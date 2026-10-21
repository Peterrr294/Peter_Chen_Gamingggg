// 06.3b Road network seam (pure data, no rendering). Joins the per-chunk NetworkGraphs across shared edges that
// 06.3a harmonised, so roads that meet at an edge are one topology, not two lines that only touch.
//
// Input: every chunk's unchanged single-chunk NetworkGraph (EdgePorts included), its harmonised fields, and the
// TerrainHarmonizer edge report. Output: a stitched NetworkGraph per chunk (only chunks with a change are rebuilt),
// one connection record per joined port pair, a status + reason for every port on a shared edge, and a world graph.
//
// Rules (geometry is changed only inside the transition band of the shared edge, on both sides):
//   pair  — a road port of A and a road port of B within the shift limit become one joint node J on the edge;
//           each road is re-routed from the inner line of its band (redirect anchor) straight to J.
//   stub  — a road port left without a counterpart may continue straight into the neighbour's band and end on the
//           neighbour's nearest road there (T-junction); nothing outside the neighbour's band is touched.
//   never — no join on an unresolved terrain edge, through water, over terrain steeper than the DNA's road limit,
//           across another road, or by moving a bridge, tunnel, or graded mountain road (frozen 03.2 / 05.1b-2).
// Ports that are not joined keep their road unchanged and carry the reason; canal ports and ports facing an empty
// slot are pending (not in this task's scope / nothing to join yet).
import { checksum } from '../cellular-noise/noise.js';
import { GraphBuilder } from '../seed-terrain/NetworkGraph.js';
import { MinHeap, createSampler } from '../seed-terrain/NetworkGenerator.js';

export const ROAD_SEAM_RULES = Object.freeze({
  maxLateralShiftDeg: 25, // a re-routed road may lean at most this far from its own direction across the band; pair offset ≤ 2·W·tan(25°)
  maxApproachDeg: 60, // a port road must meet the edge within 60° of the edge normal (else it runs along the edge)
  maxBendDeg: 40, // turn added where a re-routed road or a stub leaves the existing road
  elevationTolerance: 0.5, // m; joint height difference allowed between the two chunks (= 06.2 seam tolerance)
  maxClassGap: 1, // road hierarchy steps allowed across a join (primary 3 · secondary 2 · lane 1)
  snapToNodeDistance: 2, // m; a stub ending this close to an existing node ends on that node
});

const CLASS_RANK = { primary: 3, secondary: 2, lane: 1 };
const INWARD = { minX: [1, 0], maxX: [-1, 0], minZ: [0, 1], maxZ: [0, -1] };
const STEP = 2; // m; validation sampling along connectors (= NETWORK_COMMON.sampleStep)
const META_SKIP = new Set(['units', 'nodes', 'edges', 'edgePorts', 'components', 'removed', 'stats', 'signature', 'seam']);
const deg = rad => rad * 180 / Math.PI;
const r2 = v => +v.toFixed(2);

const depthOf = (grid, side, p) => {
  const h = grid.size / 2;
  return side === 'minX' ? p.x - (grid.originX - h) : side === 'maxX' ? grid.originX + h - p.x : side === 'minZ' ? p.z - (grid.originZ - h) : grid.originZ + h - p.z;
};
const edgeLine = (grid, side) => {
  const h = grid.size / 2;
  return { minX: grid.originX - h, maxX: grid.originX + h, minZ: grid.originZ - h, maxZ: grid.originZ + h }[side];
};
const onSide = (grid, side, position) => (side.endsWith('X') ? { x: edgeLine(grid, side), z: position } : { x: position, z: edgeLine(grid, side) });
const angleBetween = (a, b) => {
  const la = Math.hypot(a.x, a.z) || 1; const lb = Math.hypot(b.x, b.z) || 1;
  return deg(Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / (la * lb)))));
};
const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
const properCross = (a, b, c, d) => {
  const d1 = cross(a, b, c); const d2 = cross(a, b, d); const d3 = cross(c, d, a); const d4 = cross(c, d, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
};
const segDistance = (p, a, b) => {
  const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return { d: Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t), t, x: a.x + dx * t, z: a.z + dz * t };
};
const same = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.z - q.z) < 0.01;

