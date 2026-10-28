// 07.1 City Influence & Fusion (pure data, no rendering). One source city invades one neighbouring target chunk.
// Chunk grid, terrain, water and the frozen tunnel algorithm are never touched; only the target chunk's network,
// parcels and buildings are regenerated with a locally mixed rule set.
//
// Influence field (world metres): d = distance from (x, z) to the source chunk square (0 inside it),
//   w(x, z) = strength · (1 − smoothstep(d / radius))      (w = strength inside the source, 0 beyond radius).
// Seam guard: inside the target, w is multiplied by smoothstep((e − W) / W), e = distance to the nearest target side
// NOT shared with the source, W = transition width. The fusion zone never reaches the target's other seam bands, so
// road ports there (and every third chunk's joins) stay as they were.
// Base DNA = the target chunk's own resolved DNA; invading DNA = the source chunk's resolved DNA (manual or auto).
//
// How each rule is mixed (see RULES below):
//   continuous — parcel frontage / depth / jitter / min sizes and building occupancy / setbacks / depth / floors /
//                floor height / height weights / centre radius are interpolated by w (one table of 65 levels).
//   discrete   — street topology (grid vs organic vs canal-street, incl. quays and canals) cannot be averaged: each
//                edge of both networks (base on the target terrain, invader on the same terrain) is clipped at its
//                own threshold τ ∈ [0.35, 0.65] (hashed from the edge), base kept where w < τ, invader where w ≥ τ.
//                The spread of τ makes a fusion band where both street systems interleave instead of a hard line;
//                crossings between them become junctions, cut ends are joined to the other system when a short dry
//                straight link exists. Courtyard rule: invader's from w ≥ 0.5. Tunnels: base tunnels kept, invader
//                tunnels dropped (no new tunnel logic).
import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';
import { GraphBuilder } from '../seed-terrain/NetworkGraph.js';
import { createSampler, findCrossings } from '../seed-terrain/NetworkGenerator.js';
import { DNA_STRATEGY, NETWORK_COMMON } from '../seed-terrain/networkStrategies.js';
import { PARCEL_RULES } from '../seed-terrain/parcelRules.js';
import { BUILDING_RULES } from '../seed-terrain/buildingRules.js';

export const INFLUENCE = Object.freeze({
  levels: 64, // weight quantisation of the mixed rule tables (w < 1/128 → exactly the base rule)
  threshold: { min: 0.35, max: 0.65 }, // per-edge network switch threshold range (A)
  clipStep: 4, // m between weight samples along an edge (= terrain cell)
  connector: { maxLength: 40, maxSlopeDeg: 15, step: 2 }, // cut end → other system: straight, dry, gentle (A)
  courtyardFrom: 0.5,
  defaults: { strength: 0, radius: 384 },
  radius: { min: 64, max: 1024 },
});

// Spatial rules of the fusion zone. value(dna) gives the rule's level for one DNA (0–1 or metres / floors);
// regularity, waterfront and organicity are strategy-level design assumptions (A), the rest read the DNA configs.
const STRATEGY_PROFILE = { grid: { regularity: 1, waterfront: 0.2 }, canalStreet: { regularity: 0.4, waterfront: 1 }, organic: { regularity: 0.15, waterfront: 0.3 } };
const meanFloors = dna => { const r = BUILDING_RULES.byDNA[dna]; return (r.floors[0] + r.floors[1]) / 2 * r.floorHeight; };
export const RULES = [
  { id: 'networkRegularity', unit: '0–1', mixing: 'discrete', layer: 'network', value: dna => STRATEGY_PROFILE[DNA_STRATEGY[dna]].regularity, note: 'street topology switch per edge (τ band)' },
  { id: 'streetDensity', unit: 'km / km²', mixing: 'discrete', layer: 'network', value: null, note: 'measured on the generated networks' },
  { id: 'parcelRegularity', unit: '0–1', mixing: 'continuous', layer: 'parcel', value: dna => +(1 - PARCEL_RULES.byDNA[dna].jitter / 0.35).toFixed(3), note: '1 − frontage jitter / 0.35' },
  { id: 'parcelScale', unit: 'm frontage × m depth', mixing: 'continuous', layer: 'parcel', value: dna => `${PARCEL_RULES.byDNA[dna].targetFrontage} × ${PARCEL_RULES.byDNA[dna].maxDepth}`, note: 'target frontage, max depth' },
  { id: 'buildingDensity', unit: 'occupancy', mixing: 'continuous', layer: 'building', value: dna => BUILDING_RULES.byDNA[dna].occupancy, note: 'share of parcels built' },
  { id: 'buildingHeight', unit: 'm (mid floors × floor height)', mixing: 'continuous', layer: 'building', value: dna => +meanFloors(dna).toFixed(1), note: 'floor range and floor height interpolated' },
  { id: 'waterfrontPreference', unit: '0–1', mixing: 'discrete', layer: 'network', value: dna => STRATEGY_PROFILE[DNA_STRATEGY[dna]].waterfront, note: 'quays / canals come with the invader edges' },
  { id: 'organicity', unit: '0–1', mixing: 'discrete', layer: 'network', value: dna => +(1 - STRATEGY_PROFILE[DNA_STRATEGY[dna]].regularity).toFixed(2), note: 'follows the street switch; parcel jitter is continuous' },
];

