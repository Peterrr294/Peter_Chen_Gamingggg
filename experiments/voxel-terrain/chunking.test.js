import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkLayout, samplePosition, shapeBounds, unionBounds, chunksForBounds, auditAdjacentBoundary } from './chunking.js';

test('chunks preserve spacing and adjacent world coordinates', () => {
  const layout = createChunkLayout(24, 8, 0.5);
  assert.equal(layout.chunksPerAxis, 3);
  assert.equal(layout.samplesPerAxis, 16);
  assert.equal(samplePosition(layout, { x: 0, y: 0, z: 0 }, 15, 0, 0).x, -4.25);
  assert.equal(samplePosition(layout, { x: 1, y: 0, z: 0 }, 0, 0, 0).x, -3.75);
});

test('shared boundary queries use identical world coordinates and density', () => {
  const layout = createChunkLayout(24, 8, 0.5);
  const audit = auditAdjacentBoundary(layout, { x: 0, y: 1, z: 1 }, point => Math.hypot(point.x, point.y, point.z) - 5);
  assert.deepEqual(audit, { coordinateDelta: 0, densityDelta: 0 });
});

test('old and new shape bounds select every crossed chunk', () => {
  const layout = createChunkLayout(24, 8, 0.5);
  const oldShape = { type: 'sphere', position: { x: -5, y: 0, z: 0 }, radius: 2 };
  const newShape = { type: 'sphere', position: { x: 5, y: 0, z: 0 }, radius: 2 };
  const affected = chunksForBounds(layout, unionBounds(shapeBounds(oldShape), shapeBounds(newShape)));
  assert.equal(new Set(affected.map(chunk => chunk.x)).size, 3);
});

test('a subtraction shape crossing a boundary rebuilds chunks on both sides', () => {
  const layout = createChunkLayout(24, 8, 0.5);
  // x = 4 是中间区块与右侧区块的边界。
  const cutter = { type: 'sphere', position: { x: 4, y: 0, z: 0 }, radius: 3 };
  const affected = chunksForBounds(layout, shapeBounds(cutter));
  const middleLayers = affected.filter(chunk => chunk.y === 1 && chunk.z === 1).map(chunk => chunk.x);
  assert.deepEqual(middleLayers, [1, 2]);
});
