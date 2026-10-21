// 06.3a-R2 world terrain with core preservation (pure data, deterministic, independent of input order and City ID).
//
// Three layers, kept apart:
//   rawLocalTerrain     — the unchanged single-chunk generation (each landform on its own datum: plain 20 m,
//                         river valley 30 m surface, mountain 120 m floor, coast at sea level).
//   worldMacroTerrain   — one world datum field D(x, z) = macroDatum + macroAmplitude·fBm(worldSeed, world metres).
//                         Every chunk is re-datumed by one constant: s_c = D(chunk centre) − its landform datum
//                         (coast: s = 0, the sea level is the world's zero). worldBase = raw + s_c, river levels + s_c.
//                         This removes the architectural step (the mountain floor 100 m above the plains) at its
//                         source instead of hiding it in the seam blend; core shape, slope, water and buildability
//                         are unchanged by a constant shift.
//   coordinatedTerrain  — seam correction inside the user transition band only (d < W from a shared edge):
//                         h = base(1 − w) + S·w, corners h = base(1−w1)(1−w2) + S1·w1(1−w2) + S2·w2(1−w1) + Sk·w1·w2,
//                         w = existing edgeWeight (smoothstep: w = 1, w′ = 0 at the edge; w = 0, w′ = 0 at d = W).
//                         Outside every band h = base exactly (core and outer-edge strips).
// Shared surface S of an edge (one world function, evaluated identically by both chunks):
//   S = P(s) + G(s)·n,  n = signed world distance across the edge line, P = relief-weighted mean of both base edge
//   profiles, G = relief-weighted mean of both cross-edge slopes (outward of A = inward of B, in world direction);
//   both low-passed along the edge and pinned at the ends to the corner values. Corner surface Sk = Pk + Gx·dx + Gz·dz.
//   So the joined edge keeps a natural cross slope (C¹, no level shelf) and the corner is one surface for all chunks.
// Sea stiffness: where only one side is sea at an edge sample, P is held at least freeboard below sea level (the sea
// is not lifted out of existence); the land side has to drop inside its band. If that makes terrain too steep, it is a
// waterConflict. Fallback: an edge whose cross-slope join makes cells too steep drops its cross slope (G = 0, level
// cross-section at the edge, still C¹) and is checked again (the 06.3a C¹ → C⁰ idea).
// Check: a band cell is made steep if slope > maxTransitionSlopeDeg and > its base slope + margin. An edge with made-
// steep cells is unresolved; its runs along the edge are reported as escarpmentCandidates (position, both base
// heights, step, slope, cause, slope budget). No escarpment geometry is built and the band is never widened.
// Water: sea level 0, river levels shifted with their chunk; connected flooding from raw water only, river water stays
// in its raw channel cells (floodWater, riverSpread false). Core water is untouched by construction.
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { LANDFORMS } from '../seed-terrain/config.js';
import { edgeWeight } from '../seed-terrain/TerrainFields.js';
import { HARMONY_RULES, floodWater, slopeField } from './TerrainHarmonizer.js';

export const COORDINATOR_RULES = Object.freeze({
  macroDatum: 20, // m; world datum of land landforms (= the plain's generator datum, so plains barely move)
  macroAmplitude: 6, // m; world-coordinate variation of that datum (worldSeed fBm)
  macroWavelength: 4096, // m; wavelength of the datum variation (larger than the 3 × 3 world: one regional tilt)
  boundarySmoothing: 64, // m; along-edge low-pass window of the shared edge profile and cross slope
  cornerPinBands: 1, // 06.3c: the shared corner value fades into the edge's own profile over this many band widths (was half the edge)
  maxTransitionSlopeDeg: HARMONY_RULES.maxTransitionSlopeDeg, // 35° (A)
  createdSlopeMargin: HARMONY_RULES.createdSlopeMargin, // 2°
  smoothKinkTargetDeg: 2, // test target for the measured slope kink on resolved edges (reported, not enforced)
  waterLevelTolerance: HARMONY_RULES.waterLevelTolerance,
  exchangeRounds: HARMONY_RULES.exchangeRounds,
  freeboard: HARMONY_RULES.freeboard,
});

const SIDES = ['minX', 'maxX', 'minZ', 'maxZ'];
const NEIGHBOUR = { maxX: [1, 0, 'minX'], maxZ: [0, 1, 'minZ'] };
const SEA = LANDFORMS.coast.seaLevel;
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const indexOf = (side, along, depth, segments, columns) => (side === 'minX' ? along * columns + depth
  : side === 'maxX' ? along * columns + (segments - depth)
    : side === 'minZ' ? depth * columns + along : (segments - depth) * columns + along);
