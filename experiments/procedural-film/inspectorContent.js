// WEB-01b-R1 Algorithm Inspector content (pure, no DOM, no Three.js). Every value is read from the finished snapshot of the real chain.
// What the data does not contain is returned as NA, never estimated. The film chunk stands alone: it has no world seed, chunk id or growth step.
export const NA = reason => ({ na: true, reason });

const n = (value, digits = 0) => Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)} %`;
const STANDALONE = 'single-chunk film, not part of a world';
const source = file => `../../index.html#files?file=./experiments/seed-terrain/${file}`;
const docs = file => `../../index.html#files?file=./docs/procedural-mini-world/03-generative-system/${file}`;

export function identityRows({ cityMatch, config, fields }) {
  const dna = cityMatch.selectedDNA;
  return [
    ['Scene', 'Part I: live single chunk. Unrelated to the world run in Part II.'],
    ['City ID', dna.id],
    ['City name', dna.label],
    ['DNA family', dna.family ?? NA('not recorded')],
    ['DNA choice', `${dna.mode} · auto-match would pick ${dna.autoTopId}`],
    ['Terrain fit', `${dna.score.toFixed(2)} (fit ${dna.fitScore.toFixed(2)} × coverage ${dna.evidenceCoverage.toFixed(2)}) · measures terrain only`],
    ['Terrain type', config.landform],
    ['Terrain seed', String(config.seed)],
    ['World seed', NA(STANDALONE)],
    ['Chunk ID', NA(`${STANDALONE}; origin (${fields.grid.originX}, ${fields.grid.originZ}), ${fields.grid.size} m`)],
    ['Growth step', NA(STANDALONE)],
    ['Parent chunk', NA('none: this chunk was not grown')],
  ];
}

// Input → process → output of the real chain, as called in experiments/procedural-film/snapshotWorker.js.
export const STAGE_FLOW = {
  terrain: {
    input: 'config: landform, seed, variation, transitionWidth', process: 'generateChunk() → deriveFields()', output: 'height, waterSurface, slope, waterMask, buildableMask, transitionWeight',
    what: 'A closed block of land with water, before any city exists.', rules: 'The landform algorithm and the seed. City DNA plays no part.', next: 'Slope and water fields are all the analysis reads.',
  },
  analysis: {
    input: 'terrain fields', process: 'analyseTerrain() → matchCity()', output: 'terrainAnalysis, cityMatch',
    what: 'Suitability classes, buildable and water regions, and the direction of the site, if evidence exists.', rules: 'Slope thresholds. The film sets the City DNA by hand, so the match is reported, not used to choose.', next: 'Hints and constraints go to the road network; terrain is not changed.',
  },
  roads: {
    input: 'terrain fields + terrainAnalysis + cityMatch', process: 'generateNetwork()', output: 'NetworkGraph (nodes, edges, edge ports)',
    what: 'One street graph for this chunk.', rules: 'The strategy and spacing of the City DNA, limited by slope and water.', next: 'Road centrelines cut the land into blocks.',
  },
  blocks: {
    input: 'terrain fields + NetworkGraph + cityMatch', process: 'generateBlocks() → refineBlocks()', output: 'blocks, fragments, terrainBlockIndex',
    what: 'Closed pieces of land enclosed by roads, water or the chunk edge.', rules: 'Geometry of the roads and water. Blocks are never forced to a DNA shape.', next: 'Parcels subdivide the buildable part of each block.',
  },
  parcels: {
    input: 'blocks + terrain fields + NetworkGraph + cityMatch', process: 'generateParcels()', output: 'parcels, residuals, reserve',
    what: 'Lots along road frontage. Land too far from a road stays reserve.', rules: 'Target frontage, depth and minimum area of the City DNA.', next: 'Each parcel holds at most one building.',
  },
  buildings: {
    input: 'parcels + terrain fields + cityMatch', process: 'generateBuildings()', output: 'buildings (footprint, height, floors), vacant',
    what: 'Grey-box volumes on parcels.', rules: 'Occupancy, setbacks, floors and height weights of the City DNA.', next: 'Last stage of one chunk. Growth extends the city in the world experiment.',
  },
};

