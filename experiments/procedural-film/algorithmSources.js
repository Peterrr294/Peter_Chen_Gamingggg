// WEB-01d: the source each Inspector summary is bound to. scripts/verify-inspector-docs.mjs checks that these files and symbols still exist,
// and that a changed file sends its summary back to review. A passing path check does not prove that an explanation is right:
// the meaning of each summary is covered by the checklist in algorithm-review.json.
const SEED = 'experiments/seed-terrain/';
const WORLD = 'experiments/city-of-cities/';

export const ALGORITHM_SOURCES = Object.freeze({
  terrain: [{ file: `${SEED}TerrainGenerator.js`, symbols: ['generateChunk', 'LANDFORM_RULES'] }, { file: `${SEED}TerrainFields.js`, symbols: ['deriveFields', 'buildableMask', 'maxBuildableSlope'] }],
  analysis: [{ file: `${SEED}TerrainAnalysis.js`, symbols: ['analyseTerrain', 'suitabilityMask', 'dominantDirection'] }, { file: `${SEED}CityMatcher.js`, symbols: ['matchCity'] }],
  roads: [{ file: `${SEED}NetworkGenerator.js`, symbols: ['generateNetwork', 'gridStrategy', 'organicStrategy', 'canalStreetStrategy', 'closeLoops', 'resolveCrossings', 'planConnectivity'] }, { file: `${SEED}networkStrategies.js`, symbols: ['primarySpacing', 'secondarySpacing', 'slopePenalty', 'climbPenalty', 'reuseDiscount'] }],
  blocks: [{ file: `${SEED}BlockGenerator.js`, symbols: ['generateBlocks'] }, { file: `${SEED}BlockRefinement.js`, symbols: ['refineBlocks'] }],
  parcels: [{ file: `${SEED}ParcelGenerator.js`, symbols: ['generateParcels'] }, { file: `${SEED}parcelRules.js`, symbols: ['targetFrontage', 'maxDepth', 'minFrontage', 'minArea'] }],
  buildings: [{ file: `${SEED}BuildingGenerator.js`, symbols: ['generateBuildings', 'occupancy', 'centreRadius', 'floorHeight'] }, { file: `${SEED}buildingRules.js`, symbols: ['roadClassWeight', 'maxPlinth'] }],
  origins: [{ file: `${WORLD}OriginPlacement.js`, symbols: ['placeOriginsSteps', 'evaluateSite'] }, { file: `${WORLD}WorldContext.js`, symbols: ['initialise', 'registerOrigin'] }],
  growth: [{ file: `${WORLD}WorldGrowthController.js`, symbols: ['step', 'selectionSharpness', 'cityJitter'] }, { file: `${WORLD}growthDNA.js`, symbols: ['GROWTH_RULES', 'GROWTH_DNA'] }, { file: `${WORLD}GrowthEvaluation.js`, symbols: ['evaluateCandidate'] }],
  encounter: [{ file: `${WORLD}UrbanEncounter.js`, symbols: ['growWithNegotiation', 'negotiate', 'path'] }, { file: `${WORLD}encounterFixture.js`, symbols: ['createFixtureWorld', 'ENCOUNTER_FIXTURES'] }],
});
