import { CHUNK } from './config.js';
import { BLOCK_RULES } from './blockRules.js';
import { OUTSIDE, WATER, contours, dedupeRing, edgePoint as edgePointOf, label, ringArea, ringsIntersect, simplifyRing } from './BlockGenerator.js';

// 04.1b Block refinement (pure data). Adds to every block — without changing its
// polygon, id, road references, or DNA context:
//   buildablePolygons [{ polygon, holes, area }]   MultiPolygon of buildable land inside the block
//   buildableArea, unbuildableArea, buildableRasterArea, buildableAreaError
//   transitionArea, transitionAreaRatio, buildableTransitionArea, buildableTransitionRatio
//   fragmentClassification  null, or { class, reasons, width, … } for thin waterfront blocks
// Former remnants become result.fragments (each classified, none deleted).

const round = ring => ring.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) }));

// Bilinear sample of a 4 m terrain array; `map` turns a vertex value into the term.
function bilinear(fields, array, map) {
  const { columns, segments, spacing, size, originX, originZ } = fields.grid;
  const x0 = originX - size / 2; const z0 = originZ - size / 2;
  return (x, z) => {
    const gx = Math.min(segments, Math.max(0, (x - x0) / spacing));
    const gz = Math.min(segments, Math.max(0, (z - z0) / spacing));
    const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz));
    const tx = gx - c0; const tz = gz - r0;
    const at = (r, c) => map(r * columns + c, array[r * columns + c]);
    return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
  };
}

// Area of a ring clipped to the axis-aligned square |x−cx|,|z−cz| ≤ half (Sutherland–Hodgman;
// shoelace area stays exact for non-convex rings clipped by a convex window).
function clippedArea(ring, cx, cz, half) {
  if (half <= 0) return 0;
  let points = ring;
  const planes = [
    [p => p.x >= cx - half, (a, b) => ({ x: cx - half, z: a.z + (b.z - a.z) * (cx - half - a.x) / (b.x - a.x) })],
    [p => p.x <= cx + half, (a, b) => ({ x: cx + half, z: a.z + (b.z - a.z) * (cx + half - a.x) / (b.x - a.x) })],
    [p => p.z >= cz - half, (a, b) => ({ x: a.x + (b.x - a.x) * (cz - half - a.z) / (b.z - a.z), z: cz - half })],
    [p => p.z <= cz + half, (a, b) => ({ x: a.x + (b.x - a.x) * (cz + half - a.z) / (b.z - a.z), z: cz + half })],
  ];
  for (const [inside, cut] of planes) {
    const output = [];
    points.forEach((current, i) => {
      const previous = points[(i - 1 + points.length) % points.length];
      if (inside(current)) {
        if (!inside(previous)) output.push(cut(previous, current));
        output.push(current);
      } else if (inside(previous)) output.push(cut(previous, current));
    });
    points = output;
    if (!points.length) return 0;
  }
  return Math.abs(ringArea(points));
}

// Area of a polygon-with-holes inside the transition band (chunk minus inner square).
export function transitionArea(polygon, holes, area, grid, width) {
  const inner = grid.size / 2 - width;
  const inside = clippedArea(polygon, grid.originX, grid.originZ, inner) - holes.reduce((sum, hole) => sum + clippedArea(hole, grid.originX, grid.originZ, inner), 0);
  return Math.max(0, area - inside);
}

