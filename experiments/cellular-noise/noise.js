// 噪声计算不依赖 DOM：同一个世界坐标可独立查询，也便于验证。
export const CHUNK_SIZE = 16;

function hash32(x, y, seed, channel) {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(channel, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function sampleNoise(worldX, worldY, params) {
  // 世界坐标与网格分辨率无关；scale 表示特征单元的世界尺寸。
  const px = worldX / params.scale;
  const py = worldY / params.scale;
  const bx = Math.floor(px);
  const by = Math.floor(py);
  let squared = Infinity;
  for (let y = by - 2; y <= by + 2; y += 1) {
    for (let x = bx - 2; x <= bx + 2; x += 1) {
      const dx = px - x - hash32(x, y, params.seed, 0) / 4294967296;
      const dy = py - y - hash32(x, y, params.seed, 1) / 4294967296;
      squared = Math.min(squared, dx * dx + dy * dy);
    }
  }
  return Math.sqrt(squared);
}

export function shapeNoise(distance, params) {
  if (params.shaping === 'Threshold') return distance <= params.threshold ? 1 : 0;
  if (params.shaping === 'Invert Threshold') return distance > params.invertThreshold ? 1 : 0;
  return Math.abs(distance - 0.5) <= params.bandWidth / 2 ? 1 : 0;
}

export function sampleHeight(worldX, worldY, params) {
  let total = 0;
  let weights = 0;
  let weight = 1;
  for (let layer = 0; layer < params.octaves; layer += 1) {
    // 每层缩小特征尺寸：第一层决定山体，后面的层提供较弱的细节。
    const distance = sampleNoise(worldX, worldY, {
      scale: params.scale / 2 ** layer,
      seed: params.seed + layer * 1013,
    });
    // 本单元至少有一个特征点，F1 不超过 sqrt(2)，用固定界限归一化。
    const normalized = Math.max(0, Math.min(1, 1 - distance / Math.SQRT2));
    // smoothstep 使峰谷过渡更柔和；各层按照 persistence 衰减。
    total += normalized * normalized * (3 - 2 * normalized) * weight;
    weights += weight;
    weight *= params.persistence;
  }
  return total / weights;
}

export function worldCoordinate(x, y, params) {
  // N 个顶点跨越固定 worldSize，增加 N 只增加采样密度。
  const spacing = params.worldSize / (params.resolution - 1);
  return [params.worldOffsetX + x * spacing, params.worldOffsetY + y * spacing];
}

export function generateMap(params, reverse = false) {
  const noise = new Float32Array(params.resolution ** 2);
  const binary = new Uint8Array(noise.length);
  const height = new Float32Array(noise.length);
  const chunks = [];
  for (let y = 0; y < Math.ceil(params.resolution / CHUNK_SIZE); y += 1) {
    for (let x = 0; x < Math.ceil(params.resolution / CHUNK_SIZE); x += 1) chunks.push([x, y]);
  }
  if (reverse) chunks.reverse();
  for (const [cx, cy] of chunks) {
    for (let y = cy * CHUNK_SIZE; y < Math.min((cy + 1) * CHUNK_SIZE, params.resolution); y += 1) {
      for (let x = cx * CHUNK_SIZE; x < Math.min((cx + 1) * CHUNK_SIZE, params.resolution); x += 1) {
        // 索引永远使用局部整数，绝不能用可能为负数或小数的世界坐标。
        const index = y * params.resolution + x;
        const [wx, wy] = worldCoordinate(x, y, params);
        const distance = sampleNoise(wx, wy, params);
        noise[index] = distance;
        binary[index] = shapeNoise(distance, params);
        height[index] = params.heightMode === 'Binary terraces'
          ? binary[index] : sampleHeight(wx, wy, params);
      }
    }
  }
  return { noise, binary, height };
}

export function checksum(data) {
  // 对原始字节做校验，保留浮点高度的小数信息。
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
  return (value >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
