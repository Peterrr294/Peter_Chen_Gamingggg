import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';

// Pure height-field generator for one fixed chunk. No rendering here.
// Samples are taken in world metres (chunk origin + local offset), so a future
// neighbour chunk with the same seed continues the same noise.

const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function createNoise(seed, label) {
  const random = new SeededRandom(seed, label);
  return new SimplexNoise({ random: () => random.next() });
}

// Fractional Brownian motion, roughly in [-1, 1].
function fbm(noise, x, z, frequency, octaves, gain = 0.5, lacunarity = 2) {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise.noise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

// Musgrave ridged multifractal, roughly in [0, 1]. Each octave is weighted by
// the previous one, so detail gathers on ridges instead of uniform spikes.
function ridged(noise, x, z, frequency, octaves, offset = 1, gain = 2, lacunarity = 2.1) {
  let sum = 0;
  let weight = 1;
  let amplitude = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    let signal = offset - Math.abs(noise.noise(x * frequency, z * frequency));
    signal *= signal * weight;
    weight = clamp01(signal * gain);
    sum += signal * amplitude;
    norm += amplitude;
    amplitude *= 0.4;
    frequency *= lacunarity;
  }
  return sum / norm;
}

// Domain warping: offset the sample point by low-frequency noise (metres).
function warp(noise, x, z, strength, frequency) {
  return [
    x + fbm(noise, x + 113.7, z - 41.3, frequency, 3) * strength,
    z + fbm(noise, x - 271.1, z + 97.9, frequency, 3) * strength,
  ];
}