// Unsigned distance (m) from each sample to the nearest final (simplified) block edge, excluding edges
// that lie on the chunk boundary. Stamped only near edges; elsewhere = cap.
export function edgeDistance(field, owners, grid, reach) {
  const { m, n, h, x0, z0 } = field;
  const distance = new Float32Array(m * m).fill(BLOCK_RULES.fieldCap);
  const half = grid.size / 2;
  const onChunkEdge = (p, q) => (Math.abs(p.x - q.x) < 1e-6 && Math.abs(Math.abs(p.x - grid.originX) - half) < 1e-6) || (Math.abs(p.z - q.z) < 1e-6 && Math.abs(Math.abs(p.z - grid.originZ) - half) < 1e-6);
  for (const owner of owners) for (const ring of [owner.polygon, ...owner.holes]) ring.forEach((p, index) => {
    const q = ring[(index + 1) % ring.length];
    if (onChunkEdge(p, q)) return;
    const dx = q.x - p.x; const dz = q.z - p.z; const l2 = dx * dx + dz * dz || 1e-12;
    const jMin = Math.max(0, Math.floor((Math.min(p.x, q.x) - reach - x0) / h)); const jMax = Math.min(n - 1, Math.ceil((Math.max(p.x, q.x) + reach - x0) / h));
    const iMin = Math.max(0, Math.floor((Math.min(p.z, q.z) - reach - z0) / h)); const iMax = Math.min(n - 1, Math.ceil((Math.max(p.z, q.z) + reach - z0) / h));
    for (let i = iMin; i <= iMax; i += 1) for (let j = jMin; j <= jMax; j += 1) {
      const x = x0 + j * h; const z = z0 + i * h;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2));
      const d = Math.hypot(x - p.x - dx * t, z - p.z - dz * t);
      const k = (i + 1) * m + (j + 1);
      if (d < distance[k]) distance[k] = d;
    }
  });
  return distance;
}

export function buildableField(field, fields, owners) {
  const rules = BLOCK_RULES.buildable;
  const cap = BLOCK_RULES.fieldCap;
  const slopeTerm = bilinear(fields, fields.slope, (_, slope) => Math.max(-cap, Math.min(cap, (CHUNK.maxBuildableSlope - slope) * rules.slopeScale)));
  const freeboardTerm = bilinear(fields, fields.height, (index, height) => {
    const surface = fields.waterSurface[index];
    return Number.isFinite(surface) ? Math.max(-cap, Math.min(cap, height - surface - CHUNK.shoreFreeboard)) : cap;
  });
  const { m, n, h, x0, z0 } = field;
  const toEdge = edgeDistance(field, owners, fields.grid, rules.edgeMargin + 2);
  const value = new Float32Array(m * m).fill(-1);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = (i + 1) * m + (j + 1);
    const a = field.value[k];
    // Outside the block the margin term still applies, so the contour never sits on the raw block edge.
    if (a <= 0) { value[k] = Math.min(a, toEdge[k] - rules.edgeMargin); continue; }
    const x = x0 + j * h; const z = z0 + i * h;
    // Margin is measured from the final block outline, so buildable stays inside it after simplification.
    value[k] = Math.min(a, toEdge[k] - rules.edgeMargin, slopeTerm(x, z), freeboardTerm(x, z));
  }
  return { ...field, value };
}

// A piece is contained when all its vertices are inside the owner (not in owner holes) and no
// piece edge crosses an owner edge.
function contained(owner, rings) {
  const inside = (ring, p) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
  const ownerRings = [owner.polygon, ...owner.holes];
  if (!rings.every(ring => ring.every(p => inside(owner.polygon, p) && !owner.holes.some(hole => inside(hole, p))))) return false;
  return !crossesBetween(ownerRings, rings);
}

function crossesBetween(a, b) {
  const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (const ra of a) for (const rb of b) for (let i = 0; i < ra.length; i += 1) {
    const p = ra[i]; const q = ra[(i + 1) % ra.length];
    for (let j = 0; j < rb.length; j += 1) {
      const r = rb[j]; const t = rb[(j + 1) % rb.length];
      if (Math.max(r.x, t.x) < Math.min(p.x, q.x) || Math.min(r.x, t.x) > Math.max(p.x, q.x) || Math.max(r.z, t.z) < Math.min(p.z, q.z) || Math.min(r.z, t.z) > Math.max(p.z, q.z)) continue;
      if (orient(p, q, r) * orient(p, q, t) < 0 && orient(r, t, p) * orient(r, t, q) < 0) return true;
    }
  }
  return false;
}

