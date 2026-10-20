import { CONNECTIVITY } from './networkStrategies.js';
import { MinHeap, findCrossings } from './NetworkGenerator.js';

// 03.2 connectivity planner: links road components and missing edge ports that
// steep terrain separates. Surface mountain roads first; a tunnel only when the
// surface route is impossible or far too long AND a tunnel passes every
// engineering check AND is cheaper. Works on the existing GraphBuilder; never
// changes terrain. All thresholds: CONNECTIVITY in networkStrategies.js.

// 16 directions: axis, diagonal, and knight moves let roads follow contours.
const MOVES = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
// Cells a move passes beside; all must be passable (no corner cutting through water, cliffs, or roads).
const between = (dr, dc) => {
  if (Math.abs(dr) + Math.abs(dc) === 1) return [];
  if (Math.abs(dr) === 1 && Math.abs(dc) === 1) return [[dr, 0], [0, dc]];
  return Math.abs(dr) === 2 ? [[Math.sign(dr), 0], [Math.sign(dr), dc]] : [[0, Math.sign(dc)], [dr, Math.sign(dc)]];
};
const SURFACE_KINDS = new Set(['road', 'bridgeCandidate']);

function rasterize(builder, sampler) {
  const components = builder.components(kind => kind !== 'canal').sort((a, b) => b.length - a.length || a.nodes[0].localeCompare(b.nodes[0]));
  const componentOf = new Map();
  components.forEach((component, index) => component.edges.forEach(edgeId => componentOf.set(edgeId, index)));
  const cells = new Map();
  const blocked = new Uint8Array(sampler.count);
  for (const edge of builder.edges.values()) {
    if (!SURFACE_KINDS.has(edge.kind)) continue;
    for (let segIndex = 0; segIndex < edge.points.length - 1; segIndex += 1) {
      const a = edge.points[segIndex];
      const b = edge.points[segIndex + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let s = 0; s <= steps; s += 1) {
        const point = { x: a.x + (b.x - a.x) * s / steps, z: a.z + (b.z - a.z) * s / steps };
        const cell = sampler.indexAt(point.x, point.z);
        blocked[cell] = 1;
        if (edge.kind !== 'road') continue;
        // Attach to the sample closest to the cell centre, so a node sitting on the cell is joined, not passed.
        const centre = sampler.toWorld(cell);
        const distance = Math.hypot(point.x - centre.x, point.z - centre.z);
        if (!cells.has(cell) || distance < cells.get(cell).distance - 1e-9) cells.set(cell, { edgeId: edge.id, segIndex, point, component: componentOf.get(edge.id), distance });
      }
    }
  }
  return { components, cells, blocked };
}

// Grade-limited 16-direction Dijkstra. Returns { path, cost } to the first goal, or
// the full { dist, prev } when goal is null.
function mountainSearch(sampler, { sources, goal, blocked, allowBoundary = new Set(), maxCost }) {
  const rules = CONNECTIVITY.mountainRoad;
  const { columns, segments, spacing } = sampler.grid;
  const { waterMask, slope, height } = sampler.fields;
  const passable = index => !waterMask[index] && slope[index] <= rules.maxTerrainSlopeDeg
    && (!sampler.onBoundary(index) || allowBoundary.has(index));
  const dist = new Float64Array(sampler.count).fill(Infinity);
  const prev = new Int32Array(sampler.count).fill(-1);
  const heap = new MinHeap();
  const sourceSet = new Set(sources);
  for (const source of sources) { dist[source] = 0; heap.push(0, source); }
  while (heap.size) {
    const [d, index] = heap.pop();
    if (d > dist[index]) continue;
    if (goal && goal(index) && !sourceSet.has(index)) {
      const path = [index];
      for (let at = prev[index]; at !== -1; at = prev[at]) path.push(at);
      return { path: path.reverse(), cost: d };
    }
    if (d > maxCost) break;
    const row = Math.floor(index / columns);
    const col = index % columns;
    for (const [dr, dc] of MOVES) {
      const r = row + dr; const c = col + dc;
      if (r < 0 || c < 0 || r > segments || c > segments) continue;
      const next = r * columns + c;
      const isGoal = goal && goal(next);
      if (!passable(next) || (blocked[next] && !isGoal)) continue;
      if (between(dr, dc).some(([br, bc]) => { const cell = (row + br) * columns + col + bc; return !passable(cell) || blocked[cell]; })) continue;
      const length = spacing * Math.hypot(dr, dc);
      const rise = Math.abs(height[next] - height[index]);
      if (rise / length > rules.maxGrade) continue;
      const ratio = slope[next] / rules.maxTerrainSlopeDeg;
      const nd = d + length * (1 + rules.slopePenalty * ratio * ratio) + rules.climbPenalty * rise;
      if (nd < dist[next]) { dist[next] = nd; prev[next] = index; heap.push(nd, next); }
    }
  }
  return goal ? null : { dist, prev };
}

