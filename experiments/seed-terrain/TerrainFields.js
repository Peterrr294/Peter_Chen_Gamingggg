import { checksum } from '../cellular-noise/noise.js';

// Pure field derivation for one chunk (no rendering). Output arrays share the
// generator's 257 × 257 row-major layout: index = row * columns + col,
// row grows with world z, col with world x.

export const EDGES = Object.freeze(['minX', 'maxX', 'minZ', 'maxZ']);
const SLOPE_BINS = [5, 10, 20, 30, 45, 60, 90];

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Edge weight: 1 on the edge, 0 at transitionWidth metres inside.
export const edgeWeight = (distance, width) => 1 - smoothstep(0, width, distance);

export function deriveFields(chunk, config) {
  const { height, waterSurface } = chunk;
  const { segments, columns, spacing, size } = chunk.grid;
  const count = height.length;
  const slope = new Float32Array(count);
  const waterMask = new Uint8Array(count);
  const buildableMask = new Uint8Array(count);
  const transitionWeight = new Float32Array(count);
  const edgeWeights = Object.fromEntries(EDGES.map(edge => [edge, new Float32Array(count)]));
  const width = config.transitionWidth;

  for (let row = 0; row <= segments; row += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const index = row * columns + col;
      // Slope: central differences, as in the Manhattan greybox.
      const dx = (height[row * columns + Math.min(segments, col + 1)] - height[row * columns + Math.max(0, col - 1)])
        / (spacing * (Math.min(segments, col + 1) - Math.max(0, col - 1)));
      const dz = (height[Math.min(segments, row + 1) * columns + col] - height[Math.max(0, row - 1) * columns + col])
        / (spacing * (Math.min(segments, row + 1) - Math.max(0, row - 1)));
      slope[index] = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;

      const surface = waterSurface[index];
      const water = Number.isFinite(surface) && height[index] < surface;
      const lowShore = !water && Number.isFinite(surface) && height[index] < surface + config.shoreFreeboard;
      waterMask[index] = water ? 1 : 0;
      buildableMask[index] = !water && !lowShore && slope[index] <= config.maxBuildableSlope ? 1 : 0;

      // Per-edge smoothstep weights; corners combine both edges with
      // 1 − Π(1 − w), which is continuous and reduces to one edge elsewhere.
      const distances = { minX: col * spacing, maxX: size - col * spacing, minZ: row * spacing, maxZ: size - row * spacing };
      let keep = 1;
      for (const edge of EDGES) {
        const weight = edgeWeight(distances[edge], width);
        edgeWeights[edge][index] = weight;
        keep *= 1 - weight;
      }
      transitionWeight[index] = 1 - keep;
    }
  }

  const fields = { grid: chunk.grid, height, slope, waterMask, buildableMask, transitionWeight, edgeWeights, waterSurface };
  fields.boundarySamples = sampleBoundary(fields, width);
  fields.stats = summarise(fields, chunk, config);
  return fields;
}

// Reserved neighbour interface. Without neighbours the chunk is returned
// unchanged; blending with neighbour boundary data is a later task.
export function applyNeighborConstraints(fields, neighbors = {}) {
  const provided = EDGES.filter(edge => neighbors[edge]);
  if (provided.length === 0) return { height: fields.height, applied: [] };
  throw new Error(`Neighbour blending (${provided.join(', ')}) is reserved for a later task; 02.4 defines the interface only.`);
}

// Outer edge line and the inner line at transitionWidth, per edge, in world
// coordinates. Each line runs in increasing world x or z.
function sampleBoundary(fields, width) {
  const { segments, columns, spacing, size, originX, originZ } = fields.grid;
  const innerStep = Math.round(width / spacing);
  const lineIndex = {
    minX: (depthStep, step) => step * columns + depthStep,
    maxX: (depthStep, step) => step * columns + (segments - depthStep),
    minZ: (depthStep, step) => depthStep * columns + step,
    maxZ: (depthStep, step) => (segments - depthStep) * columns + step,
  };
  const line = (edge, depthStep) => {
    const heights = [];
    const water = [];
    const weights = [];
    for (let step = 0; step <= segments; step += 1) {
      const index = lineIndex[edge](depthStep, step);
      heights.push(Number(fields.height[index].toFixed(3)));
      water.push(fields.waterMask[index]);
      weights.push(Number(fields.transitionWeight[index].toFixed(4)));
    }
    return { offsetMetres: depthStep * spacing, heights, water, weights };
  };
  const edges = {};
  for (const edge of EDGES) {
    const outer = line(edge, 0);
    let waterRuns = 0;
    outer.water.forEach((wet, step) => { if (wet && (step === 0 || !outer.water[step - 1])) waterRuns += 1; });
    edges[edge] = { axis: edge.endsWith('X') ? 'z' : 'x', outer, inner: line(edge, innerStep), waterRuns };
  }
  const corner = (row, col, names) => {
    const index = row * columns + col;
    return {
      edges: names,
      x: originX - size / 2 + col * spacing,
      z: originZ - size / 2 + row * spacing,
      height: Number(fields.height[index].toFixed(3)),
      water: fields.waterMask[index],
      weight: fields.transitionWeight[index],
    };
  };
  return {
    samplesPerEdge: segments + 1,
    spacing,
    transitionWidth: width,
    edges,
    corners: [
      corner(0, 0, ['minZ', 'minX']),
      corner(0, segments, ['minZ', 'maxX']),
      corner(segments, 0, ['maxZ', 'minX']),
      corner(segments, segments, ['maxZ', 'maxX']),
    ],
  };
}

