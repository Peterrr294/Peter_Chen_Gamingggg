import GUI from 'lil-gui';
import { createProjectionOptions } from './config.js';

export class ControlPanel {
  constructor(container, options, callbacks) {
    this.options = options;
    this.callbacks = callbacks;
    this.gui = new GUI({ title: 'Road Projection', container, width: 330 });
    const controls = [
      ['sampleSpacing', 0.1, 2.5, 0.05],
      ['heightOffset', 0.02, 0.8, 0.01],
      ['maximumSlope', 1, 60, 1],
      ['waterClearance', 0, 2, 0.05],
      ['lateralSearchDistance', 0, 5, 0.1],
      ['smoothingIterations', 0, 6, 1],
    ];
    for (const [property, min, max, step] of controls) {
      this.gui.add(options, property, min, max, step)
        .name(property.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()))
        .onFinishChange(() => callbacks.project?.());
    }
    this.gui.add(options, 'enableSlopeAvoidance').name('Enable Slope Avoidance').onChange(() => callbacks.project?.());
    this.gui.add(options, 'showDebug').name('Show Debug').onChange(value => callbacks.setDebugVisible?.(value));
    const actions = {
      project: () => callbacks.project?.(),
      reset: () => this.reset(),
      exportJSON: () => callbacks.exportJSON?.(),
    };
    this.gui.add(actions, 'project').name('Project');
    this.gui.add(actions, 'reset').name('Reset');
    this.gui.add(actions, 'exportJSON').name('Export');
  }

  reset() {
    Object.assign(this.options, createProjectionOptions());
    this.gui.controllersRecursive().forEach(controller => controller.updateDisplay());
    this.callbacks.project?.();
    this.callbacks.setDebugVisible?.(this.options.showDebug);
  }

  dispose() {
    this.gui.destroy();
  }
}
