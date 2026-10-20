import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDefaultConfig } from '../iceland-region/config.js';
import { IcelandTerrain } from '../iceland-region/IcelandTerrain.js';
import { SurfaceQuery } from '../iceland-region/SurfaceQuery.js';
import { createRoadDocument } from '../iceland-region/roadData.js';
import { createProjectionOptions } from '../road-projection/config.js';
import { RoadProjector } from '../road-projection/RoadProjector.js';
import { createRoadMeshOptions } from './config.js';
import { RoadMeshBuilder } from './RoadMeshBuilder.js';
import { ControlPanel } from './ControlPanel.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

const canvas = document.querySelector('#roadCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x091014);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x091014, 0.018);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 180);
camera.position.set(28, 22, 30);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2.2, 0);
controls.enableDamping = true;
controls.minDistance = 10;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xc9e8f2, 0x152024, 2.2));
const sun = new THREE.DirectionalLight(0xfff4df, 3.4);
sun.position.set(-18, 30, 15);
sun.castShadow = true;
scene.add(sun);

const terrain = new IcelandTerrain(scene, createDefaultConfig());
terrain.regenerate();
const projectionOptions = createProjectionOptions();
const surfaceQuery = new SurfaceQuery(terrain, {
  maxRoadSlope: projectionOptions.maximumSlope,
  waterSafetyDistance: projectionOptions.waterClearance,
  sampleSpacing: projectionOptions.sampleSpacing,
});
const projector = new RoadProjector(surfaceQuery, projectionOptions);
let projectionRuns = 0;
const projectedRoadData = deepFreeze(JSON.parse(JSON.stringify(projector.project(createRoadDocument()))));
projectionRuns += 1;
const projectedInputSnapshot = JSON.stringify(projectedRoadData);
const options = createRoadMeshOptions();
const builder = new RoadMeshBuilder(scene, options);
let output = null;

function invalidSegmentCount() {
  return projectedRoadData.paths.reduce((total, path) => total + path.samples.slice(1).filter((sample, index) => !sample.valid || !path.samples[index].valid).length, 0);
}

function updateStats() {
  const roads = output.roads;
  document.querySelector('#roadCount').textContent = roads.length;
  document.querySelector('#vertexCount').textContent = roads.reduce((sum, road) => sum + road.vertexCount, 0);
  document.querySelector('#triangleCount').textContent = roads.reduce((sum, road) => sum + road.triangleCount, 0);
  document.querySelector('#roadLength').textContent = `${roads.reduce((sum, road) => sum + road.length, 0).toFixed(2)} m`;
  document.querySelector('#invalidSegments').textContent = invalidSegmentCount();
  document.querySelector('#meshSignature').textContent = builder.lastGeometrySignatures.join(' / ');
  document.querySelector('#terrainSignature').textContent = terrain.lastResult.signature;
  document.querySelector('#projectionRuns').textContent = projectionRuns;
  document.querySelector('#statusText').textContent = 'MESH READY';
}

function rebuild() {
  document.querySelector('#statusText').textContent = 'BUILDING';
  output = builder.build(projectedRoadData);
  updateStats();
  return output;
}

const panel = new ControlPanel(document.querySelector('#guiMount'), options, {
  rebuild,
  setWireframe: value => builder.setWireframe(value),
  setCenterlineVisible: value => builder.setCenterlineVisible(value),
  setInvalidVisible: value => builder.setInvalidVisible(value),
});
rebuild();

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

let running = true;
function animate() {
  if (!running) return;
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.__roadMeshLab = {
  ready: true,
  terrain,
  options,
  builder,
  projectedRoadData,
  projectedInputSnapshot,
  get projectionRuns() { return projectionRuns; },
  get output() { return output; },
  rebuild,
  snapshot: () => ({
    terrainSignature: terrain.lastResult.signature,
    terrainGenerationCount: terrain.generationCount,
    projectionRuns,
    projectedInput: JSON.stringify(projectedRoadData),
    geometrySignatures: [...builder.lastGeometrySignatures],
    vertexCount: output.roads.reduce((sum, road) => sum + road.vertexCount, 0),
    triangleCount: output.roads.reduce((sum, road) => sum + road.triangleCount, 0),
    length: output.roads.reduce((sum, road) => sum + road.length, 0),
    invalidSegments: invalidSegmentCount(),
    disposedGeometries: builder.disposedGeometries,
    disposedMaterials: builder.disposedMaterials,
    rootChildren: builder.root.children.length,
    debugChildren: builder.debugRoot.children.length,
    maxMiterRatio: builder.maxMiterRatio,
  }),
};

window.addEventListener('pagehide', () => {
  running = false;
  panel.dispose();
  builder.dispose();
  terrain.dispose();
  controls.dispose();
  renderer.dispose();
}, { once: true });