// Mutable working copy of one chunk's graph: edges keyed by a stable string, points kept with their y.
function workOf(entry) {
  const { network, fields } = entry;
  const edges = new Map(network.edges.map(e => [`e${e.id}`, {
    key: `e${e.id}`, points: e.points.map(p => ({ ...p })),
    props: { kind: e.kind, roadClass: e.roadClass, width: e.width, source: e.source, ...(e.rule ? { rule: e.rule } : {}), ...(e.tunnel ? { tunnel: e.tunnel } : {}) },
  }]));
  return { entry, grid: fields.grid, sampler: createSampler(fields), params: network.params ?? {}, edges, edited: new Set(), changed: false, nextKey: 0, stubs: 0, reroutes: 0 };
}

const frozenEdge = edge => edge.props.kind === 'bridgeCandidate' || edge.props.kind === 'tunnel' || edge.props.rule === 'mountain';
const frozenWhy = edge => (edge.props.kind === 'tunnel' ? 'tunnel' : edge.props.kind === 'bridgeCandidate' ? 'bridge' : 'graded mountain road');

// Validation of a new polyline inside one chunk: terrain (same land test as the network: no water, slope ≤ DNA
// road limit), proper crossings with other edges, and no foreign node touched without a junction.
function validate(work, points, ignore) {
  const { sampler, params } = work;
  const maxSlope = params.maxSlopeDeg ?? 90;
  let maxCellSlope = 0; let maxGrade = 0; let prevH = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / STEP));
    for (let s = 0; s <= steps; s += 1) {
      const x = a.x + (b.x - a.x) * s / steps; const z = a.z + (b.z - a.z) * s / steps;
      const index = sampler.indexAt(x, z);
      if (sampler.fields.waterMask[index]) return { ok: false, reason: 'connector would enter water (no bridge is created at a seam)' };
      maxCellSlope = Math.max(maxCellSlope, sampler.fields.slope[index]);
      const h = sampler.height(x, z);
      if (prevH !== null && length > 0) maxGrade = Math.max(maxGrade, deg(Math.atan(Math.abs(h - prevH) / (length / steps))));
      prevH = h;
    }
  }
  if (maxCellSlope > maxSlope) return { ok: false, reason: `connector crosses terrain at ${maxCellSlope.toFixed(1)}° (> ${maxSlope}° road limit of this DNA)` };
  for (const edge of work.edges.values()) {
    if (ignore.has(edge.key)) continue;
    for (let i = 1; i < edge.points.length; i += 1) {
      const c = edge.points[i - 1]; const d = edge.points[i];
      for (let j = 1; j < points.length; j += 1) if (properCross(points[j - 1], points[j], c, d)) return { ok: false, reason: `connector would cross road ${edge.key} without a junction` };
    }
    for (const p of [edge.points[0], edge.points.at(-1)]) {
      if (points.some(q => same(p, q))) continue;
      for (let j = 1; j < points.length; j += 1) if (segDistance(p, points[j - 1], points[j]).d < 1) return { ok: false, reason: `connector would touch node of ${edge.key} without a junction` };
    }
  }
  return { ok: true, maxCellSlope, maxGrade };
}

// New geometry of a port edge whose boundary end moves to J. Only the part inside the band is replaced.
function reroute(work, edge, side, portPoint, J, W) {
  const forward = same(edge.points[0], portPoint);
  const pts = forward ? edge.points : [...edge.points].reverse();
  let inner = null; let Q = null;
  for (let i = 1; i < pts.length && !inner; i += 1) {
    const da = depthOf(work.grid, side, pts[i - 1]); const db = depthOf(work.grid, side, pts[i]);
    if (da < W && db >= W) {
      const t = (W - da) / (db - da);
      Q = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
      inner = db - W < 0.01 ? pts.slice(i + 1) : pts.slice(i);
      if (db - W < 0.01) Q = pts[i];
    }
  }
  if (!inner) {
    const end = pts.at(-1);
    const onBoundary = ['minX', 'maxX', 'minZ', 'maxZ'].some(s => Math.abs(depthOf(work.grid, s, end)) < 1e-6);
    if (onBoundary) return { ok: false, reason: 'port road ends on another chunk edge inside the band (nothing to re-route from)' };
    Q = end; inner = [];
  }
  const replaced = [{ x: J.x, z: J.z }, { x: Q.x, z: Q.z }];
  const next = inner[0];
  const bend = next ? angleBetween({ x: Q.x - J.x, z: Q.z - J.z }, { x: next.x - Q.x, z: next.z - Q.z }) : 0;
  const lean = angleBetween({ x: Q.x - J.x, z: Q.z - J.z }, { x: Q.x - portPoint.x, z: Q.z - portPoint.z });
  const points = [...replaced, ...inner.map(p => ({ ...p }))];
  return { ok: true, points: forward ? points : points.reverse(), connector: replaced, bend, lean };
}