const pathLength = points => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.z - points[i].z), 0);
const dedupe = points => points.filter((point, i) => i === 0 || Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z) > 1e-6);

// Final grade check on an assembled polyline (attach segments included); segments under 3 m are ignored.
function gradeOk(sampler, points) {
  for (let i = 1; i < points.length; i += 1) {
    const run = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (run >= 3 && Math.abs(sampler.height(points[i].x, points[i].z) - sampler.height(points[i - 1].x, points[i - 1].z)) / run > CONNECTIVITY.mountainRoad.maxGrade) return false;
  }
  return true;
}

function crossesNetwork(builder, points, ignoreKinds = new Set(['canal', 'tunnel'])) {
  const candidate = { id: '__candidate', kind: 'road', points };
  const edges = [candidate, ...[...builder.edges.values()].filter(edge => !ignoreKinds.has(edge.kind))];
  if (findCrossings(edges).some(pair => pair.includes('__candidate'))) return true;
  // Near-touch: passing within 0.5 m of an existing node (other than the candidate's own ends) would leave an unjoined junction.
  const ends = [points[0], points.at(-1)];
  for (const node of builder.nodes.values()) {
    if (ends.some(end => Math.hypot(end.x - node.x, end.z - node.z) < 1e-6)) continue;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]; const b = points[i];
      const length2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((node.x - a.x) * (b.x - a.x) + (node.z - a.z) * (b.z - a.z)) / length2));
      if (Math.hypot(node.x - (a.x + (b.x - a.x) * t), node.z - (a.z + (b.z - a.z) * t)) < 0.5) return true;
    }
  }
  return false;
}

// Engineering check of one straight tunnel P → Q. Returns metrics or a rejection reason.
function checkTunnel(builder, sampler, P, Q, transitionWidth, existingTunnels) {
  const rules = CONNECTIVITY.tunnel;
  const planLength = Math.hypot(Q.x - P.x, Q.z - P.z);
  if (planLength < rules.minLength) return { reason: 'tooShort' };
  if (planLength > rules.maxLength) return { reason: 'tooLong' };
  const yP = sampler.height(P.x, P.z);
  const yQ = sampler.height(Q.x, Q.z);
  const grade = (yQ - yP) / planLength;
  if (Math.abs(grade) > rules.maxGrade) return { reason: 'grade' };
  const profile = [];
  let minCover = Infinity; let coverSum = 0; let coverCount = 0;
  const steps = Math.ceil(planLength / 4);
  for (let s = 0; s <= steps; s += 1) {
    const d = planLength * s / steps;
    const x = P.x + (Q.x - P.x) * s / steps;
    const z = P.z + (Q.z - P.z) * s / steps;
    const cell = sampler.indexAt(x, z);
    if (sampler.fields.waterMask[cell]) return { reason: 'water' };
    if (builder.distanceToBoundary({ x, z }) < transitionWidth) return { reason: 'transitionZone' };
    const roadY = yP + grade * d;
    const terrainY = sampler.height(x, z);
    const cover = terrainY - roadY - rules.clearance;
    const inPortal = d < rules.portalZone || planLength - d < rules.portalZone;
    if (inPortal && terrainY < roadY - 0.25) return { reason: 'daylight' };
    if (!inPortal) {
      if (cover < rules.minCover) return { reason: 'cover' };
      minCover = Math.min(minCover, cover); coverSum += cover; coverCount += 1;
    }
    if (s % 2 === 0 || s === steps) profile.push({ d: Number(d.toFixed(1)), roadY: Number(roadY.toFixed(2)), crownY: Number((roadY + rules.clearance).toFixed(2)), terrainY: Number(terrainY.toFixed(2)), cover: Number(cover.toFixed(2)) });
  }
  if (!coverCount) return { reason: 'cover' };
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (const tunnel of existingTunnels) {
    const a = tunnel.points[0]; const b = tunnel.points.at(-1);
    if ((Math.hypot(a.x - P.x, a.z - P.z) < 50 && Math.hypot(b.x - Q.x, b.z - Q.z) < 50) || (Math.hypot(a.x - Q.x, a.z - Q.z) < 50 && Math.hypot(b.x - P.x, b.z - P.z) < 50)) return { reason: 'duplicate' };
    if (cross(P, Q, a) * cross(P, Q, b) < 0 && cross(a, b, P) * cross(a, b, Q) < 0) return { reason: 'crossesTunnel' };
  }
  return { planLength, yP, yQ, grade, minCover, meanCover: coverSum / coverCount, profile, length3d: Math.hypot(planLength, yQ - yP) };
}

