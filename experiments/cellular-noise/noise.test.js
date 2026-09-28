import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, sampleHeight, sampleNoise, worldCoordinate } from './noise.js';

const params = {
  seed: 20260909, scale: 8, resolution: 64, worldSize: 32,
  worldOffsetX: 0, worldOffsetY: 0, octaves: 3, persistence: 0.35,
  heightMode: 'Continuous F1', shaping: 'Threshold', threshold: 0.58,
  invertThreshold: 0.58, bandWidth: 0.16,
};

test('fractional and negative world offsets fill every local sample correctly', () => {
  for (const [worldOffsetX, worldOffsetY] of [[0.125, 0.7], [-42.75, -19.5], [64, -64]]) {
    const p = { ...params, worldOffsetX, worldOffsetY, resolution: 32 };
    const map = generateMap(p);
    for (let y = 0; y < p.resolution; y += 1) {
      for (let x = 0; x < p.resolution; x += 1) {
        const i = y * p.resolution + x;
        const [wx, wy] = worldCoordinate(x, y, p);
        assert.equal(map.noise[i], Math.fround(sampleNoise(wx, wy, p)));
        assert.equal(map.height[i], Math.fround(sampleHeight(wx, wy, p)));
        assert.ok(map.height[i] >= 0 && map.height[i] <= 1);
        assert.ok(map.binary[i] === 0 || map.binary[i] === 1);
      }
    }
  }
});

test('all map arrays are reproducible and independent of chunk order', () => {
  const p = { ...params, worldOffsetX: -3.25, worldOffsetY: 8.75 };
  const first = generateMap(p);
  for (const other of [generateMap(p), generateMap(p, true)]) {
    for (const key of ['height', 'noise', 'binary']) assert.deepEqual(first[key], other[key]);
  }
  assert.ok(new Set(first.height).size > 100);
  assert.notDeepEqual(first.height, generateMap({ ...p, seed: p.seed + 1 }).height);
});

test('changing resolution preserves heights at coincident world locations', () => {
  // 17 和 33 个顶点让每隔两个细网格顶点精确对应一个粗网格顶点。
  const coarse = generateMap({ ...params, resolution: 17 });
  const fine = generateMap({ ...params, resolution: 33 });
  for (let y = 0; y < 17; y += 1) {
    for (let x = 0; x < 17; x += 1) {
      assert.equal(coarse.height[y * 17 + x], fine.height[y * 2 * 33 + x * 2]);
    }
  }
});

test('neighboring world windows share exactly the same seam samples', () => {
  const left = generateMap({ ...params, resolution: 32 });
  const right = generateMap({ ...params, resolution: 32, worldOffsetX: params.worldSize });
  for (let y = 0; y < 32; y += 1) assert.equal(left.height[y * 32 + 31], right.height[y * 32]);
});

test('binary modes share the binary map as heights while continuous layers affect terrain', () => {
  for (const shaping of ['Threshold', 'Invert Threshold', 'Band']) {
    const m = generateMap({ ...params, shaping, heightMode: 'Binary terraces', resolution: 32 });
    assert.deepEqual(Array.from(m.height), Array.from(m.binary));
  }
  assert.notDeepEqual(generateMap(params).height, generateMap({ ...params, octaves: 1 }).height);
});