function portNodes(network, side) {
  const byNode = new Map();
  for (const port of network.edgePorts.filter(p => p.side === side)) {
    if (!byNode.has(port.nodeId)) {
      const node = network.nodes[port.nodeId];
      byNode.set(port.nodeId, { nodeId: port.nodeId, side, position: port.position, point: { x: node.x, z: node.z }, elevation: port.elevation, ports: [] });
    }
    byNode.get(port.nodeId).ports.push(port);
  }
  return [...byNode.values()].map(group => {
    const roads = group.ports.filter(p => p.type === 'road');
    const rank = Math.max(0, ...roads.map(p => CLASS_RANK[p.roadClass] ?? 2));
    return { ...group, type: roads.length ? 'road' : 'canal', rank, roadClass: roads.find(p => (CLASS_RANK[p.roadClass] ?? 2) === rank)?.roadClass ?? group.ports[0].roadClass, approachDeg: Math.max(...roads.map(p => deg(Math.acos(Math.min(1, Math.max(-1, p.outwardDot)))))), status: null, reason: null, connectionId: null };
  }).sort((a, b) => a.position - b.position);
}

// Pair test + commit. Returns a connection or { reason }.
function tryPair(ctx, edge, pa, pb) {
  const { W, rules } = ctx;
  const wa = ctx.work.get(edge.a); const wb = ctx.work.get(edge.b);
  const offset = Math.abs(pa.position - pb.position);
  if (Math.abs(pa.rank - pb.rank) > rules.maxClassGap) return { reason: `road class mismatch (${pa.roadClass} ↔ ${pb.roadClass})` };
  for (const p of [pa, pb]) if (p.approachDeg > rules.maxApproachDeg) return { reason: `road meets the edge at ${p.approachDeg.toFixed(0)}° from the normal (> ${rules.maxApproachDeg}°, runs along the edge)` };
  const sides = [[wa, edge.sideA, pa], [wb, edge.sideB, pb]].map(([work, side, port]) => {
    const edges = port.ports.filter(p => p.type === 'road').map(p => work.edges.get(`e${p.edgeId}`));
    const frozen = edges.find(e => !e || frozenEdge(e));
    return { work, side, port, edges, frozen };
  });
  for (const s of sides) if (s.edges.some(e => !e || s.work.edited.has(e.key))) return { reason: 'port road already re-routed for another edge' };
  let along;
  if (offset < 0.01) along = pa.position;
  else if (sides[0].frozen && sides[1].frozen) return { reason: `${frozenWhy(sides[0].frozen)} and ${frozenWhy(sides[1].frozen)} ports ${offset.toFixed(1)} m apart (frozen roads are not moved)` };
  else if (sides[0].frozen) along = pa.position;
  else if (sides[1].frozen) along = pb.position;
  else along = (pa.position + pb.position) / 2;
  const J = onSide(wa.grid, edge.sideA, along);
  const hA = wa.sampler.height(J.x, J.z); const hB = wb.sampler.height(J.x, J.z);
  if (Math.abs(hA - hB) > rules.elevationTolerance) return { reason: `elevation step ${Math.abs(hA - hB).toFixed(2)} m at the joint` };
  const plans = [];
  let maxGrade = 0; let maxBend = 0; let maxLean = 0;
  for (const s of sides) {
    if (same(s.port.point, J)) continue;
    for (const e of s.edges) {
      const plan = reroute(s.work, e, s.side, s.port.point, J, W);
      if (!plan.ok) return { reason: plan.reason };
      if (plan.lean > rules.maxLateralShiftDeg) return { reason: `re-route would lean ${plan.lean.toFixed(1)}° (> ${rules.maxLateralShiftDeg}°) inside the ${W} m band` };
      if (plan.bend > rules.maxBendDeg) return { reason: `re-route would bend ${plan.bend.toFixed(0)}° at the band limit (> ${rules.maxBendDeg}°)` };
      const check = validate(s.work, plan.connector, new Set([e.key, ...s.edges.map(x => x.key)]));
      if (!check.ok) return { reason: check.reason };
      maxGrade = Math.max(maxGrade, check.maxGrade); maxBend = Math.max(maxBend, plan.bend); maxLean = Math.max(maxLean, plan.lean);
      plans.push({ work: s.work, edge: e, points: plan.points, connector: plan.connector });
    }
  }
  for (const plan of plans) { plan.edge.points = plan.points; plan.work.edited.add(plan.edge.key); plan.work.changed = true; plan.work.reroutes += 1; }
  return {
    kind: 'pair', joint: { x: J.x, z: J.z, yA: r2(hA), yB: r2(hB) }, offset: r2(offset), shiftA: r2(Math.abs(along - pa.position)), shiftB: r2(Math.abs(along - pb.position)),
    classA: pa.roadClass, classB: pb.roadClass, elevationDiff: +Math.abs(hA - hB).toFixed(3), maxGradeDeg: r2(maxGrade), maxBendDeg: r2(maxBend), maxLeanDeg: r2(maxLean),
    connectors: plans.map(p => ({ chunkId: p.work.entry.chunkId, width: p.edge.props.width, points: p.connector.map(q => ({ x: r2(q.x), z: r2(q.z) })) })),
  };
}

