import * as THREE from 'three';
import { qualitySettings } from '../config/worldConfig.js';
import { Region } from './Region.js';
import { layoutFitsWorld } from './RegionLayout.js';

export class WorldMap {
  constructor(scene, worldConfig, regionConfigs, onStats = () => {}) {
    this.scene = scene;
    this.worldConfig = worldConfig;
    this.regionConfigs = regionConfigs;
    this.onStats = onStats;
    this.root = new THREE.Group();
    this.root.name = 'Flavor Clash finite world';
    this.scene.add(this.root);
    this.regions = new Map();
    this.plaza = null;
    this.boundary = null;
  }

  createWorldFrame() {
    this.plaza?.removeFromParent();
    this.plaza?.geometry.dispose();
    this.plaza?.material.dispose();
    this.boundary?.removeFromParent();
    this.boundary?.geometry.dispose();
    this.boundary?.material.dispose();
    const plazaGeometry = new THREE.CylinderGeometry(this.worldConfig.centralPlazaRadius, this.worldConfig.centralPlazaRadius, 0.35, 48);
    const plazaMaterial = new THREE.MeshStandardMaterial({ color: 0xd2b45f, roughness: 0.7, metalness: 0.18 });
    this.plaza = new THREE.Mesh(plazaGeometry, plazaMaterial);
    this.plaza.position.y = 0.08;
    this.plaza.name = 'Central Crown Plaza';
    const boundarySource = new THREE.BoxGeometry(this.worldConfig.mapWidth, 1.2, this.worldConfig.mapDepth);
    const boundaryGeometry = new THREE.EdgesGeometry(boundarySource);
    boundarySource.dispose();
    const boundaryMaterial = new THREE.LineBasicMaterial({ color: 0x305fd6, transparent: true, opacity: 0.78 });
    this.boundary = new THREE.LineSegments(boundaryGeometry, boundaryMaterial);
    this.boundary.position.y = 0.6;
    this.boundary.name = 'Finite world boundary';
    this.root.add(this.plaza, this.boundary);
  }

  generateAll() {
    const started = performance.now();
    this.createWorldFrame();
    for (const id of Object.keys(this.regionConfigs)) this.generateRegion(id, this.regionConfigs[id], false);
    this.emitStats(performance.now() - started);
    return this.serialize();
  }

  generateRegion(regionId, config = this.regionConfigs[regionId], notify = true) {
    if (!config) throw new Error(`Unknown region: ${regionId}`);
    this.regionConfigs[regionId] = config;
    let region = this.regions.get(regionId);
    if (!region) {
      region = new Region(regionId, config, this.worldConfig, qualitySettings[this.worldConfig.quality]);
      this.regions.set(regionId, region);
    }
    region.worldConfig = this.worldConfig;
    region.quality = qualitySettings[this.worldConfig.quality];
    const result = region.generate(config);
    if (result) this.root.add(result.object3D);
    if (notify) this.emitStats(result?.generationTime ?? 0, regionId);
    return result;
  }

  regenerateRegion(regionId) {
    return this.generateRegion(regionId, this.regionConfigs[regionId]);
  }

  regenerateBuildings(regionId) {
    const buildings = this.regions.get(regionId)?.regenerateBuildings();
    if (buildings) this.emitStats(buildings.generationTime, `${regionId}-buildings`);
    return buildings;
  }

  setRegionVisible(regionId, visible) {
    this.regions.get(regionId)?.setVisible(visible);
  }

  updateRegionMaterials(regionId) {
    this.regions.get(regionId)?.updateMaterials();
  }

  setDebugVisibility() {
    for (const region of this.regions.values()) region.setDebugVisibility(this.worldConfig);
  }

  setBuildabilityHeatmap(enabled) {
    this.worldConfig.showBuildabilityHeatmap = enabled;
    for (const region of this.regions.values()) region.setBuildabilityHeatmap(enabled);
  }

  setWaterMaskOverlay(enabled) {
    this.worldConfig.showWaterMask = enabled;
    for (const region of this.regions.values()) region.setWaterMaskOverlay(enabled);
  }

  disposeRegion(regionId) {
    this.regions.get(regionId)?.dispose();
    this.regions.delete(regionId);
  }

  serializeRegionConfig(regionId) {
    return this.regions.get(regionId)?.serialize() ?? null;
  }

  serialize() {
    return {
      schemaVersion: 1,
      world: JSON.parse(JSON.stringify(this.worldConfig)),
      regions: JSON.parse(JSON.stringify(this.regionConfigs)),
    };
  }

  signature(regionId) {
    const result = this.regions.get(regionId)?.result;
    if (!result) return null;
    return JSON.stringify({
      seed: result.seed,
      roads: [...result.roads.connected].map(index => {
        const tile = result.roads.tiles[index];
        return [index, tile.name, tile.rotation];
      }),
      scatter: result.decorations.accepted.map(point => [
        Number(point.x.toFixed(4)), Number(point.y.toFixed(4)), Number(point.z.toFixed(4)),
      ]),
      buildings: result.buildings.accepted.map(point => [
        Number(point.x.toFixed(4)), Number(point.y.toFixed(4)), Number(point.z.toFixed(4)),
      ]),
    });
  }

  applyConfiguration(configuration) {
    if (configuration?.schemaVersion !== 1 || !configuration.world || !configuration.regions) throw new Error('Unsupported Flavor Clash configuration.');
    Object.assign(this.worldConfig, configuration.world);
    for (const [id, config] of Object.entries(configuration.regions)) {
      if (this.regionConfigs[id]) Object.assign(this.regionConfigs[id], config);
    }
    return this.generateAll();
  }

  emitStats(totalTime, changedRegion = 'all') {
    const regions = {};
    let objects = 0;
    for (const [id, region] of this.regions) {
      if (!region.result) continue;
      regions[id] = {
        seed: region.result.seed,
        generationTime: region.result.generationTime,
        objectCount: region.result.objectCount,
        ...region.result.debugData,
      };
      objects += region.result.objectCount;
    }
    this.onStats({ totalTime, changedRegion, objects, regions, layoutValid: layoutFitsWorld(this.worldConfig, this.regionConfigs) });
  }

  dispose() {
    for (const region of this.regions.values()) region.dispose();
    this.regions.clear();
    this.plaza?.geometry.dispose();
    this.plaza?.material.dispose();
    this.boundary?.geometry.dispose();
    this.boundary?.material.dispose();
    this.root.removeFromParent();
  }
}
