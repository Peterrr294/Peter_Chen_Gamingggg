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
  snapToleranceM: 2, // G03c-02: half a terrain sample: a gate placed on the 4 m grid lands within this of its target; the uncommitted end moves onto it
  buildingClearanceM: 0.25, // a building is vacated where the corridor moves its ground by more than this
  // G02c-03a (opt-in): a ramp may pass ONE junction. Every road meeting there shares the junction height and is graded back.
  junctionLevelM: 8, // the roads stay level at the junction height for this distance on every side (cautious junction rule)
  junctionStraightDeg: 30, // the main road continues on the junction road closest to straight, within this angle
  junctionHeightSteps: 20, // junction heights tried between the source elevation and the junction ground (fraction steps)
});
export const RAMP_STATUS = Object.freeze({
  flush: 'flush', accepted: 'accepted', length: 'insufficientLength', grade: 'gradeExceeded', terrain: 'terrainDiscontinuity',
  collision: 'geometryCollision', network: 'networkConflict', infrastructure: 'requiresInfrastructure',
  junction: 'junctionConstraint', // G02c-03a: a ramp through the junction was tried; the junction or one of its roads failed
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

// Profile that starts level at yStart for `level` metres, then ramps to the ground: the shortest that passes, or the reason.
function rampFromLevel(samples, yStart, level, allowed, available) {
  const shifted = samples.filter(q => q.s >= level - 1e-6).map(q => ({ ...q, s: q.s - level }));
  if (!shifted.length) return { status: RAMP_STATUS.length, reason: 'road ends inside the level junction zone' };
  const found = searchProfile(shifted, yStart, allowed, available - level);
  if (found.status) return found;
  const ys = samples.map(q => (q.s < level ? yStart : found.ys[shifted.findIndex(x => Math.abs(x.s + level - q.s) < 1e-6)]));
  return { L: found.L + level, ys, m: measure(samples, ys, found.L + level) };
}

// G02c-03a: a ramp through one junction. main = road from the boundary through the junction J and on to its next node;
// branches = every other road at J. One height zJ for J; all roads level within junctionLevelM of J; each graded to the
// ground before its next junction. Any failing road refuses the whole plan.
function planJunction(network, sampler, wet, approach, y0, allowedOf) {
  const R = RAMP_RULES; const roads = network.edges.filter(e => e.kind !== 'canal');
  const J = approach.endNode; const arrive = approach.parts.at(-1); const nodeJ = network.nodes[J];
  const incident = roads.filter(e => (e.from === J || e.to === J) && e.id !== arrive.edge.id);
  const dirAway = e => { const pts = e.from === J ? e.points : [...e.points].reverse(); const a = pts[0]; const b = pts[Math.min(pts.length - 1, 1)]; return Math.atan2(b.z - a.z, b.x - a.x); };
  const inPts = arrive.forward ? arrive.edge.points : [...arrive.edge.points].reverse(); const ia = inPts.at(-2); const ib = inPts.at(-1);
  const heading = Math.atan2(ib.z - ia.z, ib.x - ia.x);
  const turn = e => { const d = Math.abs(((dirAway(e) - heading) * 180) / Math.PI) % 360; return Math.min(d, 360 - d); };
  const candidates = incident.filter(e => e.kind === 'road').map(e => ({ e, t: turn(e) })).sort((a, b) => a.t - b.t || a.e.id - b.e.id);
  const info = { nodeId: J, x: r2(nodeJ.x), z: r2(nodeJ.z), groundM: r2(nodeJ.y), degree: incident.length + 1, levelM: R.junctionLevelM };
  if (incident.some(e => e.kind !== 'road')) return { status: RAMP_STATUS.infrastructure, reason: 'a bridge or tunnel meets the junction', junction: info };
  if (!candidates.length || candidates[0].t > R.junctionStraightDeg) return { status: RAMP_STATUS.junction, reason: `no straight continuation at junction ${J} (closest turn ${candidates.length ? Math.round(candidates[0].t) : '—'}°)`, junction: info };
  const cont = candidates[0].e;
  const after = approachOf(network, J, cont);
  if (after.endsAtJunction && after.endNode === J) return { status: RAMP_STATUS.junction, reason: 'continuation loops back to the junction', junction: info };
  const main = { parts: [...approach.parts, ...after.parts], endsAtJunction: after.endsAtJunction, endNode: after.endNode };
  const ms = sampleApproach(main, sampler.height, wet);
  const sJ = ms.samples[approach.parts.length ? ms.marks[approach.parts.length] : 0].s;
  const branchesIn = incident.filter(e => e.id !== cont.id).map(e => { const a = approachOf(network, J, e); return { edge: e, approach: a, sampled: sampleApproach(a, sampler.height, wet) }; });
  info.mainContinuationEdge = cont.id; info.branchEdges = branchesIn.map(b => b.edge.id);
  if (sJ <= R.junctionLevelM) return { status: RAMP_STATUS.junction, reason: `junction only ${r2(sJ)} m from the shared edge: no room before its level zone`, junction: info };
  if ([ms, ...branchesIn.map(b => b.sampled)].some(x => x.samples.some(q => q.wet))) return { status: RAMP_STATUS.infrastructure, reason: 'a road at the junction crosses water', junction: info };
  const allowedMain = allowedOf(arrive.edge.roadClass); const gJ = nodeJ.y;
  let best = null; const failures = new Map(); const fail = x => { const k = x.reason.replace(/-?[0-9.]+/g, "#"); if (!failures.has(k)) failures.set(k, x); };
  for (let k = 0; k <= R.junctionHeightSteps; k += 1) {
    const zJ = y0 + (gJ - y0) * (k / R.junctionHeightSteps);
    if (Math.abs(zJ - gJ) > R.maxGroundOffsetM) { fail({ status: RAMP_STATUS.terrain, reason: `junction would sit ${r2(Math.abs(zJ - gJ))} m off its ground` }); continue; }
    // Main road: boundary → level zone around J → back to the ground.
    const L1 = sJ - R.junctionLevelM;
    const avail2 = ms.total - (main.endsAtJunction ? R.junctionStandoffM : 0);
    const ys = ms.samples.map(q => (q.s <= L1 ? y0 + (zJ - y0) * rampShape(q.s / L1) : zJ));
    const after2 = rampFromLevel(ms.samples.map(q => ({ ...q, s: q.s - (sJ - R.junctionLevelM) })).filter(q => q.s >= 0), zJ, 2 * R.junctionLevelM, allowedMain, avail2 - L1);
    if (after2.status) { fail({ status: RAMP_STATUS.junction, reason: `main road past the junction: ${after2.reason}` }); continue; }
    const first = ms.samples.findIndex(q => q.s >= L1);
    for (let i = first; i < ms.samples.length; i += 1) ys[i] = after2.ys[i - first] ?? ms.samples[i].ground;
    const mainEnd = L1 + after2.L;
    const mm = measure(ms.samples, ys, mainEnd);
    const off = Math.max(...ms.samples.filter(q => q.s <= mainEnd).map(q => Math.abs(ys[ms.samples.indexOf(q)] - q.ground)));
    if (mm.maxGrade > allowedMain + 1e-9 || mm.maxChange > R.maxGradeChangePerSample + 1e-9) { fail({ status: RAMP_STATUS.grade, reason: `main road through the junction: grade ${(mm.maxGrade * 100).toFixed(1)} %, change ${(mm.maxChange * 100).toFixed(1)} %` }); continue; }
    if (off > R.maxGroundOffsetM) { fail({ status: RAMP_STATUS.terrain, reason: `main road ${r2(off)} m off the ground` }); continue; }
    // Every branch: level at zJ, then down to the ground before its own next junction.
    const branches = []; let failed = null;
    for (const b of branchesIn) {
      const allowed = allowedOf(b.edge.roadClass);
      const avail = b.sampled.total - (b.approach.endsAtJunction ? R.junctionStandoffM : 0);
      const r = rampFromLevel(b.sampled.samples, zJ, R.junctionLevelM, allowed, avail);
      if (r.status) { failed = { status: RAMP_STATUS.junction, reason: `branch ${b.edge.id} (${b.edge.roadClass}, ${Math.round(b.sampled.total)} m to its next node): ${r.reason}` }; break; }
      const offB = Math.max(...b.sampled.samples.filter(q => q.s <= r.L).map((q, i) => Math.abs(r.ys[i] - q.ground)));
      if (offB > R.maxGroundOffsetM) { failed = { status: RAMP_STATUS.terrain, reason: `branch ${b.edge.id} ${r2(offB)} m off the ground` }; break; }
      branches.push({ ...b, ys: r.ys, L: r.L, m: r.m, allowed });
    }
    if (failed) { fail(failed); continue; }
    const earthwork = ms.samples.reduce((s, q, i) => s + Math.abs(ys[i] - q.ground), 0) + branches.reduce((s, b) => s + b.sampled.samples.reduce((t, q, i) => t + Math.abs(b.ys[i] - q.ground), 0), 0);
    if (!best || earthwork < best.earthwork - 1e-9) best = { zJ, ys, mainEnd, mm, branches, earthwork, k };
  }
  if (!best) { const list = [...failures.values()]; const branch = list.find(x => x.reason.startsWith('branch')); return { status: (branch ?? list[0])?.status ?? RAMP_STATUS.junction, reason: `no junction height passes: ${list.map(x => x.reason).slice(0, 3).join('; ')}`, junction: info }; }
  return {
    junction: { ...info, junctionZ: r2(best.zJ), heightStep: `${best.k} of ${R.junctionHeightSteps}`, branches: best.branches.map(b => ({ edgeId: b.edge.id, roadClass: b.edge.roadClass, lengthToNextNodeM: Math.round(b.sampled.total), rampLengthM: b.L, maxGrade: r3(b.m.maxGrade), allowedGrade: r3(b.allowed), endsAt: b.approach.endsAtJunction ? 'junction' : b.approach.endsOnBoundary ? 'boundary' : 'road end' })) },
    paths: [{ approach: main, samples: ms.samples, marks: ms.marks, ys: best.ys, L: best.mainEnd, width: arrive.edge.width }, ...best.branches.map(b => ({ approach: b.approach, samples: b.sampled.samples, marks: b.sampled.marks, ys: b.ys, L: b.L, width: b.edge.width }))],
    main: { L: best.mainEnd, m: best.mm, ys: best.ys, samples: ms.samples },
  };
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
    // A gate placed on the 4 m terrain grid can miss the other road end by a few decimetres: the uncommitted end moves onto it.
    if (!ports.length || ports[0].d > R.snapToleranceM) { done(RAMP_STATUS.network, ports.length ? `nearest child road end is ${r2(ports[0].d)} m away on the boundary` : 'no child road on this side', { horizontalM: ports.length ? r2(ports[0].d) : null }); continue; }
    const port = ports[0].p; const node = network.nodes[port.nodeId];
    const dh = node.y - e.elevation;
    if (ports[0].d > R.endpointToleranceM) rec.xySnapM = r2(ports[0].d);
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
    let found = available <= 0 ? { status: RAMP_STATUS.length, reason: `no road length before the junction (${Math.round(total)} m, stand-off ${R.junctionStandoffM} m)` } : searchProfile(samples, e.elevation, allowed, available);
    let paths = null; let junction = null;
    if (found.status === RAMP_STATUS.length && approach.endsAtJunction && vertical.throughJunction) {
      const jp = planJunction(network, sampler, wet, approach, e.elevation, cls => base * (R.classFactor[cls] ?? 1));
      if (jp.status) { done(jp.status, jp.reason, { simpleRampReason: found.reason, junction: jp.junction }); continue; }
      if (jp.paths.some(pa => pa.approach.parts.some(({ edge }) => claimedEdges.has(edge.id)))) { done(RAMP_STATUS.collision, 'a road of the junction plan is already used by another ramp', { simpleRampReason: found.reason, junction: jp.junction }); continue; }
      paths = jp.paths; junction = jp.junction; found = { L: jp.main.L, ys: jp.main.ys, m: jp.main.m };
      rec.simpleRampReason = `${available <= 0 ? `no road length before the junction (${Math.round(total)} m, stand-off ${R.junctionStandoffM} m)` : 'too short before the junction'}`;
    }
    if (found.status) { done(found.status, found.reason, { neededM: found.required ? Math.ceil(found.required) : null }); continue; }
    paths ??= [{ approach, samples, marks, ys: found.ys, L: found.L, width: network.edges[port.edgeId].width }];
    const pathSamples = paths[0].samples;
    const cells = new Map();
    for (const pa of paths) for (const [i, c] of corridorOf(fields, pa.samples, pa.ys, pa.L, pa.width)) { const old = cells.get(i); if (!old || c.d < old.d) cells.set(i, c); }
    // Collisions: another ramp's ground, or another road running over this ramp's reshaped ground.
    const clash = [...cells.keys()].some(i => claimedCells.has(i) && Math.abs(claimedCells.get(i) - fields.height[i]) > R.buildingClearanceM && Math.abs(cells.get(i).h - fields.height[i]) > R.buildingClearanceM);
    const own = new Set(paths.flatMap(pa => pa.approach.parts.map(({ edge }) => edge.id)));
    const moved = (x, z) => { const { originX, originZ, size, spacing, columns } = fields.grid; const i = Math.round((z - originZ + size / 2) / spacing) * columns + Math.round((x - originX + size / 2) / spacing); const c = cells.get(i); return c ? Math.abs(c.h - fields.height[i]) : 0; };
    const crossed = others.filter(x => !own.has(x.id)).some(x => x.points.some((a, i) => { if (!i) return false; const b = x.points[i - 1]; const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / R.sampleM); for (let k = 0; k <= n; k += 1) if (moved(a.x + (b.x - a.x) * (k / n), a.z + (b.z - a.z) * (k / n)) > R.buildingClearanceM) return true; return false; }));
    if (clash || crossed) { done(RAMP_STATUS.collision, clash ? 'corridor overlaps another ramp corridor' : 'corridor reshapes the ground under another road'); continue; }
    for (const [i, c] of cells) claimedCells.set(i, c.h);
    paths.forEach(pa => pa.approach.parts.forEach(({ edge }) => claimedEdges.add(edge.id)));
    const offsets = pathSamples.map((q, i) => found.ys[i] - q.ground).filter((_, i) => pathSamples[i].s <= found.L);
    const profile = pathSamples.filter(q => q.s <= found.L + RAMP_RULES.sampleM).map(q => { const i = pathSamples.indexOf(q); return [r2(q.s), r2(found.ys[i]), r2(q.ground)]; });
    done(RAMP_STATUS.accepted, null, {
      ...(junction ? { through: 'junction', junction } : {}),
      rampLengthM: found.L, startElevation: r2(e.elevation), endElevation: r2(found.ys[Math.max(0, pathSamples.findIndex(q => q.s >= found.L))]), maxGrade: r3(found.m.maxGrade), meanGrade: r3(found.m.meanGrade), maxGradeChange: r3(found.m.maxChange),
      fillMaxM: r2(Math.max(0, ...offsets)), cutMaxM: r2(Math.max(0, ...offsets.map(v => -v))), corridorCells: cells.size, corridorAreaM2: cells.size * fields.grid.spacing * fields.grid.spacing, residualM: 0, profile,
    });
    accepted.push({ rec, paths, port, node, elevation: e.elevation, junction });
  }
  // Apply to copies: plan geometry is the same, the generated network object stays untouched.
  const nodes = network.nodes.map(n => ({ ...n })); const edges = network.edges.map(x => ({ ...x }));
  const edgePorts = network.edgePorts.map(p => ({ ...p }));
  for (const a of accepted) {
    a.paths.forEach((pa, pIndex) => pa.approach.parts.forEach(({ edge, forward }, k) => {
      const ptsOf = pa.samples.slice(pa.marks[k], pa.marks[k + 1] + 1).map(q => { const i = pa.samples.indexOf(q); return { x: q.x, y: pa.ys[i], z: q.z }; });
      edges[edge.id] = { ...edges[edge.id], points: forward ? ptsOf : ptsOf.reverse(), ramp: a.rec.rampId, ...(a.junction ? { rampRole: pIndex === 0 ? 'main' : 'branch' } : {}) };
      const endNode = forward ? edge.to : edge.from; if (!network.nodes[endNode].onBoundary) nodes[endNode].y = pa.ys[pa.marks[k + 1]]; // G02c-03a: graph nodes take the road height
    }));
    if (a.junction) nodes[a.junction.nodeId].y = a.junction.junctionZ;
    nodes[a.node.id].y = a.elevation;
    for (const p of edgePorts) if (p.nodeId === a.node.id) p.elevation = a.elevation;
  }
  // Moved road ends (recorded as xySnapM): the node, the end of its road and its port take the other end's position.
  for (const rec of records.filter(x => x.xySnapM && (x.status === RAMP_STATUS.accepted || x.status === RAMP_STATUS.flush))) {
    const n = nodes[rec.childNodeId]; const was = { x: n.x, z: n.z };
    if (rec.side.endsWith('X')) n.z = rec.position; else n.x = rec.position;
    for (const x of edges.filter(q => q.from === n.id || q.to === n.id)) {
      const pts = x.points.map(q => ({ ...q }));
      for (const k of [0, pts.length - 1]) if (Math.hypot(pts[k].x - was.x, pts[k].z - was.z) < 1e-6) { pts[k].x = n.x; pts[k].z = n.z; }
      edges[x.id] = { ...edges[x.id], points: pts };
    }
    for (const q of edgePorts) if (q.nodeId === n.id) q.position = rec.position;
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

// G02c-03a impact report of one chunk's corridor. Only the chunk being generated is ever reshaped, so no committed building
// can be affected; what is lost are the new chunk's own building candidates on reshaped ground.
export function rampImpact(fields, height, blocks, parcels, buildings, vacated) {
  const { columns, spacing, originX, originZ, size } = fields.grid; const x0 = originX - size / 2; const z0 = originZ - size / 2;
  const moved = []; for (let i = 0; i < height.length; i += 1) if (Math.abs(height[i] - fields.height[i]) > RAMP_RULES.buildingClearanceM) moved.push({ x: x0 + (i % columns) * spacing, z: z0 + Math.floor(i / columns) * spacing });
  const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) { const a = poly[i]; const b = poly[j]; if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c; } return c; };
  const areaOn = list => { let cells = 0; let touched = 0; for (const o of list) { const poly = o.polygon; const xs = poly.map(q => q.x); const zs = poly.map(q => q.z); const lo = { x: Math.min(...xs), z: Math.min(...zs) }; const hi = { x: Math.max(...xs), z: Math.max(...zs) }; const n = moved.filter(q => q.x >= lo.x && q.x <= hi.x && q.z >= lo.z && q.z <= hi.z && inside(poly, q.x, q.z)).length; if (n) { cells += n; touched += 1; } } return { touched, areaM2: cells * spacing * spacing }; };
  const gone = new Set(vacated); const lost = (buildings.buildings ?? []).filter(b => gone.has(b.id));
  const b = areaOn(blocks.blocks ?? []); const pa = areaOn(parcels.parcels ?? []);
  return {
    committedBuildingsAffected: 0, committedNote: 'by construction: only the chunk being generated is reshaped',
    newBuildingCandidatesExcluded: lost.length, excludedFootprintM2: Math.round(lost.reduce((s, x) => s + (x.footprintArea ?? 0), 0)), candidatesBefore: (buildings.buildings ?? []).length,
    corridorAreaM2: moved.length * spacing * spacing, blocksTouched: b.touched, blockAreaAffectedM2: b.areaM2, parcelsTouched: pa.touched, parcelAreaAffectedM2: pa.areaM2,
  };
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
