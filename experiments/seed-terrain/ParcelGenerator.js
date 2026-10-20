import { checksum } from '../cellular-noise/noise.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { BLOCK_RULES } from './blockRules.js';
import { PARCEL_RULES } from './parcelRules.js';
import { WATER, contours, dedupeRing, label, ringArea, ringsIntersect, simplifyRing } from './BlockGenerator.js';
import { transitionArea } from './BlockRefinement.js';

// 04.2 road-oriented parcel subdivision (pure data). Reads the block result (incl. its
// hidden 1 m fields), the NetworkGraph, and cityMatch; never changes them.
//
// Parcel { id, blockId, polygon, holes, area, frontageRoadId, frontages[{edgeId, roadClass, length}],
//          frontageType (road | corner), frontageLength, canalFrontage, orientation{inwardDeg, frontageAxisDeg},
//          depth, terrainStats, buildableStatus, transitionRatio, mayBeAdjusted, roadNodes, buildingInputs }

const polylineLength = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
const round = ring => ring.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) }));

// Part of a polyline between arc lengths d0 and d1.
function slice(points, d0, d1) {
  const out = [];
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const at = d => ({ x: a.x + (b.x - a.x) * (d - travelled) / (length || 1), z: a.z + (b.z - a.z) * (d - travelled) / (length || 1) });
    if (travelled + length >= d0 && travelled <= d1) {
      if (!out.length) out.push(at(Math.max(d0, travelled)));
      if (travelled + length <= d1) out.push(b);
      else { out.push(at(d1)); break; }
    }
    travelled += length;
  }
  return out;
}

// Nearest point on a segment and its distance.
const segmentNearest = (x, z, a, b) => {
  const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  const px = a.x + dx * t; const pz = a.z + dz * t;
  return { d: Math.hypot(x - px, z - pz), px, pz };
};

