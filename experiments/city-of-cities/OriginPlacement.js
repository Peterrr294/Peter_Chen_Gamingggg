// A City of Cities — G01 Origin Suitability Evaluation and placement (pure data).
//
// Per city (independent of the others):
//   1. Sites from the citySeed: SCREEN keyed draws inside searchRadius (landform field only, no terrain build);
//      a landform with compatibility 0 is rejected here.
//   2. The best PROBED screened sites get a real terrain probe (terrain + analysis, cached per cell, city-neutral).
//   3. Hard rejections: buildable share, triggered 02.6 DNA conflict, required water missing, score below minimum.
//   4. Suitability score = weighted mean of five terms (slope, buildable, water, terrainType, dnaFit), 0–1.
//   5. Reproducible weighted order of the qualified sites: key = −ln(u) / score^k, u = hash(citySeed, cell)
//      (weighted sampling without replacement); the first site is the weighted choice.
// Between cities (the only coupling): the minimum origin distance. Cities claim in an order derived from the data —
// fewest qualified sites first, ties by a seeded hash of (worldSeed, cityId), never by name or list position — so
// the order of the input list never matters and no city is systematically last. A city whose qualified
// sites are all too close to placed origins gets a placement FAILURE with a suggestion; no constraint is relaxed.
import { CITY_IDS, ORIGIN_PROFILES, PLACEMENT, citySeedOf } from './originConfig.js';
import { unit } from '../growing-world/growthConfig.js';
import { CITY_GROWTH } from '../growing-world/growthConfig.js';

const clamp01 = v => Math.min(1, Math.max(0, v));
const round = (v, d = 3) => +Number(v).toFixed(d);
const cheb = (a, b) => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
const WET = new Set(['coast', 'riverValley']);

// Five suitability terms of one probed cell for one city (all 0–1) + hard rejection reason (or null).
export function evaluateSite(world, cityId, probe) {
  const profile = ORIGIN_PROFILES[cityId];
  const terrainType = CITY_GROWTH[cityId].landform[probe.landform];
  const wetNeighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => WET.has(world.landformAt(probe.gx + dx, probe.gy + dy))).length / 4;
  const proximity = 0.7 * clamp01(probe.waterFraction / 0.12) + 0.3 * wetNeighbours; // water in the cell + wet neighbours
  const water = profile.water === 'required' || profile.water === 'preferred' ? proximity
    : profile.water === 'avoid' ? 1 - clamp01(probe.waterFraction / 0.3)
      : 1 - 0.5 * clamp01(probe.waterFraction / 0.5); // neutral: mild penalty for a mostly wet cell
  const slope = profile.slope === 'flat' ? probe.lowSlope : 0.4 * probe.lowSlope + 0.6 * clamp01(probe.mixedSlope / 0.4);
  const fit = probe.fit[cityId];
  const terms = { slope: round(slope), buildable: round(clamp01(probe.buildableFraction / 0.6)), water: round(water), terrainType: round(terrainType), dnaFit: round(fit.fitScore) };
  const w = profile.weights;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const score = round(Object.entries(terms).reduce((s, [k, v]) => s + w[k] * v, 0) / total, 4);
  let rejected = null;
  if (terrainType === 0) rejected = `terrain type ${probe.landform} incompatible (compatibility 0)`;
  else if (probe.buildableFraction < PLACEMENT.minBuildable) rejected = `buildable ${probe.buildableFraction} < ${PLACEMENT.minBuildable}`;
  else if (fit.conflicts.length) rejected = `02.6 DNA conflict: ${fit.conflicts.join(', ')}`;
  else if (profile.water === 'required' && probe.waterFraction < PLACEMENT.waterRequiredMin) rejected = `water required, water share ${probe.waterFraction} < ${PLACEMENT.waterRequiredMin}`;
  else if (score < PLACEMENT.minScore) rejected = `score ${score} < minimum ${PLACEMENT.minScore}`;
  return { terms, weights: w, score, rejected, water: { fraction: probe.waterFraction, wetNeighbours } };
}

