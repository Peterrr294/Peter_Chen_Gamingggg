import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDefaultConfig } from '../iceland-region/config.js';
import { IcelandTerrain } from '../iceland-region/IcelandTerrain.js';
import { SurfaceQuery } from '../iceland-region/SurfaceQuery.js';
import { createRoadDocument } from '../iceland-region/roadData.js';
import { createProjectionOptions } from './config.js';
import { RoadProjector } from './RoadProjector.js';
import { ProjectionDebug } from './ProjectionDebug.js';
import { ControlPanel } from './ControlPanel.js';

const canvas = document.querySelector('#projectionCanvas');
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

const terrainConfig = createDefaultConfig();
const terrain = new IcelandTerrain(scene, terrainConfig);
terrain.regenerate();
const roadDocument = createRoadDocument();
const immutableRoadSnapshot = JSON.stringify(roadDocument);
const options = createProjectionOptions();
const surfaceQueryOptions = { maxRoadSlope: options.maximumSlope, waterSafetyDistance: options.waterClearance, sampleSpacing: options.sampleSpacing };
const surfaceQuery = new SurfaceQuery(terrain, surfaceQueryOptions);
const projector = new RoadProjector(surfaceQuery, options);
const debug = new ProjectionDebug(scene, options, surfaceQuery);
let projection = null;

function updateStats() {
  const paths = projection.paths;
  const samples = paths.flatMap(path => path.samples);
  document.querySelector('#pathCount').textContent = paths.length;
  document.querySelector('#sampleCount').textContent = samples.length;
  document.querySelector('#invalidRangeCount').textContent = paths.reduce((total, path) => total + path.invalidRanges.length, 0);
  document.querySelector('#validSampleCount').textContent = samples.filter(sample => sample.valid).length;
  document.querySelector('#terrainSignature').textContent = terrain.lastResult.signature;
  document.querySelector('#terrainRebuilds').textContent = terrain.generationCount;
  document.querySelector('#outputPreview').textContent = JSON.stringify(projection, null, 2).slice(0, 9000);
  document.querySelector('#outputStatus').textContent = 'SERIALIZABLE / READY';
  document.querySelector('#statusText').textContent = 'PROJECTION READY';
}

function project() {
  document.querySelector('#statusText').textContent = 'PROJECTING';
  surfaceQueryOptions.maxRoadSlope = options.maximumSlope;
  surfaceQueryOptions.waterSafetyDistance = options.waterClearance;
  surfaceQueryOptions.sampleSpacing = options.sampleSpacing;
  projection = projector.project(roadDocument);
  debug.rebuild(projector.debugPaths);
  updateStats();
  return projection;
}

function exportJSON() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(projection, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'iceland-road-projection.json';
  link.click();
  URL.revokeObjectURL(url);
}

const panel = new ControlPanel(document.querySelector('#guiMount'), options, {
  project,
  exportJSON,
  setDebugVisible: visible => debug.setVisible(visible),
});
project();

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

window.__roadProjectionLab = {
  ready: true,
  terrain,
  surfaceQuery,
  options,
  roadDocument,
  immutableRoadSnapshot,
  projector,
  debug,
  project,
  get projection() { return projection; },
  snapshot: () => ({
    terrainSignature: terrain.lastResult.signature,
    terrainGenerationCount: terrain.generationCount,
    roadJson: JSON.stringify(roadDocument),
    projectionJson: JSON.stringify(projection),
    debugChildren: debug.root.children.length,
    disposedDebugLayers: debug.disposedLayers,
  }),
};

window.addEventListener('pagehide', () => {
  running = false;
  panel.dispose();
  debug.dispose();
  terrain.dispose();
  controls.dispose();
  renderer.dispose();
}, { once: true });