// Stub from an unpaired road port of `from` into the neighbour's band, ending on its nearest road there.
function tryStub(ctx, edge, port, fromA) {
  const { W, rules } = ctx;
  const own = ctx.work.get(fromA ? edge.a : edge.b); const other = ctx.work.get(fromA ? edge.b : edge.a);
  const sideOther = fromA ? edge.sideB : edge.sideA;
  if (port.approachDeg > rules.maxApproachDeg) return { reason: `road meets the edge at ${port.approachDeg.toFixed(0)}° from the normal (> ${rules.maxApproachDeg}°, runs along the edge)` };
  const J = { x: port.point.x, z: port.point.z };
  const hOwn = own.sampler.height(J.x, J.z); const hOther = other.sampler.height(J.x, J.z);
  if (Math.abs(hOwn - hOther) > rules.elevationTolerance) return { reason: `elevation step ${Math.abs(hOwn - hOther).toFixed(2)} m at the joint` };
  const outward = port.ports.find(p => p.type === 'road').direction;
  let best = null; let firstFail = null;
  const candidates = [];
  for (const target of other.edges.values()) {
    if (target.props.kind !== 'road' || target.props.rule === 'mountain' || target.props.source === '06.3b seam stub') continue;
    let near = null;
    for (let i = 1; i < target.points.length; i += 1) {
      const s = segDistance(J, target.points[i - 1], target.points[i]);
      if (!near || s.d < near.d) near = { ...s, seg: i - 1 };
    }
    const depth = depthOf(other.grid, sideOther, near);
    if (depth < 1 || depth > W) continue;
    candidates.push({ target, near });
  }
  candidates.sort((a, b) => a.near.d - b.near.d || (a.target.key < b.target.key ? -1 : 1));
  for (const { target, near } of candidates) {
    if (Math.abs((CLASS_RANK[target.props.roadClass] ?? 2) - port.rank) > rules.maxClassGap) { firstFail ??= `nearest road in the neighbour band is ${target.props.roadClass} (class gap > ${rules.maxClassGap} from ${port.roadClass})`; continue; }
    let T = { x: near.x, z: near.z };
    const a = target.points[near.seg]; const b = target.points[near.seg + 1];
    const endNode = [target.points[0], target.points.at(-1)].find(p => Math.hypot(p.x - T.x, p.z - T.z) <= rules.snapToNodeDistance);
    if (endNode) T = { x: endNode.x, z: endNode.z };
    const bend = angleBetween(outward, { x: T.x - J.x, z: T.z - J.z });
    if (bend > rules.maxBendDeg) { firstFail ??= `nearest road in the neighbour band needs a ${bend.toFixed(0)}° turn (> ${rules.maxBendDeg}°)`; continue; }
    const check = validate(other, [J, T], new Set([target.key]));
    if (!check.ok) { firstFail ??= `stub: ${check.reason}`; continue; }
    best = { target, T, seg: near.seg, a, b, endNode, check, bend };
    break;
  }
  if (!best) return { reason: firstFail ?? `no road of ${other.entry.chunkId} inside its ${W} m band to continue into` };
  const { target, T, check, bend } = best;
  if (!best.endNode) {
    const first = [...target.points.slice(0, best.seg + 1), { x: T.x, z: T.z }];
    const second = [{ x: T.x, z: T.z }, ...target.points.slice(best.seg + 1)];
    other.edges.delete(target.key);
    for (const pts of [first, second]) { const key = `s${other.nextKey++}`; other.edges.set(key, { key, points: pts, props: { ...target.props } }); }
  }
  const rank = Math.min(port.rank, CLASS_RANK[target.props.roadClass] ?? 2);
  const roadClass = Object.keys(CLASS_RANK).find(k => CLASS_RANK[k] === rank) ?? target.props.roadClass;
  const key = `s${other.nextKey++}`;
  other.edges.set(key, { key, points: [{ x: J.x, z: J.z }, { x: T.x, z: T.z }], props: { kind: 'road', roadClass, width: other.params.widths?.[roadClass] ?? target.props.width, source: '06.3b seam stub' } });
  other.edited.add(key); other.changed = true; other.stubs += 1;
  return {
    kind: 'stub', joint: { x: J.x, z: J.z, yA: r2(fromA ? hOwn : hOther), yB: r2(fromA ? hOther : hOwn) }, offset: 0, stubLength: r2(Math.hypot(T.x - J.x, T.z - J.z)), into: other.entry.chunkId,
    classA: fromA ? port.roadClass : roadClass, classB: fromA ? roadClass : port.roadClass, elevationDiff: +Math.abs(hOwn - hOther).toFixed(3), maxGradeDeg: r2(check.maxGrade), maxBendDeg: r2(bend), maxLeanDeg: 0,
    connectors: [{ chunkId: other.entry.chunkId, width: other.edges.get(key).props.width, points: [{ x: r2(J.x), z: r2(J.z) }, { x: r2(T.x), z: r2(T.z) }] }],
  };
}

