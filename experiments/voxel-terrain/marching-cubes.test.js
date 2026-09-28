import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMarchingCubes, compareChunkSeam } from './marching-cubes.js';

const sphere = point => Math.hypot(point.x, point.y, point.z) - 2;

test('Marching Cubes interpolates a sphere with outward winding and unit normals', () => {
  const mesh = generateMarchingCubes({ origin: { x: -3, y: -3, z: -3 }, cells: 12, spacing: 0.5, sample: sphere });
  assert.ok(mesh.triangleCount > 0);
  for (let i = 0; i < mesh.positions.length; i += 9) {
    const p = mesh.positions;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const abx = p[i + 3] - ax, aby = p[i + 4] - ay, abz = p[i + 5] - az;
    const acx = p[i + 6] - ax, acy = p[i + 7] - ay, acz = p[i + 8] - az;
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    const area = Math.hypot(fx, fy, fz);
    const cx = (ax + p[i + 3] + p[i + 6]) / 3, cy = (ay + p[i + 4] + p[i + 7]) / 3, cz = (az + p[i + 5] + p[i + 8]) / 3;
    if (area > 1e-8) assert.ok(fx * cx + fy * cy + fz * cz > 0);
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]) - 1) < 1e-5);
  }
});

test('subtraction produces both the outer surface and an inner hole surface', () => {
  const shell = point => Math.max(Math.hypot(point.x, point.y, point.z) - 2, -(Math.hypot(point.x, point.y, point.z) - 1));
  const mesh = generateMarchingCubes({ origin: { x: -3, y: -3, z: -3 }, cells: 12, spacing: 0.5, sample: shell });
  const radii = [];
  for (let i = 0; i < mesh.positions.length; i += 3) radii.push(Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]));
  assert.ok(Math.min(...radii) <= 1.01);
  assert.ok(Math.max(...radii) >= 1.99);
});

test('neighbor chunks share interpolated boundary vertices and normals', () => {
  const left = generateMarchingCubes({ origin: { x: -3, y: -3, z: -3 }, cells: 6, spacing: 0.5, sample: sphere });
  const right = generateMarchingCubes({ origin: { x: 0, y: -3, z: -3 }, cells: 6, spacing: 0.5, sample: sphere });
  const seam = compareChunkSeam(left, right, 'x', 0);
  assert.ok(seam.matches > 0);
  assert.ok(seam.maxNormalDelta < 1e-6);
});
