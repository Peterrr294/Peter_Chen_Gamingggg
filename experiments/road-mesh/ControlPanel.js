import GUI from 'lil-gui';
import { createRoadMeshOptions } from './config.js';

export class ControlPanel {
  constructor(container, options, callbacks) {
    this.options = options;
    this.callbacks = callbacks;
    this.gui = new GUI({ title: 'Road Mesh', container, width: 330 });
    const rebuildControls = [
      ['roadWidth', 0.2, 4, 0.05],
      ['surfaceOffset', 0.01, 0.5, 0.01],
      ['uvScale', 0.02, 1, 0.01],
      ['miterLimit', 1, 6, 0.1],
    ];
    for (const [property, min, max, step] of rebuildControls) {
      this.gui.add(options, property, min, max, step)
        .name(property.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()))
        .onFinishChange(() => callbacks.rebuild?.());
    }
    this.gui.add(options, 'showWireframe').name('Show Wireframe').onChange(value => callbacks.setWireframe?.(value));
    this.gui.add(options, 'showCenterline').name('Show Centerline').onChange(value => callbacks.setCenterlineVisible?.(value));
    this.gui.add(options, 'showInvalidSegments').name('Show Invalid Segments').onChange(value => callbacks.setInvalidVisible?.(value));
    const actions = { rebuild: () => callbacks.rebuild?.(), reset: () => this.reset() };
    this.gui.add(actions, 'rebuild').name('Rebuild');
    this.gui.add(actions, 'reset').name('Reset');
  }

  reset() {
    Object.assign(this.options, createRoadMeshOptions());
    this.gui.controllersRecursive().forEach(controller => controller.updateDisplay());
    this.callbacks.rebuild?.();
  }

  dispose() {
    this.gui.destroy();
  }
}
