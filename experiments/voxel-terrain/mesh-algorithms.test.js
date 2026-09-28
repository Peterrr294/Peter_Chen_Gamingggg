import test from 'node:test';
import assert from 'node:assert/strict';
import { createDensityField } from './density-field.js';
import { meshAlgorithms } from './mesh-algorithms.js';
import { compareChunkSeam } from './marching-cubes.js';
import { compareSharedVertices } from './mesh-audit.js';

const sphere = point => Math.hypot(point.x, point.y, point.z) - 2;
const field = createDensityField({ worldMin: -3, totalCells: 12, spacing: .5, sample: sphere });
const full = { x0:0,y0:0,z0:0,x1:12,y1:12,z1:12 };
const left = { x0:0,y0:0,z0:0,x1:6,y1:12,z1:12 };
const right = { x0:6,y0:0,z0:0,x1:12,y1:12,z1:12 };

for (const [name, algorithm] of Object.entries(meshAlgorithms)) {
  test(`${name} generates a sphere with finite unit normals`, () => {
    const mesh = algorithm(field, full);
    assert.ok(mesh.triangleCount > 0);
    assert.equal(mesh.vertexCount, mesh.triangleCount * 3);
    assert.equal(mesh.bufferBytes, mesh.positions.byteLength + mesh.normals.byteLength);
    for(let i=0;i<mesh.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2])-1)<1e-5);
  });
  test(`${name} preserves chunk face ownership and shared normals`, () => {
    const whole = algorithm(field, full), a = algorithm(field, left), b = algorithm(field, right);
    assert.equal(a.triangleCount + b.triangleCount, whole.triangleCount);
    const seam = name === 'SurfaceNets' ? compareSharedVertices(a,b) : compareChunkSeam(a,b,'x',0);
    assert.ok(seam.matches > 0);
    assert.ok(seam.maxNormalDelta < 1e-6);
  });
}

test('all algorithms extract both surfaces of a subtraction shell', () => {
  const shellField=createDensityField({worldMin:-3,totalCells:12,spacing:.5,sample:p=>Math.max(Math.hypot(p.x,p.y,p.z)-2,-(Math.hypot(p.x,p.y,p.z)-1))});
  for(const algorithm of Object.values(meshAlgorithms)){
    const mesh=algorithm(shellField,full),radii=[];for(let i=0;i<mesh.positions.length;i+=3)radii.push(Math.hypot(mesh.positions[i],mesh.positions[i+1],mesh.positions[i+2]));
    assert.ok(Math.min(...radii)<1.2);assert.ok(Math.max(...radii)>1.8);
  }
});