export function paramRows(stageId, snapshot) {
  const { config, fields, analysis, network, blocks, parcels, buildings, cityMatch } = snapshot;
  const s = fields.stats;
  switch (stageId) {
    case 'terrain': return [
      ['Algorithm', `LANDFORM_RULES.${config.landform}`],
      ['Terrain seed', String(config.seed)],
      ['Variation', String(config.variation)],
      ['Relief setting', config.relief !== undefined ? `${config.relief} m` : NA('not a parameter of this landform')],
      ['Samples', `${fields.grid.columns} × ${fields.grid.rows} at ${fields.grid.spacing} m`],
      ['Elevation range', `${s.minHeight.toFixed(1)} to ${s.maxHeight.toFixed(1)} m`],
      ['Transition width', `${config.transitionWidth} m`],
    ];
    case 'analysis': {
      let maxSlope = 0;
      for (let i = 0; i < fields.slope.length; i += 1) if (!fields.waterMask[i] && fields.slope[i] > maxSlope) maxSlope = fields.slope[i];
      const suit = analysis.suitability.fraction;
      const direction = analysis.dominantDirection.selected;
      return [
        ['Mean land slope', `${analysis.slopeStats.meanLand.toFixed(1)}°`],
        ['Maximum land slope', `${maxSlope.toFixed(1)}°`],
        ['Water coverage', pct(analysis.waterCoverage.fraction)],
        ['Buildable area', `${pct(analysis.waterCoverage.buildableFraction)} (slope ≤ ${config.maxBuildableSlope}°, ${config.shoreFreeboard} m above water)`],
        ['Suitability', `high ${pct(suit[3], 0)} · medium ${pct(suit[2], 0)} · low ${pct(suit[1], 0)} · none ${pct(suit[0], 0)}`],
        ['Regions', `${analysis.buildableRegions.significantCount} buildable · ${analysis.waterRegions.count} water`],
        ['Water role', cityMatch.terrainConstraints.waterRole],
        ['Site direction', direction ? `${direction.type} ${direction.axisDeg ?? direction.downslopeDeg}°` : NA('no candidate passed its evidence test')],
      ];
    }
    case 'roads': {
      const st = network.stats;
      const p = network.params;
      const km2 = (fields.grid.size / 1000) ** 2;
      return [
        ['Network type', `${network.strategy} (${p.label})`],
        ['Road density', `${(st.roadLength / 1000 / km2).toFixed(1)} km per km²`],
        ['Spacing', p.primarySpacing ? `${p.primarySpacing} m avenues · ${p.secondarySpacing} m cross streets` : NA(`${network.strategy} has no fixed spacing`)],
        ['Maximum road slope', `${p.maxSlopeDeg}°`],
        ['Orientation', network.orientation ? `${network.orientation.axisDeg}° (${network.orientation.source})` : NA(`${network.strategy} has no single axis`)],
        ['Regularity', `straightness ${st.straightness.toFixed(2)} · orientation entropy ${st.orientationEntropy.toFixed(2)}`],
        ['Graph', `${n(st.nodes)} nodes · ${n(st.edges)} edges · ${n(st.junctions)} junctions`],
        ['Connectivity', `${st.roadComponents} component(s) · ${pct(st.deadEndRatio, 0)} dead ends · ${st.ports} edge ports`],
      ];
    }
    case 'blocks': {
      const st = blocks.stats;
      const areas = blocks.blocks.map(block => block.area).sort((a, b) => a - b);
      return [
        ['Method', 'Connected regions of an availability field on a 1 m grid'],
        ['Block count', n(st.blocks)],
        ['Area', areas.length ? `min ${n(areas[0])} · median ${n(areas[areas.length >> 1])} · max ${n(areas.at(-1))} m²` : NA('no blocks')],
        ['Enclosure', `${st.byEnclosure.roads} by roads · ${st.byEnclosure.roadsAndWater} roads and water · ${st.byEnclosure.clipped} cut by chunk edge`],
        ['Status', `${st.byStatus.buildable} buildable · ${st.byStatus.partial} partial · ${st.byStatus.unbuildable} unbuildable`],
        ['Minimum block', `${blocks.rules.minBlockArea} m²`],
        ['Status rule', `buildable from ${pct(blocks.rules.status.buildableMin, 0)} · partial from ${pct(blocks.rules.status.partialMin, 0)} of area`],
        ['Invalid blocks', String(st.invalid)],
      ];
    }
    case 'parcels': {
      const st = parcels.stats;
      const target = parcels.rules.target;
      return [
        ['Method', 'Road-oriented frontage subdivision'],
        ['DNA rule', target.label],
        ['Parcel count', `${n(st.parcels)} (${st.corner} corner lots)`],
        ['Target frontage', `${target.targetFrontage} m ± ${pct(target.jitter, 0)}, minimum ${target.minFrontage} m`],
        ['Maximum depth', `${target.maxDepth} m`],
        ['Minimum area', `${target.minArea} m²`],
        ['Measured', `mean frontage ${st.meanFrontage.toFixed(1)} m · mean area ${n(st.meanArea)} m²`],
        ['Valid frontage', pct(st.validFrontageRate, 0)],
        ['Setback', NA('set per building in the next stage')],
      ];
    }
    case 'buildings': {
      const st = buildings.stats;
      const rule = buildings.rules.rule;
      return [
        ['Footprint', `${rule.type}: occupancy ${pct(rule.occupancy, 0)}, side setback ${rule.sideSetback} m, depth up to ${rule.maxDepth} m`],
        ['Height rule', `${rule.floors[0]}–${rule.floors[1]} floors × ${rule.floorHeight} m`],
        ['Height weights', `centre ${rule.weights.centre} · road ${rule.weights.road} · area ${rule.weights.area} · jitter ${rule.jitter}`],
        ['Building count', `${n(st.buildings)} on ${n(st.parcels)} parcels (${pct(st.occupancy, 0)})`],
        ['Height', `mean ${st.meanHeight.toFixed(1)} · p10 ${st.heightP10.toFixed(0)} · p50 ${st.heightP50.toFixed(0)} · p90 ${st.heightP90.toFixed(0)} m`],
        ['Coverage', `${pct(st.coverageOfBuiltParcels, 0)} of built parcels`],
        ['Extrusion', 'One extruded prism per footprint, from plinth to roof'],
        ['Evidence', 'Design assumption, not measured from the real city'],
      ];
    }
    default: return [];
  }
}