const smooth = u => u * u * (3 - 2 * u);
export function influenceField({ sourceOrigin, targetOrigin = null, chunkSize, strength, radius, guardWidth = 0 }) {
  const half = chunkSize / 2;
  // Target sides shared with the source (edge neighbour: one side; corner neighbour: none) are not guarded.
  const sides = targetOrigin ? [['minX', -1, 0], ['maxX', 1, 0], ['minZ', 0, -1], ['maxZ', 0, 1]].filter(([, sx, sz]) => !(targetOrigin.x + sx * chunkSize === sourceOrigin.x && targetOrigin.z + sz * chunkSize === sourceOrigin.z)) : [];
  return (x, z) => {
    const d = Math.hypot(Math.max(0, Math.abs(x - sourceOrigin.x) - half), Math.max(0, Math.abs(z - sourceOrigin.z) - half));
    if (d >= radius) return 0;
    let w = strength * (1 - smooth(d / radius));
    if (guardWidth > 0 && sides.length && Math.abs(x - targetOrigin.x) <= half && Math.abs(z - targetOrigin.z) <= half) {
      const e = Math.min(...sides.map(([, sx, sz]) => (sx ? half - sx * (x - targetOrigin.x) : half - sz * (z - targetOrigin.z))));
      w *= e <= guardWidth ? 0 : e >= 2 * guardWidth ? 1 : smooth((e - guardWidth) / guardWidth);
    }
    return w;
  };
}
// Distance from the source square at which w falls to level τ (for debug contours); null if never reached.
export function distanceAtWeight(strength, radius, tau) {
  if (tau >= strength) return null;
  let lo = 0; let hi = 1;
  for (let i = 0; i < 40; i += 1) { const mid = (lo + hi) / 2; if (strength * (1 - smooth(mid)) > tau) lo = mid; else hi = mid; }
  return lo * radius;
}

const lerp = (a, b, t) => a + (b - a) * t;
function mixParcel(base, inv, t) {
  if (t === 0) return base;
  return { label: `fusion ${t.toFixed(2)}`, targetFrontage: lerp(base.targetFrontage, inv.targetFrontage, t), jitter: lerp(base.jitter, inv.jitter, t), maxDepth: lerp(base.maxDepth, inv.maxDepth, t), minFrontage: lerp(base.minFrontage, inv.minFrontage, t), minArea: lerp(base.minArea, inv.minArea, t) };
}
function mixBuilding(base, inv, t) {
  if (t === 0) return base;
  const keys = ['occupancy', 'sideSetback', 'frontSetback', 'maxDepth', 'floorHeight', 'jitter', 'centreRadius'];
  return {
    ...base, ...Object.fromEntries(keys.map(k => [k, lerp(base[k], inv[k], t)])),
    floors: [lerp(base.floors[0], inv.floors[0], t), lerp(base.floors[1], inv.floors[1], t)],
    weights: Object.fromEntries(Object.keys(base.weights).map(k => [k, lerp(base.weights[k], inv.weights[k] ?? 0, t)])),
    courtyard: t >= INFLUENCE.courtyardFrom ? inv.courtyard : base.courtyard,
  };
}