export function generateParcels(blocksResult, fields, graph, cityMatch, config) {
  const rules = PARCEL_RULES;
  const dna = cityMatch.selectedDNA.id;
  const target = rules.byDNA[dna];
  const { field, labels, blockOfComponent, bfield } = blocksResult._internal;
  const { m, n, h, x0, z0 } = field;
  const random = new SeededRandom(config.seed, 'parcels', dna);
  const blocks = blocksResult.blocks;
  const blockAt = k => { const component = labels[k]; return component && blockOfComponent.has(component) ? blockOfComponent.get(component) : -1; };
  const sampleIndex = (x, z) => {
    const j = Math.round((x - x0) / h); const i = Math.round((z - z0) / h);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : (i + 1) * m + (j + 1);
  };

  // 1. Frontage runs: walk each surface road edge; on each side probe just inside the road edge.
  const runs = [];
  for (const edge of graph.edges) {
    if (!rules.frontageKinds.includes(edge.kind)) continue;
    const hw = edge.width / 2;
    const samples = [];
    let travelled = 0; let next = 0;
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1]; const b = edge.points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (!length) continue;
      const tx = (b.x - a.x) / length; const tz = (b.z - a.z) / length;
      for (; next <= travelled + length; next += rules.sampleStep) {
        const d = next - travelled;
        samples.push({ x: a.x + tx * d, z: a.z + tz * d, tx, tz });
      }
      travelled += length;
    }
    for (const side of [1, -1]) {
      let current = null;
      const close = () => { if (current && current.points.length >= 2) runs.push(current); current = null; };
      for (const s of samples) {
        const nx = -s.tz * side; const nz = s.tx * side;
        const probe = sampleIndex(s.x + nx * (hw + rules.probeDepth), s.z + nz * (hw + rules.probeDepth));
        const block = probe >= 0 ? blockAt(probe) : -1;
        const point = { x: s.x + nx * hw, z: s.z + nz * hw };
        if (block >= 0 && current && current.blockIndex === block) { current.points.push(point); current.nx += nx; current.nz += nz; continue; }
        close();
        if (block >= 0) current = { blockIndex: block, edgeId: edge.id, roadClass: edge.roadClass, roadNodes: [edge.from, edge.to], side, points: [point], nx, nz };
      }
      close();
    }
  }
  const usableRuns = runs.map(run => ({ ...run, length: polylineLength(run.points) })).filter(run => run.length >= target.minFrontage);

  // 2. Pieces along each run at the DNA target frontage; remainders below minFrontage are merged.
  const pieces = [];
  for (const run of usableRuns) {
    const cuts = [0];
    let position = 0;
    if (!target.jitter) {
      const count = Math.max(1, Math.round(run.length / target.targetFrontage));
      for (let k = 1; k < count; k += 1) cuts.push(run.length * k / count);
    } else {
      for (;;) {
        const width = target.targetFrontage * (1 + target.jitter * (2 * random.next() - 1));
        if (run.length - (position + width) < target.minFrontage) break;
        position += width;
        cuts.push(position);
      }
    }
    cuts.push(run.length);
    for (let k = 1; k < cuts.length; k += 1) {
      const points = slice(run.points, cuts[k - 1], cuts[k]);
      if (points.length < 2) continue;
      const norm = Math.hypot(run.nx, run.nz) || 1;
      pieces.push({ run, blockIndex: run.blockIndex, edgeId: run.edgeId, roadClass: run.roadClass, points, length: cuts[k] - cuts[k - 1], first: k === 1, last: k === cuts.length - 1, normal: { x: run.nx / norm, z: run.nz / norm } });
    }
  }

  // 3. Corner lots: end pieces of two different roads meeting in the same block.
  const parent = pieces.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const groupSize = pieces.map(() => 1);
  const ends = pieces.map((piece, index) => ({ piece, index })).filter(item => item.piece.first || item.piece.last);
  for (let a = 0; a < ends.length; a += 1) for (let b = a + 1; b < ends.length; b += 1) {
    const p = ends[a].piece; const q = ends[b].piece;
    if (p.blockIndex !== q.blockIndex || p.edgeId === q.edgeId) continue;
    const pEnd = [p.first ? p.points[0] : null, p.last ? p.points.at(-1) : null].filter(Boolean);
    const qEnd = [q.first ? q.points[0] : null, q.last ? q.points.at(-1) : null].filter(Boolean);
    const close = pEnd.some(u => qEnd.some(v => Math.hypot(u.x - v.x, u.z - v.z) <= rules.cornerJoin));
    const ra = find(ends[a].index); const rb = find(ends[b].index);
    if (close && ra !== rb && groupSize[ra] + groupSize[rb] <= 3) { parent[rb] = ra; groupSize[ra] += groupSize[rb]; }
  }
  const lotOfPiece = pieces.map((_, i) => find(i));
  const lots = new Map();
  pieces.forEach((piece, i) => {
    const root = lotOfPiece[i];
    if (!lots.has(root)) lots.set(root, { index: lots.size, blockIndex: piece.blockIndex, pieces: [] });
    lots.get(root).pieces.push(piece);
  });
  const lotList = [...lots.values()];
  lotList.forEach(lot => { lot.segments = lot.pieces.flatMap(piece => piece.points.slice(1).map((b, i) => [piece.points[i], b])); });
  const lotNearest = (lot, x, z) => {
    let best = { d: Infinity, px: x, pz: z };
    for (const [a, b] of lot.segments) { const near = segmentNearest(x, z, a, b); if (near.d < best.d) best = near; }
    return best;
  };

  // 4. Nearest / second-nearest lot per buildable sample (same block only; bucketed).
  const bucketSize = 16;
  const buckets = new Map();
  const reach = target.maxDepth + 2;
  lotList.forEach(lot => lot.segments.forEach(([a, b]) => {
    for (let gx = Math.floor((Math.min(a.x, b.x) - reach) / bucketSize); gx <= Math.floor((Math.max(a.x, b.x) + reach) / bucketSize); gx += 1) {
      for (let gz = Math.floor((Math.min(a.z, b.z) - reach) / bucketSize); gz <= Math.floor((Math.max(a.z, b.z) + reach) / bucketSize); gz += 1) {
        const key = gx * 100003 + gz;
        if (!buckets.has(key)) buckets.set(key, new Set());
        buckets.get(key).add(lot);
      }
    }
  }));
  // Cell value of lot P at (x, z): first-order distance to the boundary of P's nearest-frontage cell,
  //   min over other lots X of (dX − dP) / |eP − eX|  (e = unit vector from each lot's nearest point),
  // capped by the depth limit. The pairwise term is antisymmetric, so neighbours share one boundary.
  const cap = BLOCK_RULES.fieldCap * 10;
  const lotsNear = (x, z, block) => {
    const set = buckets.get(Math.floor(x / bucketSize) * 100003 + Math.floor(z / bucketSize));
    if (!set) return [];
    const list = [];
    for (const lot of set) if (lot.blockIndex === block) { const near = lotNearest(lot, x, z); list.push({ lot, ...near }); }
    return list;
  };
  const cellValue = (list, P, x, z) => {
    const own = list.find(item => item.lot === P);
    if (!own) return -cap;
    const ex = own.d > 1e-9 ? (x - own.px) / own.d : 0; const ez = own.d > 1e-9 ? (z - own.pz) / own.d : 0;
    let value = Math.min(cap, target.maxDepth - own.d);
    for (const other of list) {
      if (other.lot === P) continue;
      const ox = other.d > 1e-9 ? (x - other.px) / other.d : 0; const oz = other.d > 1e-9 ? (z - other.pz) / other.d : 0;
      const gradient = Math.max(1e-3, Math.hypot(ex - ox, ez - oz));
      value = Math.min(value, (other.d - own.d) / gradient);
    }
    return value;
  };
  const p1 = new Int32Array(m * m).fill(-1);
  const d1 = new Float32Array(m * m).fill(Infinity);
  const v1 = new Float32Array(m * m).fill(-Infinity);
  const n1x = new Float32Array(m * m); const n1z = new Float32Array(m * m); // nearest point on the nearest lot
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = (i + 1) * m + (j + 1);
    if (bfield.value[k] <= 0) continue;
    const block = blockAt(k);
    if (block < 0) continue;
    const x = x0 + j * h; const z = z0 + i * h;
    const list = lotsNear(x, z, block);
    if (!list.length) continue;
    const nearest = list.reduce((best, item) => (item.d < best.d ? item : best));
    p1[k] = nearest.lot.index;
    d1[k] = nearest.d;
    n1x[k] = nearest.px; n1z[k] = nearest.pz;
    v1[k] = cellValue(list, nearest.lot, x, z);
  }

  // 5. Membership (positive parcel field) and per-lot sample statistics.
  const inset = rules.inset;
  const member = new Int32Array(m * m).fill(-1);
  const slopeAt = bilinear(fields, fields.slope);
  const heightAt = bilinear(fields, fields.height);
  const stats = lotList.map(() => ({ area: 0, minI: Infinity, maxI: -1, minJ: Infinity, maxJ: -1, slope: 0, maxSlope: 0, hMin: Infinity, hMax: -Infinity, depth: 0, minFrontDistance: Infinity, canalSamples: 0 }));
  const sampleArea = (i, j) => (i === 0 || i === n - 1 ? 0.5 : 1) * (j === 0 || j === n - 1 ? 0.5 : 1) * h * h;
  let buildableArea = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = (i + 1) * m + (j + 1);
    if (bfield.value[k] <= 0 || blockAt(k) < 0) continue;
    buildableArea += sampleArea(i, j);
    const lot = p1[k];
    if (lot < 0) continue;
    const value = Math.min(bfield.value[k], v1[k]) - inset;
    if (value <= 0) continue;
    member[k] = lot;
    const s = stats[lot];
    const x = x0 + j * h; const z = z0 + i * h;
    s.area += sampleArea(i, j);
    s.minI = Math.min(s.minI, i); s.maxI = Math.max(s.maxI, i); s.minJ = Math.min(s.minJ, j); s.maxJ = Math.max(s.maxJ, j);
    const slope = slopeAt(x, z); const height = heightAt(x, z);
    s.slope += slope * sampleArea(i, j); s.maxSlope = Math.max(s.maxSlope, slope);
    s.hMin = Math.min(s.hMin, height); s.hMax = Math.max(s.hMax, height);
    s.depth = Math.max(s.depth, d1[k]); s.minFrontDistance = Math.min(s.minFrontDistance, d1[k]);
    // Water within canalProbe metres (water is a facing, not access).
    const r = Math.round(rules.canalProbe / h);
    outer: for (let di = -r; di <= r; di += 1) for (let dj = -r; dj <= r; dj += 1) {
      const q = k + di * m + dj;
      if (field.value[q] <= 0 && field.source[q] === WATER) { s.canalSamples += 1; break outer; }
    }
  }

  // 6. Polygons per lot from a local field (bisector-exact shared lines, inset 0.25 m).
  const parcels = [];
  const residuals = [];
  const lotParcel = new Int32Array(lotList.length).fill(-1);
  const grid = fields.grid;
  const chunkMin = { x: x0, z: z0 }; const chunkMax = { x: x0 + (n - 1) * h, z: z0 + (n - 1) * h };
  for (const lot of lotList) {
    const s = stats[lot.index];
    const block = blocks[lot.blockIndex];
    const reject = reason => residuals.push({ blockId: block.id, lot: lot.index, area: s.area, reason });
    if (!s.area) { reject('no buildable land within lot depth'); continue; }
    const pad = 2;
    const i0 = s.minI - pad; const j0 = s.minJ - pad;
    const size = Math.max(s.maxI - s.minI, s.maxJ - s.minJ) + 2 * pad + 1;
    const sm = size + 2;
    const value = new Float32Array(sm * sm).fill(-1);
    for (let a = 0; a < size; a += 1) for (let b = 0; b < size; b += 1) {
      const i = i0 + a; const j = j0 + b;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = (i + 1) * m + (j + 1);
      if (blockAt(k) !== lot.blockIndex) continue;
      const x = x0 + j * h; const z = z0 + i * h;
      // Samples owned by another lot only need the term against that (nearest) lot: on any grid edge
      // between a P-sample and a Q-sample, Q is the nearest lot at the Q end, so the shared line is unchanged.
      let cell = -cap;
      if (p1[k] === lot.index) cell = v1[k];
      else if (p1[k] >= 0) {
        const own = lotNearest(lot, x, z);
        const ex = own.d > 1e-9 ? (x - own.px) / own.d : 0; const ez = own.d > 1e-9 ? (z - own.pz) / own.d : 0;
        const ox = d1[k] > 1e-9 ? (x - n1x[k]) / d1[k] : 0; const oz = d1[k] > 1e-9 ? (z - n1z[k]) / d1[k] : 0;
        cell = Math.min(target.maxDepth - own.d, (d1[k] - own.d) / Math.max(1e-3, Math.hypot(ex - ox, ez - oz)));
      }
      value[(a + 1) * sm + (b + 1)] = Math.min(bfield.value[k], cell) - inset;
    }
    const sub = { value, m: sm, n: size, h, x0: x0 + j0 * h, z0: z0 + i0 * h };
    const { labels: subLabels } = label(sub);
    const { rings } = contours(sub);
    const byPart = new Map();
    for (const ring of rings) {
      const part = subLabels[ring.ref];
      const points = ring.ids.map(id => clampPoint(edgePointLocal(sub, id), chunkMin, chunkMax));
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push({ points, area: ringArea(points) });
    }
    const parts = [...byPart].map(([partLabel, partRings]) => {
      partRings.sort((p, q) => Math.abs(q.area) - Math.abs(p.area));
      const sign = Math.sign(partRings[0].area);
      let outer = dedupeRing(sign > 0 ? partRings[0].points : [...partRings[0].points].reverse());
      if (ringArea(outer) < 0) outer.reverse();
      let holes = partRings.slice(1).filter(ring => Math.sign(ring.area) === -sign).map(ring => dedupeRing(sign > 0 ? [...ring.points].reverse() : ring.points)).filter(ring => ring.length >= 3).map(ring => (ringArea(ring) < 0 ? ring : [...ring].reverse()));
      const simplified = [simplifyRing(outer, rules.simplifyTolerance), ...holes.map(ring => simplifyRing(ring, rules.simplifyTolerance))];
      if (simplified.every(ring => ring.length >= 3) && !ringsIntersect(simplified)) [outer, ...holes] = simplified;
      return { label: partLabel, outer, holes, area: ringArea(outer) - holes.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0) };
    }).filter(part => part.outer.length >= 3).sort((p, q) => q.area - p.area);
    if (!parts.length) { reject('degenerate polygon'); continue; }
    const [main, ...rest] = parts;
    rest.forEach(part => residuals.push({ blockId: block.id, lot: lot.index, area: part.area, reason: 'disconnected part of a lot (separated by unbuildable land)' }));
    if (main.area < target.minArea) { reject(`area ${main.area.toFixed(0)} m² < ${target.minArea} m²`); continue; }
    if (ringsIntersect([main.outer, ...main.holes])) { reject('invalid polygon'); continue; }
    // Topological frontage: walk each piece in 1 m steps and probe inward (up to edge margin + inset + 1.5 m)
    // for samples of the kept polygon part (sub-field label). Only measured contact counts as frontage.
    const tolerance = BLOCK_RULES.buildable.edgeMargin + inset + 1.5;
    for (const piece of lot.pieces) {
      piece.contact = 0;
      for (let i = 1; i < piece.points.length; i += 1) {
        const a = piece.points[i - 1]; const b = piece.points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        for (let d = 0.5; d < length; d += 1) {
          const px = a.x + (b.x - a.x) * d / length; const pz = a.z + (b.z - a.z) * d / length;
          let touches = false;
          for (let depth = 0.5; depth <= tolerance + 1e-9 && !touches; depth += 0.5) {
            const k = sampleIndex(px + piece.normal.x * depth, pz + piece.normal.z * depth);
            if (k < 0) continue;
            const gi = Math.floor(k / m) - 1 - i0; const gj = (k % m) - 1 - j0;
            if (gi >= 0 && gj >= 0 && gi < size && gj < size && subLabels[(gi + 1) * sm + (gj + 1)] === main.label) touches = true;
          }
          if (touches) piece.contact += 1;
        }
      }
    }
    const frontageLength = lot.pieces.reduce((sum, piece) => sum + piece.contact, 0);
    if (!frontageLength) { reject(`buildable land starts ${s.minFrontDistance.toFixed(1)} m behind the road edge (no real frontage)`); continue; }
    if (frontageLength < target.minFrontage) { reject(`frontage contact ${frontageLength.toFixed(1)} m < ${target.minFrontage} m`); continue; }

    const frontages = new Map();
    lot.pieces.filter(piece => piece.contact >= 1).forEach(piece => frontages.set(piece.edgeId, { edgeId: piece.edgeId, roadClass: piece.roadClass, length: (frontages.get(piece.edgeId)?.length ?? 0) + piece.contact, roadNodes: piece.run.roadNodes }));
    const frontageList = [...frontages.values()].sort((p, q) => q.length - p.length || p.edgeId - q.edgeId);
    const primary = lot.pieces.reduce((best, piece) => (piece.contact > best.contact ? piece : best), lot.pieces[0]);
    const axis = primary.points.at(-1);
    const transition = transitionArea(main.outer, main.holes, main.area, grid, config.transitionWidth);
    lotParcel[lot.index] = parcels.length;
    parcels.push({
      id: `${block.id}-P${parcels.filter(parcel => parcel.blockId === block.id).length}`,
      blockId: block.id,
      polygon: round(main.outer),
      holes: main.holes.map(round),
      area: main.area,
      frontageRoadId: frontageList[0].edgeId,
      frontages: frontageList,
      frontageType: frontageList.length > 1 ? 'corner' : 'road',
      frontageLength,
      canalFrontage: s.canalSamples * h * h / (2 * rules.canalProbe), // ≈ length of the parcel strip within canalProbe of water
      orientation: {
        inwardDeg: ((Math.atan2(primary.normal.z, primary.normal.x) * 180 / Math.PI) + 360) % 360,
        frontageAxisDeg: ((Math.atan2(axis.z - primary.points[0].z, axis.x - primary.points[0].x) * 180 / Math.PI) % 180 + 180) % 180,
      },
      depth: s.depth,
      terrainStats: { meanSlope: s.slope / s.area, maxSlope: s.maxSlope, minHeight: s.hMin, maxHeight: s.hMax, sampleArea: s.area },
      buildableStatus: 'buildable', // parcels lie inside buildablePolygons by construction
      transitionRatio: main.area > 0 ? transition / main.area : 0,
      mayBeAdjusted: transition > 0, // inside the transition band: may change when neighbour chunks are joined
      clippedBlock: block.clippedByBoundary,
      roadNodes: frontageList[0].roadNodes,
      frontageLines: lot.pieces.filter(piece => piece.contact >= 1).map(piece => round(piece.points)),
      buildingInputs: { ...rules.building },
    });
  }

  // 7. Reserve: buildable land in blocks that no valid parcel covers.
  const reserveByBlock = new Map();
  const terrainParcelIndex = new Int32Array(fields.grid.columns * fields.grid.columns).fill(-1);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = (i + 1) * m + (j + 1);
    if (bfield.value[k] <= 0 || blockAt(k) < 0) continue;
    const parcel = member[k] >= 0 ? lotParcel[member[k]] : -1;
    if (parcel < 0) reserveByBlock.set(blockAt(k), (reserveByBlock.get(blockAt(k)) ?? 0) + sampleArea(i, j));
  }
  const step = Math.round(fields.grid.spacing / h);
  for (let r = 0; r <= fields.grid.segments; r += 1) for (let c = 0; c <= fields.grid.segments; c += 1) {
    const k = (r * step + 1) * m + (c * step + 1);
    if (bfield.value[k] <= 0 || blockAt(k) < 0) continue;
    const parcel = member[k] >= 0 ? lotParcel[member[k]] : -1;
    terrainParcelIndex[r * fields.grid.columns + c] = parcel >= 0 ? parcel : -5;
  }
  const blocksWithoutFrontage = blocks.filter((block, index) => block.buildableArea > 0 && !usableRuns.some(run => run.blockIndex === index)).map(block => block.id);
  const parcelArea = parcels.reduce((sum, parcel) => sum + parcel.area, 0);
  const result = {
    version: '04.2',
    source: { dna, strategy: graph.strategy, seed: config.seed, landform: config.landform, blocksSignature: blocksResult.signature },
    units: { length: 'm', area: 'm²', angle: 'deg from +x toward +z' },
    rules: { ...rules, target },
    parcels,
    residuals,
    reserve: [...reserveByBlock].sort((a, b) => a[0] - b[0]).map(([index, area]) => ({ blockId: blocks[index].id, area, reason: blocksWithoutFrontage.includes(blocks[index].id) ? 'no road frontage (water or chunk edge only)' : 'beyond lot depth / unresolved lots' })),
    terrainParcelIndex,
    stats: {
      parcels: parcels.length,
      corner: parcels.filter(parcel => parcel.frontageType === 'corner').length,
      withCanalFrontage: parcels.filter(parcel => parcel.canalFrontage > 1).length,
      frontageRuns: usableRuns.length,
      lots: lotList.length,
      unresolvedLots: residuals.filter(item => item.lot !== undefined && !item.reason.startsWith('disconnected')).length,
      validFrontageRate: parcels.length ? parcels.filter(parcel => parcel.frontageLength >= target.minFrontage).length / parcels.length : 0,
      meanFrontage: parcels.length ? parcels.reduce((sum, parcel) => sum + parcel.frontageLength, 0) / parcels.length : 0,
      meanArea: parcels.length ? parcelArea / parcels.length : 0,
      meanDepth: parcels.length ? parcels.reduce((sum, parcel) => sum + parcel.depth, 0) / parcels.length : 0,
      buildableArea,
      parcelArea,
      utilisation: buildableArea ? parcelArea / buildableArea : 0,
      reserveArea: [...reserveByBlock.values()].reduce((sum, area) => sum + area, 0),
      blocksWithoutFrontage,
      inTransition: parcels.filter(parcel => parcel.mayBeAdjusted).length,
    },
  };
  result.signature = checksum(new TextEncoder().encode(JSON.stringify(parcels.map(parcel => [parcel.id, parcel.polygon, parcel.frontageRoadId]))));
  return result;
}

