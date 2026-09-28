// 在 DOM/renderer 替身下验证交互；实际几何使用 Three.js，不替代浏览器视觉检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import * as noise from './noise.js';

test('shared grayscale/heights, simulation pause/resume, resolution, reset and keyboard controls', () => {
  const elements = new Map();
  const context2d = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(image) { this.image = image; }, drawImage() {},
  };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', style: {}, width: 512, height: 512, clientWidth: 512, clientHeight: 512,
      listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, getContext: () => context2d,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 512 }),
    });
    return elements.get(id);
  }
  const controllers = new Map();
  class GUI {
    addFolder() { return this; }
    add(object, property) {
      const controller = { name() { return this; }, onChange(fn) { this.change = fn; return this; },
        onFinishChange(fn) { this.change = fn; return this; }, destroy() {} };
      controller.set = value => { object[property] = value; controller.change?.(value); };
      controllers.set(property, controller);
      return controller;
    }
  }
  const frames = new Map();
  let frameId = 0;
  const windowListeners = {};
  const documentListeners = {};
  const sandbox = {
    ...noise, generateNoiseMap: noise.generateMap, GUI,
    THREE: { ...THREE, WebGLRenderer: class { setPixelRatio() {} setSize() {} render() {} } },
    OrbitControls: class { target = new THREE.Vector3(); update() {} addEventListener() {} },
    ResizeObserver: class { observe() {} }, performance: { now: () => 0 },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    document: { querySelector: element, createElement: () => element('buffer'),
      addEventListener: (type, fn) => { documentListeners[type] = fn; } },
    window: { devicePixelRatio: 1, addEventListener: (type, fn) => { windowListeners[type] = fn; } },
  };
  let source = fs.readFileSync(new URL('./demo.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*;$/gm, '');
  source += '\n globalThis.state = () => ({ heightMap, gridGeometry, parameters, simulationRunning });';
  vm.runInNewContext(source, sandbox);
  function assertShared() {
    const { heightMap, gridGeometry, parameters } = sandbox.state();
    assert.equal(gridGeometry.attributes.position.count, heightMap.length);
    for (let i = 0; i < heightMap.length; i += 1) {
      assert.equal(context2d.image.data[i * 4], Math.round(heightMap[i] * 255));
      assert.ok(Math.abs(gridGeometry.attributes.position.getZ(i) - heightMap[i] * parameters.gridHeight) < 1e-6);
    }
  }
  assertShared();
  element('#mapCanvas').listeners.click({ clientX: 100, clientY: 200 });
  assert.match(element('#heightReadout').textContent, /MATCH/);
  element('#simulationToggle').listeners.click();
  const [id, frame] = frames.entries().next().value;
  frames.delete(id); frame(100);
  assert.ok(sandbox.state().parameters.worldOffsetX > 0);
  assertShared();
  controllers.get('resolution').set(32);
  assertShared();
  element('#simulationToggle').listeners.click();
  assert.equal(sandbox.state().simulationRunning, false);
  assert.equal(frames.size, 0);
  element('#reverse').listeners.click();
  assert.equal(element('#orderResult').textContent, 'PASS / IDENTICAL');
  element('#resetWorld').listeners.click();
  assert.equal(sandbox.state().parameters.worldOffsetX, 0);
  controllers.get('heightMode').set('Binary terraces');
  assertShared();
  const key = value => ({ key: value, code: value, target: { closest: () => null }, preventDefault() {} });
  windowListeners.keydown(key('ArrowLeft'));
  assert.equal(sandbox.state().parameters.worldOffsetX, -2);
  assertShared();
  windowListeners.keydown(key('w'));
  assert.equal(element('#wireframeToggle').textContent, 'SOLID SURFACE');
});
