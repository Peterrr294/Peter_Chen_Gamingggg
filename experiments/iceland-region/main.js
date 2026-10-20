import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDefaultConfig } from './config.js';
import { IcelandTerrain } from './IcelandTerrain.js';
import { ControlPanel } from './ControlPanel.js';
import { SurfaceQuery } from './SurfaceQuery.js';
import { RoadDebugPreview } from './RoadDebugPreview.js';
import { createRoadDocument, createRoadOptions, exportableRoadDocument, validateRoadDocument } from './roadData.js';

const canvas = document.querySelector('#terrainCanvas');
const statusText = document.querySelector('#statusText');
const config = createDefaultConfig();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
scene.add(sun);

const terrain = new IcelandTerrain(scene, config);
terrain.regenerate();
const roadOptions = createRoadOptions();
let roadDocument = createRoadDocument();
const surfaceQuery = new SurfaceQuery(terrain, roadOptions);
const roadPreview = new RoadDebugPreview(scene, roadOptions);
let lastRoadValidation = null;

function setBusy(busy) {
  statusText.textContent = busy ? 'REGENERATING' : 'TERRAIN READY';
  statusText.classList.toggle('busy', busy);
}

function updateStatus() {
  const result = terrain.lastResult;
  document.querySelector('#seedHash').textContent = result.numericSeed;
  document.querySelector('#signature').textContent = result.signature;
  document.querySelector('#vertices').textContent = result.vertices.toLocaleString();
  document.querySelector('#generationTime').textContent = `${result.generationTime.toFixed(1)} ms`;
  document.querySelector('#generationCount').textContent = terrain.generationCount;
  document.querySelector('#disposedCount').textContent = terrain.disposedGeometryCount;
  document.body.dataset.terrainSignature = result.signature;
  document.body.dataset.geometryUuid = result.geometryUuid;
  setBusy(false);
}

function updateRoadReport(validation) {
  const status = document.querySelector('#roadValidation');
  status.textContent = validation.valid ? 'VALID ROAD INPUT' : `${validation.errors.length} VALIDATION ISSUE(S)`;
  status.className = validation.valid ? 'valid' : 'invalid';
  const sampleCount = validation.roads.reduce((total, result) => total + result.samples.length, 0);
  const passableCount = validation.roads.reduce((total, result) => total + result.samples.filter(sample => sample.passable).length, 0);
  document.querySelector('#roadCounts').textContent = `${validation.roads.length} road(s) · ${passableCount}/${sampleCount} passable samples`;
}

function validateRoads() {
  lastRoadValidation = validateRoadDocument(roadDocument, surfaceQuery);
  updateRoadReport(lastRoadValidation);
  return lastRoadValidation;
}

function updateRoadPreview() {
  const validation = validateRoads();
  roadPreview.rebuild(validation, surfaceQuery);
  return validation;
}

function downloadRoadJSON() {
  validateRoads();
  const data = exportableRoadDocument(roadDocument, terrain, roadOptions);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'iceland-road-input.json';
  link.click();
  URL.revokeObjectURL(url);
}

const panel = new ControlPanel(document.querySelector('#guiMount'), config, terrain, roadOptions, {
  setBusy,
  updateStatus,
  updateRoadPreview,
  validateRoads,
  exportRoadJSON: downloadRoadJSON,
  setRoadDebugVisible: visible => roadPreview.setVisible(visible),
});
updateStatus();
updateRoadPreview();

function displaySurfaceQuery(query) {
  document.querySelector('#queryPosition').textContent = `${query.x.toFixed(2)}, ${query.z.toFixed(2)}`;
  document.querySelector('#queryHeight').textContent = query.inBounds ? query.height.toFixed(3) : 'Out of bounds';
  document.querySelector('#querySlope').textContent = query.inBounds ? `${query.slope.toFixed(2)}°` : '—';
  document.querySelector('#queryNormal').textContent = query.normal
    ? `${query.normal.x.toFixed(2)}, ${query.normal.y.toFixed(2)}, ${query.normal.z.toFixed(2)}` : '—';
  document.querySelector('#queryState').textContent = !query.inBounds ? 'OUTSIDE'
    : query.underwater ? 'UNDERWATER'
      : query.passable ? 'PASSABLE' : 'TOO STEEP / WATER MARGIN';
  roadPreview.showQuery(query);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerStart = null;
canvas.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; });
canvas.addEventListener('pointerup', event => {
  if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
  const bounds = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const [intersection] = raycaster.intersectObject(terrain.terrainMesh, false);
  if (intersection) displaySurfaceQuery(surfaceQuery.querySurface(intersection.point.x, intersection.point.z));
});

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
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

window.__icelandRegionLab = {
  ready: true,
  config,
  terrain,
  surfaceQuery,
  roadOptions,
  get roadDocument() { return roadDocument; },
  get roadValidation() { return lastRoadValidation; },
  regenerate: () => { const result = terrain.regenerate(); updateStatus(); updateRoadPreview(); return result; },
  querySurface: (x, z) => surfaceQuery.querySurface(x, z),
  samplePath: points => surfaceQuery.samplePath(points),
  validateRoads,
  setRoadDocument: document => {
    roadDocument = JSON.parse(JSON.stringify(document));
    return updateRoadPreview();
  },
  exportRoadData: () => exportableRoadDocument(roadDocument, terrain, roadOptions),
  signature: () => terrain.lastResult.signature,
  snapshot: () => ({
    signature: terrain.lastResult.signature,
    geometryUuid: terrain.lastResult.geometryUuid,
    generationCount: terrain.generationCount,
    disposedGeometryCount: terrain.disposedGeometryCount,
    sceneChildren: terrain.root.children.length,
  }),
};

window.addEventListener('pagehide', () => {
  running = false;
  panel.dispose();
  roadPreview.dispose();
  terrain.dispose();
  controls.dispose();
  renderer.dispose();
}, { once: true });