// Local rule set for the target chunk: parcel target / building rule at any world point, from quantised tables.
export function mixedRules(baseDNA, invaderDNA, weightAt) {
  const Q = INFLUENCE.levels;
  const level = (x, z) => Math.round(weightAt(x, z) * Q);
  const pBase = PARCEL_RULES.byDNA[baseDNA]; const pInv = PARCEL_RULES.byDNA[invaderDNA];
  const bBase = BUILDING_RULES.byDNA[baseDNA]; const bInv = BUILDING_RULES.byDNA[invaderDNA];
  const parcels = Array.from({ length: Q + 1 }, (_, k) => mixParcel(pBase, pInv, k / Q));
  const buildings = Array.from({ length: Q + 1 }, (_, k) => mixBuilding(bBase, bInv, k / Q));
  return {
    parcel: { targetAt: (x, z) => parcels[level(x, z)], maxDepthBound: Math.max(pBase.maxDepth, pInv.maxDepth) },
    building: { ruleAt: (x, z) => buildings[level(x, z)] },
    at: w => { const k = Math.round(w * Q); return { parcel: parcels[k], building: buildings[k] }; },
  };
}

// Edge threshold τ from the edge's end points (deterministic, independent of edge order).
const tauOf = (origin, points) => {
  const a = points[0]; const b = points.at(-1);
  const h = hashParts('city-fusion', origin, Math.round(a.x * 10), Math.round(a.z * 10), Math.round(b.x * 10), Math.round(b.z * 10)) / 4294967296;
  return INFLUENCE.threshold.min + (INFLUENCE.threshold.max - INFLUENCE.threshold.min) * h;
};

// Pieces of a polyline where keep(w) holds; cut points are found by bisection between 4 m samples.
function clip(points, weightAt, keep) {
  const pieces = [];
  let current = null; let cut = false;
  const at = (a, b, t) => ({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), ...(a.y !== undefined && b.y !== undefined ? { y: lerp(a.y, b.y, t) } : {}) });
  const inside = p => keep(weightAt(p.x, p.z));
  if (inside(points[0])) current = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / INFLUENCE.clipStep));
    let prevT = 0; let prevIn = inside(a);
    for (let s = 1; s <= n; s += 1) {
      const t = s / n; const p = at(a, b, t); const now = inside(p);
      if (now !== prevIn) {
        let lo = prevT; let hi = t;
        for (let k = 0; k < 20; k += 1) { const mid = (lo + hi) / 2; if (inside(at(a, b, mid)) === prevIn) lo = mid; else hi = mid; }
        const c = at(a, b, now ? hi : lo);
        cut = true;
        if (prevIn) { current.push(c); pieces.push(current); current = null; } else current = [c];
      }
      prevT = t; prevIn = now;
    }
    if (prevIn) current.push(b);
  }
  if (current) pieces.push(current);
  return { pieces, cut };
}
const lengthOf = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);

