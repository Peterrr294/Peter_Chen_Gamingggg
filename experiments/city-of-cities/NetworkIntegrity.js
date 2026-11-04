// A City of Cities — G02c-R1 Network Integrity Gate (pure data; no generator is changed).
//
// A city is connected when its roads can be traced on the road graph to the city root, not when one road reaches the
// parent chunk.
//   City root        the longest road component of the city's core chunk (road edges only; canals are a separate network
//                    type). A core with no road edge has no root: none is invented, and the city cannot grow by road.
//   Root reach       every city node reachable from the root over committed chunk road graphs and recorded joins
//                    (parent joins and neighbour joins).
//   Component        a connected piece of one chunk's own road graph; stable id `${chunkId}:n${smallest node id}`.
// A piece the root cannot reach is classified with the generator's own land rule (water, or slope above the DNA's
// maxSlopeDeg), inside its chunk:
//   geographicWater  it lies on another land body than every root-reached road of the chunk (water in between)
//   geographicSlope  same land body, but every land path crosses slopes above the limit
//   orphan           passable land connects it to root-reached roads; the generator left it unlinked (no explanation)
// Land that runs to an edge shared with a root-connected chunk of the same city is not isolated: such a piece is an
// orphan (its roads are not joined at that edge). Land toward an empty cell may connect later; it is not counted.
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { DIRECTIONS } from './growthDNA.js';

export const INTEGRITY_CLASS = Object.freeze({ root: 'rootConnected', water: 'geographicWater', slope: 'geographicSlope', orphan: 'orphan' });
// One public rule: what a growth candidate with geographic pieces does. 'record' keeps the chunk and lists the pieces as
// pending geographic isolation (no separate-settlement growth exists yet); 'reject' refuses it.
export const INTEGRITY_RULES = Object.freeze({ geographicIsolation: 'record' });

const key = (chunkId, nodeId) => `${chunkId}:${nodeId}`;
const round = v => Math.round(v);

// Connected pieces of one chunk road graph ([from, to, length, roadClass] rows).
export function chunkComponents(chunkId, roadGraph) {
  const adj = new Map(); const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const [f, t] of roadGraph) { add(f, t); add(t, f); }
  const comp = new Map(); const list = [];
  for (const start of [...adj.keys()].sort((a, b) => a - b)) {
    if (comp.has(start)) continue;
    const nodes = []; const stack = [start]; comp.set(start, list.length);
    while (stack.length) { const n = stack.pop(); nodes.push(n); for (const m of adj.get(n)) if (!comp.has(m)) { comp.set(m, list.length); stack.push(m); } }
    list.push({ componentId: `${chunkId}:n${Math.min(...nodes)}`, nodes: nodes.sort((a, b) => a - b), edges: 0, lengthM: 0, roadClasses: {} });
  }
  for (const [f, , len, cls] of roadGraph) { const c = list[comp.get(f)]; c.edges += 1; c.lengthM += len; c.roadClasses[cls ?? 'road'] = (c.roadClasses[cls ?? 'road'] ?? 0) + 1; }
  return list;
}

// City road graph (committed chunks, recorded joins, plus optional extra joins of an uncommitted candidate).
export function cityGraph(world, cityId, extraJoins = []) {
  const adj = new Map(); const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); };
  for (const c of world.chunks.values()) if (c.cityId === cityId && c.outputs) for (const [f, t] of c.outputs.roadGraph) add(key(c.chunkId, f), key(c.chunkId, t));
  const joins = [...world.growth.history.filter(e => e.cityId === cityId).flatMap(e => [...(e.connections ?? []), ...(e.neighbourConnections ?? [])]), ...extraJoins];
  for (const l of joins) add(key(l.parent.chunkId, l.parent.nodeId), key(l.child.chunkId, l.child.nodeId));
  return adj;
}

