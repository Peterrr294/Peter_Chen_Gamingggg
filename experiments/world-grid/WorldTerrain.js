// 06.3a-R world-coherent terrain (pure data, deterministic, independent of input order and City ID).
//
// Raw chunk height fields (single-chunk generator, unchanged) stay untouched; this returns a separate coordinated
// height and water-level field per chunk. Three layers, all in world coordinates:
//
//   Global macro base B / relief R — a C¹ world field over the chunk lattice. Control values: each chunk's own base
//     b_c (mean raw height; sea level for a coast) and relief R_c (landform relief × variation strength); every shared edge and every corner
//     gets one relief-weighted value (weights 1 / R), so the flatter landform keeps its level and the rougher one
//     carries the climb, like foothills. Along an edge the value runs smoothly from corner to mid-edge to corner.
//   Local layer L_c — the raw chunk, re-based: L = T_c + E_c·(raw − b_c). T_c ramps from b_c (core) to the edge base
//     over the landform's ramp distance D (Coons sum over shared sides); E_c fades the local relief toward the shared
//     relief over the same distance (never amplifies). Core cells (beyond D from every shared edge) are raw exactly.
//   Shared boundary surface S — near an edge: P(s) + share·R_edge(s)·n(x, z)·dry, where P is the relief-weighted mean
//     of both raw edge profiles, smoothed along the edge and pinned at its ends to the shared corner value (relief-
//     weighted mean of the raw corner heights of every chunk at that point); near a 4-chunk corner: corner value +
//     share·R_corner·n·dry. n = worldSeed fBm in world metres; dry fades it out below sea level so a sea that reaches
//     the edge on both sides stays sea. Both chunks evaluate the same function.
//
// Final height inside the user's transition band W (w = existing edgeWeight, smoothstep: w = 1, w' = 0 at the edge):
//   one band:  h = L(1 − w) + S·w;   corner:  h = L(1−w1)(1−w2) + S1·w1(1−w2) + S2·w2(1−w1) + Sk·w1·w2.
// So both chunks hold the same height on the edge and the same slope across it (C¹ by construction), and the four
// chunks at a corner share one corner value. Nothing is flattened: the edge carries world-coordinate relief.
// Check: a cell is "made steep" when its slope > maxTransitionSlopeDeg and > its raw slope + margin; it is blamed on
// the nearest shared edge whose coordination zone contains it. Such an edge is reported unresolved with the cause and
// feasible adjustments; the geometry stays continuous (no cliff) and the band is never widened automatically.
// Water: sea keeps its level; river levels take the same transform as the ground; wet cells come only from connected
// flooding from raw water (TerrainHarmonizer.floodWater); river water stays in its raw channel cells, so no lake or
// river link is faked by height blending.
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { LANDFORMS, TRANSITION } from '../seed-terrain/config.js';
const SEA_LEVEL = LANDFORMS.coast.seaLevel;
import { edgeWeight } from '../seed-terrain/TerrainFields.js';
import { HARMONY_RULES, floodWater, slopeField } from './TerrainHarmonizer.js';

export const COORDINATION_RULES = Object.freeze({
  rampDistance: Object.freeze({ plain: 0, coast: 128, riverValley: 384, mountain: 512 }), // m; approach zone over which a landform's base and relief meet the shared edge values (never < W, ≤ half a chunk)
  sharedReliefShare: 0.35, // share of the shared relief used as world-coordinate relief on the boundary surface
  sharedWavelength: 400, // m; base wavelength of that boundary relief (worldSeed fBm)
  boundarySmoothing: 64, // m; window of the along-edge low-pass applied to the weighted raw edge profile
  maxTransitionSlopeDeg: HARMONY_RULES.maxTransitionSlopeDeg, // 35° (A, ≈ angle of repose)
  createdSlopeMargin: HARMONY_RULES.createdSlopeMargin, // 2°
  waterLevelTolerance: HARMONY_RULES.waterLevelTolerance,
  exchangeRounds: HARMONY_RULES.exchangeRounds,
  freeboard: HARMONY_RULES.freeboard,
});