const NETWORK_STEPS = {
  grid: [
    'axis = DNA fixed axis, else site direction, else 0°',
    'lay two street families at avenue and cross-street spacing',
    'truncate lines on ground steeper than the limit; main streets may bridge short water',
  ],
  organic: [
    'choose boundary gates and centres on buildable land',
    'join them by least-cost paths (slope and climb cost more, reusing a road costs less)',
    'branch lanes toward buildable land, dead ends allowed',
    'close some local loops',
  ],
  canalStreet: [
    'trace canals on existing water, kept central by distance to land',
    'lay quays: land paths that stay a set distance inland, one tree per land body',
    'close some local loops',
  ],
};

export function howItWorks(stageId, snapshot) {
  const { network, parcels, buildings, config } = snapshot;
  const table = {
    terrain: { steps: [`rules = LANDFORM_RULES.${config.landform}(seeded noise, layout)`, 'for each sample (x, z): height, water = rules(x, z)', 'slope = gradient of height', 'buildable = slope ≤ limit and above water + freeboard'], constraints: 'Fixed 1024 m chunk. Same seed gives the same field.', files: [['TerrainGenerator.js', source('TerrainGenerator.js')], ['TerrainFields.js', source('TerrainFields.js')]], more: docs('terrain-and-water.md') },
    analysis: { steps: ['class = slope band (≤ 5°, ≤ 10°, ≤ 20°, steeper or water)', 'label connected buildable and water regions', 'report a direction only if a candidate passes its evidence test', 'score each DNA: fit × evidence coverage'], constraints: 'Reads terrain only and never changes it.', files: [['TerrainAnalysis.js', source('TerrainAnalysis.js')], ['CityMatcher.js', source('CityMatcher.js')]], more: docs('terrain-analysis.md') },
    roads: { steps: [...(NETWORK_STEPS[network.strategy] ?? []), 'resolve crossings, prune short pieces, link separated components'], constraints: `Strategy ${network.strategy}. All spacings are design assumptions.`, files: [['NetworkGenerator.js', source('NetworkGenerator.js')], ['networkStrategies.js', source('networkStrategies.js')]], more: docs('road-and-tunnel.md') },
    blocks: { steps: ['a(p) = min(distance to road − ½ width, height − water surface)', 'blocks = 4-connected regions where a > 0', 'boundary = a = 0 contour (marching squares)', 'each block records its roads, water and chunk edge'], constraints: `Blocks under ${snapshot.blocks.rules.minBlockArea} m² become fragments, nothing is deleted.`, files: [['BlockGenerator.js', source('BlockGenerator.js')], ['BlockRefinement.js', source('BlockRefinement.js')]], more: docs('block-and-parcel.md') },
    parcels: { steps: ['walk frontage runs along the roads of each block', `cut each run into lots near ${parcels.rules.target.targetFrontage} m`, 'merge remainders, form corner lots', 'give each buildable sample to its nearest lot, up to maximum depth', 'build polygons with exact shared lines'], constraints: 'Every parcel fronts a road; deeper land stays reserve.', files: [['ParcelGenerator.js', source('ParcelGenerator.js')], ['parcelRules.js', source('parcelRules.js')]], more: docs('block-and-parcel.md') },
    buildings: { steps: ['keep or leave each parcel empty by the occupancy rule', 'footprint = parcel inset by setbacks, limited by depth', `leave vacant if the ground drops over ${buildings.rules.maxPlinth} m under it`, 'mix = centre·e^(−d²/r²) + road class + parcel area, with bounded jitter', 'floors = minimum + (maximum − minimum) · mix', 'height = floors × floor height'], constraints: 'Terrain and network seeds are not touched.', files: [['BuildingGenerator.js', source('BuildingGenerator.js')], ['buildingRules.js', source('buildingRules.js')]], more: docs('building-extrusion.md') },
  };
  return table[stageId];
}

