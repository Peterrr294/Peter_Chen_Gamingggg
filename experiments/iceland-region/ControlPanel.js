import GUI from 'lil-gui';
import { createDefaultConfig } from './config.js';
import { createRoadOptions } from './roadData.js';

const EXPENSIVE_CONTROLS = [
  ['seed'],
  ['mapWidth', 16, 64, 1],
  ['mapDepth', 16, 64, 1],
  ['resolution', 16, 180, 1],
  ['heightScale', 0.5, 16, 0.1],
  ['largeNoiseScale', 3, 28, 0.1],
  ['detailNoiseScale', 0.8, 10, 0.1],
  ['ridgeStrength', 0, 1.5, 0.01],
  ['coastFalloff', 0.05, 0.48, 0.01],
];

export class ControlPanel {
  constructor(container, config, terrain, roadOptions, callbacks = {}) {
    this.config = config;
    this.terrain = terrain;
    this.roadOptions = roadOptions;
    this.callbacks = callbacks;
    this.gui = new GUI({ title: 'Iceland Terrain', container, width: 330 });
    for (const [property, min, max, step] of EXPENSIVE_CONTROLS) {
      const controller = typeof min === 'number'
        ? this.gui.add(config, property, min, max, step)
        : this.gui.add(config, property);
      controller.name(property.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()));
      controller.onFinishChange(() => this.regenerate());
    }
    this.gui.add(config, 'waterLevel', -1.5, 3, 0.05).name('Water Level').onChange(value => {
      terrain.updateWaterLevel(value);
      callbacks.updateRoadPreview?.();
      callbacks.updateStatus?.();
    });
    this.gui.add(config, 'wireframe').name('Wireframe').onChange(value => {
      terrain.updateWireframe(value);
      callbacks.updateStatus?.();
    });
    const actions = {
      regenerate: () => this.regenerate(),
      reset: () => this.reset(),
    };
    this.gui.add(actions, 'regenerate').name('Regenerate');
    this.gui.add(actions, 'reset').name('Reset');

    const roadFolder = this.gui.addFolder('Road Input Debug');
    roadFolder.add(roadOptions, 'sampleSpacing', 0.1, 2.5, 0.05).name('Path Sample Spacing').onFinishChange(() => callbacks.updateRoadPreview?.());
    roadFolder.add(roadOptions, 'maxRoadSlope', 1, 60, 1).name('Maximum Road Slope').onFinishChange(() => callbacks.updateRoadPreview?.());
    roadFolder.add(roadOptions, 'waterSafetyDistance', 0, 2, 0.05).name('Water Safety Distance').onFinishChange(() => callbacks.updateRoadPreview?.());
    roadFolder.add(roadOptions, 'previewHeight', 0.02, 0.8, 0.01).name('Road Preview Height').onFinishChange(() => callbacks.updateRoadPreview?.());
    roadFolder.add(roadOptions, 'showRoadDebug').name('Show Road Debug').onChange(value => callbacks.setRoadDebugVisible?.(value));
    const roadActions = {
      validateRoads: () => callbacks.validateRoads?.(),
      exportRoadJSON: () => callbacks.exportRoadJSON?.(),
    };
    roadFolder.add(roadActions, 'validateRoads').name('Validate Road Input');
    roadFolder.add(roadActions, 'exportRoadJSON').name('Export Road JSON');
  }

  regenerate() {
    this.callbacks.setBusy?.(true);
    requestAnimationFrame(() => {
      this.terrain.regenerate();
      this.callbacks.updateRoadPreview?.();
      this.callbacks.setBusy?.(false);
      this.callbacks.updateStatus?.();
    });
  }

  reset() {
    Object.assign(this.config, createDefaultConfig());
    Object.assign(this.roadOptions, createRoadOptions());
    this.gui.controllersRecursive().forEach(controller => controller.updateDisplay());
    this.regenerate();
  }

  dispose() {
    this.gui.destroy();
  }
}
