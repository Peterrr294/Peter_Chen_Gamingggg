// 06.3a world terrain + water harmonisation (pure data, deterministic, independent of input order and City ID).
//
// Raw chunk height fields stay untouched; this returns a separate harmonised height and water-level field per chunk.
//
// Heights. For every shared edge e (chunks A | B, same 257 samples in the same world order):
//   joint target   T(i) = (hA(i) + hB(i)) / 2, blended at both ends to the corner target Tc (mean of the raw
//                  heights of all chunks meeting at that point) with the same smoothstep weight along the edge;
//   slope target   S(i) = −(sA(i) + sB(i)) / 2, sX = raw inward first difference — both sides get the same S,
//                  so the outward slope of A equals the inward slope of B (C¹ across the edge, discrete);
//   correction on each side, inside its own transition band (d = inward distance, W = transitionWidth):
//                  D(i)·w(d) + S(i)·b(d),  w = 1 − smoothstep(0, W, d) (existing edgeWeight),
//                  b(d) = d·(1 − d/W)² normalised so b(spacing) = spacing (exact first difference at the edge).
//   Corners: the four edge terms of a chunk are combined as a Coons boolean sum (P1 + P2 − P1·P2) with the corner
//   value Dc and slopes S1c, S2c, so each active edge keeps its exact target even inside the corner square.
//   Edge samples of active edges are finally set to T(i) itself, so both chunks hold the identical value.
// Resolution: a cell is "made steep" when its harmonised slope exceeds maxTransitionSlopeDeg and its raw slope by
// createdSlopeMargin. Any edge with a made-steep cell (attributed to the nearest active edge) is deactivated —
// it keeps its raw step and is reported unresolved. Repeated until stable; the transition width is never enlarged.
//
// Water. Levels spread only by connected flooding: from each chunk's raw water cells (sea level or local river
// surface) through band cells below level + freeboard; across an edge only sea water propagates, and only into the
// neighbour's band of that edge. Rivers never continue into a neighbour without a channel and water never crosses
// higher ground: such interfaces stay discontinuous and are reported by the seam check.
import { CHUNK } from '../seed-terrain/config.js';
import { edgeWeight } from '../seed-terrain/TerrainFields.js';

export const HARMONY_RULES = Object.freeze({
  maxTransitionSlopeDeg: 35, // A: steeper slopes created by the join are not a natural transition (≈ angle of repose)
  createdSlopeMargin: 2, // deg above the raw slope before a cell counts as made steep by harmonisation
  maxIterations: 8,
  waterLevelTolerance: 1, // m; two water bodies with levels closer than this are compatible
  exchangeRounds: 2, // sea propagation rounds across edges (simultaneous, order-independent)
  freeboard: CHUNK.shoreFreeboard,
});

const NEIGHBOUR = { maxX: [1, 0, 'minX'], maxZ: [0, 1, 'minZ'] };
const SIDES = ['minX', 'maxX', 'minZ', 'maxZ'];
const WATER = { none: 0, sea: 1, river: 2 };

// Index of the sample `depth` steps inward from `side`, at position `along` (row for X sides, column for Z sides).
const indexOf = (side, along, depth, segments, columns) => (side === 'minX' ? along * columns + depth
  : side === 'maxX' ? along * columns + (segments - depth)
    : side === 'minZ' ? depth * columns + along : (segments - depth) * columns + along);

// Same central / one-sided differences as deriveFields.
export function slopeField(height, segments, columns, spacing) {
  const slope = new Float32Array(height.length);
  for (let row = 0; row <= segments; row += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const c0 = Math.max(0, col - 1); const c1 = Math.min(segments, col + 1);
      const r0 = Math.max(0, row - 1); const r1 = Math.min(segments, row + 1);
      const dx = (height[row * columns + c1] - height[row * columns + c0]) / (spacing * (c1 - c0));
      const dz = (height[r1 * columns + col] - height[r0 * columns + col]) / (spacing * (r1 - r0));
      slope[row * columns + col] = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
    }
  }
  return slope;
}

