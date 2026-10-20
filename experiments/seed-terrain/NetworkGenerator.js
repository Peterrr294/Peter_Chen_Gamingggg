import { SurfaceQuery } from '../iceland-region/SurfaceQuery.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { GraphBuilder, polylineLength } from './NetworkGraph.js';
import { DNA_STRATEGY, NETWORK_COMMON, strategyParams } from './networkStrategies.js';
import { planConnectivity } from './TunnelPlanner.js';

// Road / canal network generator (pure data). Reads fields, terrainAnalysis, and
// cityMatch; never writes to them. One GraphBuilder serves all three strategies.

// ---------- terrain sampling (read-only) ----------
export function createSampler(fields) {
  const { segments, columns, spacing, size, originX, originZ } = fields.grid;
  const half = size / 2;
  // Reuses the Iceland SurfaceQuery bilinear height lookup through a surfaceData adapter.
  const query = new SurfaceQuery({ surfaceData: { heights: fields.height, segments, columns, rows: columns, width: size, depth: size } }, {});
  const indexAt = (x, z) => {
    const col = Math.min(segments, Math.max(0, Math.round((x - originX + half) / spacing)));
    const row = Math.min(segments, Math.max(0, Math.round((z - originZ + half) / spacing)));
    return row * columns + col;
  };
  return {
    grid: fields.grid,
    count: columns * columns,
    indexAt,
    toWorld: index => ({ x: originX - half + (index % columns) * spacing, z: originZ - half + Math.floor(index / columns) * spacing }),
    rowCol: index => [Math.floor(index / columns), index % columns],
    onBoundary: index => { const row = Math.floor(index / columns); const col = index % columns; return row === 0 || col === 0 || row === segments || col === segments; },
    height: (x, z) => query.sampleHeight(x - originX, z - originZ) ?? fields.height[indexAt(x, z)],
    waterSurface: (x, z) => { const surface = fields.waterSurface[indexAt(x, z)]; return Number.isFinite(surface) ? surface : fields.height[indexAt(x, z)]; },
    fields,
  };
}

// Samples a straight segment every sampleStep metres; returns per-sample status.
function sampleSegment(sampler, a, b, test) {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(length / NETWORK_COMMON.sampleStep));
  const result = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    result.push({ t, x, z, status: test(sampler.indexAt(x, z)) });
  }
  return result;
}

const landTest = (sampler, maxSlope) => index => (sampler.fields.waterMask[index] ? 'water' : sampler.fields.slope[index] > maxSlope ? 'slope' : 'ok');
const waterTest = sampler => index => (sampler.fields.waterMask[index] ? 'ok' : 'land');

