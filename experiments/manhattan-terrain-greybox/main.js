import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SurfaceQuery } from '../iceland-region/SurfaceQuery.js';
import { createManhattanConfig } from './config.js';
import { ManhattanTerrain } from './ManhattanTerrain.js';

const query = new URLSearchParams(location.search);
const requestedSeed = query.get('seed')?.trim();
const config = createManhattanConfig(requestedSeed ? { seed: requestedSeed } : {});
const canvas = document.querySelector('#terrainCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x081014);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x081014, 0.012);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 260);
camera.position.set(58, 55, 70);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 18;
controls.maxDistance = 170;

scene.add(new THREE.HemisphereLight(0xcde7ef, 0x17231d, 2.2));
const sun = new THREE.DirectionalLight(0xffefd2, 3.4);
sun.position.set(-42, 66, 34);
sun.castShadow = true;
scene.add(sun);

const terrain = new ManhattanTerrain(scene, config);
const result = terrain.regenerate();
const surfaceQuery = new SurfaceQuery(terrain, {
  waterSafetyDistance: config.shoreSetback,
  maxRoadSlope: config.maxBuildableSlope,
  sampleSpacing: 1,
});

document.querySelector('#seed').textContent = result.seed;
document.querySelector('#signature').textContent = result.signature;
document.querySelector('#vertices').textContent = result.vertices.toLocaleString();
document.querySelector('#waterCount').textContent = result.waterVertices.toLocaleString();
document.querySelector('#buildableCount').textContent = result.buildableVertices.toLocaleString();
document.querySelector('#blockedCount').textContent = result.blockedVertices.toLocaleString();
document.querySelector('#statusText').textContent = 'READY';
document.body.dataset.terrainSignature = result.signature;

const resize = () => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
};

renderer.setAnimationLoop(() => {
  resize();
  controls.update();
  renderer.render(scene, camera);
});

window.__manhattanTerrainLab = {
  ready: true,
  terrain,
  surfaceQuery,
  snapshot: () => ({
    ...terrain.lastResult,
    mapWidth: config.mapWidth,
    mapDepth: config.mapDepth,
    resolution: config.resolution,
    waterLevel: config.waterLevel,
    shoreSetback: config.shoreSetback,
    maxBuildableSlope: config.maxBuildableSlope,
  }),
};
