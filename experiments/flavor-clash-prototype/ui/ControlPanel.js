import GUI from 'lil-gui';
import { cloneWorldConfig } from '../config/worldConfig.js';
import { cloneRegionPresets } from '../config/regionPresets.js';

const REGION_FIELDS = [
  ['enabled'], ['visible'], ['seedOffset', 0, 9999, 1], ['centerX', -22, 22, 0.5], ['centerZ', -22, 22, 0.5],
  ['width', 10, 24, 1], ['depth', 10, 24, 1], ['heightScale', 0, 9, 0.1], ['noiseScale', 2, 16, 0.1],
  ['noiseStrength', 0, 1.5, 0.01], ['waterLevel', -1, 3, 0.05], ['terrainResolution', 12, 72, 1],
  ['roadDensity', 0.1, 0.95, 0.01], ['wfcRetryLimit', 1, 20, 1], ['mainRoadWidth', 0.35, 1.8, 0.05],
  ['routeCurvature', 0, 1, 0.01], ['scatterDensity', 0, 1, 0.01], ['scatterMinDistance', 0.7, 3.5, 0.05],
  ['maxScatterSlope', 0.1, 1.5, 0.01], ['terrainColor'], ['roadColor'],
];

function downloadJson(filename, value) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export class ControlPanel {
  constructor(container, worldMap, worldConfig, regionConfigs, callbacks = {}) {
    this.container = container;
    this.worldMap = worldMap;
    this.worldConfig = worldConfig;
    this.regionConfigs = regionConfigs;
    this.callbacks = callbacks;
    this.pending = new Map();
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.hidden = true;
    document.body.append(this.fileInput);
    this.fileInput.addEventListener('change', event => this.importFile(event));
    this.build();
  }

  build() {
    this.gui?.destroy();
    this.gui = new GUI({ title: 'Map Prototype 0.1', container: this.container, width: 340 });
    const global = this.gui.addFolder('Global Map');
    global.add(this.worldConfig, 'worldSeed').name('World Seed').onFinishChange(() => this.regenerateAll());
    global.add(this.worldConfig, 'mapWidth', 42, 72, 1).name('Map Width').onFinishChange(() => this.reflowRegions());
    global.add(this.worldConfig, 'mapDepth', 42, 72, 1).name('Map Depth').onFinishChange(() => this.reflowRegions());
    global.add(this.worldConfig, 'regionGap', 1, 10, 0.5).name('Region Gap').onFinishChange(() => this.reflowRegions());
    global.add(this.worldConfig, 'centralPlazaRadius', 2.5, 8, 0.25).name('Plaza Radius').onFinishChange(() => this.reflowRegions());
    global.add(this.worldConfig, 'terrainResolution', 12, 72, 1).name('Shared Resolution').onFinishChange(value => {
      Object.values(this.regionConfigs).forEach(region => { region.terrainResolution = value; });
      this.regenerateAll();
    });
    global.add(this.worldConfig, 'quality', ['Draft', 'Standard', 'High']).onFinishChange(() => this.regenerateAll());
    global.add(this.worldConfig, 'autoRegenerate').name('Auto Regenerate');
    global.add(this.worldConfig, 'showRegionBounds').name('Region Bounds').onChange(() => this.worldMap.setDebugVisibility());
    global.add(this.worldConfig, 'showWfcGrid').name('WFC Grid').onChange(() => this.worldMap.setDebugVisibility());
    global.add(this.worldConfig, 'showRoadConnections').name('Road Connections').onChange(() => this.worldMap.setDebugVisibility());
    global.add(this.worldConfig, 'showScatterCandidates').name('Scatter Candidates').onChange(() => this.worldMap.setDebugVisibility());
    global.add(this.worldConfig, 'showRejectedScatter').name('Rejected Scatter').onChange(() => this.worldMap.setDebugVisibility());
    global.add(this.worldConfig, 'showBuildabilityHeatmap').name('Buildability Heatmap').onChange(value => this.worldMap.setBuildabilityHeatmap(value));
    global.add(this.worldConfig, 'showWaterMask').name('Water Mask').onChange(value => this.worldMap.setWaterMaskOverlay(value));

    for (const [id, config] of Object.entries(this.regionConfigs)) this.addRegionFolder(id, config);

    const actions = {
      regenerateAll: () => this.regenerateAll(),
      exportJSON: () => downloadJson('flavor-clash-map-0.1.json', this.worldMap.serialize()),
      importJSON: () => this.fileInput.click(),
      savePreset: () => localStorage.setItem('flavor-clash-map-preset', JSON.stringify(this.worldMap.serialize())),
      loadPreset: () => this.loadPreset(),
      resetPrototype: () => this.resetPrototype(),
    };
    const tools = this.gui.addFolder('Configuration');
    tools.add(actions, 'regenerateAll').name('Regenerate All');
    tools.add(actions, 'exportJSON').name('Export JSON');
    tools.add(actions, 'importJSON').name('Import JSON');
    tools.add(actions, 'savePreset').name('Save Browser Preset');
    tools.add(actions, 'loadPreset').name('Load Browser Preset');
    tools.add(actions, 'resetPrototype').name('Reset Prototype');
  }

  addRegionFolder(id, config) {
    const folder = this.gui.addFolder(config.label);
    for (const [property, min, max, step] of REGION_FIELDS) {
      const controller = typeof min === 'number'
        ? folder.add(config, property, min, max, step)
        : property.endsWith('Color') ? folder.addColor(config, property) : folder.add(config, property);
      controller.name(property.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()));
      if (property === 'visible') controller.onChange(value => this.worldMap.setRegionVisible(id, value));
      else if (property.endsWith('Color')) controller.onChange(() => this.worldMap.updateRegionMaterials(id));
      else controller.onFinishChange(() => this.scheduleRegion(id));
    }
    const actions = {
      regenerate: () => this.regenerateRegion(id),
      reset: () => this.resetRegion(id),
    };
    folder.add(actions, 'regenerate').name(`Regenerate ${config.label}`);
    folder.add(actions, 'reset').name(`Reset ${config.label}`);
    if (config.enableBuildingScatter === true) {
      const buildings = folder.addFolder('Buildings');
      buildings.add(config, 'buildingSeed', 0, 999999, 1).name('Seed');
      buildings.add(config, 'buildingDensity', 0, 1, 0.01).name('Density');
      buildings.add(config, 'buildingCountLimit', 0, 250, 1).name('Count Limit');
      buildings.add({ regenerate: () => this.regenerateBuildings(id) }, 'regenerate').name('Regenerate Buildings');
    }
    folder.close();
  }

  regenerateBuildings(id) {
    this.callbacks.setStatus?.(`Generating ${this.regionConfigs[id].label} buildings…`);
    requestAnimationFrame(() => {
      this.worldMap.regenerateBuildings(id);
      this.callbacks.setStatus?.(`${this.regionConfigs[id].label} buildings ready`);
    });
  }

  scheduleRegion(id) {
    if (!this.worldConfig.autoRegenerate) return;
    clearTimeout(this.pending.get(id));
    this.pending.set(id, setTimeout(() => this.regenerateRegion(id), 180));
  }

  regenerateRegion(id) {
    this.callbacks.setStatus?.(`Generating ${this.regionConfigs[id].label}…`);
    requestAnimationFrame(() => {
      this.worldMap.regenerateRegion(id);
      this.callbacks.setStatus?.(`${this.regionConfigs[id].label} ready`);
    });
  }

  regenerateAll() {
    this.callbacks.setStatus?.('Generating all regions…');
    requestAnimationFrame(() => {
      this.worldMap.generateAll();
      this.callbacks.setStatus?.('All regions ready');
    });
  }

  reflowRegions() {
    const signs = { iceland: [-1, -1], tokyo: [1, -1], venice: [-1, 1], hawaii: [1, 1] };
    for (const [id, config] of Object.entries(this.regionConfigs)) {
      const [signX, signZ] = signs[id];
      const desiredX = this.worldConfig.centralPlazaRadius + this.worldConfig.regionGap + config.width / 2;
      const desiredZ = this.worldConfig.centralPlazaRadius + this.worldConfig.regionGap + config.depth / 2;
      const fittingX = Math.max(config.width / 2, this.worldConfig.mapWidth / 2 - config.width / 2 - 1);
      const fittingZ = Math.max(config.depth / 2, this.worldConfig.mapDepth / 2 - config.depth / 2 - 1);
      config.centerX = signX * Math.min(desiredX, fittingX);
      config.centerZ = signZ * Math.min(desiredZ, fittingZ);
    }
    this.gui.controllersRecursive().forEach(controller => controller.updateDisplay());
    this.regenerateAll();
  }

  resetRegion(id) {
    Object.assign(this.regionConfigs[id], cloneRegionPresets()[id]);
    this.build();
    this.regenerateRegion(id);
  }

  resetPrototype() {
    Object.assign(this.worldConfig, cloneWorldConfig());
    const defaults = cloneRegionPresets();
    Object.keys(this.regionConfigs).forEach(id => Object.assign(this.regionConfigs[id], defaults[id]));
    this.build();
    this.regenerateAll();
  }

  async importFile(event) {
    const [file] = event.target.files;
    if (!file) return;
    try {
      this.worldMap.applyConfiguration(JSON.parse(await file.text()));
      this.build();
      this.callbacks.setStatus?.('Imported configuration');
    } catch (error) {
      this.callbacks.setStatus?.(`Import failed: ${error.message}`, true);
    } finally {
      event.target.value = '';
    }
  }

  loadPreset() {
    const saved = localStorage.getItem('flavor-clash-map-preset');
    if (!saved) return this.callbacks.setStatus?.('No browser preset saved', true);
    this.worldMap.applyConfiguration(JSON.parse(saved));
    this.build();
    this.callbacks.setStatus?.('Browser preset loaded');
  }

  dispose() {
    for (const timeout of this.pending.values()) clearTimeout(timeout);
    this.gui.destroy();
    this.fileInput.remove();
  }
}
