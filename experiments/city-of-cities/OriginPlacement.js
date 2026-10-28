// A City of Cities — G01 Origin Suitability Evaluation and placement (pure data).
//
// Per city (independent of the others):
//   1. Sites from the citySeed: SCREEN keyed draws inside searchRadius (landform field only, no terrain build);
//      a landform with compatibility 0 is rejected here. Water-required cities (placement v2) probe wet landforms
//      (coast, river valley) first; the landform alone never qualifies a site.
//   2. The best PROBED screened sites get a real terrain probe (terrain + analysis, cached per cell, city-neutral).
//   3. Hard rejections: buildable share, triggered 02.6 DNA conflict, required water missing, (v2) no accessible
//      buildable shore for water-required cities, score below minimum.
//   4. Suitability score = weighted mean of five terms (slope, buildable, water, terrainType, dnaFit), 0–1.
//   5. Reproducible weighted order of the qualified sites: key = −ln(u) / score^k, u = hash(citySeed, cell)
//      (weighted sampling without replacement); the first site is the weighted choice.
// Between cities (the only coupling): the minimum origin distance. Cities claim in an order derived from the data —
// fewest qualified sites first, ties by a seeded hash of (worldSeed, cityId), never by name or list position — so
// the order of the input list never matters and no city is systematically last. A city whose qualified
// sites are all too close to placed origins gets a placement FAILURE with a suggestion; no constraint is relaxed.
// Placement v2: a city without a legal site searches again in up to PLACEMENT.maxExpansions bounded rounds (radius
// + expansionStep each, new keyed draws); a remaining failure is classified (noSuitableLandform, insufficientWater,
// buildConditions, spacingConflict) and the whole initialisation fails atomically (WorldContext registers nothing).
import { CITY_IDS, ORIGIN_PROFILES, PLACEMENT, PLACEMENT_VERSION, citySeedOf } from './originConfig.js';
import { CITY_GROWTH, unit } from '../growing-world/growthConfig.js';

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
  else if (profile.water === 'required' && probe.waterfrontBuildable < PLACEMENT.waterfrontMin) rejected = `waterfront not accessible: buildable shore ${probe.waterfrontBuildable} < ${PLACEMENT.waterfrontMin}`;
  else if (score < PLACEMENT.minScore) rejected = `score ${score} < minimum ${PLACEMENT.minScore}`;
  return { terms, weights: w, score, rejected, rejectionKind: rejected ? kindOf(rejected) : null, water: { fraction: probe.waterFraction, wetNeighbours, waterfrontBuildable: probe.waterfrontBuildable } };
}

// Failure / rejection categories (placement v2).
export function kindOf(reason) {
  if (/terrain type|no wet landform/.test(reason)) return 'noSuitableLandform';
  if (/noWater|water required|waterfront/.test(reason)) return 'insufficientWater';
  return 'buildConditions'; // buildable share, other DNA conflicts, score below minimum
}

// Candidate list of one city for one search round: screened sites, probed sites with terms, qualified sites in
// weighted order. Round 0 uses the G01 keys (identical draws); round k > 0 uses radius + k · expansionStep and its
// own keyed draws.
function* cityCandidates(world, cityId, round = 0) {
  const { searchRadius, selectionSharpness } = world.params;
  const radius = searchRadius + round * PLACEMENT.expansionStep;
  const citySeed = citySeedOf(world.worldSeed, cityId);
  const waterRequired = ORIGIN_PROFILES[cityId].water === 'required';
  const screened = [];
  const seen = new Set();
  for (let a = 0; a < PLACEMENT.screenAttempts; a += 1) {
    const angle = 2 * Math.PI * (round ? unit('origin-site-angle', citySeed, 'round', round, a) : unit('origin-site-angle', citySeed, a));
    const r = radius * Math.sqrt(round ? unit('origin-site-radius', citySeed, 'round', round, a) : unit('origin-site-radius', citySeed, a));
    const gx = Math.round(r * Math.cos(angle)); const gy = Math.round(r * Math.sin(angle));
    if (seen.has(`${gx},${gy}`)) continue;
    seen.add(`${gx},${gy}`);
    const landform = world.landformAt(gx, gy);
    const compatibility = CITY_GROWTH[cityId].landform[landform];
    screened.push({ gx, gy, attempt: a, round, landform, compatibility, wet: WET.has(landform), rejected: compatibility === 0 ? `terrain type ${landform} incompatible (screen)` : null });
  }
  // v2: water-required cities probe wet landforms first (then compatibility, then draw order); others as in v1.
  const toProbe = screened.filter(s => !s.rejected)
    .sort((a, b) => (waterRequired ? Number(b.wet) - Number(a.wet) : 0) || b.compatibility - a.compatibility || a.attempt - b.attempt)
    .slice(0, PLACEMENT.probedPerCity);
  const probed = [];
  for (const s of toProbe) {
    const probe = world.probe(s.gx, s.gy);
    yield { cityId, probed: probed.length + 1, of: toProbe.length, round };
    const e = evaluateSite(world, cityId, probe);
    const u = unit('origin-pick', citySeed, s.gx, s.gy);
    probed.push({ gx: s.gx, gy: s.gy, landform: s.landform, attempt: s.attempt, round, ...e, key: e.rejected ? Infinity : -Math.log(Math.max(u, 1e-12)) / Math.max(e.score, 1e-6) ** selectionSharpness });
  }
  const qualified = probed.filter(p => !p.rejected).sort((a, b) => a.key - b.key || a.gy - b.gy || a.gx - b.gx);
  return { cityId, citySeed, radius, rounds: [round], screened, probed, qualified, waterRequired, wetScreened: screened.filter(x => x.wet && !x.rejected).length };
}

