// A City of Cities — G02c-02 Grade-Aware Road Growth: vertical alignment of a new chunk's roads (pure data, runs in Node).
//
// Roads lie on their chunk's own terrain and growth terrain is raw, so a height step at a chunk edge IS the terrain seam.
// A connection is negotiated in the uncommitted child only; parent chunks, world terrain and plan geometry never change:
//   1. pair each neighbouring road end with the child port at the same point (XY continuity)
//   2. take the child road from that port to its first junction as the available approach
//   3. search the shortest profile (constant grade + parabolic vertical curves) that passes when SAMPLED: maximum grade,
//      grade change, height over the ground; it starts at the neighbour's elevation (elevation continuity)
//   4. give the ground a road corridor (flat under the road + side slopes), limited to the ramp, recorded, for this chunk only
//   5. buildings on reshaped ground stay vacant and are recorded
// A candidate that cannot pass stays unconnected with its reason. The seam beside the corridor stays visible and measured.
import { checksum } from '../cellular-noise/noise.js';

// Sensitivity experiment, not a road standard: none of these values is calibrated.
export const GRADE_PROFILES = Object.freeze({ conservative: { id: 'conservative', grade: 0.04 }, baseline: { id: 'baseline', grade: 0.06 }, permissive: { id: 'permissive', grade: 0.08 } });
export const RAMP_RULES = Object.freeze({
  classFactor: { primary: 1, secondary: 1.25, lane: 1.5 }, // allowed grade = profile grade × factor: lesser roads may be steeper
  curveShare: 0.25, // share of the ramp used by each vertical curve
  junctionStandoffM: 12, // a ramp ends this far before a junction, whose cross streets stay on the terrain
  sampleM: 4, // profile samples; equal to the terrain grid spacing
  runStepM: 8, // ramp length search step
  maxGroundOffsetM: 6, // largest cut or fill under a road without a retaining structure; beyond it: requires infrastructure
  maxGradeChangePerSample: 0.03, // sampled grade change between neighbouring samples (vertical curve check)
  shoulderM: 1.5, // flat ground beside the road surface
  sideSlopeRunPerM: 2, // metres of side slope per metre of height
  endpointToleranceM: 0.05, // same-node height test: port elevations are stored to 0.01 m, terrain samples 4 m apart
  buildingClearanceM: 0.25, // a building is vacated where the corridor moves its ground by more than this
});
export const RAMP_STATUS = Object.freeze({
  flush: 'flush', accepted: 'accepted', length: 'insufficientLength', grade: 'gradeExceeded', terrain: 'terrainDiscontinuity',
  collision: 'geometryCollision', network: 'networkConflict', infrastructure: 'requiresInfrastructure',
});
const r2 = v => +Number(v).toFixed(2);
const r3 = v => +Number(v).toFixed(3);
const positionOf = (node, side) => (side.endsWith('X') ? node.z : node.x);

// Fraction of the height change reached at t (0–1): parabola, constant grade, parabola.
export function rampShape(t, c = RAMP_RULES.curveShare) {
  const p = 1 / (1 - c);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < c) return (p * t * t) / (2 * c);
  if (t <= 1 - c) return p * (t - c / 2);
  return 1 - (p * (1 - t) * (1 - t)) / (2 * c);
}

// The child's road from a boundary node to its first junction or end, through bend nodes.
function approachOf(network, startNode, startEdge) {
  const roads = network.edges.filter(e => e.kind !== 'canal');
  const incident = id => roads.filter(e => e.from === id || e.to === id);
  const parts = []; let node = startNode; let edge = startEdge; const seen = new Set();
  while (edge && !seen.has(edge.id)) {
    seen.add(edge.id);
    const forward = edge.from === node;
    parts.push({ edge, forward });
    node = forward ? edge.to : edge.from;
    const next = incident(node);
    if (next.length !== 2 || network.nodes[node].onBoundary) break;
    edge = next.find(e => e.id !== edge.id);
  }
  const end = network.nodes[node];
  return { parts, endNode: node, endsAtJunction: incident(node).length >= 3, endsOnBoundary: end.onBoundary };
}

