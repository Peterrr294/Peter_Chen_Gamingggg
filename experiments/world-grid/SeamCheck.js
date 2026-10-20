// 06.2 boundary preparation: compare the shared edges of adjacent chunks in world coordinates.
// Detection only — nothing is flattened, blended, or hidden. Inputs are the existing per-chunk
// boundary interfaces: fields.boundarySamples (outer / inner lines, transitionWidth) and
// NetworkGraph.edgePorts.

export const SEAM_RULES = Object.freeze({
  heightTolerance: 0.5, // m; |Δh| above this on a shared sample is a height discontinuity
  portTolerance: 16, // m along the edge; ports closer than this on both sides are paired
  portElevationTolerance: 2, // m
  waterLevelTolerance: 1, // m; both sides wet with levels further apart = level step
});

// 06.3a: inward index of an edge line (depth 0 = edge) and water-type names from TerrainHarmonizer.
const lineIndex = (side, along, depth, segments, columns) => (side === 'minX' ? along * columns + depth
  : side === 'maxX' ? along * columns + (segments - depth)
    : side === 'minZ' ? depth * columns + along : (segments - depth) * columns + along);
const WATER_NAME = ['dry', 'sea', 'river'];

const percentile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0);

// World coordinates of sample i on one outer edge line (lines run in increasing world x or z).
function edgePoint(grid, edge, i) {
  const half = grid.size / 2;
  const along = (edge.endsWith('X') ? grid.originZ : grid.originX) - half + i * grid.spacing;
  const fixed = { minX: grid.originX - half, maxX: grid.originX + half, minZ: grid.originZ - half, maxZ: grid.originZ + half }[edge];
  return edge.endsWith('X') ? { x: fixed, z: along } : { x: along, z: fixed };
}

function comparePorts(a, b, sideA, sideB) {
  if (!a || !b) return { status: 'n/a (empty slot on one side)', a: a ? a.filter(p => p.side === sideA).length : null, b: b ? b.filter(p => p.side === sideB).length : null, matched: [], unmatchedA: [], unmatchedB: [] };
  const portsA = a.filter(p => p.side === sideA);
  const portsB = b.filter(p => p.side === sideB);
  const usedB = new Set();
  const matched = [];
  const unmatchedA = [];
  for (const p of [...portsA].sort((x, y) => x.position - y.position)) {
    const best = portsB.filter(q => !usedB.has(q.id) && q.type === p.type)
      .map(q => ({ q, d: Math.abs(q.position - p.position) })).filter(item => item.d <= SEAM_RULES.portTolerance)
      .sort((x, y) => x.d - y.d)[0];
    if (best) {
      usedB.add(best.q.id);
      matched.push({ a: p.id, b: best.q.id, type: p.type, positionA: +p.position.toFixed(1), positionB: +best.q.position.toFixed(1), offset: +best.d.toFixed(2), elevationDiff: +Math.abs(p.elevation - best.q.elevation).toFixed(2), elevationOk: Math.abs(p.elevation - best.q.elevation) <= SEAM_RULES.portElevationTolerance });
    } else unmatchedA.push({ id: p.id, type: p.type, position: +p.position.toFixed(1), elevation: +p.elevation.toFixed(2) });
  }
  const unmatchedB = portsB.filter(q => !usedB.has(q.id)).map(q => ({ id: q.id, type: q.type, position: +q.position.toFixed(1), elevation: +q.elevation.toFixed(2) }));
  const status = !portsA.length && !portsB.length ? 'no ports' : !unmatchedA.length && !unmatchedB.length && matched.every(m => m.elevationOk) ? 'all paired' : 'unpaired ports';
  return { status, a: portsA.length, b: portsB.length, matched, unmatchedA, unmatchedB };
}

