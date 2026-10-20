import { checksum } from '../cellular-noise/noise.js';
import { BLOCK_RULES } from './blockRules.js';
import { DNA_STRATEGY, strategyParams } from './networkStrategies.js';
import { refineBlocks } from './BlockRefinement.js';

// Urban block extraction (pure data; no Three.js, no upstream changes).
//
// 1. Availability field a(p) on a 1 m grid over the chunk:
//      a = min( distance to each surface road centreline − ½ road width,  height − water surface )
//    Tunnels never enter the field (underground); canals are water already.
// 2. Blocks are the 4-connected regions a > 0. Their boundaries are the a = 0
//    contours (marching squares, saddles resolved to keep positive corners apart,
//    matching the 4-connected labelling), so rings are closed, simple, and disjoint.
// 3. Each boundary vertex records what made it: a road edge id, water, or the chunk edge.
//
// Block { id, polygon[{x,z}] (outer ring, CCW in x→z), holes[[{x,z}]], area (m²), centroid,
//         boundaryEdges { roads[{edgeId, length}], waterLength, chunkBoundaryLength },
//         adjacentRoads[{ edgeId, roadClass, kind, frontage, nodes[from,to] }],
//         terrainStats, buildableStatus, enclosure, clippedByBoundary, metrics, dnaContext, valid }

export const WATER = -1;
export const OUTSIDE = -2;

export function buildField(fields, graph, rules) {
  const { size, originX, originZ } = fields.grid;
  const h = rules.resolution;
  const n = Math.round(size / h) + 1; // samples per side inside the chunk
  const m = n + 2; // padded with one outside ring
  const half = size / 2;
  const value = new Float32Array(m * m).fill(-1);
  const source = new Int32Array(m * m).fill(OUTSIDE);
  const x0 = originX - half; const z0 = originZ - half;
  // Water term: bilinear of (height − water surface) on the 4 m terrain grid.
  const { columns, segments, spacing } = fields.grid;
  const waterTerm = (x, z) => {
    const gx = Math.min(segments, Math.max(0, (x - x0) / spacing));
    const gz = Math.min(segments, Math.max(0, (z - z0) / spacing));
    const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz));
    const tx = gx - c0; const tz = gz - r0;
    const at = (r, c) => {
      const surface = fields.waterSurface[r * columns + c];
      return Number.isFinite(surface) ? Math.max(-rules.fieldCap, Math.min(rules.fieldCap, fields.height[r * columns + c] - surface)) : rules.fieldCap;
    };
    return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const k = (i + 1) * m + (j + 1);
      const w = waterTerm(x0 + j * h, z0 + i * h);
      value[k] = Math.min(rules.fieldCap, w);
      source[k] = w < rules.fieldCap ? WATER : OUTSIDE;
    }
  }
  // Road term: stamp exact segment distances minus half width, keeping the minimum.
  const cutting = new Set(rules.cuttingKinds);
  for (const edge of graph.edges) {
    if (!cutting.has(edge.kind)) continue;
    const halfWidth = edge.width / 2;
    for (let s = 1; s < edge.points.length; s += 1) {
      const a = edge.points[s - 1]; const b = edge.points[s];
      const reach = halfWidth + rules.fieldCap;
      const jMin = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - x0) / h));
      const jMax = Math.min(n - 1, Math.ceil((Math.max(a.x, b.x) + reach - x0) / h));
      const iMin = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - z0) / h));
      const iMax = Math.min(n - 1, Math.ceil((Math.max(a.z, b.z) + reach - z0) / h));
      const dx = b.x - a.x; const dz = b.z - a.z; const length2 = dx * dx + dz * dz || 1e-12;
      for (let i = iMin; i <= iMax; i += 1) {
        const z = z0 + i * h;
        for (let j = jMin; j <= jMax; j += 1) {
          const x = x0 + j * h;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) - halfWidth;
          const k = (i + 1) * m + (j + 1);
          if (d < value[k]) { value[k] = d; source[k] = edge.id; }
        }
      }
    }
  }
  return { value, source, n, m, h, x0, z0 };
}