function sampleApproach(approach, ground, wet) {
  const samples = []; let total = 0;
  const marks = [0];
  for (const { edge, forward } of approach.parts) {
    const pts = forward ? edge.points : [...edge.points].reverse();
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]; const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / RAMP_RULES.sampleM));
      for (let k = i === 1 && !samples.length ? 0 : 1; k <= steps; k += 1) {
        const t = k / steps; const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
        samples.push({ s: total + len * t, x, z, ground: ground(x, z), wet: wet(x, z) });
      }
      total += len;
    }
    marks.push(samples.length - 1);
  }
  return { samples, total, marks };
}

// Grades of a profile, measured between neighbouring samples.
function measure(samples, ys, upTo) {
  let maxGrade = 0; let maxChange = 0; let prev = null; let sum = 0; let count = 0;
  // Up to one sample past the ramp end: the change back onto the terrain grade is part of the vertical curve.
  for (let i = 1; i < samples.length && samples[i - 1].s < upTo + RAMP_RULES.sampleM - 1e-6; i += 1) {
    const g = (ys[i] - ys[i - 1]) / Math.max(1e-6, samples[i].s - samples[i - 1].s);
    maxGrade = Math.max(maxGrade, Math.abs(g)); sum += Math.abs(g); count += 1;
    if (prev !== null) maxChange = Math.max(maxChange, Math.abs(g - prev));
    prev = g;
  }
  return { maxGrade, maxChange, meanGrade: count ? sum / count : 0 };
}

// Shortest ramp that passes the sampled checks, or the reason none does.
function searchProfile(samples, y0, allowedGrade, available) {
  const R = RAMP_RULES;
  const groundAt = s => { const i = samples.findIndex(q => q.s >= s); return samples[Math.max(0, i)].ground; };
  const required = Math.abs(groundAt(Math.min(available, samples.at(-1).s)) - y0) / (allowedGrade * (1 - R.curveShare));
  if (required > available) return { status: RAMP_STATUS.length, required, reason: `needs ${Math.ceil(required)} m at ${(allowedGrade * 100).toFixed(1)} %, ${Math.floor(available)} m available` };
  let failure = null;
  for (let L = Math.max(R.runStepM, Math.ceil(required / R.runStepM) * R.runStepM); L <= available + 1e-6; L += R.runStepM) {
    const yEnd = groundAt(L);
    const ys = samples.map(q => (q.s >= L ? q.ground : y0 + (yEnd - y0) * rampShape(q.s / L)));
    const m = measure(samples, ys, L);
    const offset = Math.max(...samples.map((q, i) => Math.abs(ys[i] - q.ground)));
    if (offset > R.maxGroundOffsetM) { failure = { status: RAMP_STATUS.terrain, reason: `road would be ${r2(offset)} m off the ground, limit ${R.maxGroundOffsetM} m` }; continue; }
    if (m.maxGrade > allowedGrade) { failure = { status: RAMP_STATUS.grade, reason: `sampled grade ${(m.maxGrade * 100).toFixed(1)} % over ${(allowedGrade * 100).toFixed(1)} %` }; continue; }
    if (m.maxChange > R.maxGradeChangePerSample) { failure = { status: RAMP_STATUS.grade, reason: `grade change ${(m.maxChange * 100).toFixed(1)} % per sample over ${(R.maxGradeChangePerSample * 100).toFixed(1)} %` }; continue; }
    return { L, ys, m, required };
  }
  return { required, ...(failure ?? { status: RAMP_STATUS.length, reason: `no ramp length fits ${Math.floor(available)} m` }) };
}