const LANDFORM_RULES = {
  // Low-frequency fBm on a gentle regional tilt. No water.
  plain(context) {
    const { config, noise, random, strength } = context;
    const angle = random.next() * Math.PI * 2;
    const tilt = (0.004 + random.next() * 0.004) * strength; // 0.2–0.5° at default variation
    const tiltX = Math.cos(angle) * tilt;
    const tiltZ = Math.sin(angle) * tilt;
    return (x, z) => {
      const [wx, wz] = warp(noise, x, z, 90 * strength, 1 / 900);
      const relief = (fbm(noise, wx, wz, 1 / 650, 4) * 0.5 + 0.5) * config.relief * strength;
      return { height: config.baseHeight + x * tiltX + z * tiltZ + relief, surface: NaN };
    };
  },

  // Continuous valley cut around a meandering river. The water surface falls
  // steadily along the river; bed and banks are built relative to that surface.
  riverValley(context) {
    const { config, noise, random, strength, chunk } = context;
    const alongZ = random.next() < 0.5;
    const offset = (random.next() - 0.5) * chunk.size * 0.3;
    const direction = random.next() < 0.5 ? -1 : 1;
    const meanderAmplitude = config.meanderAmplitude * strength;
    const centre = along => offset + fbm(noise, along, 911.3, 1 / 700, 3) * meanderAmplitude;
    const surfaceAt = along => config.baseHeight - direction * along * config.riverGradient;
    const halfWidth = config.channelWidth / 2;
    return (x, z) => {
      const along = alongZ ? z : x;
      const across = alongZ ? x : z;
      const slope = (centre(along + 2) - centre(along - 2)) / 4;
      const distance = Math.abs(across - centre(along)) / Math.sqrt(1 + slope * slope);
      const surface = surfaceAt(along);
      const [wx, wz] = warp(noise, x, z, 120 * strength, 1 / 800);
      const valleyHalf = config.valleyHalfWidth * (0.8 + 0.4 * (fbm(noise, along, 377.7, 1 / 900, 2) * 0.5 + 0.5));
      const floor = surface + config.bankHeight + (fbm(noise, wx, wz, 1 / 220, 3) * 0.5 + 0.5) * 1.2;
      const upland = floor + (fbm(noise, wx, wz, 1 / 520, 5) * 0.5 + 0.5) * config.relief * strength;
      let height = floor + (upland - floor) * smoothstep(valleyHalf * 0.55, valleyHalf * 1.25, distance);
      if (distance < halfWidth) {
        // Parabolic channel: bed is channelDepth below the surface at the centre line.
        const t = distance / halfWidth;
        height = surface - config.channelDepth * (1 - t * t);
      } else if (distance < halfWidth + config.bankWidth) {
        // Bank rises from the water line to the valley floor.
        const t = smoothstep(halfWidth, halfWidth + config.bankWidth, distance);
        height = surface + (height - surface) * t;
      }
      return { height, surface, river: distance < halfWidth };
    };
  },

  // Low-frequency land meeting a sea whose shoreline is a warped level set of a
  // signed land potential. The coast is exactly where that potential is zero.
  coast(context) {
    const { config, noise, random, strength, chunk } = context;
    const enclosed = random.next() < 0.35; // inland bay vs. sea crossing the edge
    const angle = random.next() * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const shift = (0.1 + random.next() * 0.25) * chunk.size;
    const bayX = (random.next() - 0.5) * chunk.size * 0.3;
    const bayZ = (random.next() - 0.5) * chunk.size * 0.3;
    const bayRadius = chunk.size * (0.2 + random.next() * 0.08);
    return (x, z) => {
      const [wx, wz] = warp(noise, x, z, 140 * strength, 1 / 700);
      const base = enclosed ? Math.hypot(wx - bayX, wz - bayZ) - bayRadius : wx * dirX + wz * dirZ + shift;
      const potential = base + fbm(noise, wx, wz, 1 / 300, 4) * config.shorelineNoise * strength;
      let height;
      if (potential >= 0) {
        const hills = (fbm(noise, wx, wz, 1 / 480, 4) * 0.5 + 0.5) * config.relief * strength;
        height = config.seaLevel + 0.4 + potential * config.beachGradient + hills * smoothstep(0, 260, potential);
      } else {
        height = config.seaLevel - 0.4 - Math.min(config.shelfDepth, -potential * config.shelfGradient);
      }
      return { height, surface: config.seaLevel, sea: potential < 0, potential };
    };
  },

  // Ridged multifractal on a large massif / valley mask. No water.
  mountain(context) {
    const { config, noise, strength } = context;
    return (x, z) => {
      const [wx, wz] = warp(noise, x, z, 160 * strength, 1 / 1100);
      const massif = fbm(noise, wx + 5000, wz - 3000, 1 / 1600, 3) * 0.5 + 0.5;
      const ridges = ridged(noise, wx, wz, 1 / 900, 4);
      const height = config.baseHeight + config.relief * strength * (0.3 * massif + 0.7 * ridges * (0.45 + 0.55 * massif));
      return { height, surface: NaN };
    };
  },
};

export function generateChunk(config) {
  const chunk = config.chunk;
  const segments = chunk.segments;
  const columns = segments + 1;
  const spacing = chunk.size / segments;
  const count = columns * columns;
  const height = new Float32Array(count);
  const waterSurface = new Float32Array(count).fill(NaN);
  const riverMask = new Uint8Array(count);
  const seaMask = new Uint8Array(count);
  const potential = config.landform === 'coast' ? new Float32Array(count) : null;
  const context = {
    config,
    chunk,
    strength: 0.5 + config.variation,
    noise: createNoise(config.seed, `${config.landform}-noise`),
    random: new SeededRandom(config.seed, `${config.landform}-layout`),
  };
  const sample = LANDFORM_RULES[config.landform](context);

  for (let row = 0; row < columns; row += 1) {
    const z = chunk.originZ - chunk.size / 2 + row * spacing;
    for (let col = 0; col < columns; col += 1) {
      const x = chunk.originX - chunk.size / 2 + col * spacing;
      const index = row * columns + col;
      const result = sample(x, z);
      height[index] = result.height;
      waterSurface[index] = result.surface;
      if (result.river) riverMask[index] = 1;
      if (result.sea) seaMask[index] = 1;
      if (potential) potential[index] = result.potential;
    }
  }

  return {
    grid: { size: chunk.size, segments, columns, rows: columns, spacing, originX: chunk.originX, originZ: chunk.originZ },
    height,
    waterSurface,
    riverMask,
    seaMask,
    potential,
  };
}