// Fused NetworkGraph of the target chunk. Returns the base graph object itself when nothing switches.
export function fuseNetwork({ base, invader, fields, weightAt, transitionWidth, sourceDNA, strength, radius }) {
  const sampler = createSampler(fields);
  const builder = new GraphBuilder(fields.grid);
  builder.heightAt = sampler.height;
  const minStub = 16; // m (= grid minStubLength)
  const stats = { baseEdges: base.edges.length, invaderEdges: invader.edges.length, baseKept: 0, baseClipped: 0, baseDropped: 0, invaderKept: 0, invaderClipped: 0, droppedInvaderTunnels: 0, connectors: 0, cutEnds: 0, junctions: 0, remainingCrossings: 0 };
  const cutEnds = [];
  const add = (edge, origin) => {
    if (origin === 'invader' && edge.kind === 'tunnel') { stats.droppedInvaderTunnels += 1; return; }
    const tau = tauOf(origin, edge.points);
    // Base tunnels are frozen: kept whatever the weight (no new tunnel logic).
    const keep = origin === 'base' ? (edge.kind === 'tunnel' ? () => true : w => w < tau) : w => w >= tau;
    const { pieces, cut } = clip(edge.points, weightAt, keep);
    const props = { kind: edge.kind, roadClass: edge.roadClass, width: edge.width, source: edge.source, ...(edge.rule ? { rule: edge.rule } : {}), ...(edge.tunnel ? { tunnel: edge.tunnel } : {}), fusionOrigin: origin };
    const kept = pieces.filter(p => !cut || lengthOf(p) >= minStub);
    if (origin === 'base') { if (!kept.length) stats.baseDropped += 1; else if (cut) stats.baseClipped += 1; else stats.baseKept += 1; }
    else if (kept.length) { if (cut) stats.invaderClipped += 1; else stats.invaderKept += 1; }
    for (const piece of kept) {
      if (builder.edge(piece, props) === null) continue;
      // Cut ends (new dead ends at the switch line) of surface roads, for the connector step.
      if (cut && edge.kind === 'road') for (const end of [piece[0], piece.at(-1)]) if (!edge.points.some(p => p.x === end.x && p.z === end.z)) cutEnds.push({ ...end, origin });
    }
  };
  base.edges.forEach(edge => add(edge, 'base'));
  if (stats.baseClipped + stats.baseDropped === 0 && stats.invaderKept + stats.invaderClipped === 0) return { graph: base, stats, unchanged: true };
  invader.edges.forEach(edge => add(edge, 'invader'));
  stats.cutEnds = cutEnds.length;

  // Cut end → nearest surface road of the other system: straight, dry, ≤ 15° cells, ≤ 40 m.
  const C = INFLUENCE.connector;
  const roadEdges = origin => [...builder.edges.values()].filter(e => e.kind === 'road' && e.fusionOrigin === origin);
  for (const end of cutEnds) {
    let best = null;
    for (const edge of roadEdges(end.origin === 'base' ? 'invader' : 'base')) {
      for (let i = 1; i < edge.points.length; i += 1) {
        const a = edge.points[i - 1]; const b = edge.points[i];
        const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12;
        const t = Math.max(0, Math.min(1, ((end.x - a.x) * dx + (end.z - a.z) * dz) / l2));
        const p = { x: a.x + dx * t, z: a.z + dz * t }; const d = Math.hypot(end.x - p.x, end.z - p.z);
        if (d <= C.maxLength && (!best || d < best.d)) best = { d, edgeId: edge.id, seg: i - 1, p };
      }
    }
    if (!best || best.d < 0.5) continue;
    const n = Math.ceil(best.d / C.step); let ok = true;
    for (let s = 0; s <= n && ok; s += 1) { const k = sampler.indexAt(lerp(end.x, best.p.x, s / n), lerp(end.z, best.p.z, s / n)); if (fields.waterMask[k] || fields.slope[k] > C.maxSlopeDeg) ok = false; }
    if (!ok || !builder.edges.has(best.edgeId)) continue;
    const node = builder.splitEdgeAt(best.edgeId, best.seg, best.p);
    const target = builder.nodes.get(node);
    if (builder.edge([{ x: end.x, z: end.z }, { x: target.x, z: target.z }], { kind: 'road', roadClass: 'lane', width: 4, source: 'fusion connector (cut end → other system)', fusionOrigin: 'connector' }) !== null) stats.connectors += 1;
  }

  // Road crossings between the two systems (and connectors) become junctions. Bridges, canals, tunnels: not split.
  const roadOnly = (a, b) => a.kind !== 'road' || b.kind !== 'road' || a.fusionOrigin === b.fusionOrigin;
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let round = 0; round < 50; round += 1) {
    const pairs = findCrossings([...builder.edges.values()], { ignore: roadOnly });
    if (!pairs.length) break;
    const touched = new Set();
    for (const [ida, idb] of pairs) {
      if (touched.has(ida) || touched.has(idb) || !builder.edges.has(ida) || !builder.edges.has(idb)) continue;
      const A = builder.edges.get(ida); const B = builder.edges.get(idb);
      let hit = null;
      for (let i = 1; i < A.points.length && !hit; i += 1) for (let j = 1; j < B.points.length && !hit; j += 1) {
        const a = A.points[i - 1]; const b = A.points[i]; const c = B.points[j - 1]; const d = B.points[j];
        const d1 = cross(a, b, c); const d2 = cross(a, b, d); const d3 = cross(c, d, a); const d4 = cross(c, d, b);
        if (d1 * d2 < -1e-12 && d3 * d4 < -1e-12) { const t = d3 / (d3 - d4); hit = { i: i - 1, j: j - 1, p: { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) } }; }
      }
      if (!hit) continue;
      touched.add(ida); touched.add(idb);
      builder.splitEdgeAt(ida, hit.i, hit.p);
      builder.splitEdgeAt(idb, hit.j, hit.p);
      stats.junctions += 1;
    }
  }
  stats.remainingCrossings = findCrossings([...builder.edges.values()], { ignore: roadOnly }).length;
  builder.pruneShortComponents(NETWORK_COMMON.minComponentLength);
  const origins = [...builder.edges.values()].map(e => e.fusionOrigin);
  const { nodes, edges, edgePorts, components, removed, stats: _s, signature: _g, units: _u, ...meta } = base;
  const graph = builder.finalize(sampler, { transitionWidth, meta: { ...meta, fusion: { version: '07.1', sourceDNA, strength, radius, invaderStrategy: invader.strategy, stats } } });
  graph.edges.forEach((edge, i) => { edge.fusionOrigin = origins[i]; });
  return { graph, stats, unchanged: false };
}

