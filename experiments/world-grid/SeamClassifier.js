// 06.3c seam classification (pure data). Separates four questions per shared edge instead of one resolved / unresolved:
//   geometryStatus  — is the surface one continuous, valid heightfield across the edge? (heights, corners, finiteness)
//   landformStatus  — what kind of seam is it? smooth transition · valid escarpment · escarpment candidate · unresolved
//   hydrologyStatus — how do the water bodies meet? none · continuous · shoreline · coastal escarpment · river ends at
//                     the edge · incompatible levels · core water lost
//   transportStatus — can a vehicle road cross at all? (terrain only; road topology is not changed here)
// A steep seam is a valid escarpment only when the geometry is continuous, the landform pair can carry a scarp, the
// heightfield can represent it (slope ≤ the 4 m grid limit) and the join creates no pit or ridge outside both sides'
// heights; otherwise it stays a candidate (or unresolved when nothing justifies a scarp). The legacy `status` of the
// terrain report (resolved = smooth join used by the 06.3b road seam) is not changed.
export const SEAM_CLASS_RULES = Object.freeze({
  smoothKinkTargetDeg: 2, // measured one-sided 4 m slope kink allowed on a smooth seam (test target, reported per edge)
  escarpmentMaxSlopeDeg: 75, // steepest face a 4 m heightfield represents as a scarp (one cell rises ≥ 15 m); steeper needs a cliff mesh
  escarpmentLandforms: Object.freeze(['mountain', 'riverValley', 'coast']), // at least one side must be one of these
  overshootTolerance: 1, // m; a join may not create a pit / ridge beyond both sides' heights by more than this
  roadMaxSlopeDeg: 20, // steepest road limit of any City DNA (organic lanes)
  minCrossingRunM: 40, // a crossable stretch at least this long along the edge (≈ one street with its verges)
});

export const SEAM_CLASS_COLOR = { smooth: 0x3fd17a, smoothKink: 0xb8e05a, escarpment: 0x4fb3ff, candidate: 0xff9a3c, failed: 0xff3b3b };

const lineIndex = (side, along, depth, segments, columns) => (side === 'minX' ? along * columns + depth
  : side === 'maxX' ? along * columns + (segments - depth)
    : side === 'minZ' ? depth * columns + along : (segments - depth) * columns + along);
const r2 = v => +v.toFixed(2);

// Straight transects through both bands: dry, ≤ maxSlope, no height step at the edge. Share of positions + longest run.
export function transectFeasibility(pair, A, B, W, maxSlope = SEAM_CLASS_RULES.roadMaxSlopeDeg) {
  const { segments, columns, spacing } = A.grid;
  let ok = 0; let run = 0; let best = 0;
  for (let i = 0; i <= segments; i += 1) {
    let good = Math.abs(A.height[lineIndex(pair.sideA, i, 0, segments, columns)] - B.height[lineIndex(pair.sideB, i, 0, segments, columns)]) <= 0.5;
    for (let depth = 0; good && depth * spacing < W; depth += 1) {
      for (const [f, side] of [[A, pair.sideA], [B, pair.sideB]]) { const k = lineIndex(side, i, depth, segments, columns); if (f.waterMask[k] || f.slope[k] > maxSlope) good = false; }
    }
    if (good) { ok += 1; run += 1; best = Math.max(best, run); } else run = 0;
  }
  return { pairId: pair.id, share: +(ok / (segments + 1)).toFixed(3), longestRunM: best * spacing };
}