// ---------- grid search (4-neighbour Dijkstra, deterministic tie-break) ----------
export class MinHeap {
  constructor() { this.keys = []; this.values = []; }
  get size() { return this.keys.length; }
  less(i, j) { return this.keys[i] < this.keys[j] || (this.keys[i] === this.keys[j] && this.values[i] < this.values[j]); }
  swap(i, j) { [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]]; [this.values[i], this.values[j]] = [this.values[j], this.values[i]]; }
  push(key, value) {
    this.keys.push(key); this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop() {
    const key = this.keys[0]; const value = this.values[0];
    const lastKey = this.keys.pop(); const lastValue = this.values.pop();
    if (this.keys.length) {
      this.keys[0] = lastKey; this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return [key, value];
  }
}

// Returns the cell path from a source to the first goal cell (inclusive), or null.
// isGoal(index, steps) receives the path length in cells; barrier(index) cells are reached but never expanded.
function searchPath(sampler, { sources, passable, stepCost, isGoal, maxCost = Infinity, barrier = null }) {
  const { columns, segments } = sampler.grid;
  const dist = new Float64Array(sampler.count).fill(Infinity);
  const prev = new Int32Array(sampler.count).fill(-1);
  const steps = new Int32Array(sampler.count);
  const heap = new MinHeap();
  for (const source of sources) { dist[source] = 0; heap.push(0, source); }
  while (heap.size) {
    const [d, index] = heap.pop();
    if (d > dist[index]) continue;
    if (isGoal(index, steps[index])) {
      const path = [index];
      for (let at = prev[index]; at !== -1; at = prev[at]) path.push(at);
      return path.reverse();
    }
    if (d > maxCost) return null;
    if (barrier && barrier(index)) continue;
    const row = Math.floor(index / columns);
    const col = index % columns;
    for (const next of [row > 0 ? index - columns : -1, row < segments ? index + columns : -1, col > 0 ? index - 1 : -1, col < segments ? index + 1 : -1]) {
      if (next < 0 || !passable(next)) continue;
      const nd = d + stepCost(index, next);
      if (nd < dist[next]) { dist[next] = nd; prev[next] = index; steps[next] = steps[index] + 1; heap.push(nd, next); }
    }
  }
  return null;
}

// Multi-source BFS distance (in cells) over cells where `through` is true.
function cellDistance(sampler, isSource, through) {
  const { columns, segments } = sampler.grid;
  const distance = new Int32Array(sampler.count).fill(-1);
  const queue = new Int32Array(sampler.count);
  let head = 0; let tail = 0;
  for (let i = 0; i < sampler.count; i += 1) if (isSource(i)) { distance[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const index = queue[head++];
    const row = Math.floor(index / columns); const col = index % columns;
    for (const next of [row > 0 ? index - columns : -1, row < segments ? index + columns : -1, col > 0 ? index - 1 : -1, col < segments ? index + 1 : -1]) {
      if (next < 0 || distance[next] !== -1 || !through(next)) continue;
      distance[next] = distance[index] + 1;
      queue[tail++] = next;
    }
  }
  return distance;
}

// Paths may touch the chunk boundary only at designated terminals, so they never run along it.
const interior = (sampler, passable, allowed = new Set()) => index => passable(index) && (!sampler.onBoundary(index) || allowed.has(index));

// Keeps the middle cell of each run of consecutive boundary terminals (one port per crossing).
function boundaryRunMiddles(sampler, cells) {
  const set = new Set(cells);
  const seen = new Set();
  const middles = [];
  for (const cell of [...cells].sort((a, b) => a - b)) {
    if (seen.has(cell)) continue;
    const run = [];
    const stack = [cell];
    seen.add(cell);
    while (stack.length) {
      const current = stack.pop();
      run.push(current);
      const [row, col] = sampler.rowCol(current);
      const { columns } = sampler.grid;
      for (const next of [current - columns, current + columns, col > 0 ? current - 1 : -1, current + 1]) {
        if (set.has(next) && !seen.has(next) && Math.abs(sampler.rowCol(next)[0] - row) + Math.abs(sampler.rowCol(next)[1] - col) === 1) { seen.add(next); stack.push(next); }
      }
    }
    run.sort((a, b) => a - b);
    middles.push(run[run.length >> 1]);
  }
  return middles;
}

// ---------- cell networks → graph edges ----------
const CLASS_RANK = { lane: 1, secondary: 2, primary: 3, canal: 1 };
const RANK_CLASS = { road: ['', 'lane', 'secondary', 'primary'], canal: ['', 'canal', 'canal', 'canal'] };

class CellNetwork {
  constructor(sampler, kind) {
    this.sampler = sampler;
    this.kind = kind;
    this.rank = new Uint8Array(sampler.count);
    this.adjacency = new Map();
    this.forced = new Set();
  }
  has(index) { return this.rank[index] > 0; }
  addPath(path, roadClass) {
    path.forEach((cell, i) => {
      this.rank[cell] = Math.max(this.rank[cell], CLASS_RANK[roadClass]);
      if (!this.adjacency.has(cell)) this.adjacency.set(cell, new Set());
      if (i > 0) { this.adjacency.get(cell).add(path[i - 1]); this.adjacency.get(path[i - 1]).add(cell); }
    });
  }
  // Collapses degree-2 chains into polylines between node cells.
  chains() {
    const isNode = cell => this.adjacency.get(cell).size !== 2 || this.sampler.onBoundary(cell) || this.forced.has(cell);
    const visited = new Set();
    const linkKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const result = [];
    const walk = (start, next) => {
      const chain = [start, next];
      visited.add(linkKey(start, next));
      let previous = start; let current = next;
      while (!isNode(current)) {
        const following = [...this.adjacency.get(current)].find(cell => cell !== previous);
        if (following === undefined || visited.has(linkKey(current, following))) break;
        visited.add(linkKey(current, following));
        chain.push(following);
        previous = current; current = following;
        if (current === start) break;
      }
      result.push(chain);
    };
    const cells = [...this.adjacency.keys()].sort((a, b) => a - b);
    for (const cell of cells) if (isNode(cell)) for (const next of [...this.adjacency.get(cell)].sort((a, b) => a - b)) if (!visited.has(linkKey(cell, next))) walk(cell, next);
    for (const cell of cells) for (const next of [...this.adjacency.get(cell)].sort((a, b) => a - b)) if (!visited.has(linkKey(cell, next))) { this.forced.add(cell); walk(cell, next); }
    return result;
  }
  // Mode of interior cell ranks gives the chain class.
  chainClass(chain) {
    const counts = [0, 0, 0, 0];
    const cells = chain.length > 2 ? chain.slice(1, -1) : chain;
    cells.forEach(cell => { counts[this.rank[cell]] += 1; });
    let best = 1;
    for (let rank = 1; rank < 4; rank += 1) if (counts[rank] > counts[best]) best = rank;
    return RANK_CLASS[this.kind][best];
  }
}

// Douglas–Peucker that only accepts a chord whose sampled line passes `test`.
function simplifyValid(sampler, points, test, tolerance) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const valid = (a, b) => sampleSegment(sampler, a, b, test).every(sample => sample.status === 'ok');
  const recurse = (i, j) => {
    if (j - i < 2) return;
    let maxDistance = -1; let at = i + 1;
    const a = points[i]; const b = points[j];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    for (let k = i + 1; k < j; k += 1) {
      const d = Math.abs((b.x - a.x) * (a.z - points[k].z) - (a.x - points[k].x) * (b.z - a.z)) / length;
      if (d > maxDistance) { maxDistance = d; at = k; }
    }
    if (maxDistance <= tolerance && valid(a, b)) return;
    if (maxDistance <= tolerance) at = (i + j) >> 1;
    keep[at] = 1;
    recurse(i, at);
    recurse(at, j);
  };
  recurse(0, points.length - 1);
  return points.filter((_, index) => keep[index]);
}

function emitCellNetwork(builder, network, sampler, props) {
  const created = [];
  for (const chain of network.chains()) {
    const raw = chain.map(cell => sampler.toWorld(cell));
    const roadClass = network.chainClass(chain);
    const test = network.kind === 'canal' ? waterTest(sampler) : landTest(sampler, props.maxSlopeDeg);
    const points = simplifyValid(sampler, raw, test, NETWORK_COMMON.simplifyTolerance);
    const id = builder.edge(points, { kind: network.kind, roadClass, width: props.widths[roadClass], source: props.source });
    if (id) created.push({ id, raw });
  }
  return created;
}

// Simplified polylines may cross; revert both edges of any crossing pair to their
// raw 4-neighbour cell paths (which can only meet at shared cells, i.e. nodes).
function resolveCrossings(builder, created) {
  const rawById = new Map(created.map(item => [item.id, item.raw]));
  for (let round = 0; round < 20; round += 1) {
    const crossing = findCrossings([...builder.edges.values()], { ignore: (a, b) => (a.kind === 'canal') !== (b.kind === 'canal') && (a.kind === 'bridgeCandidate' || b.kind === 'bridgeCandidate') });
    const fixable = crossing.flat().filter(id => rawById.has(id) && builder.edges.get(id).points.length !== rawById.get(id).length);
    if (!fixable.length) return crossing.length;
    for (const id of new Set(fixable)) builder.edges.get(id).points = rawById.get(id);
  }
  return -1;
}

// Proper segment intersections between edges that do not share the crossing point as a node.
export function findCrossings(edges, { ignore = () => false } = {}) {
  const segments = [];
  edges.forEach(edge => {
    for (let i = 1; i < edge.points.length; i += 1) segments.push({ edge, a: edge.points[i - 1], b: edge.points[i] });
  });
  const cell = 32;
  const buckets = new Map();
  segments.forEach((segment, index) => {
    const x0 = Math.floor(Math.min(segment.a.x, segment.b.x) / cell); const x1 = Math.floor(Math.max(segment.a.x, segment.b.x) / cell);
    const z0 = Math.floor(Math.min(segment.a.z, segment.b.z) / cell); const z1 = Math.floor(Math.max(segment.a.z, segment.b.z) / cell);
    for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) {
      const k = `${x},${z}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(index);
    }
  });
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const found = new Set();
  const pairs = [];
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const s = segments[list[i]]; const t = segments[list[j]];
        if (s.edge === t.edge || ignore(s.edge, t.edge)) continue;
        const d1 = cross(s.a, s.b, t.a); const d2 = cross(s.a, s.b, t.b);
        const d3 = cross(t.a, t.b, s.a); const d4 = cross(t.a, t.b, s.b);
        if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) {
          const pairKey = [s.edge.id, t.edge.id].sort().join('#');
          if (!found.has(pairKey)) { found.add(pairKey); pairs.push([s.edge.id, t.edge.id]); }
        }
      }
    }
  }
  return pairs;
}

// ---------- shared organic routines (used by organic and canal-street) ----------
function nearestMatching(sampler, index, accept, maxRadius = 40) {
  if (accept(index)) return index;
  const { columns, segments } = sampler.grid;
  const [row, col] = sampler.rowCol(index);
  for (let r = 1; r <= maxRadius; r += 1) {
    let best = -1; let bestDistance = Infinity;
    for (let dr = -r; dr <= r; dr += 1) for (let dc = -r; dc <= r; dc += 1) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nc < 0 || nr > segments || nc > segments) continue;
      const candidate = nr * columns + nc;
      const distance = dr * dr + dc * dc;
      if (accept(candidate) && (distance < bestDistance || (distance === bestDistance && candidate < best))) { best = candidate; bestDistance = distance; }
    }
    if (best !== -1) return best;
  }
  return -1;
}

function landCost(sampler, params, network) {
  const { slope, height } = sampler.fields;
  const spacing = sampler.grid.spacing;
  return (from, to) => {
    const ratio = slope[to] / params.maxSlopeDeg;
    const base = spacing * (1 + params.slopePenalty * ratio * ratio) + params.climbPenalty * Math.abs(height[to] - height[from]);
    return network.has(to) ? base * params.reuseDiscount : base;
  };
}

function gateCells(sampler, analysis, params, passable) {
  const gates = [];
  for (const [side, edge] of Object.entries(analysis.boundaryConnections.edges)) {
    const run = [...edge.buildableRuns].filter(item => item.length >= params.gateMinRun).sort((a, b) => b.length - a.length || a.from - b.from)[0];
    if (!run) continue;
    const middle = (run.from + run.to) / 2;
    const { originX, originZ, size } = sampler.grid;
    const point = side === 'minX' ? { x: originX - size / 2, z: middle } : side === 'maxX' ? { x: originX + size / 2, z: middle }
      : side === 'minZ' ? { x: middle, z: originZ - size / 2 } : { x: middle, z: originZ + size / 2 };
    const cell = sampler.indexAt(point.x, point.z);
    if (passable(cell)) gates.push({ side, cell });
  }
  return gates;
}

function centreCells(sampler, analysis, params, passable) {
  const regions = analysis.buildableRegions.regions;
  const centres = [];
  regions.forEach((region, rank) => {
    if (rank > params.secondaryCentres || (rank > 0 && region.area < params.secondaryCentreMinArea)) return;
    const cell = nearestMatching(sampler, sampler.indexAt(region.centroid.x, region.centroid.z), index => passable(index) && sampler.fields.buildableMask[index] === 1);
    if (cell !== -1) centres.push({ regionId: region.id, cell, primary: rank === 0 });
  });
  return centres;
}

function connectTargets(sampler, network, targets, params, passable, roadClass) {
  const cost = landCost(sampler, params, network);
  let connected = 0;
  for (const target of targets) {
    if (network.has(target)) { connected += 1; continue; }
    const path = searchPath(sampler, { sources: [target], passable: interior(sampler, passable, new Set([target])), stepCost: cost, isGoal: index => network.has(index) });
    if (path) { network.addPath(path, roadClass); connected += 1; }
  }
  return connected;
}

function growLanes(sampler, network, params, passable, random) {
  const candidates = [];
  for (let i = 0; i < sampler.count; i += 1) if (sampler.fields.buildableMask[i] && passable(i) && !sampler.onBoundary(i)) candidates.push(i);
  const cost = landCost(sampler, params, network);
  let lanes = 0;
  for (let attempt = 0; attempt < params.laneAttempts && lanes < params.laneTargets && candidates.length; attempt += 1) {
    const target = candidates[Math.floor(random.next() * candidates.length)];
    if (network.has(target)) continue;
    const path = searchPath(sampler, { sources: [target], passable: interior(sampler, passable), stepCost: cost, isGoal: index => network.has(index), maxCost: params.laneMaxLength * 4 });
    if (!path) continue;
    const length = (path.length - 1) * sampler.grid.spacing;
    if (length < params.laneMinLength || length > params.laneMaxLength) continue;
    network.addPath(path, 'lane');
    lanes += 1;
  }
  return lanes;
}

// ---------- strategies ----------
function gridStrategy(context) {
  const { sampler, builder, params, random, cityMatch, warnings } = context;
  const { originX, originZ, size } = sampler.grid;
  const half = size / 2;
  const fixed = params.fixedAxisDeg ?? null; // 06.1: DNA-fixed axis (e.g. cardinal survey grid) overrides terrain direction
  const orientation = fixed ?? cityMatch.networkHints?.orientation?.axisDeg;
  const theta = ((orientation ?? 0) * Math.PI) / 180;
  context.meta.orientation = { axisDeg: orientation ?? 0, source: fixed !== null ? 'DNA config fixedAxisDeg' : orientation === null || orientation === undefined ? 'default 0° (no direction evidence)' : cityMatch.networkHints.orientation.source };
  const u = { x: Math.cos(theta), z: Math.sin(theta) };
  const v = { x: -Math.sin(theta), z: Math.cos(theta) };
  const phaseA = random.next() * params.primarySpacing;
  const phaseB = random.next() * params.secondarySpacing;
  const reach = half * Math.SQRT2 + Math.max(params.primarySpacing, params.secondarySpacing);
  const offsets = (phase, spacing) => {
    const list = [];
    for (let k = Math.ceil((-reach - phase) / spacing); phase + k * spacing <= reach; k += 1) list.push(phase + k * spacing);
    return list;
  };
  const familyA = offsets(phaseA, params.primarySpacing); // lines along u, offset along v (avenues)
  const familyB = offsets(phaseB, params.secondarySpacing); // lines along v, offset along u (cross streets)
  const clip = (origin, direction) => {
    let tmin = -Infinity; let tmax = Infinity;
    for (const [o, d, lo, hi] of [[origin.x, direction.x, originX - half, originX + half], [origin.z, direction.z, originZ - half, originZ + half]]) {
      if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return null; continue; }
      const t1 = (lo - o) / d; const t2 = (hi - o) / d;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    }
    return tmax - tmin > 1e-6 ? [tmin, tmax] : null;
  };
  const snap = point => ({
    x: Math.abs(Math.abs(point.x - originX) - half) < 1e-6 ? originX + Math.sign(point.x - originX) * half : point.x,
    z: Math.abs(Math.abs(point.z - originZ) - half) < 1e-6 ? originZ + Math.sign(point.z - originZ) * half : point.z,
  });
  const test = landTest(sampler, params.maxSlopeDeg);
  const counts = { segments: 0, truncated: 0, dropped: 0, bridges: 0 };
  const addLine = (offset, along, across, crossOffsets, roadClass) => {
    const origin = { x: originX + across.x * offset, z: originZ + across.z * offset };
    const range = clip(origin, along);
    if (!range) return;
    const breaks = [range[0], ...crossOffsets.filter(t => t > range[0] + 1e-6 && t < range[1] - 1e-6), range[1]];
    const at = t => snap({ x: origin.x + along.x * t, z: origin.z + along.z * t });
    for (let i = 1; i < breaks.length; i += 1) {
      counts.segments += 1;
      const a = at(breaks[i - 1]); const b = at(breaks[i]);
      const samples = sampleSegment(sampler, a, b, test);
      const width = params.widths[roadClass];
      if (samples.every(sample => sample.status === 'ok')) { builder.edge([a, b], { kind: 'road', roadClass, width, source: 'grid-line' }); continue; }
      counts.truncated += 1;
      const firstBad = samples.findIndex(sample => sample.status !== 'ok');
      let lastBad = samples.length - 1;
      while (samples[lastBad].status === 'ok') lastBad -= 1;
      const point = sample => snap({ x: sample.x, z: sample.z });
      const prefixEnd = firstBad > 0 ? point(samples[firstBad - 1]) : null;
      const suffixStart = lastBad < samples.length - 1 ? point(samples[lastBad + 1]) : null;
      const prefixLength = prefixEnd ? Math.hypot(prefixEnd.x - a.x, prefixEnd.z - a.z) : 0;
      const suffixLength = suffixStart ? Math.hypot(b.x - suffixStart.x, b.z - suffixStart.z) : 0;
      if (prefixLength >= params.minStubLength) builder.edge([a, prefixEnd], { kind: 'road', roadClass, width, source: 'grid-line (truncated)' });
      if (suffixLength >= params.minStubLength) builder.edge([suffixStart, b], { kind: 'road', roadClass, width, source: 'grid-line (truncated)' });
      const gap = samples.slice(firstBad, lastBad + 1);
      const span = prefixEnd && suffixStart ? Math.hypot(suffixStart.x - prefixEnd.x, suffixStart.z - prefixEnd.z) : Infinity;
      if ((!params.bridgePrimaryOnly || roadClass === 'primary') && prefixLength >= params.minStubLength && suffixLength >= params.minStubLength
        && gap.every(sample => sample.status !== 'slope') && gap.some(sample => sample.status === 'water') && span <= params.maxBridgeSpan) {
        builder.edge([prefixEnd, suffixStart], { kind: 'bridgeCandidate', roadClass: 'bridge', width: params.widths.bridge, source: 'grid-line over water' });
        counts.bridges += 1;
      }
      if (prefixLength < params.minStubLength && suffixLength < params.minStubLength) counts.dropped += 1;
    }
  };
  familyA.forEach(offset => addLine(offset, u, v, familyB, 'primary'));
  familyB.forEach(offset => addLine(offset, v, u, familyA, 'secondary'));
  context.meta.gridCounts = counts;
  if (!builder.edges.size) warnings.push('grid: no valid grid segment on this terrain');
}

// ---------- 03.3 loop closure (organic and canal-street only) ----------
// Adds a limited number of land-only links that close loops of a sensible size.
// Links join the cell network, so meeting a road always creates a shared node.
function networkDistances(network, source) {
  const distance = new Map([[source, 0]]);
  const queue = [source];
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    for (const next of network.adjacency.get(cell) ?? []) {
      if (!distance.has(next)) { distance.set(next, distance.get(cell) + 1); queue.push(next); }
    }
  }
  return distance;
}

function closeLoops(context, network) {
  const { sampler, params, random, transitionWidth } = context;
  const rules = params.loops;
  const { waterMask, slope, buildableMask } = sampler.fields;
  const { spacing, originX, originZ, size, columns, segments } = sampler.grid;
  const half = size / 2;
  const outsideTransition = index => {
    const p = sampler.toWorld(index);
    return Math.min(p.x - (originX - half), originX + half - p.x, p.z - (originZ - half), originZ + half - p.z) >= transitionWidth;
  };
  const land = index => !waterMask[index] && slope[index] <= params.maxSlopeDeg;
  const stats = { deadEndsBefore: 0, added: { extension: 0, deadEnd: 0, branch: 0 }, rejected: {}, links: [] };
  const record = (link, netSteps) => stats.links.push({ type: link.type, length: (link.path.length - 1) * spacing, perimeter: netSteps * spacing + (link.path.length - 1) * spacing, points: link.path.map(cell => sampler.toWorld(cell)) });
  const reject = reason => { stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1; };
  const deadEnds = () => [...network.adjacency.keys()].filter(cell => network.adjacency.get(cell).size === 1 && !sampler.onBoundary(cell)).sort((a, b) => a - b);
  stats.deadEndsBefore = deadEnds().length;
  const maxDeadEndLinks = Math.floor(stats.deadEndsBefore * rules.closeShare);

  // Size rules that depend only on lengths (usable inside the search).
  const sizeReason = (steps, netSteps) => {
    const length = steps * spacing;
    const perimeter = netSteps * spacing + length;
    if (length > rules.maxLinkLength) return 'tooLong';
    if (perimeter < rules.minPerimeter) return 'loopTooSmall';
    if (perimeter > rules.maxPerimeter) return 'loopTooLarge';
    if (netSteps * spacing < rules.minDetourRatio * length) return 'notAShortcut';
    return null;
  };
  // Full check of a concrete path (source … goal).
  const evaluate = (path, netSteps, nearNetwork) => {
    const interior = path.slice(1, -1);
    const size = sizeReason(path.length - 1, netSteps);
    if (size) return size;
    if (!interior.every(cell => land(cell) && outsideTransition(cell) && !network.has(cell))) return 'illegalCell';
    if (interior.slice(2, -2).some(cell => nearNetwork[cell] < rules.clearanceCells)) return 'tooCloseToRoad';
    if (interior.length && interior.filter(cell => buildableMask[cell]).length / interior.length < rules.minBuildableShare) return 'notBuildable';
    return null;
  };
  const neighbours = index => {
    const row = Math.floor(index / columns); const col = index % columns;
    return [row > 0 ? index - columns : -1, row < segments ? index + columns : -1, col > 0 ? index - 1 : -1, col < segments ? index + 1 : -1].filter(cell => cell >= 0);
  };

  const tryLink = (source, kind) => {
    const distances = networkDistances(network, source);
    const nearNetwork = cellDistance(sampler, index => network.has(index), () => true);
    // (a) Straight extension along the dead end's heading (greedy 4-neighbour march).
    if (kind === 'deadEnd') {
      let back = source; let previous = -1;
      for (let k = 0; k < 6; k += 1) {
        const next = [...network.adjacency.get(back)].find(cell => cell !== previous);
        if (next === undefined) break;
        previous = back; back = next;
      }
      const from = sampler.toWorld(back); const origin = sampler.toWorld(source);
      const hx = origin.x - from.x; const hz = origin.z - from.z; const norm = Math.hypot(hx, hz);
      if (norm > 0) {
        const path = [source];
        let at = source;
        while ((path.length - 1) * spacing < rules.maxExtension) {
          const score = cell => {
            const q = sampler.toWorld(cell);
            const along = ((q.x - origin.x) * hx + (q.z - origin.z) * hz) / norm;
            const off = Math.abs((q.x - origin.x) * hz - (q.z - origin.z) * hx) / norm;
            return along - 2 * off;
          };
          const nextCell = neighbours(at).filter(cell => !path.includes(cell)).sort((a, b) => score(b) - score(a) || a - b)[0];
          if (nextCell === undefined) break;
          path.push(nextCell);
          at = nextCell;
          if (network.has(nextCell) || !land(nextCell) || !outsideTransition(nextCell)) break;
        }
        const goal = path.at(-1);
        if (network.has(goal) && distances.has(goal)) {
          const reason = evaluate(path, distances.get(goal), nearNetwork);
          if (!reason) return { path, type: 'extension' };
          reject('extension:' + reason);
        }
      }
    }
    // (b) Least-cost link to a distant part of the network; other road cells are barriers (never crossed).
    const cost = landCost(sampler, params, network);
    const penalised = (from, to) => cost(from, to) * (nearNetwork[to] === 1 && !network.has(to) ? 5 : nearNetwork[to] === 2 ? 2 : 1);
    const path = searchPath(sampler, {
      sources: [source],
      passable: index => land(index) && (network.has(index) || outsideTransition(index)),
      stepCost: penalised,
      isGoal: (index, steps) => index !== source && network.has(index) && distances.has(index) && !sizeReason(steps, distances.get(index)),
      barrier: index => index !== source && network.has(index),
      maxCost: rules.maxLinkLength * 10, // cost budget (penalties make cost > length)
    });
    if (!path) { reject(kind + ':noPath'); return null; }
    const reason = evaluate(path, distances.get(path.at(-1)), nearNetwork);
    if (reason) { reject(kind + ':' + reason); return null; }
    return { path, type: kind };
  };

  // Dead ends first (seeded order), at most closeShare of them, so cul-de-sacs remain.
  const order = deadEnds().map(cell => ({ cell, key: random.next() })).sort((a, b) => a.key - b.key || a.cell - b.cell).map(item => item.cell);
  let deadEndLinks = 0;
  for (const cell of order) {
    if (deadEndLinks >= maxDeadEndLinks) break;
    if (network.adjacency.get(cell)?.size !== 1) continue;
    const link = tryLink(cell, 'deadEnd');
    if (!link) continue;
    record(link, networkDistances(network, link.path[0]).get(link.path.at(-1)));
    network.addPath(link.path, 'lane');
    stats.added[link.type] += 1;
    deadEndLinks += 1;
  }
  // Branch links from mid-lane cells sampled along the network.
  const step = Math.max(1, Math.round(rules.branchSampleSpacing / spacing));
  const branchSources = [...network.adjacency.keys()]
    .filter(cell => network.adjacency.get(cell).size === 2 && outsideTransition(cell)).sort((a, b) => a - b).filter((_, i) => i % step === 0)
    .map(cell => ({ cell, key: random.next() })).sort((a, b) => a.key - b.key || a.cell - b.cell).map(item => item.cell);
  for (const cell of branchSources) {
    if (stats.added.branch >= rules.branchLinks) break;
    if (network.adjacency.get(cell)?.size !== 2) continue;
    const link = tryLink(cell, 'branch');
    if (!link) continue;
    record(link, networkDistances(network, link.path[0]).get(link.path.at(-1)));
    network.addPath(link.path, 'lane');
    stats.added.branch += 1;
  }
  stats.deadEndsAfter = deadEnds().length;
  return stats;
}

function organicStrategy(context, network = new CellNetwork(context.sampler, 'road')) {
  const { sampler, analysis, params, random, warnings } = context;
  const passable = index => !sampler.fields.waterMask[index] && sampler.fields.slope[index] <= params.maxSlopeDeg;
  const centres = centreCells(sampler, analysis, params, passable);
  const gates = gateCells(sampler, analysis, params, passable);
  context.meta.targets = {
    centres: centres.map(item => ({ ...sampler.toWorld(item.cell), regionId: item.regionId, kind: 'terrain centroid (proxy; markets / gates TBD)' })),
    gates: gates.map(item => ({ ...sampler.toWorld(item.cell), side: item.side, kind: 'longest buildable boundary run (proxy for a gate)' })),
  };
  if (!centres.length && !network.adjacency.size) { warnings.push('organic: no buildable centre found'); return network; }
  if (!network.adjacency.size) network.addPath([centres[0].cell], 'primary');
  connectTargets(sampler, network, [...gates.map(item => item.cell), ...centres.slice(1).map(item => item.cell)], params, passable, 'primary');
  context.meta.lanes = growLanes(sampler, network, params, passable, random);
  if (params.loops && context.options.loops !== false) context.meta.loops = closeLoops(context, network);
  return network;
}

function canalStreetStrategy(context) {
  const { sampler, analysis, builder, params, warnings } = context;
  const { waterMask, slope } = sampler.fields;
  const labels = analysis.waterRegions.labels;
  const landPassable = index => !waterMask[index] && slope[index] <= params.maxSlopeDeg;
  const regions = analysis.waterRegions.regions.filter(region => region.area >= params.canalRegionMinArea);
  if (!regions.length) {
    warnings.push('canalStreet: no water body ≥ canalRegionMinArea; only land streets were generated (cityMatch conflict noWater applies)');
    emitCellNetwork(builder, organicStrategy(context), sampler, { ...params, source: 'least-cost path' });
    return;
  }

  // 1. Canals on existing water, kept central by distance to land.
  const toLand = cellDistance(sampler, index => !waterMask[index], index => waterMask[index] === 1);
  const canals = new CellNetwork(sampler, 'canal');
  for (const region of regions) {
    const terminals = [];
    for (const [side, edge] of Object.entries(analysis.boundaryConnections.edges)) {
      for (const run of edge.waterRuns.filter(item => item.regionIds.includes(region.id))) {
        const middle = (run.from + run.to) / 2;
        const { originX, originZ, size } = sampler.grid;
        const point = side === 'minX' ? { x: originX - size / 2, z: middle } : side === 'maxX' ? { x: originX + size / 2, z: middle }
          : side === 'minZ' ? { x: middle, z: originZ - size / 2 } : { x: middle, z: originZ + size / 2 };
        const cell = nearestMatching(sampler, sampler.indexAt(point.x, point.z), index => labels[index] === region.id && sampler.onBoundary(index), 8);
        if (cell !== -1) terminals.push(cell);
      }
    }
    if (!terminals.length) {
      let deepest = -1;
      for (let i = 0; i < sampler.count; i += 1) if (labels[i] === region.id && (deepest === -1 || toLand[i] > toLand[deepest])) deepest = i;
      terminals.push(deepest);
    }
    canals.addPath([terminals[0]], 'canal');
    const inRegion = interior(sampler, index => labels[index] === region.id, new Set(terminals));
    for (const terminal of terminals.slice(1)) {
      const path = searchPath(sampler, { sources: [terminal], passable: inRegion, stepCost: (from, to) => sampler.grid.spacing * (1 + params.canalCentrePull / (1 + toLand[to])), isGoal: index => canals.has(index) });
      if (path) canals.addPath(path, 'canal');
    }
  }

  // 2. Quays: land paths that stay quayOffsetCells inland, one tree per land body.
  const toWater = cellDistance(sampler, index => waterMask[index] === 1, index => !waterMask[index]);
  const roads = new CellNetwork(sampler, 'road');
  const landLabel = new Int32Array(sampler.count);
  let bodies = 0;
  for (let i = 0; i < sampler.count; i += 1) {
    if (waterMask[i] || landLabel[i]) continue;
    bodies += 1;
    const stack = [i]; landLabel[i] = bodies;
    while (stack.length) {
      const index = stack.pop();
      const [row, col] = sampler.rowCol(index);
      const { columns, segments } = sampler.grid;
      for (const next of [row > 0 ? index - columns : -1, row < segments ? index + columns : -1, col > 0 ? index - 1 : -1, col < segments ? index + 1 : -1]) {
        if (next >= 0 && !waterMask[next] && !landLabel[next]) { landLabel[next] = bodies; stack.push(next); }
      }
    }
  }
  const isQuay = index => toWater[index] === params.quayOffsetCells && landPassable(index);
  const quayCost = (from, to) => {
    const ratio = slope[to] / params.maxSlopeDeg;
    const base = sampler.grid.spacing * (1 + params.slopePenalty * ratio * ratio) * (isQuay(to) ? 1 : params.quayOffPenalty);
    return roads.has(to) ? base * params.reuseDiscount : base;
  };
  for (let body = 1; body <= bodies; body += 1) {
    const terminals = [];
    const boundaryQuays = [];
    for (let i = 0; i < sampler.count; i += 1) if (landLabel[i] === body && isQuay(i) && sampler.onBoundary(i)) boundaryQuays.push(i);
    terminals.push(...boundaryRunMiddles(sampler, boundaryQuays));
    if (!terminals.length) {
      // Enclosed water: run the quay between the westmost and eastmost quay cells of this body.
      const quays = [];
      for (let i = 0; i < sampler.count; i += 1) if (landLabel[i] === body && isQuay(i)) quays.push(i);
      if (quays.length < 2) continue;
      const byX = [...quays].sort((a, b) => (a % sampler.grid.columns) - (b % sampler.grid.columns) || a - b);
      terminals.push(byX[0], byX.at(-1));
    }
    roads.addPath([terminals[0]], 'primary');
    for (const terminal of terminals.slice(1)) {
      const path = searchPath(sampler, { sources: [terminal], passable: interior(sampler, index => landLabel[index] === body && landPassable(index), new Set(terminals)), stepCost: quayCost, isGoal: index => roads.has(index) });
      if (path) roads.addPath(path, 'primary');
    }
  }

  // 3. Bridge candidates across canals at fixed intervals (scarce links, V2).
  const bridges = [];
  const canalChains = canals.chains();
  canalChains.forEach(chain => {
    const points = chain.map(cell => sampler.toWorld(cell));
    let travelled = 0;
    let next = params.bridgeInterval * (0.5 + 0.5 * context.random.next());
    for (let i = 1; i < points.length - 1; i += 1) {
      travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      if (travelled < next) continue;
      next += params.bridgeInterval;
      const a = points[Math.max(0, i - 3)]; const b = points[Math.min(points.length - 1, i + 3)];
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
      const shore = sign => {
        for (let d = 2; d <= params.maxBridgeSpan; d += 2) {
          const cell = sampler.indexAt(points[i].x + normal.x * d * sign, points[i].z + normal.z * d * sign);
          if (!waterMask[cell]) return landPassable(cell) && !sampler.onBoundary(cell) ? cell : -1;
        }
        return -1;
      };
      const left = shore(1); const right = shore(-1);
      if (left === -1 || right === -1) continue;
      const p = sampler.toWorld(left); const q = sampler.toWorld(right);
      if (Math.hypot(q.x - p.x, q.z - p.z) > params.maxBridgeSpan) continue;
      bridges.push([left, right]);
    }
  });
  const bridgeCost = landCost(sampler, params, roads);
  for (const [left, right] of bridges) {
    for (const end of [left, right]) {
      roads.forced.add(end);
      if (!roads.has(end)) {
        const path = searchPath(sampler, { sources: [end], passable: interior(sampler, index => landLabel[index] === landLabel[end] && landPassable(index)), stepCost: bridgeCost, isGoal: index => roads.has(index), maxCost: 400 });
        roads.addPath(path ?? [end], 'secondary');
      }
    }
  }

  // 4. Inland lanes grow from the quay network (organic routine).
  organicStrategy(context, roads);

  const canalEdges = emitCellNetwork(builder, canals, sampler, { ...params, source: 'least-cost path in water' });
  const roadEdges = emitCellNetwork(builder, roads, sampler, { ...params, source: 'least-cost path' });
  for (const [left, right] of bridges) {
    builder.edge([sampler.toWorld(left), sampler.toWorld(right)], { kind: 'bridgeCandidate', roadClass: 'bridge', width: params.widths.bridge, source: 'perpendicular to canal' });
  }
  context.meta.bridgeCandidates = bridges.length;
  context.created = [...canalEdges, ...roadEdges];
}

// ---------- entry point ----------
export function generateNetwork(fields, analysis, cityMatch, config, options = {}) {
  const dna = cityMatch.selectedDNA.id;
  const strategy = DNA_STRATEGY[dna];
  const params = strategyParams(dna);
  const sampler = createSampler(fields);
  const builder = new GraphBuilder(fields.grid);
  builder.heightAt = sampler.height;
  const warnings = [];
  const context = {
    sampler, builder, params, analysis, cityMatch, warnings,
    random: new SeededRandom(config.seed, `network-${strategy}`),
    options,
    transitionWidth: config.transitionWidth,
    meta: { version: '03.3', loopsEnabled: options.loops !== false, strategy, dna, dnaMode: cityMatch.selectedDNA.mode, seed: config.seed, landform: config.landform, params, common: NETWORK_COMMON },
    created: [],
  };
  if (strategy === 'grid') gridStrategy(context);
  else if (strategy === 'organic') context.created = emitCellNetwork(builder, organicStrategy(context), sampler, { ...params, source: 'least-cost path' });
  else canalStreetStrategy(context);
  context.meta.unresolvedCrossings = context.created.length ? resolveCrossings(builder, context.created) : 0;
  builder.pruneShortComponents(NETWORK_COMMON.minComponentLength);
  // 03.2: link steep-terrain-separated components and missing edge ports (surface first, tunnel if justified).
  context.meta.connectivity = planConnectivity(builder, sampler, config.transitionWidth);
  context.meta.warnings = warnings;
  return builder.finalize(sampler, { transitionWidth: config.transitionWidth, meta: context.meta });
}

export { polylineLength };