function rebuildGraph(work, transitionWidth, seamMeta) {
  const original = work.entry.network;
  const builder = new GraphBuilder(work.grid);
  builder.heightAt = work.sampler.height;
  builder.removed = { ...original.removed };
  for (const edge of work.edges.values()) builder.edge(edge.points, edge.props);
  const meta = Object.fromEntries(Object.entries(original).filter(([k]) => !META_SKIP.has(k)));
  return builder.finalize(work.sampler, { transitionWidth, meta: { ...meta, seam: seamMeta } });
}

const findNode = (graph, p) => graph.nodes.find(n => Math.abs(n.x - p.x) < 0.01 && Math.abs(n.z - p.z) < 0.01) ?? null;

// chunks: [{ chunkId, gridX, gridY, fields, network | null }] — network null = empty slot.
// harmony: TerrainHarmonizer report (null in raw terrain mode). mode: 'joined' | 'independent'.
export function stitchRoads(chunks, harmony, transitionWidth, mode = 'joined') {
  const started = performance.now();
  const rules = ROAD_SEAM_RULES;
  const ordered = [...chunks].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  const at = new Map(ordered.map(c => [`${c.gridX},${c.gridY}`, c]));
  const ctx = { W: transitionWidth, rules, work: new Map(ordered.filter(c => c.network).map(c => [c.chunkId, workOf(c)])) };
  const edges = []; const connections = []; const ports = [];
  for (const A of ordered) {
    for (const [dx, dy, sideA, sideB] of [[1, 0, 'maxX', 'minX'], [0, 1, 'maxZ', 'minZ']]) {
      const B = at.get(`${A.gridX + dx},${A.gridY + dy}`);
      if (!B) continue;
      const id = `${A.chunkId}|${B.chunkId}`;
      const terrain = harmony?.edges.find(e => e.id === id) ?? null;
      const record = { id, a: A.chunkId, b: B.chunkId, sideA, sideB, terrain: terrain ? (terrain.status === 'resolved' ? `joined ${terrain.continuity.split(' ')[0]}` : 'unresolved') : 'raw (not harmonised)', portsA: [], portsB: [] };
      record.portsA = A.network ? portNodes(A.network, sideA) : [];
      record.portsB = B.network ? portNodes(B.network, sideB) : [];
      const all = [...record.portsA.map(p => [p, true]), ...record.portsB.map(p => [p, false])];
      let blocked = null; let pending = null;
      if (mode !== 'joined') blocked = 'road joins off (independent mode)';
      else if (!A.network || !B.network) pending = `neighbour slot ${!A.network ? A.chunkId : B.chunkId} is empty (joins when a city is assigned)`;
      else if (!terrain) blocked = 'terrain edge not harmonised (raw terrain mode)';
      else if (terrain.status !== 'resolved') blocked = `terrain edge unresolved in 06.3a (raw step ${terrain.rawMaxStep} m kept; a road would need a ramp or wall)`;
      for (const [p] of all) {
        if (p.type === 'canal') { p.status = 'pending'; p.reason = 'canal port: canal joins are not part of 06.3b'; } else if (pending) { p.status = 'pending'; p.reason = pending; } else if (blocked) { p.status = 'rejected'; p.reason = blocked; }
      }
      edges.push(record);
    }
  }
  // Phase 1: pairs (all edges, canonical order), nearest offsets first.
  const maxOffset = 2 * transitionWidth * Math.tan(rules.maxLateralShiftDeg * Math.PI / 180);
  for (const record of edges) {
    const open = p => p.type === 'road' && p.status === null;
    const candidates = [];
    for (const pa of record.portsA.filter(open)) for (const pb of record.portsB.filter(open)) {
      const offset = Math.abs(pa.position - pb.position);
      if (offset <= maxOffset) candidates.push({ pa, pb, offset });
    }
    candidates.sort((x, y) => x.offset - y.offset || x.pa.position - y.pa.position || x.pb.position - y.pb.position);
    for (const { pa, pb } of candidates) {
      if (pa.status || pb.status) continue;
      const result = tryPair(ctx, record, pa, pb);
      if (result.reason) { pa.pairFail ??= result.reason; pb.pairFail ??= result.reason; continue; }
      const connection = { id: connections.length, edgeId: record.id, a: { chunkId: record.a, position: r2(pa.position) }, b: { chunkId: record.b, position: r2(pb.position) }, ...result };
      connections.push(connection);
      for (const p of [pa, pb]) { p.status = 'connected'; p.connectionId = connection.id; p.reason = connection.offset < 0.01 ? 'paired (same position)' : `paired, re-routed inside the band (offset ${connection.offset} m)`; }
    }
  }
  // Phase 2: stubs for the remaining road ports (by position, A before B at equal position).
  for (const record of edges) {
    const open = [...record.portsA.map(p => [p, true]), ...record.portsB.map(p => [p, false])].filter(([p]) => p.type === 'road' && p.status === null)
      .sort(([p, a], [q, b]) => p.position - q.position || (a === b ? 0 : a ? -1 : 1));
    for (const [p, fromA] of open) {
      const result = tryStub(ctx, record, p, fromA);
      if (result.reason) { p.status = 'rejected'; p.reason = p.pairFail ? `pair: ${p.pairFail}; stub: ${result.reason}` : `no counterpart within ${maxOffset.toFixed(0)} m; stub: ${result.reason}`; continue; }
      const connection = { id: connections.length, edgeId: record.id, a: { chunkId: record.a, position: r2(p.position) }, b: { chunkId: record.b, position: r2(p.position) }, ...result };
      connections.push(connection);
      p.status = 'connected'; p.connectionId = connection.id; p.reason = `stub into ${result.into} (${result.stubLength} m to its road)`;
    }
  }
  // Stitched graphs: rebuilt only where something changed (others keep the original object, bit-identical).
  const networks = new Map();
  for (const c of ordered) {
    if (!c.network) { networks.set(c.chunkId, null); continue; }
    const work = ctx.work.get(c.chunkId);
    networks.set(c.chunkId, work.changed ? rebuildGraph(work, transitionWidth, { version: '06.3b', rawSignature: c.network.signature, reroutes: work.reroutes, stubs: work.stubs }) : c.network);
  }
  // Connection endpoints = node ids in the stitched graphs (identical world coordinates on both sides).
  for (const connection of connections) {
    const J = connection.joint;
    const nA = findNode(networks.get(connection.a.chunkId), J); const nB = findNode(networks.get(connection.b.chunkId), J);
    connection.a.nodeId = nA?.id ?? null; connection.b.nodeId = nB?.id ?? null;
    connection.positionError = nA && nB ? Math.hypot(nA.x - nB.x, nA.z - nB.z) : null;
    connection.nodeElevationDiff = nA && nB ? +Math.abs(nA.y - nB.y).toFixed(3) : null;
  }
  for (const record of edges) {
    for (const [list, chunkId] of [[record.portsA, record.a], [record.portsB, record.b]]) {
      for (const p of list) ports.push({ chunkId, edgeId: record.id, side: p.side, position: r2(p.position), elevation: r2(p.elevation), type: p.type, roadClass: p.roadClass, status: p.status ?? 'rejected', reason: p.reason ?? 'not evaluated', connectionId: p.connectionId, ...(p.pairFail && p.status === 'connected' ? { pairAttempt: p.pairFail } : {}) });
    }
    const mine = connections.filter(c => c.edgeId === record.id);
    const portsHere = ports.filter(p => p.edgeId === record.id);
    record.summary = {
      portsA: record.portsA.length, portsB: record.portsB.length, pairs: mine.filter(c => c.kind === 'pair').length, pairsSamePosition: mine.filter(c => c.kind === 'pair' && c.offset < 0.01).length, stubs: mine.filter(c => c.kind === 'stub').length,
      connected: portsHere.filter(p => p.status === 'connected').length, rejected: portsHere.filter(p => p.status === 'rejected').length, pending: portsHere.filter(p => p.status === 'pending').length,
    };
    delete record.portsA; delete record.portsB;
  }
  const world = worldGraph(ordered, networks, connections);
  const reasons = {};
  for (const p of ports.filter(q => q.status !== 'connected')) { const k = `${p.status}: ${p.reason.replace(/[-0-9.]+/g, '#')}`; reasons[k] = (reasons[k] ?? 0) + 1; }
  const stats = {
    sharedEdges: edges.length, edgesWithConnections: edges.filter(e => e.summary.pairs + e.summary.stubs > 0).length,
    ports: ports.length, connected: ports.filter(p => p.status === 'connected').length, rejected: ports.filter(p => p.status === 'rejected').length, pending: ports.filter(p => p.status === 'pending').length,
    connections: connections.length, pairs: connections.filter(c => c.kind === 'pair').length, stubs: connections.filter(c => c.kind === 'stub').length,
    chunksChanged: [...ctx.work.values()].filter(w => w.changed).map(w => w.entry.chunkId), reasons,
    worldComponents: world.components.length, crossChunkComponents: world.components.filter(c => c.chunks.length > 1).map(c => c.chunks),
  };
  const signature = checksum(new TextEncoder().encode(JSON.stringify({ connections, ports, nets: [...networks.entries()].map(([id, n]) => [id, n?.signature ?? null]) })));
  return { mode, rules, transitionWidth, maxPairOffset: r2(maxOffset), edges, connections, ports, networks, world, stats, signature, ms: performance.now() - started };
}