// Candidate list of one city: screened sites, probed sites with terms, qualified sites in weighted order.
function* cityCandidates(world, cityId) {
  const { searchRadius, selectionSharpness } = world.params;
  const citySeed = citySeedOf(world.worldSeed, cityId);
  const screened = [];
  const seen = new Set();
  for (let a = 0; a < PLACEMENT.screenAttempts; a += 1) {
    const angle = 2 * Math.PI * unit('origin-site-angle', citySeed, a);
    const r = searchRadius * Math.sqrt(unit('origin-site-radius', citySeed, a));
    const gx = Math.round(r * Math.cos(angle)); const gy = Math.round(r * Math.sin(angle));
    if (seen.has(`${gx},${gy}`)) continue;
    seen.add(`${gx},${gy}`);
    const landform = world.landformAt(gx, gy);
    const compatibility = CITY_GROWTH[cityId].landform[landform];
    screened.push({ gx, gy, attempt: a, landform, compatibility, rejected: compatibility === 0 ? `terrain type ${landform} incompatible (screen)` : null });
  }
  const toProbe = screened.filter(s => !s.rejected).sort((a, b) => b.compatibility - a.compatibility || a.attempt - b.attempt).slice(0, PLACEMENT.probedPerCity);
  const probed = [];
  for (const s of toProbe) {
    const probe = world.probe(s.gx, s.gy);
    yield { cityId, probed: probed.length + 1, of: toProbe.length };
    const e = evaluateSite(world, cityId, probe);
    const u = unit('origin-pick', citySeed, s.gx, s.gy);
    probed.push({ gx: s.gx, gy: s.gy, landform: s.landform, attempt: s.attempt, ...e, key: e.rejected ? Infinity : -Math.log(Math.max(u, 1e-12)) / Math.max(e.score, 1e-6) ** selectionSharpness });
  }
  const qualified = probed.filter(p => !p.rejected).sort((a, b) => a.key - b.key || a.gy - b.gy || a.gx - b.gx);
  return { cityId, citySeed, screened, probed, qualified };
}

export function* placeOriginsSteps(world, cityIds = CITY_IDS) {
  const ids = [...new Set(cityIds)].sort(); // input order is irrelevant
  const lists = [];
  for (const id of ids) lists.push(yield* cityCandidates(world, id));
  const tie = id => unit('origin-claim-order', world.worldSeed, id);
  const order = [...lists].sort((a, b) => a.qualified.length - b.qualified.length || tie(a.cityId) - tie(b.cityId));
  const placed = [];
  const failures = [];
  for (const [index, list] of order.entries()) {
    const constrainedBy = new Set();
    let chosen = null; let rank = 0;
    for (const [i, site] of list.qualified.entries()) {
      const blocking = placed.filter(p => cheb(p, site) < world.params.minOriginDistance);
      if (blocking.length) { blocking.forEach(b => constrainedBy.add(b.cityId)); site.distanceRejectedBy = blocking.map(b => b.cityId); continue; }
      chosen = site; rank = i + 1; break;
    }
    if (!chosen) {
      failures.push({ cityId: list.cityId, reason: list.qualified.length ? `all ${list.qualified.length} qualified sites closer than ${world.params.minOriginDistance} chunks to placed origins (${[...constrainedBy].join(', ')})` : `no qualified site among ${list.probed.length} probed / ${list.screened.length} screened`, suggestion: `increase searchRadius to ${world.params.searchRadius + 2} or lower minOriginDistance to ${Math.max(2, world.params.minOriginDistance - 1)}; constraints were not relaxed` });
      continue;
    }
    const t = Object.entries(chosen.terms).map(([k, v]) => `${k} ${v}`).join(', ');
    placed.push({
      cityId: list.cityId, gx: chosen.gx, gy: chosen.gy,
      reason: {
        order: index + 1, score: chosen.score, terms: chosen.terms, weights: chosen.weights, water: chosen.water, landform: chosen.landform,
        rankInWeightedOrder: rank, qualified: list.qualified.length, probed: list.probed.length, screened: list.screened.length,
        rejected: list.probed.filter(p => p.rejected).length + list.screened.filter(s => s.rejected).length,
        constrainedBy: [...constrainedBy], hypothesis: 'weights and profiles are design assumptions (A), not calibrated',
        text: `${chosen.landform} site (${chosen.gx}, ${chosen.gy}): suitability ${chosen.score} (${t}); weighted choice ${rank} of ${list.qualified.length} qualified; claim order ${index + 1}${constrainedBy.size ? `; closer sites blocked by ${[...constrainedBy].join(', ')}` : ''}`,
      },
    });
  }
  return { order: order.map(l => l.cityId), placed, failures, candidates: Object.fromEntries(lists.map(l => [l.cityId, { citySeed: l.citySeed, screened: l.screened, probed: l.probed.map(({ key, ...p }) => ({ ...p, weightKey: Number.isFinite(key) ? round(key, 6) : null })) }])) };
}