// Ground under one ramp: cell index → new height. Flat at the road elevation under the road, then a side slope.
function corridorOf(fields, samples, ys, L, width) {
  const { columns, segments, spacing, originX, originZ, size } = fields.grid;
  const R = RAMP_RULES; const cells = new Map();
  const on = samples.map((q, i) => ({ ...q, y: ys[i] })).filter(q => q.s <= L);
  const reach = width / 2 + R.shoulderM + R.maxGroundOffsetM * R.sideSlopeRunPerM + spacing;
  const x0 = originX - size / 2; const z0 = originZ - size / 2;
  for (const q of on) {
    const c0 = Math.max(0, Math.floor((q.x - reach - x0) / spacing)); const c1 = Math.min(segments, Math.ceil((q.x + reach - x0) / spacing));
    const r0 = Math.max(0, Math.floor((q.z - reach - z0) / spacing)); const r1 = Math.min(segments, Math.ceil((q.z + reach - z0) / spacing));
    for (let row = r0; row <= r1; row += 1) for (let col = c0; col <= c1; col += 1) {
      const d = Math.hypot(x0 + col * spacing - q.x, z0 + row * spacing - q.z);
      const i = row * columns + col; const h = fields.height[i];
      const flat = width / 2 + R.shoulderM;
      let target = null;
      if (d <= flat) target = q.y;
      else { const run = Math.abs(q.y - h) * R.sideSlopeRunPerM; if (run > 0 && d - flat < run) target = q.y + (h - q.y) * ((d - flat) / run); }
      if (target === null) continue;
      const old = cells.get(i);
      if (!old || d < old.d) cells.set(i, { d, h: target });
    }
  }
  return cells;
}

