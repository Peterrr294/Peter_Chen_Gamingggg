import * as THREE from 'three';
import { generateTerrain } from '../generation/TerrainGenerator.js';
import { generateWFCRoads } from '../generation/WFCRoadGenerator.js';
import { generateMainRoute } from '../generation/MainRouteGenerator.js';
import { generateScatter } from '../generation/ScatterGenerator.js';
import { generateBuildings } from '../generation/BuildingScatterGenerator.js';
import { createRegionMaterials, disposeRegionMaterials, updateRegionMaterials } from '../rendering/RegionMaterials.js';
import { createDebugLayers } from '../rendering/DebugLayers.js';
import { regionBounds } from './RegionLayout.js';
import { regionSeed } from './SeededRandom.js';

export class Region {
  constructor(id, config, worldConfig, quality) {
    this.id = id;
    this.config = config;
    this.worldConfig = worldConfig;
    this.quality = quality;
    this.result = null;
  }

  generate(config = this.config) {
    this.config = config;
    this.dispose();
    if (!config.enabled) return null;
    const started = performance.now();
    const seed = regionSeed(this.worldConfig.worldSeed, this.id, config.seedOffset);
    const materials = createRegionMaterials(config);
    const terrain = generateTerrain(this.id, config, seed, materials, this.quality.resolutionScale);
    terrain.setBuildabilityHeatmap(this.worldConfig.showBuildabilityHeatmap);
    terrain.setWaterMaskOverlay(this.worldConfig.showWaterMask);
    const roads = generateWFCRoads(this.id, config, seed, terrain, materials.road);
    const mainRoute = generateMainRoute(config, this.worldConfig, seed, terrain, roads, materials.road);
    const decorations = generateScatter(this.id, config, seed, terrain, roads, mainRoute, materials, this.quality.scatterScale);
    const buildings = generateBuildings(this.id, config, terrain);
    const debugLayers = createDebugLayers(config, terrain, roads, mainRoute, decorations);
    const object3D = new THREE.Group();
    object3D.name = `${config.label} region`;
    object3D.add(terrain.object3D, roads.object3D, mainRoute.object3D, decorations.object3D, buildings.object3D, debugLayers.object3D);
    object3D.visible = config.visible;
    debugLayers.setVisibility(this.worldConfig);
    let objectCount = 0;
    object3D.traverse(() => { objectCount += 1; });
    this.result = {
      id: this.id,
      seed,
      bounds: regionBounds(config),
      terrain,
      roads,
      mainRoute,
      decorations,
      buildings,
      debugData: {
        wfcSuccess: roads.success,
        retries: roads.retries,
        wfcTime: roads.generationTime,
        scatterTime: decorations.generationTime,
        connectedRoadCells: roads.connected.size,
        scatterAccepted: decorations.accepted.length,
        scatterRejected: decorations.rejected.length,
        buildingCount: buildings.accepted.length,
      },
      object3D,
      generationTime: performance.now() - started,
      objectCount,
      materials,
      debugLayers,
    };
    return this.result;
  }

  setVisible(visible) {
    this.config.visible = visible;
    if (this.result) this.result.object3D.visible = visible;
  }

  setDebugVisibility(worldConfig) {
    this.worldConfig = worldConfig;
    this.result?.debugLayers.setVisibility(worldConfig);
  }

  setBuildabilityHeatmap(enabled) {
    this.result?.terrain.setBuildabilityHeatmap(enabled);
  }

  setWaterMaskOverlay(enabled) {
    this.result?.terrain.setWaterMaskOverlay(enabled);
  }

  regenerateBuildings() {
    if (!this.result) return null;
    const previous = this.result.buildings;
    const buildings = generateBuildings(this.id, this.config, this.result.terrain);
    previous.object3D.removeFromParent();
    previous.dispose();
    this.result.object3D.add(buildings.object3D);
    this.result.buildings = buildings;
    this.result.debugData.buildingCount = buildings.accepted.length;
    return buildings;
  }

  updateMaterials() {
    if (this.result) updateRegionMaterials(this.result.materials, this.config);
  }

  serialize() {
    return JSON.parse(JSON.stringify({ id: this.id, ...this.config }));
  }

  dispose() {
    if (!this.result) return;
    this.result.object3D.removeFromParent();
    this.result.terrain.dispose();
    this.result.roads.dispose();
    this.result.mainRoute.dispose();
    this.result.decorations.dispose();
    this.result.buildings.dispose();
    this.result.debugLayers.dispose();
    disposeRegionMaterials(this.result.materials);
    this.result = null;
  }
}
