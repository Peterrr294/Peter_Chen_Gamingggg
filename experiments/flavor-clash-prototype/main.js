import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cloneWorldConfig } from './config/worldConfig.js';
import { cloneRegionPresets } from './config/regionPresets.js';
import { WorldMap } from './world/WorldMap.js';
import { ControlPanel } from './ui/ControlPanel.js';

const canvas = document.querySelector('#worldCanvas');
const status = document.querySelector('#generationStatus');
const activeMode = document.querySelector('#activeMode');
const statsMount = document.querySelector('#regionStats');
const layoutStatus = document.querySelector('#layoutStatus');
const worldConfig = cloneWorldConfig();
const regionConfigs = cloneRegionPresets();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x07080b);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07080b, 0.012);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 240);
camera.position.set(44, 42, 44);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 22;
controls.maxDistance = 105;

scene.add(new THREE.HemisphereLight(0xb7ccff, 0x16130d, 2.1));
const sun = new THREE.DirectionalLight(0xfff0d5, 3.1);
sun.position.set(-24, 45, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
scene.add(sun);

function setStatus(message, error = false) {
  status.textContent = message.toUpperCase();
  status.classList.toggle('error', error);
}

function renderStats(report) {
  layoutStatus.textContent = report.layoutValid ? `${report.objects} OBJECTS / LAYOUT VALID` : 'REGIONS EXCEED MAP BOUNDS';
  statsMount.replaceChildren(...Object.entries(regionConfigs).map(([id, config]) => {
    const data = report.regions[id];
    const article = document.createElement('article');
    article.className = 'stat-card';
    if (!data) {
      article.innerHTML = `<h2>${config.label}</h2><p>Disabled</p>`;
      return article;
    }
    article.innerHTML = `<h2>${config.label}</h2><dl>
      <dt>Seed</dt><dd>${data.seed}</dd><dt>WFC</dt><dd class="${data.wfcSuccess ? '' : 'failed'}">${data.wfcSuccess ? 'Solved' : 'Fallback'}</dd>
      <dt>Retries</dt><dd>${data.retries}</dd><dt>Road cells</dt><dd>${data.connectedRoadCells}</dd>
      <dt>Scatter</dt><dd>${data.scatterAccepted}</dd><dt>Rejected</dt><dd>${data.scatterRejected}</dd>
      ${config.enableBuildingScatter === true ? `<dt>Buildings</dt><dd>${data.buildingCount}</dd><dt>Layer</dt><dd>Independent</dd>` : ''}
      <dt>Region time</dt><dd>${data.generationTime.toFixed(1)} ms</dd><dt>WFC time</dt><dd>${data.wfcTime.toFixed(1)} ms</dd>
    </dl>`;
    return article;
  }));
}

const worldMap = new WorldMap(scene, worldConfig, regionConfigs, renderStats);
setStatus('Generating map…');
try {
  worldMap.generateAll();
  setStatus('Map ready');
} catch (error) {
  console.error(error);
  setStatus(`Generation failed: ${error.message}`, true);
}

const panel = new ControlPanel(document.querySelector('#guiMount'), worldMap, worldConfig, regionConfigs, { setStatus });

function setMode(mode) {
  worldConfig.mode = mode;
  activeMode.textContent = mode.toUpperCase();
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  const systems = mode === 'Systems';
  controls.autoRotate = !systems;
  controls.autoRotateSpeed = 0.32;
  if (systems && !worldConfig.showRegionBounds && !worldConfig.showWfcGrid && !worldConfig.showRoadConnections) {
    worldConfig.showRegionBounds = true;
    worldConfig.showWfcGrid = true;
    worldConfig.showRoadConnections = true;
    panel.gui.controllersRecursive().forEach(controller => controller.updateDisplay());
  }
  worldMap.setDebugVisibility();
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
setMode('Showcase');

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
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

window.__flavorClash = {
  ready: true,
  worldMap,
  worldConfig,
  regionConfigs,
  generateRegion: (id, config) => worldMap.generateRegion(id, config),
  regenerateRegion: id => worldMap.regenerateRegion(id),
  regenerateBuildings: id => worldMap.regenerateBuildings(id),
  setRegionVisible: (id, visible) => worldMap.setRegionVisible(id, visible),
  disposeRegion: id => worldMap.disposeRegion(id),
  serializeRegionConfig: id => worldMap.serializeRegionConfig(id),
  serialize: () => worldMap.serialize(),
  signature: id => worldMap.signature(id),
  rendererInfo: () => JSON.parse(JSON.stringify(renderer.info)),
};

window.addEventListener('pagehide', () => {
  running = false;
  panel.dispose();
  worldMap.dispose();
  controls.dispose();
  renderer.dispose();
}, { once: true });