// Only what the timeline has reached so far (same reveal times as the shaders).
export function liveRows(film, { network, blocks, parcels, buildings }) {
  const c = film.liveCounts();
  return [
    ['Roads generated', `${(c.roadLength / 1000).toFixed(1)} of ${(network.stats.roadLength / 1000).toFixed(1)} km · ${n(c.roadEdges)} of ${n(network.stats.edges)} edges`],
    ['Blocks generated', `${n(c.blocks)} of ${n(blocks.stats.blocks)}`],
    ['Parcels generated', `${n(c.parcels)} of ${n(parcels.stats.parcels)}`],
    ['Buildings generated', `${n(c.buildings)} of ${n(buildings.stats.buildings)}`],
    ['Growth chunks', NA('single chunk')],
    ['Active growth frontiers', NA('single chunk')],
    ['Verified connections', NA('single chunk')],
  ];
}

// Picked object → rows of what the data really holds.
export function objectRows(picked, snapshot) {
  const { network, blocks, parcels, buildings, cityMatch, config } = snapshot;
  const city = ['City ID', cityMatch.selectedDNA.id];
  if (picked.kind === 'building') {
    const b = buildings.buildings[picked.index];
    return { title: `Building ${b.id}`, rows: [city, ['Stage', 'Buildings'], ['Parcel', b.parcelId], ['Block', b.blockId], ['Frontage road', `edge ${b.frontageRoadId}`], ['Height', `${b.height.toFixed(1)} m · ${b.floorsEstimate} floors`], ['Footprint', `${b.footprintArea.toFixed(0)} m² · coverage ${pct(b.coverageRatio, 0)}`], ['Base elevation', `${b.baseElevation.toFixed(1)} m · plinth ${b.plinthHeight.toFixed(1)} m`], ['Type', b.buildingType], ['Growth event', NA('single chunk')]] };
  }
  if (picked.kind === 'road') {
    const e = network.edges.find(edge => edge.id === picked.id);
    return { title: `Road edge ${e.id}`, rows: [city, ['Stage', 'Road Network'], ['Class', `${e.roadClass} · ${e.kind}`], ['Width', `${e.width} m`], ['Length', `${e.length.toFixed(0)} m`], ['Nodes', `${e.from} → ${e.to}`], ['Straightness', e.straightness.toFixed(2)], ['Made by', e.source ?? NA('not recorded')], ['Growth event', NA('single chunk')]] };
  }
  if (picked.kind === 'parcel') {
    const p = parcels.parcels[picked.index];
    const vacant = buildings.vacant.find(item => item.parcelId === p.id);
    const built = buildings.buildings.find(item => item.parcelId === p.id);
    return { title: `Parcel ${p.id}`, rows: [city, ['Stage', 'Parcels'], ['Block', p.blockId], ['Frontage road', `edge ${p.frontageRoadId} · ${p.frontageType}`], ['Frontage', `${p.frontageLength.toFixed(1)} m`], ['Area', `${p.area.toFixed(0)} m²`], ['Depth', `${p.depth.toFixed(1)} m`], ['Status', p.buildableStatus], ['Building', built ? built.id : vacant ? `vacant: ${vacant.reason}` : NA('not recorded')]] };
  }
  if (picked.kind === 'block') {
    const b = blocks.blocks[picked.index];
    return { title: `Block ${b.id}`, rows: [city, ['Stage', 'Urban Blocks'], ['Enclosure', b.enclosure], ['Status', b.buildableStatus], ['Area', `${n(b.area)} m² · buildable ${n(b.buildableArea ?? 0)} m²`], ['Adjacent roads', `${b.adjacentRoads.length} edge(s)`], ['Parcels', String(parcels.parcels.filter(p => p.blockId === b.id).length)], ['Mean slope', `${b.terrainStats.meanSlope.toFixed(1)}°`]] };
  }
  return { title: 'Chunk', rows: [city, ['Chunk ID', NA(STANDALONE)], ['Terrain', `${config.landform} · seed ${config.seed}`], ['Ground', `${picked.height.toFixed(1)} m at (${picked.x.toFixed(0)}, ${picked.z.toFixed(0)})`]] };
}