// chunks: [{ chunkId, gridX, gridY, landform, grid, height, waterSurface }] (raw, placed). Returns per-chunk output + report.
export function harmonizeWorld(chunks, transitionWidth, rules = HARMONY_RULES) {
  const W = transitionWidth;
  const list = [...chunks].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX); // canonical order
  const at = new Map(list.map(c => [`${c.gridX},${c.gridY}`, c]));
  const byId = new Map(list.map(c => [c.chunkId, c]));
  const { segments, columns, spacing, size } = list[0].grid;
  const half = size / 2;
  const w = d => (d < W ? edgeWeight(d, W) : 0);
  const bNorm = (1 - spacing / W) ** 2;
  const b = d => (d < W ? (d * (1 - d / W) ** 2) / bNorm : 0);

  // Corners: every chunk sample at the same world point. Targets are per connected group (chunks linked by active
  // edges around that point), so an unresolvable neighbour never pulls a resolvable edge toward its height.
  const cornerOf = (c, xs, zs) => ({ x: c.grid.originX + (xs === 'minX' ? -half : half), z: c.grid.originZ + (zs === 'minZ' ? -half : half) });
  const cornerIndex = (xs, zs) => (zs === 'minZ' ? 0 : segments) * columns + (xs === 'minX' ? 0 : segments);
  const corners = new Map();
  for (const c of list) for (const xs of ['minX', 'maxX']) for (const zs of ['minZ', 'maxZ']) {
    const p = cornerOf(c, xs, zs); const key = `${p.x},${p.z}`;
    if (!corners.has(key)) corners.set(key, { key, x: p.x, z: p.z, members: [], edges: [] });
    corners.get(key).members.push({ chunkId: c.chunkId, height: c.height[cornerIndex(xs, zs)] });
  }
  for (const corner of corners.values()) {
    corner.members.sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1));
    corner.rawSpread = Math.max(...corner.members.map(m => m.height)) - Math.min(...corner.members.map(m => m.height));
  }
  // Group target of one chunk at one corner (union of chunks connected through active edges at that corner).
  const groupTarget = (corner, chunkId) => {
    const parent = new Map(corner.members.map(m => [m.chunkId, m.chunkId]));
    const find = x => (parent.get(x) === x ? x : find(parent.get(x)));
    for (const e of corner.edges) if (e.active) parent.set(find(e.a), find(e.b));
    const group = corner.members.filter(m => find(m.chunkId) === find(chunkId));
    return group.reduce((s, m) => s + m.height, 0) / group.length;
  };

  // Shared edges: A owns maxX / maxZ, B the opposite side; raw edge lines and inward first differences.
  const edges = [];
  for (const A of list) for (const sideA of ['maxX', 'maxZ']) {
    const [dx, dy, sideB] = NEIGHBOUR[sideA];
    const B = at.get(`${A.gridX + dx},${A.gridY + dy}`);
    if (!B) continue;
    const n = segments + 1;
    const e = { id: `${A.chunkId}|${B.chunkId}`, a: A.chunkId, b: B.chunkId, sideA, sideB, hA: new Float64Array(n), hB: new Float64Array(n), sA: new Float64Array(n), sB: new Float64Array(n), T: new Float64Array(n), S: new Float64Array(n), active: true, slopeMatch: true, slopeNote: null, rawMaxStep: 0, blame: 0, maxCreatedSlope: 0, unresolvedAt: null };
    for (let i = 0; i <= segments; i += 1) {
      e.hA[i] = A.height[indexOf(sideA, i, 0, segments, columns)];
      e.hB[i] = B.height[indexOf(sideB, i, 0, segments, columns)];
      e.sA[i] = (A.height[indexOf(sideA, i, 1, segments, columns)] - e.hA[i]) / spacing;
      e.sB[i] = (B.height[indexOf(sideB, i, 1, segments, columns)] - e.hB[i]) / spacing;
      e.rawMaxStep = Math.max(e.rawMaxStep, Math.abs(e.hA[i] - e.hB[i]));
    }
    const endKey = i => {
      const xs = sideA === 'maxX' ? 'maxX' : i === 0 ? 'minX' : 'maxX';
      const zs = sideA === 'maxZ' ? 'maxZ' : i === 0 ? 'minZ' : 'maxZ';
      const p = cornerOf(A, xs, zs); return `${p.x},${p.z}`;
    };
    e.corners = [endKey(0), endKey(segments)];
    for (const key of e.corners) corners.get(key).edges.push(e);
    edges.push(e);
  }
  const edgeOf = new Map(); // `${chunkId}:${side}` → edge
  for (const e of edges) { edgeOf.set(`${e.a}:${e.sideA}`, e); edgeOf.set(`${e.b}:${e.sideB}`, e); }

  // Joint targets of active edges for the current corner groups. S also cancels the first difference that the
  // corner ramp of T adds through w(spacing) < 1, so the discrete slope stays continuous next to corners.
  const updateTargets = () => {
    const ramp = w(spacing) - 1;
    for (const e of edges) {
      if (!e.active) continue;
      const m0 = (e.hA[0] + e.hB[0]) / 2; const m1 = (e.hA[segments] + e.hB[segments]) / 2;
      const t0 = groupTarget(corners.get(e.corners[0]), e.a); const t1 = groupTarget(corners.get(e.corners[1]), e.a);
      for (let i = 0; i <= segments; i += 1) {
        const m = (e.hA[i] + e.hB[i]) / 2;
        e.T[i] = m + (t0 - m0) * w(i * spacing) + (t1 - m1) * w((segments - i) * spacing);
        e.S[i] = e.slopeMatch ? -(e.sA[i] + e.sB[i]) / 2 - ((e.T[i] - m) * ramp) / spacing : 0;
      }
    }
  };

  // Harmonised height of one chunk for the current set of active edges.
  const rawSlope = new Map(list.map(c => [c.chunkId, slopeField(c.height, segments, columns, spacing)]));
  function harmonizeChunk(c) {
    const sides = Object.fromEntries(SIDES.map(side => {
      const e = edgeOf.get(`${c.chunkId}:${side}`);
      if (!e || !e.active) return [side, null];
      const D = new Float64Array(segments + 1);
      for (let i = 0; i <= segments; i += 1) D[i] = e.T[i] - c.height[indexOf(side, i, 0, segments, columns)];
      return [side, { D, S: e.S, T: e.T }];
    }));
    if (SIDES.every(side => !sides[side])) return Float32Array.from(c.height);
    const cornerTerms = [];
    for (const xs of ['minX', 'maxX']) for (const zs of ['minZ', 'maxZ']) {
      const e1 = sides[xs]; const e2 = sides[zs];
      const along1 = zs === 'minZ' ? 0 : segments; const along2 = xs === 'minX' ? 0 : segments;
      cornerTerms.push({ xs, zs, Dc: e1 && e2 ? e1.D[along1] : 0, S1c: e1 ? e1.S[along1] : 0, S2c: e2 ? e2.S[along2] : 0 });
    }
    const H = new Float32Array(c.height.length);
    for (let row = 0; row <= segments; row += 1) {
      for (let col = 0; col <= segments; col += 1) {
        const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
        let value = 0;
        for (const side of SIDES) {
          const s = sides[side]; if (!s || d[side] >= W) continue;
          const along = side.endsWith('X') ? row : col;
          value += s.D[along] * w(d[side]) + s.S[along] * b(d[side]);
        }
        for (const t of cornerTerms) {
          if (d[t.xs] >= W || d[t.zs] >= W) continue;
          value -= t.Dc * w(d[t.xs]) * w(d[t.zs]) + t.S1c * b(d[t.xs]) * w(d[t.zs]) + t.S2c * w(d[t.xs]) * b(d[t.zs]);
        }
        H[row * columns + col] = c.height[row * columns + col] + value;
      }
    }
    for (const side of SIDES) { const s = sides[side]; if (s) for (let i = 0; i <= segments; i += 1) H[indexOf(side, i, 0, segments, columns)] = s.T[i]; }
    return H;
  }

  // Cells made steep by the join, attributed to the nearest active edge of that chunk.
  const blameSteep = (c, H, onBlame) => {
    const slope = slopeField(H, segments, columns, spacing);
    const raw = rawSlope.get(c.chunkId);
    for (let row = 0; row <= segments; row += 1) for (let col = 0; col <= segments; col += 1) {
      const k = row * columns + col;
      if (!(slope[k] > rules.maxTransitionSlopeDeg && slope[k] > raw[k] + rules.createdSlopeMargin)) continue;
      const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
      const near = SIDES.map(side => ({ e: edgeOf.get(`${c.chunkId}:${side}`), d: d[side] })).filter(x => x.e?.active && x.d < W);
      if (!near.length) continue;
      const dMin = Math.min(...near.map(x => x.d));
      for (const x of near) if (x.d === dMin) onBlame(x.e, slope[k]);
    }
  };

  // Steep cells per edge for the current active set (fresh counts each test).
  const test = chunkIds => {
    const found = new Map();
    const result = new Map(chunkIds.map(id => [id, harmonizeChunk(byId.get(id))]));
    for (const id of chunkIds) blameSteep(byId.get(id), result.get(id), (edge, slope) => {
      const f = found.get(edge) ?? { cells: 0, maxSlope: 0 }; f.cells += 1; f.maxSlope = Math.max(f.maxSlope, slope); found.set(edge, f);
    });
    return { result, found };
  };
  const fail = (e, f, at) => { e.active = false; e.unresolvedAt = at; e.blame = f.cells; e.maxCreatedSlope = f.maxSlope; };
  // Phase 1: each edge alone (corner groups are just A and B). Slope-matched (C¹) first; if that makes terrain too
  // steep, heights only (C⁰); if that still does, the edge is unresolved.
  for (const e of edges) {
    for (const other of edges) other.active = other === e;
    e.slopeMatch = true; updateTargets();
    let f = test([e.a, e.b]).found.get(e);
    if (f) { e.slopeMatch = false; e.slopeNote = 'slope match dropped (edge alone): C¹ join made terrain too steep'; updateTargets(); f = test([e.a, e.b]).found.get(e); }
    e.unresolvedAt = f ? 'alone' : null;
    if (f) { e.blame = f.cells; e.maxCreatedSlope = f.maxSlope; }
  }
  for (const e of edges) e.active = !e.unresolvedAt;
  // Phase 2: all surviving edges together (corner groups + Coons terms). A blamed edge first drops slope matching,
  // then is deactivated; repeated until no made-steep cell remains.
  let heights = null;
  let iterations = 0;
  for (; iterations < rules.maxIterations; iterations += 1) {
    updateTargets();
    const { result, found } = test(list.map(c => c.chunkId));
    heights = result;
    if (!found.size) break;
    for (const [e, f] of found) {
      if (e.slopeMatch) { e.slopeMatch = false; e.slopeNote = `slope match dropped (combined pass ${iterations + 1})`; } else fail(e, f, `combined pass ${iterations + 1}`);
    }
  }

  // ---------- water ----------
  const fb = rules.freeboard;
  const typeOfChunk = c => (c.landform === 'coast' ? WATER.sea : c.landform === 'riverValley' ? WATER.river : WATER.none);
  const band = new Map(); // cells inside the band of an active edge
  for (const c of list) {
    const mask = new Uint8Array(c.height.length);
    for (const side of SIDES) {
      const e = edgeOf.get(`${c.chunkId}:${side}`);
      if (!e?.active) continue;
      for (let depth = 0; depth * spacing < W; depth += 1) for (let i = 0; i <= segments; i += 1) mask[indexOf(side, i, depth, segments, columns)] = 1;
    }
    band.set(c.chunkId, mask);
  }
  const state = new Map(list.map(c => [c.chunkId, { type: new Uint8Array(c.height.length), level: new Float32Array(c.height.length).fill(NaN) }]));
  const flood = (c, seeds, type, levelAt, allowed) => {
    const st = state.get(c.chunkId); const H = heights.get(c.chunkId);
    const queue = [];
    for (const [k, level] of seeds) if (!st.type[k]) { st.type[k] = type; st.level[k] = level; queue.push(k); }
    for (let q = 0; q < queue.length; q += 1) {
      const k = queue[q]; const row = Math.floor(k / columns); const col = k % columns;
      for (const n of [row > 0 && k - columns, row < segments && k + columns, col > 0 && k - 1, col < segments && k + 1]) {
        if (n === false || st.type[n] || !allowed(n)) continue;
        const level = levelAt(n, st.level[k]);
        if (!(H[n] < level + fb)) continue;
        st.type[n] = type; st.level[n] = level; queue.push(n);
      }
    }
  };
  // Own water bodies: raw wet cells seed; outside the band only raw wet cells are reachable (heights unchanged there).
  for (const c of list) {
    const type = typeOfChunk(c); if (!type) continue;
    const mask = band.get(c.chunkId);
    const rawWet = k => Number.isFinite(c.waterSurface[k]) && c.height[k] < c.waterSurface[k];
    const seeds = [];
    for (let k = 0; k < c.height.length; k += 1) if (rawWet(k)) seeds.push([k, c.waterSurface[k]]);
    flood(c, seeds, type, (n, from) => (type === WATER.sea ? from : c.waterSurface[n]), n => mask[n] || rawWet(n));
  }
  // Sea crosses an edge only where the neighbour's edge sample lies below sea level (+ freeboard); it stays in that band.
  const exchanges = [];
  for (let round = 0; round < rules.exchangeRounds; round += 1) {
    const plan = [];
    for (const e of edges) for (const [from, fromSide, to, toSide] of [[e.a, e.sideA, e.b, e.sideB], [e.b, e.sideB, e.a, e.sideA]]) {
      const sf = state.get(from); const st = state.get(to); const Ht = heights.get(to); const Hf = heights.get(from);
      const seeds = [];
      for (let i = 0; i <= segments; i += 1) {
        const kf = indexOf(fromSide, i, 0, segments, columns); const kt = indexOf(toSide, i, 0, segments, columns);
        if (sf.type[kf] === WATER.sea && Hf[kf] < sf.level[kf] && !st.type[kt] && Ht[kt] < sf.level[kf] + fb) seeds.push([kt, sf.level[kf]]);
      }
      if (seeds.length) plan.push({ edge: e.id, to, toSide, seeds });
    }
    if (!plan.length) break;
    for (const p of plan) {
      const c = byId.get(p.to);
      const strip = new Uint8Array(c.height.length);
      for (let depth = 0; depth * spacing < W; depth += 1) for (let i = 0; i <= segments; i += 1) strip[indexOf(p.toSide, i, depth, segments, columns)] = 1;
      flood(c, p.seeds, WATER.sea, (n, from) => from, n => strip[n] === 1);
      exchanges.push({ round, edge: p.edge, into: p.to, seeds: p.seeds.length });
    }
  }

  // Output water level per cell: flooded → its level; band cell not flooded → raw level only if it stays above it
  // (shore semantics unchanged), otherwise no water; outside the band → raw level (identical to the raw chunk).
  const out = new Map();
  for (const c of list) {
    const H = heights.get(c.chunkId); const st = state.get(c.chunkId); const mask = band.get(c.chunkId);
    const surface = new Float32Array(c.height.length);
    const waterType = new Uint8Array(c.height.length);
    for (let k = 0; k < H.length; k += 1) {
      const raw = c.waterSurface[k];
      if (!mask[k] && !st.type[k]) { surface[k] = raw; continue; }
      if (st.type[k]) { surface[k] = st.level[k]; if (H[k] < st.level[k]) waterType[k] = st.type[k]; continue; }
      surface[k] = Number.isFinite(raw) && H[k] >= raw ? raw : NaN;
    }
    // Dry cells next to water carry the neighbour's level so the water surface mesh never drops to 0 there.
    for (let k = 0; k < H.length; k += 1) {
      if (!mask[k] || Number.isFinite(surface[k])) continue;
      const row = Math.floor(k / columns); const col = k % columns;
      for (let dr = -1; dr <= 1 && !Number.isFinite(surface[k]); dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        const r = row + dr; const cc = col + dc;
        if (r < 0 || cc < 0 || r > segments || cc > segments) continue;
        const n = r * columns + cc;
        if (waterType[n]) { surface[k] = st.level[n]; break; }
      }
    }
    let changed = 0; let maxDelta = 0;
    for (let k = 0; k < H.length; k += 1) { const delta = Math.abs(H[k] - c.height[k]); if (delta > 1e-6) changed += 1; maxDelta = Math.max(maxDelta, delta); }
    out.set(c.chunkId, { height: H, waterSurface: surface, waterType, band: mask, changedCells: changed, maxDelta });
  }

  return {
    rules, transitionWidth: W, iterations: iterations + 1, chunks: out, exchanges,
    edges: edges.map(e => ({ id: e.id, a: e.a, b: e.b, sideA: e.sideA, sideB: e.sideB, status: e.active ? 'resolved' : 'unresolved', rawMaxStep: +e.rawMaxStep.toFixed(2), madeSteepCells: e.blame, maxCreatedSlope: +e.maxCreatedSlope.toFixed(1), unresolvedAt: e.unresolvedAt, continuity: e.active ? (e.slopeMatch ? 'C1 (height + slope)' : 'C0 (height only)') : 'none', slopeNote: e.slopeNote, reason: e.active ? null : `join would create slopes up to ${e.maxCreatedSlope.toFixed(1)}° (> ${rules.maxTransitionSlopeDeg}°) inside ${W} m; raw step ${e.rawMaxStep.toFixed(1)} m` })),
    corners: [...corners.values()].filter(c => c.members.length === 4).map(c => {
      const incident = c.edges;
      const targets = c.members.map(m => +groupTarget(c, m.chunkId).toFixed(3));
      return { at: { x: c.x, z: c.z }, chunks: c.members.map(m => m.chunkId), groupTargets: targets, groups: new Set(targets).size, rawSpread: +c.rawSpread.toFixed(2), closed: incident.length === 4 && incident.every(e => e.active) };
    }),
  };
}
