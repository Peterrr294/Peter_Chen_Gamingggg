import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom.js';
import { regionExit } from '../world/RegionLayout.js';

export function generateMainRoute(config, worldConfig, regionSeed, terrain, roadResult, material) {
  const exit = regionExit(config, worldConfig.centralPlazaRadius);
  const random = new SeededRandom(regionSeed, 'main-route');
  const startIndex = exit.direction === 'east' || exit.direction === 'west'
    ? exit.x === config.centerX + config.width / 2
      ? roadResult.columns - 1 + Math.floor(roadResult.rows / 2) * roadResult.columns
      : Math.floor(roadResult.rows / 2) * roadResult.columns
    : exit.z === config.centerZ + config.depth / 2
      ? Math.floor(roadResult.columns / 2) + (roadResult.rows - 1) * roadResult.columns
      : Math.floor(roadResult.columns / 2);
  const roadStart = roadResult.roadPoints.find(point => {
    const tileIndex = roadResult.connected.has(startIndex) ? startIndex : [...roadResult.connected][0];
    const x = tileIndex % roadResult.columns;
    const y = Math.floor(tileIndex / roadResult.columns);
    const expectedX = config.centerX - config.width / 2 + (x + 0.5) * (config.width / roadResult.columns);
    const expectedZ = config.centerZ - config.depth / 2 + (y + 0.5) * (config.depth / roadResult.rows);
    return Math.abs(point.x - expectedX) < 0.01 && Math.abs(point.z - expectedZ) < 0.01;
  }) ?? roadResult.roadPoints[0] ?? { x: config.centerX, z: config.centerZ };
  const end = new THREE.Vector3(exit.plazaX, 0.18, exit.plazaZ);
  const start = new THREE.Vector3(roadStart.x, terrain.heightAt(roadStart.x, roadStart.z) + 0.16, roadStart.z);
  const middle = start.clone().lerp(end, 0.5);
  const perpendicular = new THREE.Vector3(-(end.z - start.z), 0, end.x - start.x).normalize();
  middle.addScaledVector(perpendicular, random.range(-1, 1) * config.routeCurvature * 3.5);
  middle.y = Math.max(0.3, terrain.heightAt(
    THREE.MathUtils.clamp(middle.x, config.centerX - config.width / 2, config.centerX + config.width / 2),
    THREE.MathUtils.clamp(middle.z, config.centerZ - config.depth / 2, config.centerZ + config.depth / 2),
  ) + 0.2);
  const curve = new THREE.CatmullRomCurve3([start, middle, end]);
  const geometry = new THREE.TubeGeometry(curve, 36, config.mainRoadWidth / 2, 6, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${config.label} plaza route`;
  const samples = curve.getPoints(36).map(point => ({ x: point.x, y: point.y, z: point.z }));
  return {
    object3D: mesh,
    curve,
    samples,
    start,
    end,
    dispose() { geometry.dispose(); },
  };
}