// pairs: SeamCheck pairs; corners: SeamCheck corners; terrainEdges: terrain report edges (or null in raw mode);
// chunks: Map chunkId → { fields, landform, base (world base heights or null), coreWaterLost (or 0) }.
export function classifySeams({ pairs, corners, terrainEdges, chunks, transitionWidth, rules = SEAM_CLASS_RULES }) {
  const W = transitionWidth;
  return pairs.map(pair => {
    const A = chunks.get(pair.a); const B = chunks.get(pair.b);
    const { segments, columns, spacing, size, originX, originZ } = A.fields.grid;
    const terrain = terrainEdges?.find(e => e.id === pair.id) ?? null;
    const landforms = [A.landform, B.landform];

    // ---------- geometry ----------
    const endCorners = corners.filter(c => c.chunks.includes(pair.a) && c.chunks.includes(pair.b));
    const cornerSpread = Math.max(0, ...endCorners.map(c => c.heightSpread));
    let finite = true;
    for (const f of [A.fields, B.fields]) for (let k = 0; k < f.height.length && finite; k += 1) if (!Number.isFinite(f.height[k])) finite = false;
    const geometryOk = finite && pair.height.max === 0 && pair.positionError === 0 && cornerSpread === 0;
    const geometry = { maxStep: pair.height.max, cornerSpread, finite, maxBandSlope: pair.slope.bandMaxSlopeDeg, kinkMax: pair.slope.kinkMaxDeg, kinkP95: pair.slope.kinkP95Deg, kinkMedian: pair.slope.kinkMedianDeg };
    const geometryStatus = !finite ? 'invalid' : geometryOk ? 'continuous' : 'discontinuous';

    // ---------- landform ----------
    const steepCells = terrain?.madeSteepCells ?? 0;
    const maxSteep = terrain?.maxCreatedSlope ?? 0;
    const runs = terrain?.escarpmentCandidates ?? null;
    let landformStatus; let checks = null; let landformReason = null;
    // Pit / ridge check along the steep runs: coordinated heights across both bands stay within both sides' base range.
    let overshoot = null; let overshootAt = null;
    // Base height range over the W × W corner squares of every chunk meeting at an interior corner of this edge.
    const cornerRange = end => {
      const along = (pair.sideA.endsWith('X') ? originZ : originX) - size / 2 + end * spacing;
      const line = pair.sideA === 'maxX' ? originX + size / 2 : originZ + size / 2;
      const at = pair.sideA.endsWith('X') ? { x: line, z: along } : { x: along, z: line };
      const k = corners.find(cc => cc.at.x === at.x && cc.at.z === at.z);
      if (!k) return null;
      let lo = Infinity; let hi = -Infinity;
      for (const id of k.chunks) {
        const ch = chunks.get(id); const g = ch.fields.grid; const base = ch.base ?? ch.fields.height; const n = Math.ceil(W / spacing);
        const c0 = at.x < g.originX ? 0 : segments - n; const r0 = at.z < g.originZ ? 0 : segments - n;
        for (let r = r0; r <= r0 + n; r += 1) for (let q = c0; q <= c0 + n; q += 1) { const v = base[r * columns + q]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
      return { lo, hi };
    };
    if (runs) {
      overshoot = 0;
      const startAlong = pair.sideA.endsWith('X') ? originZ - size / 2 : originX - size / 2;
      for (const run of runs) {
        const t0 = pair.sideA.endsWith('X') ? run.from.z : run.from.x; const t1 = pair.sideA.endsWith('X') ? run.to.z : run.to.x;
        for (let i = Math.round((t0 - startAlong) / spacing); i <= Math.round((t1 - startAlong) / spacing); i += 1) {
          // In a corner square the shared 4-chunk corner surface governs: the range then spans all four chunks' corner squares.
          const corner = Math.min(i, segments - i) * spacing < W ? cornerRange(i < segments / 2 ? 0 : segments) : null;
          let lo = corner ? corner.lo : Infinity; let hi = corner ? corner.hi : -Infinity; const hs = [];
          for (const [c, side] of [[A, pair.sideA], [B, pair.sideB]]) {
            const base = c.base ?? c.fields.height;
            for (let depth = 0; depth * spacing <= W; depth += 1) {
              const k = lineIndex(side, i, depth, segments, columns);
              lo = Math.min(lo, base[k]); hi = Math.max(hi, base[k]); hs.push(c.fields.height[k]);
            }
          }
          for (const h of hs) { const o = Math.max(h - hi, lo - h); if (o > overshoot) { overshoot = o; overshootAt = { along: i, alongM: i * spacing, fromCornerM: Math.min(i, segments - i) * spacing }; } }
        }
      }
      overshoot = r2(overshoot);
    }
    if (geometryStatus !== 'continuous') {
      landformStatus = 'unresolved';
      landformReason = geometryStatus === 'invalid' ? 'heightfield has non-finite values' : `surface not continuous across the edge (step ${pair.height.max} m, corner spread ${cornerSpread} m)`;
    } else if (!steepCells) {
      landformStatus = 'smooth';
    } else {
      checks = {
        naturalPair: landforms.some(l => rules.escarpmentLandforms.includes(l)),
        representable: maxSteep <= rules.escarpmentMaxSlopeDeg,
        noOvershoot: overshoot !== null && overshoot <= rules.overshootTolerance,
        runsReported: Boolean(runs?.length),
      };
      if (!checks.naturalPair) {
        landformStatus = 'unresolved';
        landformReason = `${steepCells} cells steeper than the transition limit between ${landforms.join(' and ')}: no landform reason for a scarp here`;
      } else if (Object.values(checks).every(Boolean)) {
        landformStatus = 'escarpment';
        landformReason = `continuous scarp in the ${W} m band (max ${maxSteep}°, ${runs.length} run(s)); heightfield represents it`;
      } else {
        landformStatus = 'escarpmentCandidate';
        const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
        landformReason = `scarp not valid yet: ${failed.map(k => ({ representable: `max slope ${maxSteep}° > ${rules.escarpmentMaxSlopeDeg}° (needs a cliff mesh, not a heightfield)`, noOvershoot: overshoot === null ? 'pit / ridge not checked (no run data in this terrain mode)' : `join overshoots both sides by ${overshoot} m`, runsReported: 'no escarpment runs reported' }[k] ?? k)).join('; ')}`;
      }
    }
    const kinkWithinTarget = pair.slope.kinkMaxDeg <= rules.smoothKinkTargetDeg;

    // ---------- hydrology ----------
    const wi = pair.waterInterface;
    const seaHeld = terrain?.seaHeldSamples ?? 0;
    const coreWaterLost = (A.coreWaterLost ?? 0) + (B.coreWaterLost ?? 0);
    const oneSidedReasons = Object.keys(wi.reasons ?? {});
    const riverOneSided = oneSidedReasons.some(r => r.includes('river'));
    let hydrologyStatus;
    if (coreWaterLost) hydrologyStatus = 'coreWaterLost';
    else if (wi.levelSteps) hydrologyStatus = 'incompatibleLevels';
    else if (seaHeld) hydrologyStatus = steepCells && runs?.some(r => r.waterConflict) ? 'coastalEscarpment' : 'shoreline';
    else if (wi.status === 'no water') hydrologyStatus = 'none';
    else if (wi.status === 'continuous') hydrologyStatus = landforms.every(l => l === 'riverValley') ? 'riverValleyContinues' : 'continuousWater';
    else if (riverOneSided && !oneSidedReasons.some(r => r.includes('terrain step'))) hydrologyStatus = 'riverEndsAtEdge';
    else hydrologyStatus = 'discontinuous';
    const hydrology = { status: wi.status, oneSided: wi.oneSided, levelSteps: wi.levelSteps, reasons: wi.reasons, seaHeldSamples: seaHeld, bandWaterLossCells: terrain?.waterLossCells ?? null, coreWaterLost };

    // ---------- transport (terrain only) ----------
    const t = transectFeasibility(pair, A.fields, B.fields, W);
    const transportStatus = geometryStatus === 'continuous' && t.longestRunM >= rules.minCrossingRunM ? 'passable' : 'impassable';
    const transport = { crossableShare: t.share, longestRunM: t.longestRunM, roadJoinsAllowed: terrain?.status === 'resolved', note: 'the 06.3b road seam joins only smooth (resolved) edges; a passable stretch on a scarp edge is reported, not used' };

    // ---------- overall class ----------
    const failed = geometryStatus !== 'continuous' || landformStatus === 'unresolved' || hydrologyStatus === 'incompatibleLevels' || hydrologyStatus === 'coreWaterLost';
    const overall = failed ? 'failed' : landformStatus === 'escarpmentCandidate' ? 'candidate' : landformStatus === 'escarpment' ? 'escarpment' : kinkWithinTarget ? 'smooth' : 'smoothKink';
    return {
      id: pair.id, a: pair.a, b: pair.b, landforms, overall, color: SEAM_CLASS_COLOR[overall],
      geometryStatus, geometry, landformStatus, landform: { steepCells, maxSlope: maxSteep, runs: runs?.length ?? null, overshoot, overshootAt, checks, reason: landformReason, kinkWithinTarget },
      hydrologyStatus, hydrology, transportStatus, transport,
      legacyStatus: terrain?.status ?? 'raw',
    };
  });
}