const SIDES = ['minX', 'maxX', 'minZ', 'maxZ'];
const NEIGHBOUR = { maxX: [1, 0, 'minX'], maxZ: [0, 1, 'minZ'] };
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const indexOf = (side, along, depth, segments, columns) => (side === 'minX' ? along * columns + depth
  : side === 'maxX' ? along * columns + (segments - depth)
    : side === 'minZ' ? depth * columns + along : (segments - depth) * columns + along);
const r2 = v => +v.toFixed(2);

function fbm(noise, x, z, frequency, octaves) {
  let sum = 0; let amplitude = 1; let norm = 0;
  for (let o = 0; o < octaves; o += 1) { sum += noise.noise(x * frequency, z * frequency) * amplitude; norm += amplitude; amplitude *= 0.5; frequency *= 2; }
  return sum / norm;
}

// Relief-weighted value of a set of chunks (weights 1 / R): base = weighted mean, relief = harmonic mean.
const weighted = members => {
  const sorted = [...members].sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1));
  let wSum = 0; let bSum = 0;
  for (const m of sorted) { wSum += 1 / m.R; bSum += m.b / m.R; }
  return { b: bSum / wSum, R: sorted.length / wSum };
};

// chunks: [{ chunkId, gridX, gridY, landform, grid, height, waterSurface }] (raw, placed). variation = world variation.
export function coordinateWorld(chunks, transitionWidth, worldSeed, variation, rules = COORDINATION_RULES) {
  const W = transitionWidth;
  const list = [...chunks].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX); // canonical order
  const at = new Map(list.map(c => [`${c.gridX},${c.gridY}`, c]));
  const { segments, columns, spacing, size } = list[0].grid;
  const half = size / 2;
  const random = new SeededRandom(worldSeed, 'world-macro-terrain');
  const noise = new SimplexNoise({ random: () => random.next() });
  const n = (x, z) => fbm(noise, x, z, 1 / rules.sharedWavelength, 4);
  const strength = 0.5 + variation;

  // Chunk control values.
  const macro = new Map(list.map(c => {
    let sum = 0; for (let k = 0; k < c.height.length; k += 1) sum += c.height[k];
    const D = Math.min(half, Math.max(W, rules.rampDistance[c.landform] ?? W));
    // A coast's datum is its sea level (its mean only reflects the land / sea share); other landforms use the mean.
    return [c.chunkId, { chunkId: c.chunkId, b: c.landform === 'coast' ? SEA_LEVEL : sum / c.height.length, R: LANDFORMS[c.landform].relief * strength, D }];
  }));

  // Corner values: every chunk meeting at the point (2 on the world edge, 4 inside).
  const corners = new Map();
  for (const c of list) for (const xs of ['minX', 'maxX']) for (const zs of ['minZ', 'maxZ']) {
    const x = c.grid.originX + (xs === 'minX' ? -half : half); const z = c.grid.originZ + (zs === 'minZ' ? -half : half);
    const key = `${x},${z}`;
    if (!corners.has(key)) corners.set(key, { key, x, z, members: [] });
    corners.get(key).members.push({ ...macro.get(c.chunkId), height: c.height[(zs === 'minZ' ? 0 : segments) * columns + (xs === 'minX' ? 0 : segments)] });
  }
  for (const k of corners.values()) {
    Object.assign(k, weighted(k.members));
    k.s = weighted(k.members.map(mm => ({ chunkId: mm.chunkId, b: mm.height, R: mm.R }))).b; // shared surface corner value
  }
  const hasSea = list.some(c => c.landform === 'coast');
  const dry = v => (hasSea ? smooth(SEA_LEVEL, SEA_LEVEL + 8, v) : 1);

  // Shared edges: mid value + corner values → B_edge(s), R_edge(s) along the edge (s = along · spacing, world order).
  const edges = [];
  for (const A of list) for (const sideA of ['maxX', 'maxZ']) {
    const [dx, dy, sideB] = NEIGHBOUR[sideA];
    const B = at.get(`${A.gridX + dx},${A.gridY + dy}`);
    if (!B) continue;
    const mid = weighted([macro.get(A.chunkId), macro.get(B.chunkId)]);
    const end = i => {
      const x = sideA === 'maxX' ? A.grid.originX + half : A.grid.originX + (i === 0 ? -half : half);
      const z = sideA === 'maxZ' ? A.grid.originZ + half : A.grid.originZ + (i === 0 ? -half : half);
      return corners.get(`${x},${z}`);
    };
    const c0 = end(0); const c1 = end(1);
    const along = (key, s) => mid[key] + (c0[key] - mid[key]) * (1 - smooth(0, half, s)) + (c1[key] - mid[key]) * (1 - smooth(0, half, size - s));
    let rawMaxStep = 0;
    const RA = macro.get(A.chunkId).R; const RB = macro.get(B.chunkId).R;
    const profile = new Float64Array(segments + 1);
    for (let i = 0; i <= segments; i += 1) {
      const hA = A.height[indexOf(sideA, i, 0, segments, columns)]; const hB = B.height[indexOf(sideB, i, 0, segments, columns)];
      rawMaxStep = Math.max(rawMaxStep, Math.abs(hA - hB));
      profile[i] = (hA / RA + hB / RB) / (1 / RA + 1 / RB);
    }
    const r = Math.round(rules.boundarySmoothing / 2 / spacing);
    const P = profile.map((_, i) => { let sum = 0; let count = 0; for (let j = Math.max(0, i - r); j <= Math.min(segments, i + r); j += 1) { sum += profile[j]; count += 1; } return sum / count; });
    const surfaceAt = s => { const i = Math.round(s / spacing); return P[i] + (c0.s - P[0]) * (1 - smooth(0, half, s)) + (c1.s - P[segments]) * (1 - smooth(0, half, size - s)); };
    edges.push({
      id: `${A.chunkId}|${B.chunkId}`, a: A.chunkId, b: B.chunkId, sideA, sideB, mid, c0, c1, rawMaxStep,
      fB: s => along('b', s), fR: s => along('R', s),
      S: (x, z, s) => { const v = surfaceAt(s); return v + rules.sharedReliefShare * along('R', s) * n(x, z) * dry(v); },
    });
  }
  const edgeOf = new Map();
  for (const e of edges) { edgeOf.set(`${e.a}:${e.sideA}`, e); edgeOf.set(`${e.b}:${e.sideB}`, e); }
  const cornerS = (k, x, z) => k.s + rules.sharedReliefShare * k.R * n(x, z) * dry(k.s);

  // ---------- heights ----------
  const heights = new Map(); const levels = new Map(); const zones = new Map(); const steepMasks = new Map();
  for (const c of list) {
    const m = macro.get(c.chunkId);
    const shared = SIDES.filter(side => edgeOf.has(`${c.chunkId}:${side}`));
    const H = new Float32Array(c.height.length);
    const level = new Float32Array(c.height.length).fill(NaN);
    const zone = new Uint8Array(c.height.length); // 0 core (raw), 1 ramp only, 2 transition band
    const isSea = c.landform === 'coast';
    for (let row = 0; row <= segments; row += 1) {
      for (let col = 0; col <= segments; col += 1) {
        const k = row * columns + col;
        const x = c.grid.originX - half + col * spacing; const z = c.grid.originZ - half + row * spacing;
        const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
        const s = { minX: row * spacing, maxX: row * spacing, minZ: col * spacing, maxZ: col * spacing };
        const phi = {};
        let Tb = m.b; let Tr = m.R; let inZone = false;
        for (const side of shared) {
          if (d[side] >= m.D) continue;
          const e = edgeOf.get(`${c.chunkId}:${side}`);
          phi[side] = 1 - smooth(0, m.D, d[side]);
          Tb += phi[side] * (e.fB(s[side]) - m.b); Tr += phi[side] * (e.fR(s[side]) - m.R);
          inZone = true;
        }
        for (const xs of ['minX', 'maxX']) for (const zs of ['minZ', 'maxZ']) {
          if (phi[xs] === undefined || phi[zs] === undefined) continue;
          const corner = corners.get(`${c.grid.originX + (xs === 'minX' ? -half : half)},${c.grid.originZ + (zs === 'minZ' ? -half : half)}`);
          Tb -= phi[xs] * phi[zs] * (corner.b - m.b); Tr -= phi[xs] * phi[zs] * (corner.R - m.R);
        }
        const E = Math.min(1, Math.max(0, Tr / m.R));
        const raw = c.height[k];
        const L = inZone ? Tb + E * (raw - m.b) : raw;
        const surface = c.waterSurface[k];
        if (Number.isFinite(surface)) level[k] = !inZone || isSea ? surface : Tb + E * (surface - m.b);
        const bands = shared.filter(side => d[side] < W);
        let h = L;
        if (bands.length === 1) {
          const side = bands[0]; const w = edgeWeight(d[side], W);
          h = L * (1 - w) + edgeOf.get(`${c.chunkId}:${side}`).S(x, z, s[side]) * w;
        } else if (bands.length === 2) {
          const [s1, s2] = bands.sort((p, q) => SIDES.indexOf(p) - SIDES.indexOf(q)); // X side first, then Z side
          const w1 = edgeWeight(d[s1], W); const w2 = edgeWeight(d[s2], W);
          const corner = corners.get(`${c.grid.originX + (s1 === 'minX' ? -half : half)},${c.grid.originZ + (s2 === 'minZ' ? -half : half)}`);
          h = L * (1 - w1) * (1 - w2) + edgeOf.get(`${c.chunkId}:${s1}`).S(x, z, s[s1]) * w1 * (1 - w2)
            + edgeOf.get(`${c.chunkId}:${s2}`).S(x, z, s[s2]) * w2 * (1 - w1) + cornerS(corner, x, z) * w1 * w2;
        }
        H[k] = h;
        zone[k] = bands.length ? 2 : inZone ? 1 : 0;
      }
    }
    heights.set(c.chunkId, H); levels.set(c.chunkId, level); zones.set(c.chunkId, zone);
  }

  // ---------- check: cells made steep, blamed on the nearest shared edge whose zone contains them ----------
  const blame = new Map(edges.map(e => [e.id, { cells: 0, band: 0, ramp: 0, maxSlope: 0, bandMaxSlope: 0 }]));
  for (const c of list) {
    const m = macro.get(c.chunkId);
    const slope = slopeField(heights.get(c.chunkId), segments, columns, spacing);
    const raw = slopeField(c.height, segments, columns, spacing);
    const steep = new Uint8Array(c.height.length);
    for (let row = 0; row <= segments; row += 1) for (let col = 0; col <= segments; col += 1) {
      const k = row * columns + col;
      const d = { minX: col * spacing, maxX: (segments - col) * spacing, minZ: row * spacing, maxZ: (segments - row) * spacing };
      const near = SIDES.filter(side => edgeOf.has(`${c.chunkId}:${side}`) && d[side] < m.D);
      if (!near.length) continue;
      const dMin = Math.min(...near.map(side => d[side]));
      for (const side of near) {
        if (d[side] !== dMin) continue;
        const f = blame.get(edgeOf.get(`${c.chunkId}:${side}`).id);
        if (dMin < W) f.bandMaxSlope = Math.max(f.bandMaxSlope, slope[k]);
        if (!(slope[k] > rules.maxTransitionSlopeDeg && slope[k] > raw[k] + rules.createdSlopeMargin)) continue;
        steep[k] = 1; f.cells += 1; f.maxSlope = Math.max(f.maxSlope, slope[k]);
        if (dMin < W) f.band += 1; else f.ramp += 1;
      }
    }
    steepMasks.set(c.chunkId, steep);
  }

  // ---------- water (connected flooding only; same rules as 06.3a) ----------
  const region = new Map(list.map(c => [c.chunkId, Uint8Array.from(zones.get(c.chunkId), z => (z ? 1 : 0))]));
  const { water, exchanges } = floodWater(list, heights, levels, region, edges, W, rules, { riverSpread: false });

  // ---------- report ----------
  const tan = deg => Math.tan(deg * Math.PI / 180);
  const out = new Map();
  for (const c of list) {
    const H = heights.get(c.chunkId); const zone = zones.get(c.chunkId);
    let changed = 0; let maxDelta = 0; let sumDelta = 0; let changedOutsideBand = 0;
    for (let k = 0; k < H.length; k += 1) {
      const delta = Math.abs(H[k] - c.height[k]);
      if (delta > 1e-6) { changed += 1; sumDelta += delta; if (zone[k] !== 2) changedOutsideBand += 1; }
      maxDelta = Math.max(maxDelta, delta);
    }
    const m = macro.get(c.chunkId);
    out.set(c.chunkId, { height: H, ...water.get(c.chunkId), band: Uint8Array.from(zone, z => (z === 2 ? 1 : 0)), zone, steep: steepMasks.get(c.chunkId), changedCells: changed, changedOutsideBand, maxDelta, meanDeltaChanged: changed ? sumDelta / changed : 0, macro: { base: r2(m.b), relief: r2(m.R), rampDistance: m.D } });
  }
  return {
    mode: 'macroRamp', rules, transitionWidth: W, worldSeed, iterations: 1, chunks: out, exchanges,
    edges: edges.map(e => {
      const f = blame.get(e.id);
      const status = f.cells ? 'unresolved' : 'resolved';
      let suggestion = null;
      if (f.cells) {
        const needed = Math.ceil((W * tan(Math.min(89, f.maxSlope)) / tan(rules.maxTransitionSlopeDeg)) / TRANSITION.step) * TRANSITION.step;
        suggestion = f.band >= f.ramp
          ? `mostly inside the ${W} m band: transition width ≈ ${needed > TRANSITION.max ? `${needed} m (> ${TRANSITION.max} m slider max)` : `${needed} m`} by explicit choice, or a smaller relief contrast between ${e.a} and ${e.b} (landform pair), or a dedicated escarpment rule`
          : `mostly in the landform ramp (outside the band): a longer ramp distance for the rougher landform, a smaller relief contrast (landform pair), or a dedicated escarpment rule`;
      }
      return {
        id: e.id, a: e.a, b: e.b, sideA: e.sideA, sideB: e.sideB, status, continuity: 'C1 (height + slope)', slopeNote: null,
        rawMaxStep: r2(e.rawMaxStep), madeSteepCells: f.cells, steepInBand: f.band, steepInRamp: f.ramp, maxCreatedSlope: r2(f.maxSlope), bandMaxSlope: r2(f.bandMaxSlope),
        edgeBase: { mid: r2(e.mid.b), corners: [r2(e.c0.b), r2(e.c1.b)] }, edgeRelief: r2(e.mid.R),
        reason: f.cells ? `coordination leaves ${f.cells} cells steeper than ${rules.maxTransitionSlopeDeg}° (max ${f.maxSlope.toFixed(1)}°; ${f.band} in the band, ${f.ramp} in the ramp); raw step ${e.rawMaxStep.toFixed(1)} m. Terrain stays continuous; edge not usable for roads. Feasible: ${suggestion}` : null,
        suggestion,
      };
    }),
    corners: [...corners.values()].filter(k => k.members.length === 4).map(k => ({
      at: { x: k.x, z: k.z }, chunks: k.members.map(mm => mm.chunkId).sort(), base: r2(k.b), surface: r2(k.s), relief: r2(k.R),
      rawSpread: r2(Math.max(...k.members.map(mm => mm.height)) - Math.min(...k.members.map(mm => mm.height))), closed: true, groups: 1,
    })),
    macro: Object.fromEntries([...macro.values()].map(m => [m.chunkId, { base: r2(m.b), relief: r2(m.R), rampDistance: m.D }])),
  };
}
