// WEB-01 Generation Snapshot: runs the unchanged single-chunk chain off the main thread, in the order of
// experiments/seed-terrain/main.js, and reports each real stage as it finishes. It generates nothing of its own.
import { createSeedTerrainConfig } from '../seed-terrain/config.js';
import { generateChunk } from '../seed-terrain/TerrainGenerator.js';
import { applyNeighborConstraints, deriveFields } from '../seed-terrain/TerrainFields.js';
import { analyseTerrain } from '../seed-terrain/TerrainAnalysis.js';
import { matchCity } from '../seed-terrain/CityMatcher.js';
import { generateNetwork } from '../seed-terrain/NetworkGenerator.js';
import { generateBlocks } from '../seed-terrain/BlockGenerator.js';
import { generateParcels } from '../seed-terrain/ParcelGenerator.js';
import { generateBuildings } from '../seed-terrain/BuildingGenerator.js';

self.onmessage = ({ data: { city, landform, seed } }) => {
  try {
    const timings = {};
    const stage = (id, run) => {
      const start = performance.now();
      const value = run();
      timings[id] = Math.round(performance.now() - start);
      self.postMessage({ type: 'progress', stage: id });
      return value;
    };
    const config = createSeedTerrainConfig({ landform, seed });
    const fields = stage('terrain', () => {
      const result = deriveFields(generateChunk(config), config);
      applyNeighborConstraints(result); // no neighbours in a single chunk: identity
      return result;
    });
    const analysis = stage('analysis', () => analyseTerrain(fields, config));
    const cityMatch = matchCity(analysis, { override: city });
    const network = stage('roads', () => generateNetwork(fields, analysis, cityMatch, config, { loops: true }));
    const blocks = stage('blocks', () => generateBlocks(fields, analysis, network, cityMatch, config));
    const parcels = stage('parcels', () => generateParcels(blocks, fields, network, cityMatch, config));
    const buildings = stage('buildings', () => generateBuildings(parcels, fields, cityMatch, config));
    self.postMessage({ type: 'done', snapshot: { city, config, fields, analysis, cityMatch, network, blocks, parcels, buildings, timings } });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