function percentile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

// Connected water from one edge to the opposite edge (4-neighbour flood fill).
function crossesChunk(mask, segments, columns, fromEdge) {
  const seen = new Uint8Array(mask.length);
  const queue = [];
  for (let step = 0; step <= segments; step += 1) {
    const index = fromEdge === 'minX' ? step * columns : step;
    if (mask[index]) { seen[index] = 1; queue.push(index); }
  }
  while (queue.length) {
    const index = queue.pop();
    const row = Math.floor(index / columns);
    const col = index % columns;
    if ((fromEdge === 'minX' && col === segments) || (fromEdge === 'minZ' && row === segments)) return true;
    for (const [r, c] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
      if (r < 0 || c < 0 || r > segments || c > segments) continue;
      const next = r * columns + c;
      if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
    }
  }
  return false;
}

function summarise(fields, chunk, config) {
  const { height, slope, waterMask, buildableMask, waterSurface } = fields;
  const { segments, columns } = fields.grid;
  const count = height.length;
  let water = 0;
  let buildable = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  const landSlopes = [];
  const slopeHistogram = Object.fromEntries(SLOPE_BINS.map(limit => [`<=${limit}`, 0]));
  for (let index = 0; index < count; index += 1) {
    minHeight = Math.min(minHeight, height[index]);
    maxHeight = Math.max(maxHeight, height[index]);
    if (waterMask[index]) { water += 1; continue; }
    if (buildableMask[index]) buildable += 1;
    landSlopes.push(slope[index]);
    const bin = SLOPE_BINS.find(limit => slope[index] <= limit);
    slopeHistogram[`<=${bin}`] += 1;
  }
  landSlopes.sort((a, b) => a - b);

  // Local maxima (strict, 8 neighbours) per km²: high counts mean uniform spikes.
  let peaks = 0;
  for (let row = 1; row < segments; row += 1) {
    for (let col = 1; col < segments; col += 1) {
      const centre = height[row * columns + col];
      let isPeak = true;
      for (let dr = -1; dr <= 1 && isPeak; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if ((dr || dc) && height[(row + dr) * columns + col + dc] >= centre) { isPeak = false; break; }
        }
      }
      if (isPeak) peaks += 1;
    }
  }

  const stats = {
    landform: config.landform,
    seed: config.seed,
    variation: config.variation,
    transitionWidth: config.transitionWidth,
    samples: count,
    water,
    buildable,
    waterRatio: water / count,
    buildableRatio: buildable / count,
    minHeight,
    maxHeight,
    meanLandSlope: landSlopes.length ? landSlopes.reduce((sum, value) => sum + value, 0) / landSlopes.length : 0,
    slopeP50: landSlopes.length ? percentile(landSlopes, 0.5) : 0,
    slopeP95: landSlopes.length ? percentile(landSlopes, 0.95) : 0,
    slopeP99: landSlopes.length ? percentile(landSlopes, 0.99) : 0,
    slopeHistogram,
    peaksPerKm2: peaks / ((fields.grid.size / 1000) ** 2),
    edgeWaterRuns: Object.fromEntries(EDGES.map(edge => [edge, fields.boundarySamples.edges[edge].waterRuns])),
    heightSignature: checksum(height),
    waterSignature: checksum(waterMask),
    weightSignature: checksum(fields.transitionWeight),
  };

  if (config.landform === 'riverValley') {
    let offChannelWater = 0;
    let maxDepth = 0;
    let bankBelowSurface = 0;
    for (let index = 0; index < count; index += 1) {
      if (waterMask[index]) {
        if (!chunk.riverMask[index]) offChannelWater += 1;
        maxDepth = Math.max(maxDepth, waterSurface[index] - height[index]);
      } else if (height[index] < waterSurface[index]) bankBelowSurface += 1;
    }
    stats.river = {
      offChannelWater,
      bankBelowSurface,
      maxDepth,
      crossesX: crossesChunk(waterMask, segments, columns, 'minX'),
      crossesZ: crossesChunk(waterMask, segments, columns, 'minZ'),
    };
  }
  if (config.landform === 'coast') {
    let mismatch = 0;
    for (let index = 0; index < count; index += 1) {
      if (waterMask[index] !== (chunk.potential[index] < 0 ? 1 : 0)) mismatch += 1;
    }
    const wetEdges = EDGES.filter(edge => stats.edgeWaterRuns[edge] > 0);
    stats.coast = { landSeaMismatch: mismatch, wetEdges, enclosedSea: wetEdges.length === 0 };
  }
  return stats;
}