// ---------- Part II: everything below reads the baked replay of the saved verifier run ----------
export function sourceRows(scene, info, level) {
  const commit = scene.worldSeed === null ? 'generated on this page from the current code' : info?.bakedAtCommit ? `baked from the working tree after commit ${info.bakedAtCommit}; signatures checked` : 'loading';
  return [
    ['Type', scene.sourceType],
    ...(level ? [['Current view', `${level.label}. ${level.note}`]] : []),
    ['Validation', scene.validationStatus],
    ['World seed', scene.worldSeed !== null ? String(scene.worldSeed) : NA('Part I has no world, only a terrain seed')],
    ['Source', scene.sourceFile],
    ['Version', commit],
    ['Snapshots', scene.availableSnapshots],
    ['Growth events', String(scene.availableGrowthEvents)],
  ];
}

export const WORLD_FLOW = {
  origins: { input: 'world seed, 6 City DNAs, terrain probes', process: 'WorldContext.initialise() → placeOriginsSteps()', output: '6 core chunks, placement reasons', what: 'One core chunk per city, in one coordinate frame.', rules: 'Sites are screened and scored by five terms. A seeded weighted draw orders them; cities with the fewest sites claim first, at a minimum distance.', next: 'Each core becomes the first frontier of its city.' },
  growth: { input: 'frontier cells of every city, Growth DNA', process: 'WorldGrowthController.step()', output: 'one chunk, one history event', what: 'One city wins each step and grows into one neighbouring cell.', rules: 'Bid = rate × best score / (1 + chunks grown) × seeded share. The cell is then drawn by score.', next: 'New chunks extend the frontier. Map size and borders result from this.' },
  encounter: { input: 'test row of cells, two hand-placed cores (a controlled experiment)', process: 'UrbanEncounter.growWithNegotiation()', output: 'encounter record, decisions', what: 'What happens at the edge when a grid city and an organic city meet.', rules: 'Road ends must align within tolerance on acceptable terrain, or the edge stays separate or a plan.', next: 'Not yet part of the grown world. A later task must reach this through growth.' },
};

