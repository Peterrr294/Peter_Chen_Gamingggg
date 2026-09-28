export function createChunkLayout(worldSize, chunkSize, spacing) {
  if (worldSize % chunkSize !== 0 || chunkSize % spacing !== 0) throw new Error('World and chunk sizes must align to spacing');
  const chunksPerAxis = worldSize / chunkSize;
  return { worldSize, chunkSize, spacing, chunksPerAxis, samplesPerAxis: chunkSize / spacing, worldMin: -worldSize / 2 };
}

export function chunkKey(x, y, z) { return `${x},${y},${z}`; }

export function chunkBounds(layout, x, y, z) {
  const min = { x: layout.worldMin + x * layout.chunkSize, y: layout.worldMin + y * layout.chunkSize, z: layout.worldMin + z * layout.chunkSize };
  return { min, max: { x: min.x + layout.chunkSize, y: min.y + layout.chunkSize, z: min.z + layout.chunkSize } };
}

export function samplePosition(layout, chunk, localX, localY, localZ) {
  const bounds = chunkBounds(layout, chunk.x, chunk.y, chunk.z);
  const half = layout.spacing / 2;
  return { x: bounds.min.x + localX * layout.spacing + half, y: bounds.min.y + localY * layout.spacing + half, z: bounds.min.z + localZ * layout.spacing + half };
}

export function shapeBounds(shape, padding = 0) {
  const extent = shape.type === 'sphere'
    ? { x: shape.radius, y: shape.radius, z: shape.radius }
    : shape.size;
  return {
    min: { x: shape.position.x - extent.x - padding, y: shape.position.y - extent.y - padding, z: shape.position.z - extent.z - padding },
    max: { x: shape.position.x + extent.x + padding, y: shape.position.y + extent.y + padding, z: shape.position.z + extent.z + padding },
  };
}

export function unionBounds(a, b) {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  };
}

export function chunksForBounds(layout, bounds) {
  const result = [];
  const index = value => Math.max(0, Math.min(layout.chunksPerAxis - 1, Math.floor((value - layout.worldMin) / layout.chunkSize)));
  const from = { x: index(bounds.min.x), y: index(bounds.min.y), z: index(bounds.min.z) };
  const to = { x: index(bounds.max.x), y: index(bounds.max.y), z: index(bounds.max.z) };
  for (let z = from.z; z <= to.z; z += 1) for (let y = from.y; y <= to.y; y += 1) for (let x = from.x; x <= to.x; x += 1) result.push({ x, y, z, key: chunkKey(x, y, z) });
  return result;
}

export function allChunks(layout) {
  const result = [];
  for (let z = 0; z < layout.chunksPerAxis; z += 1) for (let y = 0; y < layout.chunksPerAxis; y += 1) for (let x = 0; x < layout.chunksPerAxis; x += 1) result.push({ x, y, z, key: chunkKey(x, y, z) });
  return result;
}

// 两边分别计算同一条区块边界的世界坐标；坐标与 SDF 都必须完全相同。
export function auditAdjacentBoundary(layout, leftChunk, sample) {
  const rightChunk = { x: leftChunk.x + 1, y: leftChunk.y, z: leftChunk.z };
  const left = chunkBounds(layout, leftChunk.x, leftChunk.y, leftChunk.z).max.x;
  const right = chunkBounds(layout, rightChunk.x, rightChunk.y, rightChunk.z).min.x;
  const pointA = { x: left, y: 0, z: 0 };
  const pointB = { x: right, y: 0, z: 0 };
  return { coordinateDelta: Math.abs(pointA.x - pointB.x), densityDelta: Math.abs(sample(pointA) - sample(pointB)) };
}