function closestDistance(listA, listB) {
  let best = Infinity; let pair = null;
  const strideA = Math.max(1, Math.ceil(listA.length / 200));
  const strideB = Math.max(1, Math.ceil(listB.length / 200));
  for (let i = 0; i < listA.length; i += strideA) for (let j = 0; j < listB.length; j += strideB) {
    const d = Math.hypot(listA[i].x - listB[j].x, listA[i].z - listB[j].z);
    if (d < best) { best = d; pair = [listA[i], listB[j]]; }
  }
  return { distance: best, pair };
}

function waterBetween(sampler, a, b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
  for (let s = 0; s <= steps; s += 1) if (sampler.fields.waterMask[sampler.indexAt(a.x + (b.x - a.x) * s / steps, a.z + (b.z - a.z) * s / steps)]) return true;
  return false;
}

// Side → middle cell of the longest legal boundary run, for sides without a road port.
function missingPortDemands(builder, sampler) {
  const rules = CONNECTIVITY.mountainRoad;
  const sidesWithPorts = new Set();
  for (const node of builder.nodes.values()) {
    const side = builder.boundarySide(node.x, node.z);
    if (side && [...node.edges].some(id => builder.edges.get(id).kind === 'road')) sidesWithPorts.add(side);
  }
  const { columns, segments, spacing } = sampler.grid;
  const lines = { minX: s => s * columns, maxX: s => s * columns + segments, minZ: s => s, maxZ: s => segments * columns + s };
  const demands = [];
  for (const [side, at] of Object.entries(lines)) {
    if (sidesWithPorts.has(side)) continue;
    let best = null; let start = -1;
    for (let s = 0; s <= segments + 1; s += 1) {
      const legal = s <= segments && !sampler.fields.waterMask[at(s)] && sampler.fields.slope[at(s)] <= rules.maxTerrainSlopeDeg;
      if (legal && start === -1) start = s;
      if (!legal && start !== -1) {
        if (!best || s - start > best.length) best = { length: s - start, cell: at((start + s - 1) >> 1) };
        start = -1;
      }
    }
    if (best && best.length * spacing >= CONNECTIVITY.gateMinRun) demands.push({ type: 'edgePort', side, cell: best.cell, runLength: best.length * spacing });
  }
  return demands;
}