export const WORLD_HOW = {
  origins: { steps: ['for each city: screen cells by landform and water, probe real terrain at the sites kept', 'score = weighted slope, buildable, water, terrain type, DNA fit', 'order the qualified sites of each city by a seeded weighted draw', 'cities with the fewest qualified sites claim first (a seeded value breaks ties)', 'each takes its first site at the minimum distance from earlier cities', 'if a city fails, no city is registered'], constraints: 'Weights are design hypotheses, not calibrated.', files: [['OriginPlacement.js', '../../index.html#files?file=./experiments/city-of-cities/OriginPlacement.js']], more: '../../index.html#files?file=./docs/procedural-mini-world/A-City-of-Cities/G01-Multi-Origin-Initialization.md' },
  growth: { steps: ['for each city: evaluate its frontier cells', 'bid = rate × best score / (1 + chunks grown) × seeded ± share', 'the highest bid grows', 'draw a cell, weighted by score^4', 'generate the chunk with the unchanged chain, record the event'], constraints: 'Chunks are generated independently here. Seams are recorded, not repaired.', files: [['WorldGrowthController.js', '../../index.html#files?file=./experiments/city-of-cities/WorldGrowthController.js'], ['GrowthEvaluation.js', '../../index.html#files?file=./experiments/city-of-cities/GrowthEvaluation.js']], more: '../../index.html#files?file=./docs/procedural-mini-world/A-City-of-Cities/G02-Procedural-Urban-Growth.md' },
  encounter: { steps: ['place both cores by hand in one row', 'grow one city toward the other, road first', 'read both boundaries: ports, height steps, water', 'decide: connection, pending plan or separation', 'verify any connection by a route over the road graph'], constraints: 'A test fixture only. The thresholds are hypotheses.', files: [['UrbanEncounter.js', '../../index.html#files?file=./experiments/city-of-cities/UrbanEncounter.js'], ['encounterFixture.js', '../../index.html#files?file=./experiments/city-of-cities/encounterFixture.js']], more: '../../index.html#files?file=./docs/procedural-mini-world/A-City-of-Cities/G03b-Urban-Encounter.md' },
};

export function originParamRows(info, cityId) {
  const city = info.cities.find(item => item.cityId === cityId) ?? info.cities[0];
  const r = city.reason;
  const terms = r.terms;
  return [
    ['City ID', city.cityId],
    ['City seed', String(city.citySeed)],
    ['Origin chunk', `${city.origin} at cell (${city.gx}, ${city.gy}) · ${r.landform}`],
    ['Origin suitability', r.score.toFixed(2)],
    ['Suitability terms', `slope ${terms.slope} · buildable ${terms.buildable} · water ${terms.water} · terrain type ${terms.terrainType} · DNA fit ${terms.dnaFit}`],
    ['Placement reason', r.text],
    ['Claim order', `${r.order + 1} of 6`],
    ['Minimum distance', `${info.params.minOriginDistance} chunks`],
    ['All cities', info.cities.map(item => item.cityId).join(', ')],
  ];
}

export function growthParamRows(info, event) {
  if (!event) return [['Growth step', NA('no growth has happened yet at this point of the timeline')]];
  const r = event.reason;
  const dx = event.target.gx - Number(event.parent.split('_')[1]); const dy = event.target.gy - Number(event.parent.split('_')[2]);
  const side = dx > 0 ? 'east' : dx < 0 ? 'west' : dy > 0 ? 'south' : 'north';
  const seam = event.conflicts.find(item => item.with === event.parent);
  const bids = [...r.bids].sort((a, b) => b.bid - a.bid).slice(0, 3).map(b => `${b.cityId} ${b.bid.toFixed(2)}`).join(' · ');
  return [
    ['Growth step', `${event.step} of ${info.history.length}`],
    ['Source city', event.cityId],
    ['Parent chunk', event.parent],
    ['Growth front', `${side} edge of ${event.parent}`],
    ['New chunk', `${event.chunk} · generation ${event.generation} · ${r.terms.landform}`],
    ['Growth rule', `score ${event.score.toFixed(2)}: terrain ${r.groups.terrain}, water ${r.groups.water}, infrastructure ${r.groups.infrastructure}, urban ${r.groups.urban}`],
    ['Candidate selection', `weight ${event.weight.toFixed(2)} among this city's frontier cells`],
    ['City bids', bids],
    ['Contested', r.contested.length ? r.contested.join(', ') : 'no other city wanted this cell'],
    ['Generated', `${event.counts.roadKm} km roads · ${event.counts.blocks} blocks · ${event.counts.parcels} parcels · ${event.counts.buildings} buildings`],
    ['Inherited road', NA('G02 generates each chunk independently; road-first continuity is G02b, a separate experiment')],
    ['Seam to parent', seam ? `${seam.geometry}, up to ${seam.maxDh} m · ${seam.roads.paired} road ports align, none joined` : NA('not recorded')],
    ['Decision', r.text],
  ];
}