// entries: { connectionId, kind: parent | neighbour, parentChunkId, parentNodeId, parentEdgeId, side (child side), position, roadClass, elevation }
export function planVertical(network, fields, sampler, vertical) {
  const R = RAMP_RULES;
  const base = GRADE_PROFILES[vertical.profile].grade;
  const wet = (x, z) => { const { originX, originZ, size, spacing, columns } = fields.grid; const i = Math.round((z - originZ + size / 2) / spacing) * columns + Math.round((x - originX + size / 2) / spacing); return fields.waterMask[i] === 1; };
  const records = []; const accepted = []; const claimedEdges = new Set(); const claimedCells = new Map();
  const others = network.edges.filter(e => e.kind !== 'canal');
  for (const e of [...vertical.entries].sort((a, b) => a.connectionId.localeCompare(b.connectionId))) {
    const rampId = `ramp:${vertical.chunkId}:${e.connectionId.split(':').slice(1).join(':')}`;
    const rec = { rampId, connectionId: e.connectionId, kind: e.kind, sourceRoadId: `${e.parentChunkId}:e${e.parentEdgeId}`, parentChunkId: e.parentChunkId, targetChunkId: vertical.chunkId, side: e.side, position: e.position, roadClass: e.roadClass, elevationSource: e.elevation };
    const done = (status, reason, extra = {}) => { records.push({ ...rec, status, reason, ...extra }); };
    const ports = network.edgePorts.filter(p => p.side === e.side && p.type === 'road').map(p => ({ p, d: Math.abs(p.position - e.position) })).sort((a, b) => a.d - b.d);
    if (!ports.length || ports[0].d > R.endpointToleranceM) { done(RAMP_STATUS.network, ports.length ? `nearest child road end is ${r2(ports[0].d)} m away on the boundary` : 'no child road on this side', { horizontalM: ports.length ? r2(ports[0].d) : null }); continue; }
    const port = ports[0].p; const node = network.nodes[port.nodeId];
    const dh = node.y - e.elevation;
    Object.assign(rec, { horizontalM: r2(ports[0].d), childNodeId: node.id, childEdgeId: port.edgeId, elevationChild: r2(node.y), deltaM: r2(dh), childRoadClass: port.roadClass, directionDeg: r2(port.directionDeg) });
    if (others.filter(x => x.from === node.id || x.to === node.id).length !== 1) { done(RAMP_STATUS.network, 'child road end has more than one road'); continue; }
    if (Math.abs(dh) <= R.endpointToleranceM) { done(RAMP_STATUS.flush, 'heights already meet', { residualM: r3(Math.abs(dh)) }); continue; }
    if (Math.abs(dh) > R.maxGroundOffsetM) { done(RAMP_STATUS.terrain, `terrain seam ${r2(Math.abs(dh))} m exceeds ${R.maxGroundOffsetM} m without a structure`); continue; }
    const approach = approachOf(network, node.id, network.edges[port.edgeId]);
    if (approach.parts.some(({ edge }) => edge.kind !== 'road')) { done(RAMP_STATUS.infrastructure, `approach holds a ${approach.parts.find(({ edge }) => edge.kind !== 'road').edge.kind}, not a road on ground`); continue; }
    const { samples, total, marks } = sampleApproach(approach, sampler.height, wet);
    const available = total - (approach.endsAtJunction ? R.junctionStandoffM : 0);
    Object.assign(rec, { availableM: Math.round(available), approachM: Math.round(total), approachEnd: approach.endsAtJunction ? 'junction' : approach.endsOnBoundary ? 'boundary' : 'road end' });
    if (samples.some(q => q.wet)) { done(RAMP_STATUS.infrastructure, 'approach crosses water'); continue; }
    if (approach.parts.some(({ edge }) => claimedEdges.has(edge.id))) { done(RAMP_STATUS.collision, 'approach already used by another ramp'); continue; }
    const allowed = base * (R.classFactor[port.roadClass] ?? 1);
    Object.assign(rec, { allowedGrade: r3(allowed), requiredRunM: Math.ceil(Math.abs(dh) / allowed) });
    if (available <= 0) { done(RAMP_STATUS.length, `no road length before the junction (${Math.round(total)} m, stand-off ${R.junctionStandoffM} m)`); continue; }
    const found = searchProfile(samples, e.elevation, allowed, available);
    if (found.status) { done(found.status, found.reason, { neededM: found.required ? Math.ceil(found.required) : null }); continue; }
    const cells = corridorOf(fields, samples, found.ys, found.L, network.edges[port.edgeId].width);
    // Collisions: another ramp's ground, or another road running over this ramp's reshaped ground.
    const clash = [...cells.keys()].some(i => claimedCells.has(i) && Math.abs(claimedCells.get(i) - fields.height[i]) > R.buildingClearanceM && Math.abs(cells.get(i).h - fields.height[i]) > R.buildingClearanceM);
    const own = new Set(approach.parts.map(({ edge }) => edge.id));
    const moved = (x, z) => { const { originX, originZ, size, spacing, columns } = fields.grid; const i = Math.round((z - originZ + size / 2) / spacing) * columns + Math.round((x - originX + size / 2) / spacing); const c = cells.get(i); return c ? Math.abs(c.h - fields.height[i]) : 0; };
    const crossed = others.filter(x => !own.has(x.id)).some(x => x.points.some((a, i) => { if (!i) return false; const b = x.points[i - 1]; const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / R.sampleM); for (let k = 0; k <= n; k += 1) if (moved(a.x + (b.x - a.x) * (k / n), a.z + (b.z - a.z) * (k / n)) > R.buildingClearanceM) return true; return false; }));
    if (clash || crossed) { done(RAMP_STATUS.collision, clash ? 'corridor overlaps another ramp corridor' : 'corridor reshapes the ground under another road'); continue; }
    for (const [i, c] of cells) claimedCells.set(i, c.h);
    approach.parts.forEach(({ edge }) => claimedEdges.add(edge.id));
    const offsets = samples.map((q, i) => found.ys[i] - q.ground).filter((_, i) => samples[i].s <= found.L);
    const profile = samples.filter(q => q.s <= found.L + RAMP_RULES.sampleM).map(q => { const i = samples.indexOf(q); return [r2(q.s), r2(found.ys[i]), r2(q.ground)]; });
    done(RAMP_STATUS.accepted, null, {
      rampLengthM: found.L, startElevation: r2(e.elevation), endElevation: r2(found.ys[samples.findIndex(q => q.s >= found.L)]), maxGrade: r3(found.m.maxGrade), meanGrade: r3(found.m.meanGrade), maxGradeChange: r3(found.m.maxChange),
      fillMaxM: r2(Math.max(0, ...offsets)), cutMaxM: r2(Math.max(0, ...offsets.map(v => -v))), corridorCells: cells.size, corridorAreaM2: cells.size * fields.grid.spacing * fields.grid.spacing, residualM: 0, profile,
    });
    accepted.push({ rec, approach, samples, marks, ys: found.ys, port, node, elevation: e.elevation });
  }
  // Apply to copies: plan geometry is the same, the generated network object stays untouched.
  const nodes = network.nodes.map(n => ({ ...n })); const edges = network.edges.map(x => ({ ...x }));
  const edgePorts = network.edgePorts.map(p => ({ ...p }));
  for (const a of accepted) {
    a.approach.parts.forEach(({ edge, forward }, k) => {
      const ptsOf = a.samples.slice(a.marks[k], a.marks[k + 1] + 1).map(q => { const i = a.samples.indexOf(q); return { x: q.x, y: a.ys[i], z: q.z }; });
      edges[edge.id] = { ...edges[edge.id], points: forward ? ptsOf : ptsOf.reverse(), ramp: a.rec.rampId };
    });
    nodes[a.node.id].y = a.elevation;
    for (const p of edgePorts) if (p.nodeId === a.node.id) p.elevation = a.elevation;
  }
  for (const rec of records.filter(x => x.status === RAMP_STATUS.flush)) { nodes[rec.childNodeId].y = rec.elevationSource; for (const p of edgePorts) if (p.nodeId === rec.childNodeId) p.elevation = rec.elevationSource; }
  const height = Float32Array.from(fields.height);
  for (const [i, h] of claimedCells) height[i] = h;
  return { records, network: { ...network, nodes, edges, edgePorts }, height, corridorCells: claimedCells };
}