// World NetworkGraph: every chunk graph (ids prefixed by chunk) + one zero-length seam link per connection.
// Canal edges are excluded from road reachability.
function worldGraph(ordered, networks, connections) {
  const adjacency = new Map();
  const nodes = new Map();
  const link = (u, v, length, kind) => {
    if (!adjacency.has(u)) adjacency.set(u, []);
    if (!adjacency.has(v)) adjacency.set(v, []);
    adjacency.get(u).push({ to: v, length, kind }); adjacency.get(v).push({ to: u, length, kind });
  };
  for (const c of ordered) {
    const g = networks.get(c.chunkId);
    if (!g) continue;
    for (const e of g.edges) {
      if (e.kind === 'canal') continue;
      const u = `${c.chunkId}/${e.from}`; const v = `${c.chunkId}/${e.to}`;
      for (const [k, n] of [[u, g.nodes[e.from]], [v, g.nodes[e.to]]]) nodes.set(k, { key: k, chunkId: c.chunkId, x: n.x, z: n.z, y: n.y });
      link(u, v, e.length, e.kind);
    }
  }
  const links = connections.filter(c => c.a.nodeId !== null && c.b.nodeId !== null).map(c => ({ id: c.id, from: `${c.a.chunkId}/${c.a.nodeId}`, to: `${c.b.chunkId}/${c.b.nodeId}`, length: 0, kind: 'seam' }));
  for (const l of links) link(l.from, l.to, 0, 'seam');
  const componentOf = new Map(); const components = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (componentOf.has(start)) continue;
    const id = components.length; const stack = [start]; const chunkSet = new Set(); let size = 0;
    componentOf.set(start, id);
    while (stack.length) {
      const u = stack.pop(); size += 1; chunkSet.add(nodes.get(u).chunkId);
      for (const { to } of adjacency.get(u)) if (!componentOf.has(to)) { componentOf.set(to, id); stack.push(to); }
    }
    components.push({ id, nodes: size, chunks: [...chunkSet].sort() });
  }
  return { nodes, adjacency, links, components, componentOf };
}