// City root and every node it reaches. Returns { status, rootComponentId, reach:Set, coreComponents }.
export function cityRoot(world, cityId, extraJoins = []) {
  const core = world.chunks.get(world.cities.get(cityId).originChunkId);
  const coreComponents = core?.outputs ? chunkComponents(core.chunkId, core.outputs.roadGraph) : [];
  if (!coreComponents.length) return { status: 'noRoadNetwork', rootComponentId: null, reach: new Set(), coreComponents };
  const root = [...coreComponents].sort((a, b) => b.lengthM - a.lengthM || a.nodes[0] - b.nodes[0])[0];
  const adj = cityGraph(world, cityId, extraJoins);
  const reach = new Set(); const stack = root.nodes.map(n => key(core.chunkId, n)); stack.forEach(n => reach.add(n));
  while (stack.length) { const n = stack.pop(); for (const m of adj.get(n) ?? []) if (!reach.has(m)) { reach.add(m); stack.push(m); } }
  return { status: 'ok', rootComponentId: root.componentId, reach, coreComponents };
}

// Land bodies (no water) and passable regions (no water, slope ≤ limit) of one chunk, 4-neighbour labels.
function landLabels(fields, maxSlopeDeg) {
  const { columns, rows } = fields.grid; const n = columns * rows;
  const label = ok => {
    const out = new Int32Array(n); let next = 0;
    for (let i = 0; i < n; i += 1) {
      if (out[i] || !ok(i)) continue;
      next += 1; out[i] = next; const stack = [i];
      while (stack.length) {
        const c = stack.pop(); const r = Math.floor(c / columns); const k = c % columns;
        for (const m of [r > 0 ? c - columns : -1, r < rows - 1 ? c + columns : -1, k > 0 ? c - 1 : -1, k < columns - 1 ? c + 1 : -1]) if (m >= 0 && !out[m] && ok(m)) { out[m] = next; stack.push(m); }
      }
    }
    return out;
  };
  return { land: label(i => !fields.waterMask[i]), passable: label(i => !fields.waterMask[i] && fields.slope[i] <= maxSlopeDeg) };
}

// Sides of a chunk that border a same-city chunk whose road ends on that edge the root reaches: land that runs to such an
// edge continues into a connected part of the city, so water or slope inside this chunk does not isolate it.
export function rootedSides(world, chunk, reach) {
  const out = {};
  for (const [, [dx, dy, side, otherSide]] of Object.entries(DIRECTIONS)) {
    const other = world.chunkAt(chunk.worldCoordinate.gx + dx, chunk.worldCoordinate.gy + dy);
    if (other && other.cityId === chunk.cityId && other.outputs?.ports[otherSide].some(p => p.type === 'road' && reach.has(key(other.chunkId, p.nodeId)))) out[side] = other.chunkId;
  }
  return out;
}
const onSide = (index, side, { columns, segments }) => { const row = Math.floor(index / columns); const col = index % columns; return side === 'minX' ? col === 0 : side === 'maxX' ? col === segments : side === 'minZ' ? row === 0 : row === segments; };

