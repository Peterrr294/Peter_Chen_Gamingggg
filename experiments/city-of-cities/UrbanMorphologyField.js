// A City of Cities — G03c-03 Urban Morphology Field (analysis; pure data, runs in Node).
//
// Answers "why does this building have this height?" from the generator's own rule, without changing any building:
// for every building of a city the height is decomposed into its sources (city height centre, frontage road class,
// parcel area, the parcel's seeded jitter) and recomputed with the generator's random stream; the recomputation must
// equal the generated height exactly, so the lineage is the rule itself, not an estimate.
// Continuity across a same-city chunk edge is then measured at EQUAL distance from the city centre, which separates a
// generator reset (heights differ at the same distance) from the city's own gradient (heights differ with distance).
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { BUILDING_RULES } from '../seed-terrain/buildingRules.js';

const r2 = v => +Number(v).toFixed(2);
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const quantile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const centroid = ring => ({ x: ring.reduce((s, p) => s + p.x, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length });

// Lineage of every building of one generated chunk. layers: { city: { parcels, buildings } } from WorldContext.generateChunk.
export function buildingLineage(world, chunk, layers) {
  const dna = chunk.cityId; const rule = BUILDING_RULES.byDNA[dna]; const rules = BUILDING_RULES;
  const parcels = layers.city.parcels.parcels; const byId = new Map(parcels.map(p => [p.id, p]));
  const blockMax = new Map(); for (const p of parcels) blockMax.set(p.blockId, Math.max(blockMax.get(p.blockId) ?? 1, p.area));
  const centre = layers.city.buildings.source.centre; const worldSeed = chunk.generationParameters.urbanSeed;
  const ctx = chunk.generationParameters.growthContext;
  return layers.city.buildings.buildings.map(b => {
    const parcel = byId.get(b.parcelId);
    const random = new SeededRandom(worldSeed, 'building', dna, parcel.stableKey); random.next(); const jitter = random.next();
    const c = centroid(b.footprint.polygon);
    const centreFactor = Math.exp(-((c.x - centre.x) ** 2 + (c.z - centre.z) ** 2) / (rule.centreRadius ** 2));
    const front = parcel.frontages.reduce((best, f) => ((rules.roadClassWeight[f.roadClass] ?? 0) > (rules.roadClassWeight[best?.roadClass] ?? -1) ? f : best), null);
    const roadFactor = Math.max(...parcel.frontages.map(f => rules.roadClassWeight[f.roadClass] ?? 0));
    const areaFactor = Math.min(1, parcel.area / blockMax.get(parcel.blockId));
    const w = rule.weights; const scale = 1 - rule.jitter / 2 + rule.jitter * jitter;
    const mix = Math.min(1, Math.max(0, (w.centre * centreFactor + w.road * roadFactor + w.area * areaFactor) * scale));
    const floors = Math.max(rule.floors[0], Math.round(rule.floors[0] + (rule.floors[1] - rule.floors[0]) * mix));
    const height = floors * rule.floorHeight;
    return {
      objectId: `${chunk.chunkId}:${b.id}`, cityId: chunk.cityId, chunkId: chunk.chunkId, parentChunkId: chunk.parentChunkId, generationStep: chunk.growthStep,
      relatedRoadId: front ? `${chunk.chunkId}:e${front.edgeId}` : null, relevantMorphologySource: { centre: { x: r2(centre.x), z: r2(centre.z) }, centreSource: layers.city.buildings.source.centreSource, fromChunkId: ctx?.centre?.fromChunkId ?? chunk.chunkId },
      sourceCityDNA: dna, localMorphologyParameters: { floors: rule.floors, floorHeight: rule.floorHeight, weights: w, jitter: rule.jitter, centreRadius: rule.centreRadius },
      factors: { distanceToCentreM: Math.round(Math.hypot(c.x - centre.x, c.z - centre.z)), centre: r2(centreFactor), road: r2(roadFactor), area: r2(areaFactor), jitterScale: r2(scale), mix: r2(mix) },
      contribution: { centre: r2(w.centre * centreFactor * scale), road: r2(w.road * roadFactor * scale), area: r2(w.area * areaFactor * scale) },
      height: b.height, recomputedHeight: +height.toFixed(4), exact: Math.abs(height - b.height) < 1e-6,
      appliedConstraint: mix >= 1 ? 'clamped at the DNA maximum' : floors === rule.floors[0] ? 'DNA minimum floors' : 'rule value',
      decisionReason: `${floors} floors: centre ${r2(w.centre * centreFactor * scale)} + road ${r2(w.road * roadFactor * scale)} + area ${r2(w.area * areaFactor * scale)} of the DNA range ${rule.floors.join('–')}`,
      point: { x: r2(c.x), z: r2(c.z) },
    };
  });
}

// Continuity of heights and fabric across one same-city shared edge. a, b: { chunk, lineage, layers }.
export function edgeContinuity(a, b, { bandM = 100, ringM = 100 } = {}) {
  const ax = a.chunk.worldOrigin; const bx = b.chunk.worldOrigin;
  const alongX = ax.z === bx.z; const edge = alongX ? (ax.x + bx.x) / 2 : (ax.z + bx.z) / 2;
  const dist = p => Math.abs((alongX ? p.x : p.z) - edge);
  const near = l => l.lineage.filter(x => dist(x.point) <= bandM);
  const A = near(a); const B = near(b);
  const stat = list => { const h = list.map(x => x.height); return { buildings: list.length, meanM: r2(mean(h)), p50M: quantile(h, 0.5), p90M: quantile(h, 0.9), maxM: h.length ? Math.max(...h) : null, meanDistanceToCentreM: Math.round(mean(list.map(x => x.factors.distanceToCentreM))) }; };
  // Same distance from the centre: mean height per ring on both sides, only rings with buildings on both sides.
  const rings = new Map();
  for (const [side, list] of [['a', a.lineage], ['b', b.lineage]]) for (const x of list) { const k = Math.floor(x.factors.distanceToCentreM / ringM); if (!rings.has(k)) rings.set(k, { a: [], b: [] }); rings.get(k)[side].push(x.height); }
  const both = [...rings].filter(([, v]) => v.a.length >= 10 && v.b.length >= 10).sort((p, q) => p[0] - q[0]).map(([k, v]) => ({ ringM: `${k * ringM}-${(k + 1) * ringM}`, meanA: r2(mean(v.a)), meanB: r2(mean(v.b)), differenceM: r2(mean(v.b) - mean(v.a)) }));
  const ma = a.chunk.outputs.morph; const mb = b.chunk.outputs.morph;
  return {
    edge: `${a.chunk.chunkId}|${b.chunk.chunkId}`, bandM, sideA: stat(A), sideB: stat(B), sameDistanceRings: both,
    maxSameDistanceDifferenceM: both.length ? Math.max(...both.map(x => Math.abs(x.differenceM))) : null,
    reading: both.length ? (Math.max(...both.map(x => Math.abs(x.differenceM))) <= a.lineage[0]?.localMorphologyParameters.floorHeight * 1.5 ? 'continuous field: heights differ by distance to the centre, not by chunk' : 'possible reset: heights differ at the same distance') : 'no common distance to compare',
    fabric: {
      orientationDeg: [ma.dominantOrientationDeg, mb.dominantOrientationDeg], roadDensityKmPerKm2: [ma.roadDensityKmPerKm2, mb.roadDensityKmPerKm2], blockAreaMedianM2: [ma.blockAreaMedianM2, mb.blockAreaMedianM2],
      parcelFrontageMedianM: [ma.parcelFrontageMedianM, mb.parcelFrontageMedianM], buildingCoverage: [ma.buildingCoverage, mb.buildingCoverage],
      grid: a.chunk.outputs.grid && b.chunk.outputs.grid ? { axis: [a.chunk.outputs.grid.axisDeg, b.chunk.outputs.grid.axisDeg], inherited: b.chunk.outputs.grid.inherited } : 'no fixed grid',
    },
  };
}
export { mean, quantile };
