import { CITY_DNA, MATCH_SETTINGS } from './cityMatchRules.js';

// Pure, deterministic terrain → City DNA matcher. Input: terrainAnalysis (02.5).
// Output: cityMatch. It never reads or changes terrain fields, and emits
// constraints and hints only, no geometry. All rules live in cityMatchRules.js.

const finite = value => typeof value === 'number' && Number.isFinite(value);
const ramp = (value, [from, to]) => Math.min(1, Math.max(0, (value - from) / (to - from)));

// Land bodies from the water-region label grid (land = label 0), 4-neighbour.
function landBodies(analysis) {
  const labels = analysis.waterRegions?.labels;
  const grid = analysis.grid;
  if (!labels || !grid) return null;
  const { segments, columns, spacing } = grid;
  const minArea = analysis.thresholds?.minRegionArea ?? 0;
  const seen = new Uint8Array(labels.length);
  const bodies = [];
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] || seen[start]) continue;
    let area = 0;
    let touchesEdge = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop();
      const row = Math.floor(index / columns);
      const col = index % columns;
      area += (row === 0 || row === segments ? 0.5 : 1) * (col === 0 || col === segments ? 0.5 : 1) * spacing * spacing;
      if (row === 0 || col === 0 || row === segments || col === segments) touchesEdge = true;
      for (const next of [row > 0 && index - columns, row < segments && index + columns, col > 0 && index - 1, col < segments && index + 1]) {
        if (next !== false && !labels[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    bodies.push({ area, touchesEdge });
  }
  const significant = bodies.filter(body => body.area >= minArea);
  return { count: bodies.length, significant: significant.length, islands: significant.filter(body => !body.touchesEdge).length };
}

export function computeMatchMetrics(analysis) {
  const coverage = analysis?.waterCoverage;
  const suitability = analysis?.suitability?.area;
  const landArea = coverage?.landArea;
  const land = landBodies(analysis);
  const waterFraction = coverage?.fraction;
  const largestWater = analysis?.waterRegions?.regions?.[0];
  return {
    largestBuildableShare: analysis?.buildableRegions?.largestShareOfChunk ?? null,
    buildableFraction: coverage?.buildableFraction ?? null,
    waterFraction: waterFraction ?? null,
    highSuitabilityShareOfLand: suitability && landArea > 0 ? suitability[3] / landArea : null,
    mixedSlopeShareOfLand: suitability && landArea > 0 ? (suitability[1] + suitability[2]) / landArea : null,
    landBodies: land,
    waterEdgeRole: !finite(waterFraction) || !land ? null : waterFraction === 0 ? 'none' : land.significant >= 2 ? 'splitsLand' : 'boundaryOnly',
    landDivision: !land ? null : land.islands > 0 ? 'islands' : land.significant >= 2 ? 'split' : 'single',
    largestWaterEnclosed: !finite(waterFraction) ? null : !largestWater ? 'none' : largestWater.touchesEdges.length === 0 ? 'enclosed' : 'open',
  };
}

const describeValue = value => (finite(value) ? Number(value.toFixed(3)) : value);

function evaluateCandidate(id, metrics) {
  const dna = CITY_DNA[id];
  let totalWeight = 0;
  let scoredWeight = 0;
  let verifiedWeight = 0;
  let weighted = 0;
  const conditions = dna.conditions.map(condition => {
    totalWeight += condition.weight;
    const base = { id: condition.id, description: condition.description, evidence: condition.evidence, weight: condition.weight, metric: condition.metric, rationale: condition.rationale };
    if (condition.evidence === 'TBD' || !condition.metric) return { ...base, status: 'tbd' };
    const value = metrics[condition.metric];
    let score = null;
    if (condition.ramp && finite(value)) score = ramp(value, condition.ramp);
    if (condition.lookup && typeof value === 'string' && value in condition.lookup) score = condition.lookup[value];
    if (score === null) return { ...base, status: 'missing', value: value ?? null };
    scoredWeight += condition.weight;
    if (condition.evidence.startsWith('V')) verifiedWeight += condition.weight;
    weighted += condition.weight * score;
    return { ...base, status: 'scored', value: describeValue(value), threshold: condition.ramp ?? condition.lookup, score: Number(score.toFixed(4)) };
  });
  const conflicts = dna.conflicts.map(conflict => {
    const value = metrics[conflict.metric];
    return { ...conflict, value: describeValue(value), triggered: finite(value) && value < conflict.below };
  });
  let fitScore = scoredWeight > 0 ? weighted / scoredWeight : 0;
  for (const conflict of conflicts) if (conflict.triggered) fitScore = Math.min(fitScore, conflict.cap);
  const coverage = totalWeight ? scoredWeight / totalWeight : 0;
  const score = fitScore * coverage;
  const verifiedShare = scoredWeight ? verifiedWeight / scoredWeight : 0;
  const { confidence: rule } = MATCH_SETTINGS;
  const confidence = coverage >= rule.mediumMinCoverage && verifiedShare >= rule.mediumMinVerifiedShare ? 'medium' : 'low';

  // Three most decisive judgements: triggered conflicts first, then the
  // scored conditions that pull furthest from neutral, weighted.
  const reasons = [
    ...conflicts.filter(conflict => conflict.triggered).map(conflict => ({ text: `conflict ${conflict.id}: ${conflict.metric}=${conflict.value} < ${conflict.below} → cap ${conflict.cap}`, impact: Infinity })),
    ...conditions.filter(condition => condition.status === 'scored').map(condition => ({
      text: `${condition.id}: ${condition.metric}=${condition.value} → ${condition.score.toFixed(2)} (w${condition.weight}, ${condition.evidence})`,
      impact: condition.weight * Math.abs(condition.score - 0.5),
    })),
  ].sort((a, b) => b.impact - a.impact).slice(0, 3).map(reason => reason.text);

  return {
    id,
    label: dna.label,
    family: dna.family,
    score: Number(score.toFixed(4)), // rankScore = fitScore × evidenceCoverage
    fitScore: Number(fitScore.toFixed(4)),
    evidenceCoverage: Number(coverage.toFixed(4)),
    verifiedShare: Number(verifiedShare.toFixed(4)),
    confidence,
    confidenceNote: `Terrain-fit evidence only; ${conditions.filter(condition => condition.status === 'tbd').length} TBD condition(s) unscored. ${rule.note}`,
    weakFit: score < MATCH_SETTINGS.weakFitBelow,
    conditions,
    conflicts,
    topReasons: reasons,
  };
}

function orientationHint(direction) {
  const selected = direction?.selected;
  if (!selected || selected.axisDeg === undefined) return { axisDeg: null, source: 'unknown (no direction with passing evidence)' };
  return { axisDeg: selected.axisDeg, source: `terrainAnalysis.dominantDirection.${direction.primary} (value ${selected.value} ≥ ${selected.threshold})` };
}

export function matchCity(analysis, options = {}) {
  const metrics = computeMatchMetrics(analysis);
  const candidates = MATCH_SETTINGS.order.map(id => evaluateCandidate(id, metrics));
  const ranked = [...candidates].sort((a, b) => b.score - a.score || MATCH_SETTINGS.order.indexOf(a.id) - MATCH_SETTINGS.order.indexOf(b.id));
  ranked.forEach((candidate, index) => { candidate.rank = index + 1; });
  const auto = ranked[0];
  const manual = options.override && CITY_DNA[options.override] ? options.override : null;
  const chosen = ranked.find(candidate => candidate.id === (manual ?? auto.id));
  const dna = CITY_DNA[chosen.id];
  const direction = analysis?.dominantDirection;
  const connections = analysis?.boundaryConnections?.edges ?? {};

  const unresolvedEvidence = [
    ...ranked.flatMap(candidate => candidate.conditions
      .filter(condition => condition.status !== 'scored')
      .map(condition => ({ dna: candidate.id, condition: condition.id, status: condition.status, reason: condition.rationale }))),
    { dna: '*', condition: 'researchRows', status: 'tbd', reason: 'city-research-template.csv rows for Venice, Manhattan, Fez are still "待研究" and Chicago, Amsterdam, Lisbon have no row; every numeric threshold is a design assumption (A).' },
    { dna: '*', condition: 'twoSources', status: 'tbd', reason: '00.3 §8: prototypes have one source anchor each; the two-source rule is not met.' },
  ];
  if (auto.weakFit) {
    unresolvedEvidence.push({ dna: auto.id, condition: 'weakFit', status: 'weak', reason: `Best rankScore ${auto.score} < ${MATCH_SETTINGS.weakFitBelow}: no implemented DNA fits this terrain well (F6 is approximated only by lisbonHillCore on the organic strategy).` });
  }

  return {
    version: '02.6',
    source: { ...analysis?.source, analysisSignature: analysis?.signature ?? null },
    metrics,
    rankedCandidates: ranked,
    selectedDNA: {
      id: chosen.id,
      label: chosen.label,
      family: chosen.family,
      prototype: dna.prototype,
      mode: manual ? 'manual' : 'auto',
      autoTopId: auto.id,
      score: chosen.score,
      fitScore: chosen.fitScore,
      evidenceCoverage: chosen.evidenceCoverage,
      rank: chosen.rank,
      confidence: chosen.confidence,
      weakFit: chosen.weakFit,
      identityRules: dna.identityRules,
      identityNote: 'Score measures terrain fit only. City identity comes from the network, parcel, and building rules above, not from terrain.',
    },
    terrainConstraints: {
      buildableRegionIds: (analysis?.buildableRegions?.regions ?? []).filter(region => region.area >= (analysis?.thresholds?.minRegionArea ?? 0)).map(region => region.id),
      buildableFraction: metrics.buildableFraction,
      maxBuildableSlopeDeg: analysis?.thresholds?.suitability?.mediumMaxSlope ?? null,
      suitabilityClasses: analysis?.suitability?.classes ?? null,
      waterRegionIds: (analysis?.waterRegions?.regions ?? []).map(region => region.id),
      waterRole: metrics.waterEdgeRole,
      landDivision: metrics.landDivision,
      dominantDirection: direction?.primary ?? 'unknown',
      reservedTransitionWidth: analysis?.source?.transitionWidth ?? null,
      edges: Object.fromEntries(Object.entries(connections).map(([edge, value]) => [edge, { waterLength: value.waterLength, buildableLength: value.buildableLength }])),
      units: analysis?.units ?? null,
    },
    networkHints: { ...dna.hints.network, orientation: orientationHint(direction) },
    parcelHints: { ...dna.hints.parcel },
    buildingHints: { ...dna.hints.building },
    unresolvedEvidence,
  };
}
