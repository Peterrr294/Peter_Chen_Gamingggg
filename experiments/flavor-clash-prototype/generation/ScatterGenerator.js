import * as THREE from 'three';
import PoissonDiskSampling from 'poisson-disk-sampling';
import { SeededRandom } from '../world/SeededRandom.js';

function distanceToRoad(x, z, roadPoints) {
  let minimum = Infinity;
  for (const point of roadPoints) minimum = Math.min(minimum, Math.hypot(x - point.x, z - point.z));
  return minimum;
}

function createAssetGeometry(regionId) {
  if (regionId === 'tokyo') {
    const geometry = new THREE.BoxGeometry(0.8, 1, 0.8);
    geometry.translate(0, 0.5, 0);
    return geometry;
  }
  if (regionId === 'venice') {
    const geometry = new THREE.BoxGeometry(0.9, 0.75, 0.75);
    geometry.translate(0, 0.375, 0);
    return geometry;
  }
  if (regionId === 'iceland') {
    const geometry = new THREE.DodecahedronGeometry(0.5, 0);
    geometry.translate(0, 0.42, 0);
    return geometry;
  }
  const geometry = new THREE.ConeGeometry(0.48, 1.8, 6);
  geometry.translate(0, 0.9, 0);
  return geometry;
}

export function generateScatter(regionId, config, regionSeed, terrain, roads, mainRoute, materials, scatterScale = 1) {
  const started = performance.now();
  const random = new SeededRandom(regionSeed, 'scatter');
  const sampler = new PoissonDiskSampling({
    shape: [config.width, config.depth],
    minDistance: config.scatterMinDistance,
    maxDistance: config.scatterMinDistance * 1.8,
    tries: 22,
  }, () => random.next());
  const points = sampler.fill();
  const target = Math.max(1, Math.floor(points.length * config.scatterDensity * scatterScale));
  const roadPoints = [...roads.roadPoints, ...mainRoute.samples];
  const candidates = [];
  const accepted = [];
  const rejected = [];

  for (const point of points) {
    const x = config.centerX - config.width / 2 + point[0];
    const z = config.centerZ - config.depth / 2 + point[1];
    const y = terrain.heightAt(x, z);
    const slope = terrain.slopeAt(x, z);
    const reason = y <= config.waterLevel + 0.04 ? 'water'
      : slope > config.maxScatterSlope ? 'slope'
        : distanceToRoad(x, z, roadPoints) < Math.max(0.75, config.mainRoadWidth * 1.2) ? 'road'
          : null;
    const item = { x, y, z, slope, reason };
    candidates.push(item);
    if (reason || accepted.length >= target) rejected.push(item);
    else accepted.push({ ...item, scale: random.range(0.72, 1.35), yaw: random.range(0, Math.PI * 2) });
  }

  const geometry = createAssetGeometry(regionId);
  const material = regionId === 'hawaii' ? materials.accent : regionId === 'iceland' ? materials.dark : materials.light;
  const mesh = new THREE.InstancedMesh(geometry, material, accepted.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  accepted.forEach((item, index) => {
    position.set(item.x, item.y, item.z);
    quaternion.setFromAxisAngle(up, item.yaw);
    scale.setScalar(item.scale);
    if (regionId === 'tokyo') scale.y *= random.range(1.2, 3.8);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = `${config.label} decoration instances`;
  return {
    object3D: mesh,
    mesh,
    candidates,
    accepted,
    rejected,
    generationTime: performance.now() - started,
    dispose() {
      mesh.dispose();
      geometry.dispose();
    },
  };
}