// Shortest road path in the world graph (Dijkstra). Returns null when unreachable.
export function worldPath(world, fromKey, toKey) {
  const dist = new Map([[fromKey, 0]]); const prev = new Map(); const heap = new MinHeap(); const ids = new Map(); const keys = [];
  const idOf = k => { if (!ids.has(k)) { ids.set(k, keys.length); keys.push(k); } return ids.get(k); };
  heap.push(0, idOf(fromKey));
  while (heap.size) {
    const [d, i] = heap.pop(); const u = keys[i];
    if (d > dist.get(u)) continue;
    if (u === toKey) break;
    for (const { to, length } of world.adjacency.get(u) ?? []) {
      const nd = d + length;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, u); heap.push(nd, idOf(to)); }
    }
  }
  if (!dist.has(toKey)) return null;
  const path = [toKey];
  for (let u = toKey; prev.has(u); u = prev.get(u)) path.push(prev.get(u));
  path.reverse();
  let seamLinks = 0;
  for (let i = 1; i < path.length; i += 1) if (world.nodes.get(path[i]).chunkId !== world.nodes.get(path[i - 1]).chunkId) seamLinks += 1;
  return { length: r2(dist.get(toKey)), nodes: path.length, seamLinks, chunks: [...new Set(path.map(k => world.nodes.get(k).chunkId))] };
}

// Representative road node of a chunk: nearest to the chunk centre within the given world component
// (default: the chunk's largest component).
export function chunkAnchor(world, chunkId, origin, component = null) {
  let best = null;
  const sizes = new Map();
  for (const n of world.nodes.values()) if (n.chunkId === chunkId) { const c = world.componentOf.get(n.key); sizes.set(c, (sizes.get(c) ?? 0) + 1); }
  const main = component ?? [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  for (const n of world.nodes.values()) {
    if (n.chunkId !== chunkId || world.componentOf.get(n.key) !== main) continue;
    const d = Math.hypot(n.x - origin.x, n.z - origin.z);
    if (!best || d < best.d || (d === best.d && n.key < best.key)) best = { key: n.key, d };
  }
  return best?.key ?? null;
}