function classifyFragment(item, rules) {
  const width = item.perimeter > 0 ? (2 * item.area) / item.perimeter : 0;
  const roadFrontage = item.boundaryEdges.roads.reduce((sum, road) => sum + road.length, 0);
  const waterLength = item.boundaryEdges.waterLength;
  const share = item.area > 0 ? item.buildableArea / item.area : 0;
  const slope = item.terrainStats.meanSlope;
  const reasons = [];
  let kind;
  if (item.area >= rules.buildableMinArea && width >= rules.buildableMinWidth && share >= rules.buildableMinShare && roadFrontage > 0) {
    kind = 'buildableFragment';
    reasons.push(`area ${item.area.toFixed(0)} ≥ ${rules.buildableMinArea}`, `width ${width.toFixed(1)} ≥ ${rules.buildableMinWidth}`, `buildable share ${share.toFixed(2)} ≥ ${rules.buildableMinShare}`, 'road frontage');
  } else if (item.area >= rules.publicMinArea && width >= rules.publicMinWidth && roadFrontage > 0 && (slope === null || slope <= rules.publicMaxSlope)) {
    kind = 'publicSpaceCandidate';
    reasons.push(`area ${item.area.toFixed(0)} ≥ ${rules.publicMinArea}`, `width ${width.toFixed(1)} ≥ ${rules.publicMinWidth}`, 'road frontage', slope === null ? 'slope unknown (no 4 m sample inside)' : `slope ${slope.toFixed(1)}° ≤ ${rules.publicMaxSlope}°`);
    if (share < rules.buildableMinShare) reasons.push(`buildable share ${share.toFixed(2)} < ${rules.buildableMinShare}`);
  } else if (waterLength > 0) {
    kind = 'waterfrontReserve';
    reasons.push(`touches water (${waterLength.toFixed(1)} m)`);
    if (width < rules.publicMinWidth) reasons.push(`width ${width.toFixed(1)} < ${rules.publicMinWidth}`);
    if (item.area < rules.publicMinArea) reasons.push(`area ${item.area.toFixed(0)} < ${rules.publicMinArea}`);
    if (!roadFrontage) reasons.push('no road frontage');
  } else {
    kind = 'unbuildable';
    if (item.area < rules.publicMinArea) reasons.push(`area ${item.area.toFixed(0)} < ${rules.publicMinArea}`);
    if (width < rules.publicMinWidth) reasons.push(`width ${width.toFixed(1)} < ${rules.publicMinWidth}`);
    if (!roadFrontage) reasons.push('no road frontage');
    if (slope !== null && slope > rules.publicMaxSlope) reasons.push(`slope ${slope.toFixed(1)}° > ${rules.publicMaxSlope}°`);
  }
  return { class: kind, reasons, width, area: item.area, roadFrontage, waterFrontage: waterLength, buildableShare: share, meanSlope: slope };
}