function bilinear(fields, array) {
  const { columns, segments, spacing, size, originX, originZ } = fields.grid;
  const x0 = originX - size / 2; const z0 = originZ - size / 2;
  return (x, z) => {
    const gx = Math.min(segments, Math.max(0, (x - x0) / spacing)); const gz = Math.min(segments, Math.max(0, (z - z0) / spacing));
    const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz));
    const tx = gx - c0; const tz = gz - r0;
    const at = (r, c) => array[r * columns + c];
    return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
  };
}

// Crossing point on a local sub-field edge (same interpolation as the block contours, no clamp).
export function edgePointLocal(field, id) {
  const { value, m, h, x0, z0 } = field;
  const vertical = id >= m * m;
  const local = vertical ? id - m * m : id;
  const i = Math.floor(local / m); const j = local % m;
  const va = value[local]; const vb = value[vertical ? local + m : local + 1];
  const t = Math.min(1 - 1e-4, Math.max(1e-4, va / (va - vb)));
  const xa = x0 + (j - 1) * h; const za = z0 + (i - 1) * h;
  return vertical ? { x: xa, z: za + t * h } : { x: xa + t * h, z: za };
}

const clampPoint = (p, min, max) => ({ x: Math.min(max.x, Math.max(min.x, p.x)), z: Math.min(max.z, Math.max(min.z, p.z)) });