const r2 = v => +v.toFixed(2);
const tan = deg => Math.tan(deg * Math.PI / 180);

// Landform datum of the raw generator (what the world datum replaces).
export const landformDatum = landform => (landform === 'coast' ? SEA : LANDFORMS[landform].baseHeight);

function fbm(noise, x, z, frequency, octaves) {
  let sum = 0; let amplitude = 1; let norm = 0;
  for (let o = 0; o < octaves; o += 1) { sum += noise.noise(x * frequency, z * frequency) * amplitude; norm += amplitude; amplitude *= 0.5; frequency *= 2; }
  return sum / norm;
}

// chunks: [{ chunkId, gridX, gridY, landform, grid, height, waterSurface }] (raw, placed). variation = world variation.
export function coordinateTerrain(chunks, transitionWidth, worldSeed, variation, rules = COORDINATOR_RULES) {
  const W = transitionWidth;
  const list = [...chunks].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX); // canonical order
  const at = new Map(list.map(c => [`${c.gridX},${c.gridY}`, c]));
  const { segments, columns, spacing, size } = list[0].grid;
  const half = size / 2;
  const random = new SeededRandom(worldSeed, 'world-macro-datum');
  const noise = new SimplexNoise({ random: () => random.next() });
  const strength = 0.5 + variation;
  const R = c => LANDFORMS[c.landform].relief * strength;

  // ---------- worldMacroTerrain: one datum shift per chunk ----------
  const macro = new Map(list.map(c => {
    const datum = c.landform === 'coast' ? SEA : rules.macroDatum + rules.macroAmplitude * fbm(noise, c.grid.originX, c.grid.originZ, 1 / rules.macroWavelength, 3);
    const shift = datum - landformDatum(c.landform);
    const base = Float32Array.from(c.height, h => h + shift);
    const level = Float32Array.from(c.waterSurface, v => (Number.isFinite(v) ? (c.landform === 'coast' ? v : v + shift) : NaN));
    const wet = Uint8Array.from(base, (h, k) => (Number.isFinite(level[k]) && h < level[k] ? 1 : 0));
    return [c.chunkId, { chunkId: c.chunkId, landform: c.landform, datum, shift, base, level, wet, R: R(c), sea: c.landform === 'coast' }];
  }));

  // ---------- shared edges: profile P and cross slope G (world +x / +z direction) ----------
  const r = Math.round(rules.boundarySmoothing / 2 / spacing);
  const lowPass = a => a.map((_, i) => { let s = 0; let n = 0; for (let j = Math.max(0, i - r); j <= Math.min(segments, i + r); j += 1) { s += a[j]; n += 1; } return s / n; });
  const edges = [];
  for (const A of list) for (const sideA of ['maxX', 'maxZ']) {
    const [dx, dy, sideB] = NEIGHBOUR[sideA];
    const B = at.get(`${A.gridX + dx},${A.gridY + dy}`);
    if (!B) continue;
    const mA = macro.get(A.chunkId); const mB = macro.get(B.chunkId);
    const n = segments + 1;
    const e = { id: `${A.chunkId}|${B.chunkId}`, a: A.chunkId, b: B.chunkId, sideA, sideB, hA: new Float64Array(n), hB: new Float64Array(n), stiff: new Int8Array(n), rawMaxStep: 0, baseMaxStep: 0 };
    const P = new Float64Array(n); const G = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const kA = indexOf(sideA, i, 0, segments, columns); const kB = indexOf(sideB, i, 0, segments, columns);
      e.hA[i] = mA.base[kA]; e.hB[i] = mB.base[kB];
      e.rawMaxStep = Math.max(e.rawMaxStep, Math.abs(A.height[kA] - B.height[kB]));
      e.baseMaxStep = Math.max(e.baseMaxStep, Math.abs(e.hA[i] - e.hB[i]));
      const seaA = mA.sea && mA.wet[kA]; const seaB = mB.sea && mB.wet[kB];
      e.stiff[i] = seaA && !seaB ? 1 : seaB && !seaA ? -1 : 0; // only one side is sea: the joint is held under water
      const wA = 1 / mA.R; const wB = 1 / mB.R;
      // Cross slopes over 8 m on each side, both in the world direction A → B.
      const gA = (e.hA[i] - mA.base[indexOf(sideA, i, 2, segments, columns)]) / (2 * spacing);
      const gB = (mB.base[indexOf(sideB, i, 2, segments, columns)] - e.hB[i]) / (2 * spacing);
      P[i] = (e.hA[i] * wA + e.hB[i] * wB) / (wA + wB);
      G[i] = (gA * wA + gB * wB) / (wA + wB);
    }
    e.P0 = lowPass(P); e.G0 = lowPass(G);
    // The sea stays at the edge (at least freeboard deep), never lifted out. The lowering is spread along the edge
    // (max filter, then low-pass over about half the band) so the shared profile has no along-edge cliff.
    const cut = Float64Array.from(e.P0, (p, i) => (e.stiff[i] ? Math.max(0, p - (SEA - rules.freeboard)) : 0));
    const spread = Math.max(1, Math.round(W / 2 / spacing));
    const widened = cut.map((_, i) => { let v = 0; for (let j = Math.max(0, i - spread); j <= Math.min(segments, i + spread); j += 1) v = Math.max(v, cut[j]); return v; });
    const soft = widened.map((_, i) => { let s = 0; let c = 0; for (let j = Math.max(0, i - spread); j <= Math.min(segments, i + spread); j += 1) { s += widened[j]; c += 1; } return s / c; });
    for (let i = 0; i < n; i += 1) { e.P0[i] -= soft[i]; if (e.stiff[i]) e.P0[i] = Math.min(e.P0[i], SEA - rules.freeboard); }
    e.line = sideA === 'maxX' ? A.grid.originX + half : A.grid.originZ + half; // world coordinate of the edge line
    e.axis = sideA === 'maxX' ? 'x' : 'z';
    e.start = sideA === 'maxX' ? A.grid.originZ - half : A.grid.originX - half;
    edges.push(e);
  }
  const edgeOf = new Map();
  for (const e of edges) { edgeOf.set(`${e.a}:${e.sideA}`, e); edgeOf.set(`${e.b}:${e.sideB}`, e); }

  // ---------- corners: one value + gradient for all chunks at the point ----------
  const corners = new Map();
  const cornerKey = (x, z) => `${x},${z}`;
  for (const e of edges) for (const end of [0, segments]) {
    const along = e.start + end * spacing;
    const x = e.axis === 'x' ? e.line : along; const z = e.axis === 'x' ? along : e.line;
    const key = cornerKey(x, z);
    if (!corners.has(key)) corners.set(key, { key, x, z, edges: [] });
    corners.get(key).edges.push({ e, i: end });
  }
  for (const k of corners.values()) {
    k.edges.sort((p, q) => (p.e.id < q.e.id ? -1 : 1));
    const members = new Map();
    for (const { e, i } of k.edges) { members.set(e.a, { h: e.hA[i], stiff: e.stiff[i] === 1 }); members.set(e.b, { h: e.hB[i], stiff: e.stiff[i] === -1 }); }
    let ws = 0; let hs = 0;
    for (const [id, m] of [...members.entries()].sort(([p], [q]) => (p < q ? -1 : 1))) { const w = 1 / macro.get(id).R; ws += w; hs += w * m.h; }
    k.P = hs / ws;
    if (k.edges.some(({ e, i }) => e.stiff[i])) k.P = Math.min(k.P, SEA - rules.freeboard);
    k.chunks = [...members.keys()].sort();
  }
  const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
  // Corner gradients and edge profiles pinned to their corner values over half the edge. An edge with cross = false
  // drops its cross slope (G = 0: level cross-section at the edge, still C¹) — the 06.3a C¹ → C⁰ fallback idea.
  const shapeEdges = () => {
    for (const k of corners.values()) {
      k.Gx = mean(k.edges.filter(({ e }) => e.axis === 'x').map(({ e, i }) => (e.cross ? e.G0[i] : 0)));
      k.Gz = mean(k.edges.filter(({ e }) => e.axis === 'z').map(({ e, i }) => (e.cross ? e.G0[i] : 0)));
    }
    for (const e of edges) {
      const xz = end => { const along = e.start + end * spacing; return e.axis === 'x' ? cornerKey(e.line, along) : cornerKey(along, e.line); };
      const c0 = corners.get(xz(0)); const c1 = corners.get(xz(segments));
      const g0 = e.axis === 'x' ? c0.Gx : c0.Gz; const g1 = e.axis === 'x' ? c1.Gx : c1.Gz;
      e.P = new Float64Array(segments + 1); e.G = new Float64Array(segments + 1);
      for (let i = 0; i <= segments; i += 1) {
        const s = i * spacing; const pin = Math.min(half, rules.cornerPinBands * W); const f0 = 1 - smooth(0, pin, s); const f1 = 1 - smooth(0, pin, size - s);
        const G0 = e.cross ? e.G0[i] : 0; const G00 = e.cross ? e.G0[0] : 0; const G0n = e.cross ? e.G0[segments] : 0;
        e.P[i] = e.P0[i] + (c0.P - e.P0[0]) * f0 + (c1.P - e.P0[segments]) * f1;
        e.G[i] = G0 + (g0 - G00) * f0 + (g1 - G0n) * f1;
      }
      e.S = (i, x, z) => e.P[i] + e.G[i] * ((e.axis === 'x' ? x : z) - e.line);
    }
  };
  const cornerS = (k, x, z) => k.P + k.Gx * (x - k.x) + k.Gz * (z - k.z);

  // ---------- coordinatedTerrain: correction inside the bands only ----------
  const computeHeights = () => {
    const heights = new Map(); const zones = new Map();
    for (const c of list) {
      const m = macro.get(c.chunkId);
      const shared = SIDES.filter(side => edgeOf.has(`${c.chunkId}:${side}`));
      const H = Float32Array.from(m.base);
      const zone = new Uint8Array(H.length); // 0 = outside every band (base exactly), 1 = band of a shared edge
      for (let row = 0; row <= segments; row += 1) {
        for (let col = 0; col <= segments; col += 1) {
          const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
          const bands = shared.filter(side => d[side] < W).sort((p, q) => SIDES.indexOf(p) - SIDES.indexOf(q));
          if (!bands.length) continue;
          const k = row * columns + col;
          const x = c.grid.originX - half + col * spacing; const z = c.grid.originZ - half + row * spacing;
          const along = side => (side.endsWith('X') ? row : col);
          const base = m.base[k];
          if (bands.length === 1) {
            const side = bands[0]; const w = edgeWeight(d[side], W);
            H[k] = base * (1 - w) + edgeOf.get(`${c.chunkId}:${side}`).S(along(side), x, z) * w;
          } else {
            const [s1, s2] = bands; const w1 = edgeWeight(d[s1], W); const w2 = edgeWeight(d[s2], W);
            const corner = corners.get(cornerKey(c.grid.originX + (s1 === 'minX' ? -half : half), c.grid.originZ + (s2 === 'minZ' ? -half : half)));
            H[k] = base * (1 - w1) * (1 - w2) + edgeOf.get(`${c.chunkId}:${s1}`).S(along(s1), x, z) * w1 * (1 - w2)
              + edgeOf.get(`${c.chunkId}:${s2}`).S(along(s2), x, z) * w2 * (1 - w1) + cornerS(corner, x, z) * w1 * w2;
          }
          zone[k] = 1;
        }
      }
      heights.set(c.chunkId, H); zones.set(c.chunkId, zone);
    }
    return { heights, zones };
  };

  // ---------- check: made-steep cells per edge, escarpment candidates ----------
  const check = (heights, zones) => {
    const found = new Map(edges.map(e => [e.id, { cells: 0, maxSlope: 0, bandMaxSlope: 0, along: new Map() }]));
    const steepMasks = new Map(); const slopeDelta = new Map();
    for (const c of list) {
      const m = macro.get(c.chunkId);
      const slope = slopeField(heights.get(c.chunkId), segments, columns, spacing);
      const baseSlope = slopeField(m.base, segments, columns, spacing);
      const steep = new Uint8Array(slope.length);
      const deltas = [];
      for (let row = 0; row <= segments; row += 1) for (let col = 0; col <= segments; col += 1) {
        const k = row * columns + col;
        if (!zones.get(c.chunkId)[k]) continue;
        deltas.push(slope[k] - baseSlope[k]);
        const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
        const near = SIDES.filter(side => edgeOf.has(`${c.chunkId}:${side}`) && d[side] < W);
        const dMin = Math.min(...near.map(side => d[side]));
        for (const side of near) {
          if (d[side] !== dMin) continue;
          const f = found.get(edgeOf.get(`${c.chunkId}:${side}`).id);
          f.bandMaxSlope = Math.max(f.bandMaxSlope, slope[k]);
          if (!(slope[k] > rules.maxTransitionSlopeDeg && slope[k] > baseSlope[k] + rules.createdSlopeMargin)) continue;
          steep[k] = 1; f.cells += 1; f.maxSlope = Math.max(f.maxSlope, slope[k]);
          const i = side.endsWith('X') ? row : col;
          f.along.set(i, Math.max(f.along.get(i) ?? 0, slope[k]));
        }
      }
      steepMasks.set(c.chunkId, steep);
      slopeDelta.set(c.chunkId, deltas);
    }
    return { found, steepMasks, slopeDelta };
  };

  // Pass 1: every edge with its cross slope. Pass 2 (if needed): edges with made-steep cells drop the cross slope.
  for (const e of edges) { e.cross = true; e.crossNote = null; }
  shapeEdges();
  let { heights, zones } = computeHeights();
  let { found, steepMasks, slopeDelta } = check(heights, zones);
  const firstSteep = edges.filter(e => found.get(e.id).cells);
  if (firstSteep.length) {
    for (const e of firstSteep) { e.cross = false; e.crossNote = `cross slope dropped: with it ${found.get(e.id).cells} band cells were too steep`; }
    shapeEdges();
    ({ heights, zones } = computeHeights());
    ({ found, steepMasks, slopeDelta } = check(heights, zones));
  }

  // ---------- water ----------
  const region = new Map(list.map(c => [c.chunkId, zones.get(c.chunkId)]));
  const rawLike = list.map(c => ({ ...c, height: c.height, waterSurface: c.waterSurface }));
  const { water, exchanges } = floodWater(rawLike, heights, new Map(list.map(c => [c.chunkId, macro.get(c.chunkId).level])), region, edges, W, rules, { riverSpread: false });

  // ---------- report ----------
  const budget = W * tan(rules.maxTransitionSlopeDeg) / 0.75; // largest step two smoothstep half-ramps can take under the limit
  const out = new Map();
  const waterLossByEdge = new Map(edges.map(e => [e.id, 0]));
  for (const c of list) {
    const m = macro.get(c.chunkId); const H = heights.get(c.chunkId); const zone = zones.get(c.chunkId); const wt = water.get(c.chunkId).waterType;
    let changed = 0; let sum = 0; let maxDelta = 0; let coreChanged = 0; let coreCells = 0; let wetBase = 0; let wetNow = 0; let lost = 0; let gained = 0; let coreLost = 0;
    for (let row = 0; row <= segments; row += 1) for (let col = 0; col <= segments; col += 1) {
      const k = row * columns + col;
      const delta = Math.abs(H[k] - m.base[k]);
      const core = Math.min(col, segments - col, row, segments - row) * spacing > W;
      if (core) { coreCells += 1; if (delta > 1e-3) coreChanged += 1; }
      if (delta > 1e-6) { changed += 1; sum += delta; }
      maxDelta = Math.max(maxDelta, delta);
      const wNow = wt[k] ? 1 : 0;
      wetBase += m.wet[k]; wetNow += wNow;
      if (m.wet[k] && !wNow) {
        lost += 1; if (core) coreLost += 1;
        if (zone[k]) {
          const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
          const side = SIDES.filter(s => edgeOf.has(`${c.chunkId}:${s}`) && d[s] < W).sort((p, q) => d[p] - d[q])[0];
          if (side) waterLossByEdge.set(edgeOf.get(`${c.chunkId}:${side}`).id, waterLossByEdge.get(edgeOf.get(`${c.chunkId}:${side}`).id) + 1);
        }
      }
      if (!m.wet[k] && wNow) gained += 1;
    }
    const deltas = slopeDelta.get(c.chunkId).sort((p, q) => p - q);
    const q = p => (deltas.length ? r2(deltas[Math.min(deltas.length - 1, Math.floor(p * (deltas.length - 1)))]) : 0);
    out.set(c.chunkId, {
      height: H, ...water.get(c.chunkId), band: zone, zone, steep: steepMasks.get(c.chunkId), base: m.base,
      changedCells: changed, changedOutsideBand: 0, maxDelta, meanDeltaChanged: changed ? sum / changed : 0,
      core: { cells: coreCells, changedVsBase: coreChanged, changedShare: coreCells ? coreChanged / coreCells : 0 },
      macro: { datum: r2(m.datum), shift: r2(m.shift), shiftExact: m.shift, landformDatum: landformDatum(c.landform) },
      water: { wetBase, wetNow, lost, gained, coreLost },
      slopeChange: { p05: q(0.05), p50: q(0.5), p95: q(0.95), max: q(1) },
    });
  }
  return {
    mode: 'coordinated', version: '06.3a-R2', rules, transitionWidth: W, worldSeed, iterations: 1, chunks: out, exchanges, slopeBudgetStep: r2(budget),
    macro: Object.fromEntries([...macro.values()].map(m => [m.chunkId, { landform: m.landform, landformDatum: landformDatum(m.landform), datum: r2(m.datum), shift: r2(m.shift), relief: r2(m.R) }])),
    edges: edges.map(e => {
      const f = found.get(e.id);
      const stiffSamples = e.stiff.reduce((s, v) => s + (v ? 1 : 0), 0);
      // Escarpment candidates: runs of along-edge positions with made-steep cells.
      const runs = [];
      const idx = [...f.along.keys()].sort((p, q) => p - q);
      for (const i of idx) {
        const last = runs.at(-1);
        if (last && i - last.to <= 2) { last.to = i; last.maxSlope = Math.max(last.maxSlope, f.along.get(i)); } else runs.push({ from: i, to: i, maxSlope: f.along.get(i) });
      }
      const candidates = runs.map(run => {
        let step = 0; let sa = 0; let sb = 0; let stiff = 0;
        for (let i = run.from; i <= run.to; i += 1) { step = Math.max(step, Math.abs(e.hA[i] - e.hB[i])); sa += e.hA[i]; sb += e.hB[i]; if (e.stiff[i]) stiff += 1; }
        const n = run.to - run.from + 1;
        const point = i => { const along = e.start + i * spacing; return e.axis === 'x' ? { x: e.line, z: along } : { x: along, z: e.line }; };
        const cause = stiff ? 'waterConflict: the sea is kept at the edge, so the land side has to drop inside its band (sea-cliff candidate)'
          : step > budget ? `height difference ${step.toFixed(0)} m exceeds the slope budget of the ${W} m band (${budget.toFixed(0)} m at ${rules.maxTransitionSlopeDeg}°)`
            : 'existing local relief in the band plus the join exceeds the slope limit';
        return { from: point(run.from), to: point(run.to), lengthM: (n - 1) * spacing, heightA: r2(sa / n), heightB: r2(sb / n), maxStep: r2(step), maxSlope: r2(run.maxSlope), waterConflict: stiff > 0, cause };
      });
      const status = f.cells ? 'unresolved' : 'resolved';
      return {
        id: e.id, a: e.a, b: e.b, sideA: e.sideA, sideB: e.sideB, status, continuity: e.cross ? 'C1 (height + cross slope)' : 'C1 (height; level cross-section at the edge)', slopeNote: e.crossNote,
        rawMaxStep: r2(e.rawMaxStep), baseMaxStep: r2(e.baseMaxStep), slopeBudgetStep: r2(budget), madeSteepCells: f.cells, maxCreatedSlope: r2(f.maxSlope), bandMaxSlope: r2(f.bandMaxSlope),
        seaHeldSamples: stiffSamples, waterLossCells: waterLossByEdge.get(e.id), waterConflict: candidates.some(cnd => cnd.waterConflict),
        escarpmentCandidates: candidates,
        reason: f.cells ? `${f.cells} band cells steeper than ${rules.maxTransitionSlopeDeg}° (max ${f.maxSlope.toFixed(1)}°) in ${candidates.length} run(s); raw step ${e.rawMaxStep.toFixed(1)} m, after world datum ${e.baseMaxStep.toFixed(1)} m, band budget ${budget.toFixed(0)} m. Terrain stays continuous; escarpment candidate, not a road crossing.` : null,
        suggestion: f.cells ? (candidates.some(cnd => cnd.waterConflict) ? 'sea cliff / coastal escarpment rule, or a lower land side next to this sea' : e.baseMaxStep > budget ? 'escarpment rule, or a wider band by explicit choice, or a landform pair with a smaller relief contrast' : 'wider band by explicit choice, or an escarpment rule for the steep run') : null,
      };
    }),
    corners: [...corners.values()].filter(k => k.chunks.length === 4).map(k => ({ at: { x: k.x, z: k.z }, chunks: k.chunks, value: r2(k.P), gradient: [r2(k.Gx), r2(k.Gz)], closed: true, groups: 1 })),
  };
}