export function planConnectivity(builder, sampler, transitionWidth) {
  const decisions = [];
  const tunnels = [];
  let connectors = 0;
  const attempted = new Set();
  const nextDemand = () => {
    const { components } = rasterize(builder, sampler);
    if (!components.length) return null;
    const target = components.slice(1).find(component => component.length >= CONNECTIVITY.minLinkComponentLength && !attempted.has(component.nodes.slice().sort()[0]));
    if (target) { attempted.add(target.nodes.slice().sort()[0]); return { type: 'component', length: target.length, key: target.nodes.slice().sort()[0] }; }
    return null;
  };

  const process = demand => {
    const raster = rasterize(builder, sampler);
    const main = raster.components[0];
    const mainIndex = 0;
    const record = { demand: { type: demand.type, side: demand.side, length: demand.length, runLength: demand.runLength } };
    if (!main || main.length < CONNECTIVITY.minLinkComponentLength) { record.decision = 'skipped'; record.reason = 'no main network'; return record; }
    const targetIndex = demand.type === 'component' ? raster.components.findIndex(component => component.nodes.slice().sort()[0] === demand.key) : -1;
    const mainCells = [...raster.cells].filter(([, entry]) => entry.component === mainIndex);
    const sourceCells = demand.type === 'component' ? [...raster.cells].filter(([, entry]) => entry.component === targetIndex).map(([cell]) => cell) : [demand.cell];
    const goalSet = new Set(mainCells.map(([cell]) => cell));
    const closest = closestDistance(sourceCells.map(cell => sampler.toWorld(cell)), mainCells.map(([cell]) => sampler.toWorld(cell)));
    record.straightDistance = closest.distance;
    if (closest.pair && waterBetween(sampler, closest.pair[0], closest.pair[1])) { record.decision = 'skipped'; record.reason = 'water between (bridge policy, not tunnel)'; return record; }

    // Surface route.
    const blocked = raster.blocked;
    const search = mountainSearch(sampler, { sources: sourceCells, goal: cell => goalSet.has(cell), blocked, allowBoundary: new Set(demand.type === 'edgePort' ? [demand.cell] : []), maxCost: CONNECTIVITY.mountainRoad.maxSearchCost });
    let surface = null;
    if (search) {
      const start = search.path[0]; const end = search.path.at(-1);
      const startAttach = raster.cells.get(start);
      const points = dedupe([...(startAttach && demand.type === 'component' ? [startAttach.point] : []), ...search.path.map(cell => sampler.toWorld(cell)), raster.cells.get(end).point]);
      const length = pathLength(points);
      const direct = Math.hypot(points.at(-1).x - points[0].x, points.at(-1).z - points[0].z) || 1;
      surface = { points, cost: search.cost, length, detourRatio: length / direct, crosses: crossesNetwork(builder, points), startAttach, endAttach: raster.cells.get(end) };
      if (surface.crosses) surface = { ...surface, feasible: false, reason: 'crosses existing network' };
      else if (!gradeOk(sampler, points)) surface = { ...surface, feasible: false, reason: 'attach segment exceeds grade' };
      else surface.feasible = true;
    }
    record.surface = surface ? { feasible: surface.feasible, length: surface.length, cost: surface.cost, detourRatio: surface.detourRatio, reason: surface.reason } : { feasible: false, reason: 'no grade-limited path' };
    const surfaceOk = surface?.feasible;

    // Tunnel candidates (only when the surface route is missing or a long detour).
    const rules = CONNECTIVITY.tunnel;
    const eligible = tunnels.length < rules.maxPerChunk && (tunnels.length === 0 || (demand.type === 'component' && demand.length >= rules.secondTunnelMinComponent));
    const consider = eligible && (!surfaceOk || surface.detourRatio > rules.maxDetourRatio);
    let best = null;
    const rejected = {};
    let evaluated = 0; let feasible = 0;
    const feasibleList = [];
    if (consider) {
      // Portal candidates: cells reachable from each side by a grade-limited approach road.
      const reachPortals = (sources, allowBoundary) => {
        const reach = mountainSearch(sampler, { sources, goal: null, blocked, allowBoundary, maxCost: rules.approachMaxCost });
        const { columns } = sampler.grid;
        const list = [];
        for (let cell = 0; cell < sampler.count; cell += 1) {
          if (!Number.isFinite(reach.dist[cell]) || (cell % columns) % rules.portalStride || Math.floor(cell / columns) % rules.portalStride) continue;
          const point = sampler.toWorld(cell);
          if (builder.distanceToBoundary(point) >= transitionWidth + 1 && sampler.fields.slope[cell] <= rules.portalMaxSlopeDeg && !sampler.fields.waterMask[cell]) {
            list.push({ cell, point, approachCost: reach.dist[cell], prev: reach.prev });
          }
        }
        const stride = Math.max(1, Math.ceil(list.length / rules.maxPortalsPerSide));
        return list.filter((_, i) => i % stride === 0);
      };
      const portalsA = reachPortals(mainCells.map(([cell]) => cell), new Set());
      const portalsB = reachPortals(sourceCells, new Set(demand.type === 'edgePort' ? [demand.cell] : []));
      record.portalCandidates = { a: portalsA.length, b: portalsB.length };
      const existing = [...builder.edges.values()].filter(edge => edge.kind === 'tunnel');
      for (const a of portalsA) for (const b of portalsB) {
        const plan = Math.hypot(b.point.x - a.point.x, b.point.z - a.point.z);
        if (plan < rules.minLength || plan > rules.maxLength) continue;
        evaluated += 1;
        const check = checkTunnel(builder, sampler, a.point, b.point, transitionWidth, existing);
        if (check.reason) { rejected[check.reason] = (rejected[check.reason] ?? 0) + 1; continue; }
        feasible += 1;
        feasibleList.push({ a, b, check, cost: check.planLength * rules.costPerMetre + a.approachCost + b.approachCost });
      }
      feasibleList.sort((p, q) => p.cost - q.cost || p.a.cell - q.a.cell || p.b.cell - q.b.cell);
    }
    // Approach road from a portal back to its network (or gate); attach = point on an existing edge.
    const approachOf = portal => {
      const cells = [];
      for (let at = portal.cell; at !== -1; at = portal.prev[at]) cells.push(at);
      const attach = raster.cells.get(cells.at(-1));
      return { points: dedupe([...cells.map(cell => sampler.toWorld(cell)), ...(attach ? [attach.point] : [])]), attach };
    };
    for (const candidate of feasibleList) {
      const approachA = approachOf(candidate.a);
      const approachB = approachOf(candidate.b);
      const crossing = [approachA, approachB].some(item => item.points.length > 1 && crossesNetwork(builder, item.points));
      if (crossing) { rejected.approachCrossesNetwork = (rejected.approachCrossesNetwork ?? 0) + 1; continue; }
      if (![approachA, approachB].every(item => gradeOk(sampler, item.points))) { rejected.approachGrade = (rejected.approachGrade ?? 0) + 1; continue; }
      best = { ...candidate, approachA, approachB };
      break;
    }
    record.tunnel = { considered: consider, eligible, evaluated, feasible, rejected, bestCost: best?.cost ?? null };

    const useTunnel = best && (!surfaceOk || best.cost < rules.advantage * surface.cost);
    if (useTunnel) {
      const { a, b, check } = best;
      for (const approach of [best.approachA, best.approachB]) {
        if (approach.attach) builder.splitEdgeAt(approach.attach.edgeId, approach.attach.segIndex, approach.attach.point);
        if (approach.points.length > 1) builder.edge(approach.points, { kind: 'road', roadClass: CONNECTIVITY.mountainRoad.roadClass, width: CONNECTIVITY.mountainRoad.width, source: 'tunnel approach (mountain road)', rule: 'mountain' });
      }
      const steps = Math.max(1, Math.ceil(check.planLength / 20));
      const points = Array.from({ length: steps + 1 }, (_, s) => ({
        x: a.point.x + (b.point.x - a.point.x) * s / steps,
        z: a.point.z + (b.point.z - a.point.z) * s / steps,
        y: check.yP + (check.yQ - check.yP) * s / steps,
      }));
      builder.edge(points, {
        kind: 'tunnel', roadClass: rules.roadClass, width: rules.width, source: 'tunnel',
        tunnel: {
          portals: [{ x: a.point.x, y: check.yP, z: a.point.z }, { x: b.point.x, y: check.yQ, z: b.point.z }],
          planLength: check.planLength, length3d: check.length3d, gradePct: check.grade * 100, clearance: rules.clearance,
          minCover: check.minCover, meanCover: check.meanCover, profile: check.profile,
          approachLengths: [pathLength(best.approachA.points), pathLength(best.approachB.points)],
          demand: record.demand, alternativeSurface: record.surface, candidates: { evaluated, feasible }, cost: best.cost,
          geometry: 'centreline + portal markers only; terrain mesh not opened (TODO)',
        },
      });
      tunnels.push(points[0]);
      record.decision = 'tunnel';
      record.reason = surfaceOk ? `detour ${surface.detourRatio.toFixed(2)} > ${rules.maxDetourRatio} and tunnel cost ${best.cost.toFixed(0)} < ${rules.advantage} × surface ${surface.cost.toFixed(0)}` : 'no feasible surface route';
      return record;
    }
    if (surfaceOk && connectors < CONNECTIVITY.maxSurfaceConnectors) {
      if (demand.type === 'component' && surface.startAttach) builder.splitEdgeAt(surface.startAttach.edgeId, surface.startAttach.segIndex, surface.startAttach.point);
      builder.splitEdgeAt(surface.endAttach.edgeId, surface.endAttach.segIndex, surface.endAttach.point);
      builder.edge(surface.points, { kind: 'road', roadClass: CONNECTIVITY.mountainRoad.roadClass, width: CONNECTIVITY.mountainRoad.width, source: 'mountain connector', rule: 'mountain' });
      connectors += 1;
      record.decision = 'surface';
      record.reason = consider ? (best ? 'tunnel not cheaper enough' : 'no tunnel candidate passed the checks') : `detour ${surface.detourRatio.toFixed(2)} ≤ ${rules.maxDetourRatio} or no tunnel eligible`;
      return record;
    }
    record.decision = 'unresolved';
    record.reason = surfaceOk ? 'surface connector limit reached' : 'no surface route and no valid tunnel';
    return record;
  };

  for (let demand = nextDemand(); demand; demand = nextDemand()) decisions.push(process(demand));
  for (const demand of missingPortDemands(builder, sampler)) decisions.push(process(demand));
  return { decisions, tunnels: tunnels.length, connectors };
}