// 4-connected labelling of positive samples (inside the chunk only).
export function label(field) {
  const { value, m } = field;
  const labels = new Int32Array(m * m);
  const stack = new Int32Array(m * m);
  let count = 0;
  for (let k = 0; k < m * m; k += 1) {
    if (value[k] <= 0 || labels[k]) continue;
    count += 1;
    let top = 0;
    stack[top++] = k;
    labels[k] = count;
    while (top) {
      const at = stack[--top];
      for (const next of [at - 1, at + 1, at - m, at + m]) {
        if (value[next] > 0 && !labels[next]) { labels[next] = count; stack[top++] = next; }
      }
    }
  }
  return { labels, count };
}

// Marching squares with directed segments (inside on the left). Edge ids:
// horizontal (i,j)-(i,j+1) → i·m + j; vertical (i,j)-(i+1,j) → m·m + i·m + j.
const CASES = (() => {
  // [edgeFrom, edgeTo, referenceCorner]; edges 0 top, 1 right, 2 bottom, 3 left; corners a0 b1 c2 d3.
  const table = Array.from({ length: 16 }, () => []);
  table[1] = [[3, 0, 0]]; table[2] = [[0, 1, 1]]; table[3] = [[3, 1, 0]]; table[4] = [[1, 2, 2]];
  table[5] = [[3, 0, 0], [1, 2, 2]]; table[6] = [[0, 2, 1]]; table[7] = [[2, 3, 0]]; table[8] = [[2, 3, 3]];
  table[9] = [[0, 2, 0]]; table[10] = [[0, 1, 1], [2, 3, 3]]; table[11] = [[1, 2, 0]]; table[12] = [[1, 3, 2]];
  table[13] = [[0, 1, 0]]; table[14] = [[3, 0, 1]];
  return table;
})();

export function contours(field) {
  const { value, m, h, x0, z0, n } = field;
  const half = (n - 1) * h / 2;
  const cx = x0 + half; const cz = z0 + half;
  const next = new Int32Array(2 * m * m).fill(-1);
  const refSample = new Int32Array(2 * m * m).fill(-1);
  const edgeId = (i, j, e) => (e === 0 ? i * m + j : e === 2 ? (i + 1) * m + j : e === 3 ? m * m + i * m + j : m * m + i * m + j + 1);
  for (let i = 0; i < m - 1; i += 1) {
    for (let j = 0; j < m - 1; j += 1) {
      const corners = [i * m + j, i * m + j + 1, (i + 1) * m + j + 1, (i + 1) * m + j];
      const index = (value[corners[0]] > 0 ? 1 : 0) | (value[corners[1]] > 0 ? 2 : 0) | (value[corners[2]] > 0 ? 4 : 0) | (value[corners[3]] > 0 ? 8 : 0);
      for (const [from, to, ref] of CASES[index]) {
        // Orient so the reference (inside) corner lies on the left of from → to.
        // Orientation uses unclamped crossings: clamping to the chunk edge can make p and q coincide.
        const p = edgePoint(field, edgeId(i, j, from), false); const q = edgePoint(field, edgeId(i, j, to), false);
        const r = { x: x0 + (corners[ref] % m - 1) * h, z: z0 + (Math.floor(corners[ref] / m) - 1) * h };
        const left = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x) > 0;
        const a = left ? edgeId(i, j, from) : edgeId(i, j, to);
        const b = left ? edgeId(i, j, to) : edgeId(i, j, from);
        next[a] = b;
        refSample[a] = corners[ref];
      }
    }
  }
  const rings = [];
  const seen = new Uint8Array(next.length);
  for (let start = 0; start < next.length; start += 1) {
    if (next[start] < 0 || seen[start]) continue;
    const ids = [];
    for (let at = start; !seen[at]; at = next[at]) { seen[at] = 1; ids.push(at); }
    rings.push({ ids, ref: refSample[start] });
  }
  return { rings, cx, cz, half };
}

// Crossing point on an edge (linear interpolation), clamped to the chunk.
export function edgePoint(field, id, clamp = true) {
  const { value, m, h, x0, z0, n } = field;
  const vertical = id >= m * m;
  const local = vertical ? id - m * m : id;
  const i = Math.floor(local / m); const j = local % m;
  const a = local; const b = vertical ? local + m : local + 1;
  const va = value[a]; const vb = value[b];
  const t = Math.min(1 - 1e-4, Math.max(1e-4, va / (va - vb)));
  const xa = x0 + (j - 1) * h; const za = z0 + (i - 1) * h;
  const max = (n - 1) * h;
  const x = vertical ? xa : xa + t * h;
  const z = vertical ? za + t * h : za;
  if (!clamp) return { x, z };
  return { x: Math.min(x0 + max, Math.max(x0, x)), z: Math.min(z0 + max, Math.max(z0, z)) };
}