// Components of one chunk with reach and spatial class. network: the chunk's generated network (nodes with x, z; edges
// with source); fields: its world terrain (not the ramp corridor). reach: Set of root-reached city node keys.
// sides: rootedSides() of the chunk (land reaching one of these edges is not isolated).
export function analyseChunk(chunk, network, fields, reach, sides = {}) {
  const comps = chunkComponents(chunk.chunkId, chunk.outputs.roadGraph);
  const nodeById = new Map(network.nodes.map(n => [n.id, n]));
  const sourceOf = new Map(); for (const e of network.edges) if (e.kind !== 'canal') sourceOf.set(e.from, [...(sourceOf.get(e.from) ?? []), e.source]);
  for (const c of comps) {
    c.rootReachable = c.nodes.some(n => reach.has(key(chunk.chunkId, n)));
    c.lengthM = round(c.lengthM);
    c.sources = {}; for (const n of c.nodes) for (const s of sourceOf.get(n) ?? []) c.sources[s] = (c.sources[s] ?? 0) + 1;
    c.boundaryPorts = c.nodes.filter(n => nodeById.get(n)?.onBoundary).length;
  }
  const others = comps.filter(c => !c.rootReachable);
  if (others.length) {
    const sampler = createSampler(fields); const maxSlopeDeg = network.params?.maxSlopeDeg ?? 90;
    const { land, passable } = landLabels(fields, maxSlopeDeg);
    const labelsOf = (c, arr) => new Set(c.nodes.map(n => nodeById.get(n)).filter(Boolean).map(p => arr[sampler.indexAt(p.x, p.z)]).filter(Boolean));
    const rooted = comps.filter(c => c.rootReachable);
    const rootLand = new Set(rooted.flatMap(c => [...labelsOf(c, land)])); const rootPass = new Set(rooted.flatMap(c => [...labelsOf(c, passable)]));
    // Labels that reach an edge shared with a root-connected same-city chunk (land continues into the connected city).
    const edgeLabels = arr => { const hit = new Map(); for (const side of Object.keys(sides)) for (let i = 0; i < arr.length; i += 1) if (arr[i] && onSide(i, side, fields.grid) && !hit.has(arr[i])) hit.set(arr[i], side); return hit; };
    const landEdge = edgeLabels(land); const passEdge = edgeLabels(passable);
    const via = (labels, edge) => { for (const x of labels) if (edge.has(x)) return edge.get(x); return null; };
    for (const c of others) {
      const l = labelsOf(c, land); const p = labelsOf(c, passable);
      if (!rooted.length) { c.class = null; c.reason = 'no road of this chunk reaches the city root'; continue; }
      const landSide = via(l, landEdge); const passSide = via(p, passEdge);
      const landInside = [...l].some(x => rootLand.has(x)); const passInside = [...p].some(x => rootPass.has(x));
      if (passInside) { c.class = INTEGRITY_CLASS.orphan; c.reason = `passable land (no water, slope ≤ ${maxSlopeDeg}°) joins it to root-reached roads inside ${chunk.chunkId}; the generator left it unlinked`; }
      else if (passSide) { c.class = INTEGRITY_CLASS.orphan; c.reason = `passable land runs from it to the ${passSide} edge, shared with root-connected ${sides[passSide]}; its roads are not joined there`; }
      else if (landInside || landSide) { c.class = INTEGRITY_CLASS.slope; c.reason = `every land path to a root-reached road (inside ${chunk.chunkId}${landSide ? `, or across the ${landSide} edge to ${sides[landSide]}` : ''}) crosses slopes above ${maxSlopeDeg}° (the DNA road limit)`; }
      else { c.class = INTEGRITY_CLASS.water; c.reason = `water separates it from every root-reached road of ${chunk.chunkId}, and its land reaches no edge shared with a root-connected chunk of the city`; }
    }
  }
  for (const c of comps) if (c.rootReachable) { c.class = INTEGRITY_CLASS.root; c.reason = null; }
  return comps.map(({ nodes, ...c }) => ({ ...c, nodeCount: nodes.length }));
}