// Buildings whose ground the corridor moves stay vacant. Returns the kept buildings and the vacated ids.
export function vacateBuildings(buildings, fields, height) {
  const { columns, spacing, originX, originZ, size, segments } = fields.grid;
  const movedAt = (x, z) => { const c = Math.min(segments, Math.max(0, Math.round((x - originX + size / 2) / spacing))); const r = Math.min(segments, Math.max(0, Math.round((z - originZ + size / 2) / spacing))); const i = r * columns + c; return Math.abs(height[i] - fields.height[i]); };
  const kept = []; const vacated = [];
  for (const b of buildings.buildings ?? []) {
    const ring = b.footprint.polygon;
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length; const cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    if ([{ x: cx, z: cz }, ...ring].some(p => movedAt(p.x, p.z) > RAMP_RULES.buildingClearanceM)) vacated.push(b.id); else kept.push(b);
  }
  return { buildings: { ...buildings, buildings: kept, stats: { ...buildings.stats, buildings: kept.length } }, vacated };
}

export function rampSignature(records, vacated) {
  return checksum(new TextEncoder().encode(JSON.stringify({ r: records.map(({ profile, ...rest }) => ({ ...rest, p: profile ?? null })), v: vacated })));
}

// Diagnosis class of a candidate (a step at a shared edge is the terrain seam by construction; the class says what it needs).
export function diagnosisOf(record) {
  const S = RAMP_STATUS;
  if (record.status === S.accepted || record.status === S.flush) return 'A road elevation mismatch, resolved';
  if (record.status === S.terrain || record.status === S.infrastructure) return 'B terrain seam discontinuity';
  if (record.status === S.network || record.status === S.collision) return 'C geometry or topology mismatch';
  return 'D insufficient approach length';
}
export { positionOf };