// chunks: [{ slot, fields, network | null, waterType? (Uint8Array, harmonised) }]; harmony: TerrainHarmonizer report or null.
export function checkSeams(chunks, harmony = null) {
  const at = new Map(chunks.map(chunk => [`${chunk.slot.gridX},${chunk.slot.gridY}`, chunk]));
  const pairs = [];
  for (const A of chunks) {
    for (const [dx, dy, sideA, sideB] of [[1, 0, 'maxX', 'minX'], [0, 1, 'maxZ', 'minZ']]) {
      const B = at.get(`${A.slot.gridX + dx},${A.slot.gridY + dy}`);
      if (!B) continue;
      const la = A.fields.boundarySamples.edges[sideA].outer;
      const lb = B.fields.boundarySamples.edges[sideB].outer;
      let positionError = 0;
      let orderOk = la.heights.length === lb.heights.length;
      const diffs = [];
      const water = { both: 0, onlyA: 0, onlyB: 0, runsA: A.fields.boundarySamples.edges[sideA].waterRuns, runsB: B.fields.boundarySamples.edges[sideB].waterRuns };
      const samples = [];
      for (let i = 0; i < Math.min(la.heights.length, lb.heights.length); i += 1) {
        const pa = edgePoint(A.fields.grid, sideA, i);
        const pb = edgePoint(B.fields.grid, sideB, i);
        positionError = Math.max(positionError, Math.hypot(pa.x - pb.x, pa.z - pb.z));
        if (i > 0) { const prev = edgePoint(A.fields.grid, sideA, i - 1); if ((sideA === 'maxX' ? pa.z <= prev.z : pa.x <= prev.x)) orderOk = false; }
        const d = la.heights[i] - lb.heights[i];
        diffs.push(Math.abs(d));
        if (la.water[i] && lb.water[i]) water.both += 1; else if (la.water[i]) water.onlyA += 1; else if (lb.water[i]) water.onlyB += 1;
        samples.push({ x: pa.x, z: pa.z, ha: la.heights[i], hb: lb.heights[i], wa: la.water[i], wb: lb.water[i] });
      }
      const sorted = [...diffs].sort((x, y) => x - y);
      const ports = comparePorts(A.network?.edgePorts ?? null, B.network?.edgePorts ?? null, sideA, sideB);
      const height = {
        max: +sorted[sorted.length - 1].toFixed(2), mean: +(diffs.reduce((s, v) => s + v, 0) / diffs.length).toFixed(2), p95: +percentile(sorted, 0.95).toFixed(2),
        overTolerance: diffs.filter(v => v > SEAM_RULES.heightTolerance).length,
      };
      // 06.3a slope continuity across the edge: angle between the outward slope of A and the inward slope of B.
      const { segments, columns, spacing } = A.fields.grid;
      const kinks = [];
      for (let i = 0; i <= segments; i += 1) {
        const gA = (A.fields.height[lineIndex(sideA, i, 0, segments, columns)] - A.fields.height[lineIndex(sideA, i, 1, segments, columns)]) / spacing;
        const gB = (B.fields.height[lineIndex(sideB, i, 1, segments, columns)] - B.fields.height[lineIndex(sideB, i, 0, segments, columns)]) / spacing;
        kinks.push(Math.abs(Math.atan(gA) - Math.atan(gB)) * 180 / Math.PI);
      }
      const ks = [...kinks].sort((x, y) => x - y);
      // Steepest terrain inside both transition bands of this edge (all depths < transitionWidth).
      const W = A.fields.boundarySamples.transitionWidth;
      let bandMaxSlope = 0;
      for (const [chunk, side] of [[A, sideA], [B, sideB]]) {
        for (let depth = 0; depth * spacing < W; depth += 1) for (let i = 0; i <= segments; i += 1) bandMaxSlope = Math.max(bandMaxSlope, chunk.fields.slope[lineIndex(side, i, depth, segments, columns)]);
      }
      // Water interface per sample: mismatches are classified, never hidden.
      const reasons = {};
      let levelSteps = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sa = samples[i];
        const kA = lineIndex(sideA, i, 0, segments, columns); const kB = lineIndex(sideB, i, 0, segments, columns);
        if (sa.wa && sa.wb) {
          if (Math.abs(A.fields.waterSurface[kA] - B.fields.waterSurface[kB]) > SEAM_RULES.waterLevelTolerance) { levelSteps += 1; reasons['level step between the two water bodies'] = (reasons['level step between the two water bodies'] ?? 0) + 1; }
          continue;
        }
        if (sa.wa === sa.wb) continue;
        const wetSide = sa.wa ? A : B; const kWet = sa.wa ? kA : kB; const dry = sa.wa ? B : A; const kDry = sa.wa ? kB : kA;
        const type = WATER_NAME[wetSide.waterType?.[kWet] ?? 0] ?? 'unknown';
        let reason;
        const other = Number.isFinite(dry.fields.waterSurface[kDry]) ? `${dry.slot.landform === 'riverValley' ? 'river' : dry.slot.landform === 'coast' ? 'sea' : 'water'} level ${dry.fields.waterSurface[kDry].toFixed(0)} m` : 'no water body';
        if (Math.abs(sa.ha - sa.hb) > SEAM_RULES.heightTolerance) reason = `terrain step (edge unresolved): ${type} ${wetSide.fields.waterSurface[kWet].toFixed(0)} m | ${dry.slot.landform}, ${other}`;
        else if (type === 'river') reason = 'river reaches the edge; neighbour has no channel (not extended)';
        else if (type === 'sea' && Number.isFinite(dry.fields.waterSurface[kDry]) && Math.abs(dry.fields.waterSurface[kDry] - wetSide.fields.waterSurface[kWet]) > SEAM_RULES.waterLevelTolerance) reason = `water levels incompatible (${wetSide.fields.waterSurface[kWet].toFixed(1)} m sea vs ${dry.fields.waterSurface[kDry].toFixed(1)} m)`;
        else reason = `${type} water on one side only`;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      const harmonyEdge = harmony?.edges.find(e => e.id === `${A.slot.chunkId}|${B.slot.chunkId}`) ?? null;
      pairs.push({
        id: `${A.slot.chunkId}|${B.slot.chunkId}`, a: A.slot.chunkId, b: B.slot.chunkId, sideA, sideB, axis: sideA.endsWith('X') ? 'z' : 'x',
        samples: diffs.length, positionError, sampleOrder: orderOk ? 'aligned (both increasing world ' + (sideA.endsWith('X') ? 'z' : 'x') + ')' : 'MISALIGNED',
        transitionWidth: { a: A.fields.boundarySamples.transitionWidth, b: B.fields.boundarySamples.transitionWidth },
        height, water, ports,
        flags: {
          heightDiscontinuity: height.overTolerance > 0,
          waterInterfaceMismatch: water.onlyA + water.onlyB > 0,
          portMismatch: ports.status === 'unpaired ports',
        },
        slope: { kinkMaxDeg: +ks[ks.length - 1].toFixed(2), kinkP95Deg: +ks[Math.floor(0.95 * (ks.length - 1))].toFixed(2), kinkMedianDeg: +ks[Math.floor(0.5 * (ks.length - 1))].toFixed(3), bandMaxSlopeDeg: +bandMaxSlope.toFixed(1) },
        waterInterface: {
          status: water.both + water.onlyA + water.onlyB === 0 ? 'no water' : water.onlyA + water.onlyB === 0 && !levelSteps ? 'continuous' : 'discontinuous',
          oneSided: water.onlyA + water.onlyB, levelSteps, reasons,
        },
        harmony: harmonyEdge ? { status: harmonyEdge.status, continuity: harmonyEdge.continuity, rawMaxStep: harmonyEdge.rawMaxStep, reason: harmonyEdge.reason, slopeNote: harmonyEdge.slopeNote } : null,
        profile: samples,
      });
    }
  }
  // Interior corners where four chunks meet: spread of the four corner heights.
  const corners = [];
  for (const A of chunks) {
    const right = at.get(`${A.slot.gridX + 1},${A.slot.gridY}`);
    const down = at.get(`${A.slot.gridX},${A.slot.gridY + 1}`);
    const diag = at.get(`${A.slot.gridX + 1},${A.slot.gridY + 1}`);
    if (!right || !down || !diag) continue;
    const pick = (chunk, names) => chunk.fields.boundarySamples.corners.find(c => c.edges.join() === names.join());
    const four = [pick(A, ['maxZ', 'maxX']), pick(right, ['maxZ', 'minX']), pick(down, ['minZ', 'maxX']), pick(diag, ['minZ', 'minX'])];
    const xs = four.map(c => c.x); const zs = four.map(c => c.z); const hs = four.map(c => c.height);
    corners.push({
      at: { x: xs[0], z: zs[0] }, chunks: [A, right, down, diag].map(c => c.slot.chunkId),
      positionSpread: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
      heightSpread: +(Math.max(...hs) - Math.min(...hs)).toFixed(2), heights: hs,
    });
  }
  return { rules: SEAM_RULES, pairs, corners };
}