// Gate for one uncommitted growth candidate (already generated). joins: its parent and neighbour joins.
export function integrityOfCandidate(world, built, joins, rules = INTEGRITY_RULES) {
  const { chunk, layers } = built;
  const root = cityRoot(world, chunk.cityId, joins);
  const base = { rootComponentId: root.rootComponentId, rootStatus: root.status };
  if (root.status !== 'ok') return { ...base, components: [], result: 'rejected', reason: `network integrity: ${chunk.cityId} has no road network root (core ${world.cities.get(chunk.cityId).originChunkId} has no road edge)` };
  const comps = analyseChunk(chunk, layers.city.network, (layers.worldTerrain ?? layers.terrain).fields, root.reach, rootedSides(world, chunk, root.reach));
  const parentJoins = joins.filter(j => j.parent.chunkId === built.event.parentChunkId);
  const parentOnRoot = parentJoins.filter(j => root.reach.has(key(j.parent.chunkId, j.parent.nodeId))).length;
  const sum = list => list.reduce((s, c) => s + c.lengthM, 0);
  const of = cls => comps.filter(c => c.class === cls);
  const summary = { ...base, components: comps, totalComponents: comps.length, rootConnected: of(INTEGRITY_CLASS.root).length, rootReachableLengthM: sum(of(INTEGRITY_CLASS.root)), disconnectedLengthM: sum(comps.filter(c => !c.rootReachable)), orphan: of(INTEGRITY_CLASS.orphan).length, orphanLengthM: sum(of(INTEGRITY_CLASS.orphan)), geographic: of(INTEGRITY_CLASS.water).length + of(INTEGRITY_CLASS.slope).length, geographicLengthM: sum([...of(INTEGRITY_CLASS.water), ...of(INTEGRITY_CLASS.slope)]), parentJoins: parentJoins.length, parentJoinsOnRoot: parentOnRoot };
  if (!summary.rootConnected) return { ...summary, result: 'rejected', reason: `network integrity: no road of ${chunk.chunkId} reaches the city root (${parentJoins.length} parent join(s), ${parentOnRoot} on a root-reached road)` };
  if (summary.orphan) return { ...summary, result: 'rejected', reason: `network integrity: ${summary.orphan} orphan road component(s), ${summary.orphanLengthM} m, on passable land not reachable from the city root` };
  if (summary.geographic && rules.geographicIsolation === 'reject') return { ...summary, result: 'rejected', reason: `network integrity: ${summary.geographic} geographically isolated component(s), ${summary.geographicLengthM} m` };
  return { ...summary, result: summary.geographic ? 'acceptedWithGeographicIsolation' : 'connected', pending: summary.geographic ? 'geographic isolation: separate-settlement growth is not implemented; these pieces are not counted as root-connected' : null };
}

// World metrics per city from committed data. Spatial classes of unreachable pieces come from the commit record of their
// chunk when it has one (G02c-R1 runs); otherwise they are 'unclassified' (analyseChunk needs the generated layers).
export function networkIntegrityReport(world) {
  const out = {};
  for (const cityId of [...world.cities.keys()].sort()) {
    const root = cityRoot(world, cityId);
    const chunks = [...world.chunks.values()].filter(c => c.cityId === cityId && c.outputs);
    let total = 0; let reached = 0; const pieces = [];
    const recorded = new Map(world.growth.history.filter(e => e.networkIntegrity).flatMap(e => e.networkIntegrity.components.map(c => [c.componentId, c])));
    for (const c of chunks) for (const comp of chunkComponents(c.chunkId, c.outputs.roadGraph)) {
      total += comp.lengthM; const on = comp.nodes.some(n => root.reach.has(key(c.chunkId, n)));
      if (on) reached += comp.lengthM;
      else pieces.push({ componentId: comp.componentId, chunkId: c.chunkId, lengthM: round(comp.lengthM), class: recorded.get(comp.componentId)?.class ?? 'unclassified', reason: recorded.get(comp.componentId)?.reason ?? null });
    }
    const len = cls => round(pieces.filter(p => p.class === cls).reduce((s, p) => s + p.lengthM, 0));
    out[cityId] = { rootStatus: root.status, rootComponentId: root.rootComponentId, coreComponents: root.coreComponents.length, chunks: chunks.length, roadLengthM: round(total), rootReachableLengthM: round(reached), rootReachableRatio: total ? +(reached / total).toFixed(4) : null, disconnectedComponents: pieces.length, orphanLengthM: len(INTEGRITY_CLASS.orphan), geographicLengthM: len(INTEGRITY_CLASS.water) + len(INTEGRITY_CLASS.slope), unclassifiedLengthM: len('unclassified'), pieces };
  }
  return out;
}