// Statistics of one chunk's city layers by influence band (centroids / edge samples), for the rule-change summary.
export const BANDS = [{ id: 'w = 0', test: w => w === 0 }, { id: '0 < w < 0.35', test: w => w > 0 && w < 0.35 }, { id: '0.35 ≤ w < 0.65', test: w => w >= 0.35 && w < 0.65 }, { id: 'w ≥ 0.65', test: w => w >= 0.65 }];
export function zoneStats(fields, network, parcels, buildings, weightAt) {
  const { originX, originZ, size } = fields.grid; const step = 8;
  const bandOf = (x, z) => BANDS.findIndex(b => b.test(weightAt(x, z)));
  const out = BANDS.map(b => ({ band: b.id, areaKm2: 0, roadKm: 0, invaderRoadKm: 0, parcels: 0, parcelArea: 0, frontage: 0, buildings: 0, footprint: 0, height: 0, heightMax: 0 }));
  for (let x = originX - size / 2 + step / 2; x < originX + size / 2; x += step) for (let z = originZ - size / 2 + step / 2; z < originZ + size / 2; z += step) out[bandOf(x, z)].areaKm2 += step * step / 1e6;
  for (const edge of network.edges.filter(e => e.kind === 'road' || e.kind === 'bridgeCandidate')) {
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1]; const b = edge.points[i]; const L = Math.hypot(b.x - a.x, b.z - a.z); const n = Math.max(1, Math.ceil(L / step));
      for (let s = 0; s < n; s += 1) { const k = bandOf(lerp(a.x, b.x, (s + 0.5) / n), lerp(a.z, b.z, (s + 0.5) / n)); out[k].roadKm += L / n / 1000; if (edge.fusionOrigin === 'invader') out[k].invaderRoadKm += L / n / 1000; }
    }
  }
  const centroid = ring => ({ x: ring.reduce((s, p) => s + p.x, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length });
  for (const p of parcels.parcels) { const c = centroid(p.polygon); const o = out[bandOf(c.x, c.z)]; o.parcels += 1; o.parcelArea += p.area; o.frontage += p.frontageLength; }
  for (const b of buildings.buildings) { const c = centroid(b.footprint.polygon); const o = out[bandOf(c.x, c.z)]; o.buildings += 1; o.footprint += b.footprintArea; o.height += b.height; o.heightMax = Math.max(o.heightMax, b.height); }
  return out.map(o => ({
    band: o.band, areaKm2: +o.areaKm2.toFixed(3), roadKmPerKm2: o.areaKm2 ? +(o.roadKm / o.areaKm2).toFixed(2) : null, invaderRoadShare: o.roadKm ? +(o.invaderRoadKm / o.roadKm).toFixed(3) : 0,
    parcels: o.parcels, meanParcelArea: o.parcels ? +(o.parcelArea / o.parcels).toFixed(1) : null, meanFrontage: o.parcels ? +(o.frontage / o.parcels).toFixed(2) : null,
    buildings: o.buildings, buildingsPerParcel: o.parcels ? +(o.buildings / o.parcels).toFixed(3) : null, coverageOfParcels: o.parcelArea ? +(o.footprint / o.parcelArea).toFixed(3) : null,
    meanHeight: o.buildings ? +(o.height / o.buildings).toFixed(1) : null, heightMax: +o.heightMax.toFixed(1),
  }));
}

