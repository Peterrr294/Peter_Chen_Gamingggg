import test from 'node:test';
import assert from 'node:assert/strict';
import { createShape, sampleShape, evaluateSequence } from './sdf.js';

const shapes = {
  sphereA: createShape('sphere', { position: { x: 0, y: 0, z: 0 }, radius: 2 }),
  boxB: createShape('box', { position: { x: 1, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }),
  cutterC: createShape('sphere', { position: { x: 1, y: 0, z: 0 }, radius: 0.75 }),
};

test('sphere and box use negative values inside', () => {
  assert.equal(sampleShape(shapes.sphereA, { x: 0, y: 0, z: 0 }), -2);
  assert.equal(sampleShape(shapes.sphereA, { x: 2, y: 0, z: 0 }), 0);
  assert.ok(sampleShape(shapes.boxB, { x: 1, y: 0, z: 0 }) < 0);
});

test('sequential union, intersection and subtraction use negative-inside CSG', () => {
  const overlap = { x: 1, y: 0, z: 0 };
  assert.ok(evaluateSequence(overlap, shapes, 'sphereA', [{ type: 'union', shapeId: 'boxB' }]) < 0);
  assert.ok(evaluateSequence(overlap, shapes, 'sphereA', [{ type: 'intersect', shapeId: 'boxB' }]) < 0);
  assert.ok(evaluateSequence(overlap, shapes, 'sphereA', [{ type: 'subtract', shapeId: 'boxB' }]) >= 0);
});

test('operation order changes the result and step limit exposes intermediate states', () => {
  const point = { x: 1, y: 0, z: 0 };
  const unionThenCut = [{ type: 'union', shapeId: 'boxB' }, { type: 'subtract', shapeId: 'cutterC' }];
  const cutThenUnion = [{ type: 'subtract', shapeId: 'cutterC' }, { type: 'union', shapeId: 'boxB' }];
  assert.ok(evaluateSequence(point, shapes, 'sphereA', unionThenCut) >= 0);
  assert.ok(evaluateSequence(point, shapes, 'sphereA', cutThenUnion) < 0);
  assert.ok(evaluateSequence(point, shapes, 'sphereA', unionThenCut, 1) < 0);
});