// What lies on the outside of a crossing edge: road edge id, WATER, or OUTSIDE (chunk edge).
function edgeSource(field, id) {
  const { value, source, m } = field;
  const vertical = id >= m * m;
  const local = vertical ? id - m * m : id;
  const a = local; const b = vertical ? local + m : local + 1;
  const outside = value[a] > 0 ? b : a;
  const i = Math.floor(outside / m); const j = outside % m;
  if (i === 0 || j === 0 || i === m - 1 || j === m - 1) return OUTSIDE;
  return source[outside];
}

export const ringArea = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;

export function dedupeRing(points) {
  const out = [];
  for (const p of points) if (!out.length || Math.hypot(p.x - out.at(-1).x, p.z - out.at(-1).z) > 1e-6) out.push(p);
  while (out.length > 1 && Math.hypot(out[0].x - out.at(-1).x, out[0].z - out.at(-1).z) <= 1e-6) out.pop();
  // Drop exactly collinear vertices (e.g. along a clamped chunk edge).
  return out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length]; const b = out[(i + 1) % out.length];
    return Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) > 1e-9;
  });
}

export function simplifyRing(ring, tolerance) {
  if (ring.length < 8) return ring;
  let far = 0;
  for (let i = 1; i < ring.length; i += 1) if (Math.hypot(ring[i].x - ring[0].x, ring[i].z - ring[0].z) > Math.hypot(ring[far].x - ring[0].x, ring[far].z - ring[0].z)) far = i;
  const dp = points => {
    const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const a = points[s]; const b = points[e];
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1e-12;
      let max = -1; let at = -1;
      for (let k = s + 1; k < e; k += 1) {
        const d = Math.abs((b.x - a.x) * (a.z - points[k].z) - (a.x - points[k].x) * (b.z - a.z)) / length;
        if (d > max) { max = d; at = k; }
      }
      if (max > tolerance) { keep[at] = 1; stack.push([s, at], [at, e]); }
    }
    return points.filter((_, i) => keep[i]);
  };
  const first = dp(ring.slice(0, far + 1));
  const second = dp([...ring.slice(far), ring[0]]);
  const result = [...first, ...second.slice(1, -1)];
  return result.length >= 3 ? result : ring;
}

// Proper intersections among the segments of a set of rings (bucketed).
export function ringsIntersect(rings) {
  const segments = [];
  rings.forEach((ring, r) => ring.forEach((p, i) => segments.push({ r, i, n: ring.length, a: p, b: ring[(i + 1) % ring.length] })));
  const cell = 8;
  const buckets = new Map();
  segments.forEach((s, index) => {
    for (let x = Math.floor(Math.min(s.a.x, s.b.x) / cell); x <= Math.floor(Math.max(s.a.x, s.b.x) / cell); x += 1) {
      for (let z = Math.floor(Math.min(s.a.z, s.b.z) / cell); z <= Math.floor(Math.max(s.a.z, s.b.z) / cell); z += 1) {
        const key = x * 100003 + z;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      }
    }
  });
  const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x += 1) for (let y = x + 1; y < list.length; y += 1) {
      const s = segments[list[x]]; const t = segments[list[y]];
      if (s.r === t.r && (Math.abs(s.i - t.i) <= 1 || Math.abs(s.i - t.i) === s.n - 1)) continue; // neighbours share a vertex
      const d1 = orient(s.a, s.b, t.a); const d2 = orient(s.a, s.b, t.b); const d3 = orient(t.a, t.b, s.a); const d4 = orient(t.a, t.b, s.b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
      if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) continue;
    }
  }
  return false;
}

