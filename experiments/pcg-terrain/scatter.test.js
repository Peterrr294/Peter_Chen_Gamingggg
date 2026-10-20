import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, generateScatter, seedToUint } from './scatter.js';

const parameters = {
  seed: 'CLASS-06',
  count: 20,
  maximumAttempts: 80,
  minimumScale: 0.5,
  maximumScale: 1.5,
  randomYaw: true,
  candidateHalfExtent: 10,
};
const surface = (x, z) => Math.abs(x) <= 7 && Math.abs(z) <= 7 ? { y: (x + z) * 0.1 } : null;

test('seed hashing and random values are repeatable', () => {
  assert.equal(seedToUint('terrain'), seedToUint('terrain'));
  const first = createRandom('terrain');
  const second = createRandom('terrain');
  assert.deepEqual(Array.from({ length: 10 }, first), Array.from({ length: 10 }, second));
});

test('same seed and parameters reproduce candidates and instances', () => {
  assert.deepEqual(generateScatter(parameters, surface), generateScatter(parameters, surface));
});

test('different seeds produce different accepted placements', () => {
  const first = generateScatter(parameters, surface);
  const second = generateScatter({ ...parameters, seed: 'CLASS-07' }, surface);
  assert.notDeepEqual(first.accepted, second.accepted);
});

test('generation stops at count or maximum attempts and records rejections', () => {
  const result = generateScatter({ ...parameters, count: 100, maximumAttempts: 12 }, surface);
  assert.equal(result.stats.attempts, 12);
  assert.equal(result.candidates.length, 12);
  assert.equal(result.stats.accepted + result.stats.rejected, 12);
  assert.ok(result.rejected.length > 0);
});

test('scale limits and disabled yaw are respected', () => {
  const result = generateScatter({ ...parameters, minimumScale: 1.25, maximumScale: 0.75, randomYaw: false }, () => ({ y: 2 }));
  assert.ok(result.accepted.every(item => item.scale >= 0.75 && item.scale <= 1.25));
  assert.ok(result.accepted.every(item => item.yaw === 0 && item.y === 2));
});
