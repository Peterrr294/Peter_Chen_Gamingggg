// A City of Cities — G02 Growth Suitability Evaluation (pure data).
// Four groups of 0–1 terms, each computed from real data; a term that the current system cannot compute is marked
// 'unavailable' and replaced by a stated fallback, never estimated silently.
//   terrain        slope (mean land slope + low-slope share, or a moderate-slope band for hill cities), buildable
//                  share, terrain-type compatibility (Growth DNA landform table); max / P95 slope recorded
//   water          coverage + distance from the cell centre to water in the cell (fallback: wet neighbour landforms),
//                  read by the city water mode; flood risk: unavailable
//   infrastructure ports (road / canal) the parent chunks open toward the cell, main-road ports, buildable share of
//                  the cell's joining edge (potential connection); accessibility = mean of ports and joining edge
//   urban          02.6 DNA fit, Growth DNA direction preference, compactness against the current territory shape
import { CITY_GROWTH } from '../growing-world/growthConfig.js';
import { GROWTH_DNA, GROWTH_RULES } from './growthDNA.js';
import { unit } from '../growing-world/growthConfig.js';

const clamp01 = v => Math.min(1, Math.max(0, v));
const r3 = v => +Number(v).toFixed(3);
const WET = new Set(['coast', 'riverValley']);

// cand: { candidateId, cityId, gx, gy, parents: [{ chunk, sideParent, sideCell }], sameCityNeighbours }
export function evaluateCandidate(world, cand, step, dna = GROWTH_DNA[cand.cityId]) {
  const p = world.probe(cand.gx, cand.gy);
  const gp = world.growthParams;
  const landformPref = CITY_GROWTH[cand.cityId].landform[p.landform];
  const wetNeighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => WET.has(world.landformAt(cand.gx + dx, cand.gy + dy))).length / 4;
  const unavailable = ['flood risk (no hydrology model)'];

  // Terrain.
  const flatSlope = 0.6 * clamp01(1 - p.meanLandSlope / 10) + 0.4 * p.lowSlope;
  const moderateSlope = 0.5 * clamp01(p.mixedSlope / 0.4) + 0.5 * clamp01(1 - Math.abs(p.meanLandSlope - 8) / 10);
  const slope = dna.slope === 'flat' ? flatSlope : moderateSlope;
  const buildable = clamp01(p.buildableFraction / 0.6);
  const terrain = (slope + buildable + landformPref) / 3;

  // Water.
  let proximity;
  if (p.distanceToWater === null) { proximity = 0.3 * wetNeighbours; unavailable.push('distance to water beyond the cell (fallback: wet neighbour landforms)'); }
  else proximity = 0.7 * clamp01(1 - p.distanceToWater / 512) + 0.3 * wetNeighbours;
  const water = dna.water === 'required' ? proximity : dna.water === 'seek' ? 0.5 + 0.5 * proximity
    : dna.water === 'avoid' ? 1 - clamp01(p.waterFraction / 0.3) : 1 - 0.5 * clamp01(p.waterFraction / 0.5);

  // Infrastructure (ports of the generated parent chunks on the side facing the cell; the cell's own joining edge).
  let ports = 0; let mainPorts = 0; let joining = 0;
  for (const parent of cand.parents) {
    const list = parent.ports ?? parent.chunk.outputs?.ports?.[parent.sideParent]; // G02c: only the ports that can really enter
    if (!list) { unavailable.push(`ports of ${parent.chunk.chunkId} (not generated)`); continue; }
    ports += list.length;
    mainPorts += list.filter(x => x.roadClass === 'primary').length;
    joining = Math.max(joining, p.edges[parent.sideCell].buildableShare);
  }
  const roadProximity = clamp01(ports / 3);
  const accessibility = 0.5 * roadProximity + 0.5 * joining;

  // Urban growth.
  const fit = p.fit[cand.cityId];
  const n = cand.sameCityNeighbours;
  const compactTerm = dna.compactness * ((n - 1) / 3) + (1 - dna.compactness) * 0.5;
  const direction = {
    roadAxis: clamp01(mainPorts / 2), waterfront: proximity, contour: 0.5 * moderateSlope + 0.5 * joining,
    edgeBranch: n === 1 ? 1 : 0.4, infrastructure: 0.5 * roadProximity + 0.5 * proximity, none: 0.5,
  }[dna.direction];
  const urban = 0.4 * fit.fitScore + 0.35 * direction + 0.25 * compactTerm;

  // Weighted score + seeded jitter (keyed by the stable candidate id and the step).
  const w = { terrain: gp.wTerrain, water: gp.wWater, infrastructure: gp.wInfra * dna.infraDependency, urban: gp.wUrban };
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const groups = { terrain: r3(terrain), water: r3(water), infrastructure: r3(accessibility), urban: r3(urban) };
  const base = Object.entries(groups).reduce((s, [k, v]) => s + w[k] * v, 0) / total;
  const jitter = gp.jitter * (2 * unit('g02-candidate-jitter', world.worldSeed, cand.candidateId, step) - 1);
  const score = +(base + jitter).toFixed(4);

  let rejectionReason = null;
  if (landformPref === 0) rejectionReason = `terrain type ${p.landform} incompatible`;
  else if (p.buildableFraction < GROWTH_RULES.minBuildable) rejectionReason = `buildable ${p.buildableFraction} < ${GROWTH_RULES.minBuildable}`;
  else if (fit.conflicts.length) rejectionReason = `02.6 DNA conflict: ${fit.conflicts.join(', ')}`;
  else if (dna.water === 'required' && p.waterFraction < GROWTH_RULES.waterRequiredMin) rejectionReason = `water required, water share ${p.waterFraction}`;
  else if (dna.barrier === 'stopAtSlope' && p.meanLandSlope > 12) rejectionReason = `slope barrier: mean land slope ${p.meanLandSlope}° > 12°`;
  else if (score < GROWTH_RULES.minScore) rejectionReason = `score ${score} < ${GROWTH_RULES.minScore}`;

  return {
    terrainSuitability: groups.terrain,
    growthPreference: r3((w.urban * urban + w.infrastructure * accessibility) / ((w.urban + w.infrastructure) || 1)),
    score, base: +base.toFixed(4), jitter: +jitter.toFixed(4), groups, weights: w, rejectionReason,
    terms: {
      slope: r3(slope), meanLandSlope: p.meanLandSlope, slopeP95: p.slopeP95, maxLandSlope: p.maxLandSlope, buildable: r3(buildable), terrainType: landformPref, landform: p.landform,
      waterCoverage: p.waterFraction, distanceToWater: p.distanceToWater, wetNeighbours, waterTerm: r3(water),
      portsTowardCell: ports, mainRoadPorts: mainPorts, joiningEdgeBuildable: r3(joining), accessibility: r3(accessibility),
      dnaFit: fit.fitScore, direction: dna.direction, directionTerm: r3(direction), sameCityNeighbours: n, compactTerm: r3(compactTerm),
    },
    unavailable,
  };
}