export function generateBlocks(fields, analysis, graph, cityMatch, config) {
  const rules = BLOCK_RULES;
  const field = buildField(fields, graph, rules);
  const { labels, count } = label(field);
  const { rings: rawRings } = contours(field);
  const edgesById = new Map(graph.edges.map(edge => [edge.id, edge]));

  // Group rings by the component of their inside reference sample.
  const byComponent = new Map();
  for (const ring of rawRings) {
    const component = labels[ring.ref];
    if (!byComponent.has(component)) byComponent.set(component, []);
    const points = ring.ids.map(id => edgePoint(field, id));
    const sources = ring.ids.map(id => edgeSource(field, id));
    byComponent.get(component).push({ points, sources, area: ringArea(points) });
  }

  // Sample-based areas (Voronoi weights) for accounting and terrain stats.
  const { n, m, h } = field;
  const sampleArea = (i, j) => (i === 0 || i === n - 1 ? 0.5 : 1) * (j === 0 || j === n - 1 ? 0.5 : 1) * h * h;
  let roadArea = 0; let waterArea = 0;
  const componentArea = new Float64Array(count + 1);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = (i + 1) * m + (j + 1);
    const w = sampleArea(i, j);
    if (field.value[k] > 0) componentArea[labels[k]] += w;
    else if (field.source[k] === WATER) waterArea += w;
    else roadArea += w;
  }

  // Terrain stats from the existing 4 m fields (vertex Voronoi weights).
  const { columns, segments, spacing } = fields.grid;
  const terrain = new Map();
  const step = Math.round(spacing / h);
  for (let r = 0; r <= segments; r += 1) for (let c = 0; c <= segments; c += 1) {
    const component = labels[(r * step + 1) * m + (c * step + 1)];
    if (!component) continue;
    const index = r * columns + c;
    const w = (r === 0 || r === segments ? 0.5 : 1) * (c === 0 || c === segments ? 0.5 : 1) * spacing * spacing;
    if (!terrain.has(component)) terrain.set(component, { w: 0, buildable: 0, slope: 0, maxSlope: 0, hMin: Infinity, hMax: -Infinity, hSum: 0, water: 0, suitability: [0, 0, 0, 0] });
    const t = terrain.get(component);
    t.w += w;
    if (fields.buildableMask[index]) t.buildable += w;
    if (fields.waterMask[index]) t.water += w;
    t.slope += fields.slope[index] * w;
    t.maxSlope = Math.max(t.maxSlope, fields.slope[index]);
    t.hMin = Math.min(t.hMin, fields.height[index]); t.hMax = Math.max(t.hMax, fields.height[index]); t.hSum += fields.height[index] * w;
    if (analysis?.suitabilityMask) t.suitability[analysis.suitabilityMask[index]] += w;
  }

  const dna = cityMatch?.selectedDNA?.id ?? null;
  const grid = DNA_STRATEGY[dna] === 'grid' ? strategyParams(dna) : null;
  const expectedGridBlock = grid ? (grid.primarySpacing - (grid.widths.primary + grid.widths.secondary) / 2) * (grid.secondarySpacing - grid.widths.secondary) : null;
  const blocks = [];
  let remnants = 0; let remnantArea = 0; let invalid = 0; let fragmentInvalid = 0; let simplifiedFallbacks = 0;
  const blockOfComponent = new Map();
  const fragmentOfComponent = new Map();
  const fragments = []; // 04.1b: former remnants (< minBlockArea), kept and classified, never deleted
  const components = [...byComponent.keys()].sort((a, b) => a - b);
  for (const component of components) {
    const rings = byComponent.get(component).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const outer = rings[0];
    const sign = Math.sign(outer.area);
    const holes = rings.slice(1).filter(ring => Math.sign(ring.area) === -sign);
    const orientedOuter = sign > 0 ? outer : { ...outer, points: [...outer.points].reverse(), sources: [...outer.sources].reverse() };
    const area = Math.abs(outer.area) - holes.reduce((sum, ring) => sum + Math.abs(ring.area), 0);
    const isRemnant = area < rules.minBlockArea;

    // Boundary attribution (per raw segment, before simplification).
    const frontage = new Map(); let waterLength = 0; let chunkLength = 0;
    for (const ring of [outer, ...holes]) {
      ring.points.forEach((p, i) => {
        const q = ring.points[(i + 1) % ring.points.length];
        const length = Math.hypot(q.x - p.x, q.z - p.z);
        const src = ring.sources[i];
        if (src === WATER) waterLength += length;
        else if (src === OUTSIDE) chunkLength += length;
        else frontage.set(src, (frontage.get(src) ?? 0) + length);
      });
    }
    let polygon = dedupeRing(orientedOuter.points);
    let holeRings = holes.map(ring => dedupeRing(sign > 0 ? [...ring.points].reverse() : ring.points)).map(ring => (ringArea(ring) < 0 ? ring : [...ring].reverse()));
    if (ringArea(polygon) < 0) polygon.reverse();
    const simplified = [simplifyRing(polygon, rules.simplifyTolerance), ...holeRings.map(ring => simplifyRing(ring, rules.simplifyTolerance))];
    if (simplified.every(ring => ring.length >= 3) && !ringsIntersect(simplified)) {
      [polygon, ...holeRings] = simplified;
    } else simplifiedFallbacks += 1;
    const valid = polygon.length >= 3 && holeRings.every(ring => ring.length >= 3) && !ringsIntersect([polygon, ...holeRings]);
    const polygonArea = ringArea(polygon) - holeRings.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);

    // Centroid and principal axis of the outer ring.
    let cxs = 0; let czs = 0; let a2 = 0;
    polygon.forEach((p, i) => { const q = polygon[(i + 1) % polygon.length]; const cross = p.x * q.z - q.x * p.z; a2 += cross; cxs += (p.x + q.x) * cross; czs += (p.z + q.z) * cross; });
    const centroid = { x: cxs / (3 * a2), z: czs / (3 * a2) };
    let xx = 0; let zz = 0; let xz = 0;
    polygon.forEach(p => { xx += (p.x - centroid.x) ** 2; zz += (p.z - centroid.z) ** 2; xz += (p.x - centroid.x) * (p.z - centroid.z); });
    const root = Math.sqrt(((xx - zz) / 2) ** 2 + xz * xz);
    const perimeter = [polygon, ...holeRings].reduce((sum, ring) => sum + ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + Math.hypot(q.x - p.x, q.z - p.z); }, 0), 0);

    const t = terrain.get(component) ?? { w: 0, buildable: 0, slope: 0, maxSlope: 0, hMin: 0, hMax: 0, hSum: 0, water: 0, suitability: [0, 0, 0, 0] };
    const buildableShare = t.w ? t.buildable / t.w : 0;
    const roadFrontage = [...frontage.values()].reduce((sum, length) => sum + length, 0);
    const enclosure = chunkLength > 0 ? 'clipped' : roadFrontage > 0 && waterLength > 0 ? 'roadsAndWater' : roadFrontage > 0 ? 'roads' : 'waterOnly';
    if (isRemnant) {
      remnants += 1;
      remnantArea += componentArea[component];
      if (!valid) fragmentInvalid += 1;
      fragmentOfComponent.set(component, fragments.length);
      fragments.push({
        id: `F${fragments.length}`,
        polygon: polygon.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) })),
        holes: holeRings.map(ring => ring.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) }))),
        area: polygonArea, sampleArea: componentArea[component], centroid, perimeter,
        boundaryEdges: { roads: [...frontage].sort((a, b) => a[0] - b[0]).map(([edgeId, length]) => ({ edgeId, length })), waterLength, chunkBoundaryLength: chunkLength },
        terrainStats: { meanSlope: t.w ? t.slope / t.w : null, buildableShareVertices: t.w ? buildableShare : null },
        valid,
      });
      continue;
    }
    if (!valid) invalid += 1;
    blockOfComponent.set(component, blocks.length);
    blocks.push({
      id: `B${blocks.length}`,
      polygon: polygon.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) })),
      holes: holeRings.map(ring => ring.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) }))),
      area: polygonArea,
      sampleArea: componentArea[component],
      centroid,
      boundaryEdges: {
        roads: [...frontage].sort((a, b) => a[0] - b[0]).map(([edgeId, length]) => ({ edgeId, length })),
        waterLength,
        chunkBoundaryLength: chunkLength,
      },
      adjacentRoads: [...frontage].filter(([, length]) => length >= 1).sort((a, b) => a[0] - b[0]).map(([edgeId, length]) => {
        const edge = edgesById.get(edgeId);
        return { edgeId, roadClass: edge.roadClass, kind: edge.kind, frontage: length, nodes: [edge.from, edge.to] };
      }),
      terrainStats: {
        sampledArea: t.w, buildableArea: t.buildable, buildableShare, meanSlope: t.w ? t.slope / t.w : 0, maxSlope: t.maxSlope,
        minHeight: t.hMin, maxHeight: t.hMax, meanHeight: t.w ? t.hSum / t.w : 0, waterSampleArea: t.water,
        suitabilityArea: t.suitability,
      },
      buildableStatus: buildableShare >= rules.status.buildableMin ? 'buildable' : buildableShare >= rules.status.partialMin ? 'partial' : 'unbuildable',
      enclosure,
      clippedByBoundary: chunkLength > 0,
      metrics: {
        perimeter,
        compactness: 4 * Math.PI * polygonArea / (perimeter * perimeter),
        principalAxisDeg: ((0.5 * Math.atan2(2 * xz, xx - zz) * 180 / Math.PI) + 180) % 180,
        elongation: Math.sqrt(((xx + zz) / 2 + root) / Math.max(1e-9, (xx + zz) / 2 - root)),
        roadFrontage,
        vertexCount: polygon.length + holeRings.reduce((sum, ring) => sum + ring.length, 0),
      },
      dnaContext: {
        dna,
        expectedGridBlockArea: expectedGridBlock,
        parcelHint: cityMatch?.parcelHints?.subdivision ?? null,
        note: 'Context for the later parcel step only; blocks are never forced to a DNA shape.',
      },
      valid,
    });
  }

  // Terrain-vertex lookup for later steps and debug colouring: block index ≥ 0,
  // −2 road corridor, −3 water, −4 remnant.
  const terrainBlockIndex = new Int32Array(columns * columns);
  for (let r = 0; r <= segments; r += 1) for (let c = 0; c <= segments; c += 1) {
    const k = (r * step + 1) * m + (c * step + 1);
    const component = labels[k];
    // ≤ −10: fragment (−10 − fragment index).
    terrainBlockIndex[r * columns + c] = component ? (blockOfComponent.has(component) ? blockOfComponent.get(component) : -10 - (fragmentOfComponent.get(component) ?? 0)) : field.source[k] === WATER ? -3 : -2;
  }

  const chunkArea = fields.grid.size * fields.grid.size;
  const blocksArea = blocks.reduce((sum, block) => sum + block.area, 0);
  const result = {
    version: '04.1',
    source: { landform: config.landform, seed: config.seed, dna, strategy: graph.strategy, networkSignature: graph.signature },
    units: { length: 'm', area: 'm²', coordinates: 'world x / z (m), y omitted (blocks are plan polygons)' },
    rules,
    blocks,
    fragments,
    terrainBlockIndex,
    stats: {
      blocks: blocks.length,
      byEnclosure: Object.fromEntries(['roads', 'roadsAndWater', 'waterOnly', 'clipped'].map(kind => [kind, blocks.filter(block => block.enclosure === kind).length])),
      byStatus: Object.fromEntries(['buildable', 'partial', 'unbuildable'].map(kind => [kind, blocks.filter(block => block.buildableStatus === kind).length])),
      invalid,
      fragmentInvalid,
      simplifiedFallbacks,
      remnants,
      area: {
        chunk: chunkArea,
        blocks: blocksArea,
        blocksSampled: blocks.reduce((sum, block) => sum + block.sampleArea, 0),
        roads: roadArea,
        water: waterArea,
        remnants: remnantArea,
        residual: chunkArea - blocks.reduce((sum, block) => sum + block.sampleArea, 0) - roadArea - waterArea - remnantArea,
        buildableInBlocks: blocks.reduce((sum, block) => sum + block.terrainStats.buildableArea, 0),
        clippedBlocks: blocks.filter(block => block.clippedByBoundary).reduce((sum, block) => sum + block.area, 0),
        enclosedBlocks: blocks.filter(block => !block.clippedByBoundary).reduce((sum, block) => sum + block.area, 0),
      },
    },
  };
  result.signature = checksum(new TextEncoder().encode(JSON.stringify(blocks.map(block => [block.id, block.polygon, block.holes]))));
  // 04.1b refinement: buildable polygons, fragment classes, transition shares (block polygons unchanged).
  refineBlocks({ result, field, labels, blockOfComponent, fragmentOfComponent, fields, graph, config });
  // Hidden (non-enumerable) internals for the parcel step; not part of the serialised block data.
  Object.defineProperty(result, '_internal', { value: { field, labels, blockOfComponent, fragmentOfComponent, bfield: result.__bfield }, enumerable: false });
  delete result.__bfield;
  return result;
}