// Adds the next search round to a city list (bounded). Returns false when the bound is reached.
function* expand(world, list) {
  const next = list.rounds.at(-1) + 1;
  if (next > PLACEMENT.maxExpansions) return false;
  const more = yield* cityCandidates(world, list.cityId, next);
  const seen = new Set(list.probed.map(p => `${p.gx},${p.gy}`));
  list.rounds.push(next); list.radius = more.radius;
  list.screened.push(...more.screened);
  list.probed.push(...more.probed.filter(p => !seen.has(`${p.gx},${p.gy}`)));
  list.qualified = list.probed.filter(p => !p.rejected).sort((a, b) => a.key - b.key || a.gy - b.gy || a.gx - b.gx);
  list.wetScreened += more.wetScreened;
  return true;
}

function failureOf(world, list, constrainedBy) {
  const rejections = list.probed.filter(p => p.rejected);
  let kind;
  if (list.qualified.length) kind = 'spacingConflict';
  else if (!list.probed.length || (list.waterRequired && !list.wetScreened)) kind = 'noSuitableLandform';
  else {
    const kinds = rejections.map(p => p.rejectionKind);
    kind = kinds.every(k => k === 'insufficientWater') ? 'insufficientWater' : kinds.every(k => k === 'noSuitableLandform') ? 'noSuitableLandform' : kinds.includes('insufficientWater') && list.waterRequired ? 'insufficientWater' : 'buildConditions';
  }
  const detail = {
    spacingConflict: `all ${list.qualified.length} qualified sites closer than ${world.params.minOriginDistance} chunks to placed origins (${[...constrainedBy].join(', ')})`,
    noSuitableLandform: `no compatible${list.waterRequired ? ' wet (coast / river valley)' : ''} landform among ${list.screened.length} screened sites`,
    insufficientWater: `water too scarce on every probed site (${rejections.map(p => p.rejected).join('; ')})`,
    buildConditions: `build conditions failed on every probed site (${rejections.map(p => p.rejected).join('; ')})`,
  }[kind];
  const suggestion = {
    spacingConflict: `lower minOriginDistance to ${Math.max(2, world.params.minOriginDistance - 1)} or raise searchRadius`,
    noSuitableLandform: 'try another world seed or raise searchRadius; the landform field has no suitable cell in range',
    insufficientWater: 'try another world seed; terrain is never altered to create water',
    buildConditions: 'try another world seed or review the origin profile thresholds (design assumptions)',
  }[kind];
  return { cityId: list.cityId, kind, reason: `${detail}; searched radius ${list.radius} in ${list.rounds.length} round(s)`, suggestion: `${suggestion}; constraints were not relaxed` };
}

export function* placeOriginsSteps(world, cityIds = CITY_IDS) {
  const ids = [...new Set(cityIds)].sort(); // input order is irrelevant
  const lists = [];
  for (const id of ids) {
    const list = yield* cityCandidates(world, id);
    while (!list.qualified.length && (yield* expand(world, list))); // bounded expansion when no site qualifies
    lists.push(list);
  }
  const tie = id => unit('origin-claim-order', world.worldSeed, id);
  const order = [...lists].sort((a, b) => a.qualified.length - b.qualified.length || tie(a.cityId) - tie(b.cityId));
  const placed = [];
  const failures = [];
  for (const [index, list] of order.entries()) {
    const constrainedBy = new Set();
    let chosen = null; let rank = 0;
    const pick = () => {
      for (const [i, site] of list.qualified.entries()) {
        const blocking = placed.filter(p => cheb(p, site) < world.params.minOriginDistance);
        if (blocking.length) { blocking.forEach(b => constrainedBy.add(b.cityId)); site.distanceRejectedBy = blocking.map(b => b.cityId); continue; }
        chosen = site; rank = i + 1; return;
      }
    };
    pick();
    while (!chosen && (yield* expand(world, list))) pick(); // bounded expansion when every site is blocked
    if (!chosen) { failures.push(failureOf(world, list, constrainedBy)); continue; }
    const t = Object.entries(chosen.terms).map(([k, v]) => `${k} ${v}`).join(', ');
    placed.push({
      cityId: list.cityId, gx: chosen.gx, gy: chosen.gy,
      reason: {
        order: index + 1, score: chosen.score, terms: chosen.terms, weights: chosen.weights, water: chosen.water, landform: chosen.landform,
        rankInWeightedOrder: rank, qualified: list.qualified.length, probed: list.probed.length, screened: list.screened.length, searchRadius: list.radius, searchRounds: list.rounds.length, placementVersion: PLACEMENT_VERSION,
        rejected: list.probed.filter(p => p.rejected).length + list.screened.filter(s => s.rejected).length,
        constrainedBy: [...constrainedBy], hypothesis: 'weights and profiles are design assumptions (A), not calibrated',
        text: `${chosen.landform} site (${chosen.gx}, ${chosen.gy}): suitability ${chosen.score} (${t}); weighted choice ${rank} of ${list.qualified.length} qualified; claim order ${index + 1}${constrainedBy.size ? `; closer sites blocked by ${[...constrainedBy].join(', ')}` : ''}`,
      },
    });
  }
  return { placementVersion: PLACEMENT_VERSION, order: order.map(l => l.cityId), placed, failures, candidates: Object.fromEntries(lists.map(l => [l.cityId, { citySeed: l.citySeed, screened: l.screened, probed: l.probed.map(({ key, ...p }) => ({ ...p, weightKey: Number.isFinite(key) ? round(key, 6) : null })) }])) };
}