// 07.1a stability of one chunk's city layers against its baseline (the last city built without fusion).
// Parcels are matched by geometry (spatial ids: stableKey; legacy: exact polygon), blocks by geometry, frontage roads
// by edge geometry, so array order and renumbered ids never count as a change. Each baseline parcel in the w = 0 zone:
//   stable             — same parcel, same building outcome (occupied / vacant, footprint, height, floors, type)
//   unstable           — same parcel in the same block on the same roads, but a different building outcome (defect)
//   blockChanged       — same parcel, its block changed shape (block-level area reference may move: legal)
//   roadChanged        — parcel replaced, or kept with a different outcome, because its block or a frontage road of
//                        the block changed geometry / class (legal)
//   siblingChanged     — block and roads unchanged, but a lot of the same block inside the fusion zone (w > 0) was
//                        regenerated under the mixed rules; lots of one block share boundaries and the block-level
//                        height area reference, so the w = 0 lot next to it may move (legal, local to that block)
//   unexplained        — parcel replaced or outcome changed although block, roads and every w > 0 lot of the block
//                        are unchanged (defect)
// Current parcels in w = 0 with no baseline parcel: `added` (follows a block / road change). Parcels in w > 0: counted.
const ringKey = ring => ring.map(p => `${p.x},${p.z}`).join(';');
const edgeGeometryKey = edge => { const a = `${edge.points[0].x.toFixed(2)},${edge.points[0].z.toFixed(2)}`; const b = `${edge.points.at(-1).x.toFixed(2)},${edge.points.at(-1).z.toFixed(2)}`; return `${a < b ? a : b}|${a < b ? b : a}|${edge.points.length}|${edge.kind}|${edge.roadClass}`; };
export function stabilityReport(base, city, weightAt) {
  const parcelKey = p => p.stableKey ?? `${ringKey(p.polygon)}|${p.holes.map(ringKey).join('|')}`;
  const blockKey = b => `${ringKey(b.polygon)}|${b.holes.map(ringKey).join('|')}`;
  const centroid = ring => [ring.reduce((s, p) => s + p.x, 0) / ring.length, ring.reduce((s, p) => s + p.z, 0) / ring.length];
  const side = (layer, network) => {
    const blocks = new Map(layer.blocks.blocks.map(b => [b.id, b]));
    const roadsOf = new Map(layer.blocks.blocks.map(b => [blockKey(b), b.adjacentRoads.map(r => edgeGeometryKey(network.edges[r.edgeId])).sort().join('#')]));
    const outcome = new Map(layer.buildings.buildings.map(b => [b.parcelId, JSON.stringify(['built', b.footprint, b.height, b.floorsEstimate, b.buildingType, b.baseElevation])]));
    layer.buildings.vacant.forEach(v => outcome.set(v.parcelId, JSON.stringify(['vacant', v.reason])));
    const parcels = new Map(layer.parcels.parcels.map(p => [parcelKey(p), { p, block: blockKey(blocks.get(p.blockId)), outcome: outcome.get(p.id) }]));
    return { parcels, roadsOf };
  };
  const A = side(base, base.network); const B = side(city, city.network);
  // Blocks (by geometry) whose fusion-zone lots differ between baseline and current.
  const zoneChanged = new Set();
  for (const [X, Y] of [[A, B], [B, A]]) for (const [key, x] of X.parcels) if (weightAt(...centroid(x.p.polygon)) > 0 && Y.parcels.get(key)?.outcome !== x.outcome) zoneChanged.add(x.block);
  const counts = { stable: 0, unstable: 0, blockChanged: 0, roadChanged: 0, siblingChanged: 0, unexplained: 0, added: 0, zoneBase: 0, zoneCurrent: 0, zoneSame: 0 };
  const items = [];
  for (const [key, a] of A.parcels) {
    const w = weightAt(...centroid(a.p.polygon));
    if (w > 0) { counts.zoneBase += 1; if (B.parcels.has(key) && B.parcels.get(key).outcome === a.outcome) counts.zoneSame += 1; continue; }
    const b = B.parcels.get(key);
    const blockSame = B.roadsOf.has(a.block); const roadsSame = blockSame && B.roadsOf.get(a.block) === A.roadsOf.get(a.block);
    const sibling = zoneChanged.has(a.block);
    const cls = b ? (b.outcome === a.outcome ? 'stable' : b.block !== a.block ? 'blockChanged' : !roadsSame ? 'roadChanged' : sibling ? 'siblingChanged' : 'unstable')
      : (!blockSame || !roadsSame ? 'roadChanged' : sibling ? 'siblingChanged' : 'unexplained');
    counts[cls] += 1;
    items.push({ cls, polygon: (b ?? a).p.polygon, current: Boolean(b) });
  }
  for (const [key, b] of B.parcels) {
    const w = weightAt(...centroid(b.p.polygon));
    if (w > 0) { counts.zoneCurrent += 1; continue; }
    if (!A.parcels.has(key)) { counts.added += 1; items.push({ cls: 'added', polygon: b.p.polygon, current: true }); }
  }
  const zero = counts.stable + counts.unstable + counts.blockChanged + counts.roadChanged + counts.siblingChanged + counts.unexplained;
  return { counts, w0Parcels: zero, stableShare: zero ? +(counts.stable / zero).toFixed(4) : null, defects: counts.unstable + counts.unexplained, items };
}
