export function createDensityField({ worldMin, totalCells, spacing, sample }) {
  // 一格 halo 供所有算法用同一份数据计算边界法线。
  const size = totalCells + 3;
  const values = new Float32Array(size ** 3);
  const offset = 1;
  const rawIndex = (x, y, z) => (x + offset) + size * ((y + offset) + size * (z + offset));
  for (let z = -1; z <= totalCells + 1; z += 1) for (let y = -1; y <= totalCells + 1; y += 1) for (let x = -1; x <= totalCells + 1; x += 1) {
    values[rawIndex(x, y, z)] = sample({ x: worldMin + x * spacing, y: worldMin + y * spacing, z: worldMin + z * spacing });
  }
  const get = (x, y, z) => values[rawIndex(x, y, z)];
  function sampleAt(point) {
    const coordinates = ['x', 'y', 'z'].map(axis => Math.max(-1, Math.min(totalCells + 1 - 1e-6, (point[axis] - worldMin) / spacing)));
    const [fx, fy, fz] = coordinates, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const mix = (a, b, t) => a + (b - a) * t;
    const zA = mix(mix(get(x0, y0, z0), get(x0 + 1, y0, z0), tx), mix(get(x0, y0 + 1, z0), get(x0 + 1, y0 + 1, z0), tx), ty);
    const zB = mix(mix(get(x0, y0, z0 + 1), get(x0 + 1, y0, z0 + 1), tx), mix(get(x0, y0 + 1, z0 + 1), get(x0 + 1, y0 + 1, z0 + 1), tx), ty);
    return mix(zA, zB, tz);
  }
  function normalAt(point) {
    const d = spacing * 0.5;
    const x = sampleAt({ x: point.x + d, y: point.y, z: point.z }) - sampleAt({ x: point.x - d, y: point.y, z: point.z });
    const y = sampleAt({ x: point.x, y: point.y + d, z: point.z }) - sampleAt({ x: point.x, y: point.y - d, z: point.z });
    const z = sampleAt({ x: point.x, y: point.y, z: point.z + d }) - sampleAt({ x: point.x, y: point.y, z: point.z - d });
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  }
  const position = (x, y, z) => ({ x: worldMin + x * spacing, y: worldMin + y * spacing, z: worldMin + z * spacing });
  return { values, get, sampleAt, normalAt, position, worldMin, totalCells, spacing };
}