export function refineBlocks({ result, field, labels, blockOfComponent, fragmentOfComponent, fields, config }) {
  const rules = BLOCK_RULES;
  const grid = fields.grid;
  const width = config.transitionWidth;
  const owners = new Map(); // block-field component → block or fragment record
  for (const [component, index] of blockOfComponent) owners.set(component, result.blocks[index]);
  for (const [component, index] of fragmentOfComponent) owners.set(component, result.fragments[index]);
  for (const owner of owners.values()) { owner.buildablePolygons = []; owner.buildableRasterArea = 0; }

  // 1. Buildable polygons: contour of min(block availability, slope margin, freeboard margin).
  const bfield = buildableField(field, fields, [...owners.values()]);
  result.__bfield = bfield; // picked up by generateBlocks as a hidden internal
  const { labels: blabels } = label(bfield);
  const { rings } = contours(bfield);
  const { m, n, h } = bfield;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = (i + 1) * m + (j + 1);
    if (bfield.value[k] <= 0) continue;
    const owner = owners.get(labels[k]);
    if (owner) owner.buildableRasterArea += (i === 0 || i === n - 1 ? 0.5 : 1) * (j === 0 || j === n - 1 ? 0.5 : 1) * h * h;
  }
  const byPiece = new Map();
  for (const ring of rings) {
    const piece = blabels[ring.ref];
    if (!byPiece.has(piece)) byPiece.set(piece, { owner: owners.get(labels[ring.ref]), rings: [] });
    const points = ring.ids.map(id => edgePointOf(bfield, id));
    byPiece.get(piece).rings.push({ points, area: ringArea(points) });
  }
  let droppedPieces = 0; let droppedArea = 0; let invalidPieces = 0; let simplifyFallbacks = 0; let uncontainedPieces = 0;
  for (const piece of [...byPiece.keys()].sort((a, b) => a - b)) {
    const { owner, rings: pieceRings } = byPiece.get(piece);
    if (!owner) continue;
    pieceRings.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const sign = Math.sign(pieceRings[0].area);
    let outer = dedupeRing(sign > 0 ? pieceRings[0].points : [...pieceRings[0].points].reverse());
    let holes = pieceRings.slice(1).filter(ring => Math.sign(ring.area) === -sign).map(ring => dedupeRing(sign > 0 ? [...ring.points].reverse() : ring.points));
    if (ringArea(outer) < 0) outer.reverse();
    holes = holes.filter(hole => hole.length >= 3).map(hole => (ringArea(hole) < 0 ? hole : [...hole].reverse()));
    if (outer.length < 3) { droppedPieces += 1; continue; }
    const simplified = [simplifyRing(outer, rules.simplifyTolerance), ...holes.map(hole => simplifyRing(hole, rules.simplifyTolerance))];
    // Keep the simplified piece only if it is valid and still strictly inside its block; else use the raw contour.
    if (simplified.every(ring => ring.length >= 3) && !ringsIntersect(simplified) && contained(owner, simplified)) [outer, ...holes] = simplified;
    else simplifyFallbacks += 1;
    if (!contained(owner, [outer, ...holes])) uncontainedPieces += 1;
    const area = ringArea(outer) - holes.reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0);
    if (area < rules.buildable.minPiece) { droppedPieces += 1; droppedArea += Math.max(0, area); continue; }
    if (ringsIntersect([outer, ...holes])) invalidPieces += 1;
    owner.buildablePolygons.push({ polygon: round(outer), holes: holes.map(round), area });
  }

  // 2. Areas and transition shares (exact polygon clipping; corners counted once).
  const finish = owner => {
    owner.buildableArea = owner.buildablePolygons.reduce((sum, piece) => sum + piece.area, 0);
    owner.unbuildableArea = Math.max(0, owner.area - owner.buildableArea);
    owner.buildableAreaError = owner.buildableArea - owner.buildableRasterArea;
    owner.transitionArea = transitionArea(owner.polygon, owner.holes, owner.area, grid, width);
    owner.transitionAreaRatio = owner.area > 0 ? owner.transitionArea / owner.area : 0;
    owner.buildableTransitionArea = owner.buildablePolygons.reduce((sum, piece) => sum + transitionArea(piece.polygon, piece.holes, piece.area, grid, width), 0);
    owner.buildableTransitionRatio = owner.buildableArea > 0 ? owner.buildableTransitionArea / owner.buildableArea : 0;
  };
  result.blocks.forEach(finish);
  result.fragments.forEach(finish);

  // 3. Fragment classification: every former remnant, plus thin water-touching blocks.
  const fr = rules.fragments;
  for (const fragment of result.fragments) fragment.fragmentClassification = { source: 'remnant', ...classifyFragment(fragment, fr) };
  for (const block of result.blocks) {
    const thin = block.area < fr.thinBlockMaxArea && 2 * block.area / block.metrics.perimeter < fr.thinBlockMaxWidth && block.boundaryEdges.waterLength > 0;
    block.fragmentClassification = thin ? { source: 'thinWaterfrontBlock', ...classifyFragment({ ...block, perimeter: block.metrics.perimeter }, fr) } : null;
  }

  // 4. Merge candidates: neighbouring regions within mergeSearchCells samples. A merge is legal only
  //    when no road, water, or chunk edge lies between them; separate regions always have one, so
  //    candidates are recorded with their separator and none is merged by force.
  const componentOfOwner = new Map([...owners].map(([component, owner]) => [owner, component]));
  const merge = { candidates: 0, legal: 0, rejectedBy: { road: 0, water: 0, chunkEdge: 0 } };
  const seen = new Set();
  const fragmentComponents = new Set(result.fragments.map(fragment => componentOfOwner.get(fragment)));
  const samplesOf = new Map([...fragmentComponents].map(component => [component, []]));
  for (let k = 0; k < labels.length; k += 1) if (fragmentComponents.has(labels[k])) samplesOf.get(labels[k]).push(k);
  for (const fragment of result.fragments) {
    const component = componentOfOwner.get(fragment);
    const r = fr.mergeSearchCells;
    for (const k of samplesOf.get(component)) {
      for (let di = -r; di <= r; di += 1) for (let dj = -r; dj <= r; dj += 1) {
        const other = labels[k + di * m + dj];
        if (!other || other === component) continue;
        const pair = component < other ? `${component}|${other}` : `${other}|${component}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        merge.candidates += 1;
        const separators = new Set();
        const steps = Math.max(Math.abs(di), Math.abs(dj));
        for (let s = 1; s < steps; s += 1) {
          const between = k + Math.round(di * s / steps) * m + Math.round(dj * s / steps);
          if (field.value[between] <= 0) separators.add(field.source[between] === WATER ? 'water' : field.source[between] === OUTSIDE ? 'chunkEdge' : 'road');
        }
        if (!separators.size) { separators.add(field.source[k + di * m + dj] === WATER ? 'water' : 'road'); }
        if (separators.has('road')) merge.rejectedBy.road += 1;
        else if (separators.has('water')) merge.rejectedBy.water += 1;
        else if (separators.has('chunkEdge')) merge.rejectedBy.chunkEdge += 1;
      }
    }
  }

  // 5. Statistics (before = unclassified remnants and thin blocks; after = classified records).
  const classified = [...result.fragments.map(item => item.fragmentClassification), ...result.blocks.filter(block => block.fragmentClassification).map(block => block.fragmentClassification)];
  const byClass = {};
  for (const item of classified) {
    byClass[item.class] ??= { count: 0, area: 0 };
    byClass[item.class].count += 1;
    byClass[item.class].area += item.area;
  }
  const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
  result.refinement = {
    version: '04.1b',
    transitionWidth: width,
    fragmentsBefore: { remnants: result.fragments.length, remnantArea: sum(result.fragments, 'area'), thinWaterfrontBlocks: result.blocks.filter(block => block.fragmentClassification).length },
    fragmentsAfter: { classified: classified.length, deleted: 0, byClass },
    merge,
    buildable: {
      blocksArea: sum(result.blocks, 'area'),
      buildableArea: sum(result.blocks, 'buildableArea'),
      unbuildableArea: sum(result.blocks, 'unbuildableArea'),
      buildableRasterArea: sum(result.blocks, 'buildableRasterArea'),
      vertexEstimate: result.blocks.reduce((total, block) => total + block.terrainStats.buildableArea, 0),
      pieces: result.blocks.reduce((total, block) => total + block.buildablePolygons.length, 0),
      droppedPieces, droppedArea, invalidPieces, simplifyFallbacks, uncontainedPieces,
      maxAbsAreaError: Math.max(0, ...result.blocks.map(block => Math.abs(block.buildableAreaError))),
    },
    transition: {
      blocksArea: sum(result.blocks, 'transitionArea'),
      buildableArea: sum(result.blocks, 'buildableTransitionArea'),
      bandArea: grid.size * grid.size - Math.max(0, grid.size - 2 * width) ** 2,
    },
  };
}

