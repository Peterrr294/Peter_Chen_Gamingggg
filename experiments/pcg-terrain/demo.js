import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sampleHeight } from '../cellular-noise/noise.js';
import { generateScatter, scatterPresets } from './scatter.js';

const canvas = document.querySelector('#terrainCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x07080b);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07080b, 25, 52);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(15, 13, 17);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 42;
controls.maxPolarAngle = Math.PI * 0.48;
controls.update();

scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x162015, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(9, 15, 7);
scene.add(sun);

const terrainSize = 18;
const terrainSegments = 72;
const terrainHeight = 5.2;
const terrainNoise = { seed: 606, scale: 7.5, octaves: 3, persistence: 0.4 };

function createTerrain() {
  const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const low = new THREE.Color(0x173422);
  const high = new THREE.Color(0x79956a);
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const normalized = sampleHeight(x, z, terrainNoise);
    positions.setY(index, normalized * terrainHeight);
    color.copy(low).lerp(high, normalized);
    color.toArray(colors, index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'PCG height-field terrain';
  return mesh;
}

const terrain = createTerrain();
scene.add(terrain);
const terrainGrid = new THREE.GridHelper(terrainSize, 18, 0x3157b8, 0x202631);
terrainGrid.position.y = 0.02;
scene.add(terrainGrid);
terrain.updateMatrixWorld(true);

const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.17, 1, 6);
trunkGeometry.translate(0, 0.5, 0);
const crownGeometry = new THREE.ConeGeometry(0.62, 1.65, 7);
crownGeometry.translate(0, 1.55, 0);
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x74513b, roughness: 1 });
const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x2f7f4f, roughness: 1 });
const debugMaterials = {
  candidates: new THREE.PointsMaterial({ color: 0xffd166, size: 0.13, sizeAttenuation: true, depthTest: false }),
  accepted: new THREE.PointsMaterial({ color: 0x55d187, size: 0.18, sizeAttenuation: true, depthTest: false }),
  rejected: new THREE.PointsMaterial({ color: 0xff5a63, size: 0.2, sizeAttenuation: true, depthTest: false }),
};

const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3(0, -1, 0);
function queryTerrainSurface(x, z) {
  rayOrigin.set(x, terrainHeight + 8, z);
  raycaster.set(rayOrigin, rayDirection);
  const hit = raycaster.intersectObject(terrain, false)[0];
  return hit ? { y: hit.point.y } : null;
}

const defaults = {
  seed: 'CLASS-06',
  count: scatterPresets.Medium.count,
  maximumAttempts: scatterPresets.Medium.maximumAttempts,
  minimumScale: scatterPresets.Medium.minimumScale,
  maximumScale: scatterPresets.Medium.maximumScale,
  randomYaw: true,
  showCandidates: false,
  showAccepted: true,
  showRejected: true,
};
const state = { ...defaults };
const elements = {
  seed: document.querySelector('#seed'),
  count: document.querySelector('#assetCount'),
  maximumAttempts: document.querySelector('#maximumAttempts'),
  minimumScale: document.querySelector('#minimumScale'),
  maximumScale: document.querySelector('#maximumScale'),
  randomYaw: document.querySelector('#randomYaw'),
  showCandidates: document.querySelector('#showCandidates'),
  showAccepted: document.querySelector('#showAccepted'),
  showRejected: document.querySelector('#showRejected'),
};

let instanceGroup = null;
let debugGroup = null;
let activePreset = 'Medium';

function readControls() {
  state.seed = elements.seed.value.trim() || '0';
  state.count = Number(elements.count.value);
  state.maximumAttempts = Number(elements.maximumAttempts.value);
  state.minimumScale = Number(elements.minimumScale.value);
  state.maximumScale = Number(elements.maximumScale.value);
  state.randomYaw = elements.randomYaw.checked;
  state.showCandidates = elements.showCandidates.checked;
  state.showAccepted = elements.showAccepted.checked;
  state.showRejected = elements.showRejected.checked;
}

function updateReadouts() {
  document.querySelector('#seedValue').textContent = state.seed;
  document.querySelector('#assetCountValue').textContent = String(state.count);
  document.querySelector('#maximumAttemptsValue').textContent = String(state.maximumAttempts);
  document.querySelector('#minimumScaleValue').textContent = state.minimumScale.toFixed(2);
  document.querySelector('#maximumScaleValue').textContent = state.maximumScale.toFixed(2);
}

function syncControls() {
  elements.seed.value = state.seed;
  elements.count.value = String(state.count);
  elements.maximumAttempts.value = String(state.maximumAttempts);
  elements.minimumScale.value = String(state.minimumScale);
  elements.maximumScale.value = String(state.maximumScale);
  elements.randomYaw.checked = state.randomYaw;
  elements.showCandidates.checked = state.showCandidates;
  elements.showAccepted.checked = state.showAccepted;
  elements.showRejected.checked = state.showRejected;
  updateReadouts();
}

function removeGeneratedObjects() {
  if (instanceGroup) {
    scene.remove(instanceGroup);
    instanceGroup.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    instanceGroup = null;
  }
  if (debugGroup) {
    scene.remove(debugGroup);
    debugGroup.traverse(object => { if (object.isPoints) object.geometry.dispose(); });
    debugGroup = null;
  }
}