export function encounterParamRows(item) {
  if (!item) return [['Scenario', NA('not loaded')]];
  const e = item.encounter;
  const road = e.roadInterfaceConditions[0]; const terrain = e.terrainConditions[0];
  return [
    ['Experiment', `${item.title} · controlled, hand-placed`],
    ['Cities', `${e.cityA} × ${e.cityB}`],
    ['States', Object.entries(e.states).filter(([, on]) => on).map(([state]) => state).join(', ')],
    ['Relationship', e.currentRelationship],
    // The cities share an edge, or a gap lies between them (barrier scenario): the record differs.
    ['Road interface', !road ? NA('no shared edge') : road.portsA !== undefined ? `${road.portsA} and ${road.portsB} ports · ${road.alignedWithinTolerance} aligned` : `${road.from} toward ${road.toward}: ${road.passing} of ${road.ports} ports pass`],
    ['Constraints', !terrain ? NA('no shared edge') : terrain.medianHeightStepM !== undefined ? `height step median ${terrain.medianHeightStepM} m, up to ${terrain.maxHeightStepM} m · barrier ${terrain.barrier ? 'yes' : 'no'}` : `cell ${terrain.cell}: ${terrain.landform}, mean slope ${terrain.meanLandSlopeDeg}°, buildable ${pct(terrain.buildableFraction, 0)}`],
    ['Cross-city joins', String(e.crossCityConnections.length)],
    ['Reason', e.decisionReason],
    ['Validation', e.validationStatus],
  ];
}

export function worldLiveRows(c, total) {
  return [
    ['Growth chunks', `${Math.max(0, c.chunks - 6)} of ${total - 6} (${c.chunks} with origins)`],
    ['Growth steps', `${c.steps} recorded`],
    ['Roads generated', `${c.roadKm.toFixed(1)} km`],
    ['Blocks generated', c.blocks.toLocaleString('en-US')],
    ['Parcels generated', c.parcels.toLocaleString('en-US')],
    ['Buildings generated', c.buildings.toLocaleString('en-US')],
    ['Active growth frontiers', NA('frontiers are not saved per step')],
    ['Verified connections', '0 in this run: G02 records aligned ports, it joins no roads'],
  ];
}

export function worldChunkRows(meta, event) {
  return {
    title: `Chunk ${meta.id}`,
    rows: [
      ['City ID', meta.cityId], ['Chunk ID', meta.id], ['Role', meta.role], ['Parent chunk', meta.parent ?? NA('an origin has no parent')], ['Growth step', String(meta.step)], ['Terrain', `${meta.terrainType} · seed ${meta.terrainSeed}`],
      ['Generated', `${meta.counts.roadKm} km roads · ${meta.counts.blocks} blocks · ${meta.counts.parcels} parcels · ${meta.counts.buildings} buildings`],
      ['Terrain fit', meta.fitScore !== undefined ? meta.fitScore.toFixed(2) : NA('not recorded')],
      ['Signatures', `${meta.signatures.network} ${meta.signatures.buildings}`],
      ['Growth event', event ? `step ${event.step}, score ${event.score.toFixed(2)}` : NA('origins are not growth events')],
    ],
  };
}