function createPointCloud(items, material, yOffset, name) {
  const positions = new Float32Array(items.length * 3);
  items.forEach((item, index) => {
    positions[index * 3] = item.x;
    positions[index * 3 + 1] = item.y + yOffset;
    positions[index * 3 + 2] = item.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.renderOrder = 5;
  return points;
}

function createInstances(placements) {
  const group = new THREE.Group();
  group.name = 'Scattered tree instances';
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, placements.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, placements.length);
  trunks.name = 'Instanced trunks';
  crowns.name = 'Instanced crowns';
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  placements.forEach((item, index) => {
    position.set(item.x, item.y, item.z);
    quaternion.setFromAxisAngle(yAxis, item.yaw);
    scale.setScalar(item.scale);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(index, matrix);
    crowns.setMatrixAt(index, matrix);
  });
  for (const mesh of [trunks, crowns]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  group.add(trunks, crowns);
  return group;
}

function scatterSignature(placements) {
  return placements.slice(0, 32).map(item => [item.x, item.y, item.z, item.scale, item.yaw].map(value => value.toFixed(5)).join(',')).join('|');
}

function updateDebugVisibility() {
  if (!debugGroup) return;
  debugGroup.getObjectByName('Candidate points').visible = state.showCandidates;
  debugGroup.getObjectByName('Accepted points').visible = state.showAccepted;
  debugGroup.getObjectByName('Rejected points').visible = state.showRejected;
  document.body.dataset.candidatesVisible = String(state.showCandidates);
  document.body.dataset.acceptedVisible = String(state.showAccepted);
  document.body.dataset.rejectedVisible = String(state.showRejected);
}

function updateStats(result, elapsed) {
  const values = {
    statRequested: result.stats.requested.toLocaleString(),
    statAttempts: result.stats.attempts.toLocaleString(),
    statAccepted: result.stats.accepted.toLocaleString(),
    statRejected: result.stats.rejected.toLocaleString(),
    statRate: `${(result.stats.acceptanceRate * 100).toFixed(1)}%`,
    statTime: `${elapsed.toFixed(2)} ms`,
    statInstances: result.stats.accepted.toLocaleString(),
    statSeed: result.stats.seed,
  };
  for (const [id, value] of Object.entries(values)) document.querySelector(`#${id}`).textContent = value;
  document.body.dataset.scatterSignature = scatterSignature(result.accepted);
  document.body.dataset.accepted = String(result.stats.accepted);
  document.body.dataset.attempts = String(result.stats.attempts);
  document.body.dataset.rejected = String(result.stats.rejected);
  document.body.dataset.generationTime = elapsed.toFixed(2);
}

function regenerate() {
  readControls();
  updateReadouts();
  document.querySelector('#generationState').textContent = 'GENERATING';
  document.querySelector('#experimentStatus').textContent = 'SCATTERING / GENERATING';
  const started = performance.now();
  const result = generateScatter({ ...state, candidateHalfExtent: terrainSize * 0.62 }, queryTerrainSurface);
  const elapsed = performance.now() - started;
  removeGeneratedObjects();
  instanceGroup = createInstances(result.accepted);
  debugGroup = new THREE.Group();
  debugGroup.name = 'Scatter debug points';
  debugGroup.add(
    createPointCloud(result.candidates, debugMaterials.candidates, 0.09, 'Candidate points'),
    createPointCloud(result.accepted, debugMaterials.accepted, 0.18, 'Accepted points'),
    createPointCloud(result.rejected, debugMaterials.rejected, 0.12, 'Rejected points'),
  );
  scene.add(instanceGroup, debugGroup);
  document.body.dataset.generatedGroups = String(scene.children.filter(object => object === instanceGroup || object === debugGroup).length);
  updateDebugVisibility();
  updateStats(result, elapsed);
  document.querySelector('#generationState').textContent = result.accepted.length === state.count ? 'COUNT REACHED' : 'ATTEMPTS EXHAUSTED';
  document.querySelector('#experimentStatus').textContent = 'SCATTERING / READY';
}

function setPreset(name) {
  activePreset = name;
  Object.assign(state, scatterPresets[name]);
  document.querySelector('#activePreset').textContent = name.toUpperCase();
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === name)));
  syncControls();
  regenerate();
}

for (const [key, element] of Object.entries(elements)) {
  element.addEventListener('input', () => {
    readControls();
    updateReadouts();
    if (key.startsWith('show')) updateDebugVisibility();
  });
  if (!key.startsWith('show')) element.addEventListener('change', regenerate);
  else element.addEventListener('change', updateDebugVisibility);
}
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => setPreset(button.dataset.preset)));
document.querySelector('#regenerateButton').addEventListener('click', regenerate);
document.querySelector('#resetButton').addEventListener('click', () => {
  Object.assign(state, defaults);
  activePreset = 'Medium';
  document.querySelector('#activePreset').textContent = 'MEDIUM';
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === 'Medium')));
  syncControls();
  regenerate();
});

document.querySelectorAll('[data-lab-tab]').forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.dataset.labTab;
    document.querySelectorAll('[data-lab-tab]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-lab-panel]').forEach(panel => { panel.hidden = panel.dataset.labPanel !== tab; });
    document.querySelector('#experimentStatus').textContent = tab === 'scattering' ? 'SCATTERING / READY' : 'FUTURE EXPERIMENT';
  });
});

function resizeRenderer() {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  if (canvas.width === Math.floor(width * renderer.getPixelRatio()) && canvas.height === Math.floor(height * renderer.getPixelRatio())) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  resizeRenderer();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener('pagehide', () => {
  removeGeneratedObjects();
  terrain.geometry.dispose();
  terrain.material.dispose();
  terrainGrid.geometry.dispose();
  if (Array.isArray(terrainGrid.material)) terrainGrid.material.forEach(material => material.dispose());
  else terrainGrid.material.dispose();
  trunkGeometry.dispose();
  crownGeometry.dispose();
  trunkMaterial.dispose();
  crownMaterial.dispose();
  Object.values(debugMaterials).forEach(material => material.dispose());
  renderer.dispose();
});

syncControls();
regenerate();
animate();
