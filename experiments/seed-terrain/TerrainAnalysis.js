import { checksum } from '../cellular-noise/noise.js';
import { EDGES } from './TerrainFields.js';

// Pure terrain analysis over the 02.4 fields (no regeneration, no rendering).
//
// Grid and coordinates: 257 × 257 vertex samples, index = row * columns + col.
// World x = originX − size/2 + col·spacing, world z = originZ − size/2 + row·spacing (metres).
// Areas: each vertex owns its Voronoi cell — spacing² inside, half on an edge,
// a quarter at a corner — so boundary vertices are not double counted and the
// weights sum exactly to size² (1 048 576 m² for the frozen chunk).
// Angles: measured in degrees from +x toward +z. Axes are undirected (0–180°),
// directions are directed (0–360°).

export const ANALYSIS_THRESHOLDS = Object.freeze({
  // Suitability classes (slope in degrees). Classes 2–3 equal the absolute
  // buildableMask from TerrainFields; class 1 is land that needs grading.
  suitability: { highMaxSlope: 5, mediumMaxSlope: 10, lowMaxSlope: 20 },
  // Regions smaller than this (≈ 50 m × 50 m, one small urban block) are counted as fragments.
  minRegionArea: 2500,
  regionDetailLimit: 12,
  // Direction evidence thresholds.
  minWaterAreaForAxis: 0.01, // fraction of chunk
  linearWaterElongation: 4, // √(λ1/λ2) of the water body
  shorelineElongation: 3, // √(λ1/λ2) of shoreline samples
  reliefAnisotropy: 0.3, // (λ1 − λ2)/(λ1 + λ2) of the gradient structure tensor
  slopeCoherence: 0.5, // |mean gradient| / mean |gradient|
  minRegionalSlopeDeg: 0.1,
});

const SLOPE_BINS = [2, 5, 10, 15, 25, 35, 45, 90];

function cellWeights(grid) {
  const { segments, columns, spacing } = grid;
  const weights = new Float32Array(columns * columns);
  for (let row = 0; row <= segments; row += 1) {
    const rowWeight = row === 0 || row === segments ? 0.5 : 1;
    for (let col = 0; col <= segments; col += 1) {
      weights[row * columns + col] = rowWeight * (col === 0 || col === segments ? 0.5 : 1) * spacing * spacing;
    }
  }
  return weights;
}

function weightedPercentiles(values, weights, mask, quantiles) {
  const order = [];
  for (let index = 0; index < values.length; index += 1) if (!mask || mask[index]) order.push(index);
  if (!order.length) return Object.fromEntries(quantiles.map(q => [`p${q * 100}`, null]));
  order.sort((a, b) => values[a] - values[b]);
  const total = order.reduce((sum, index) => sum + weights[index], 0);
  const result = {};
  let cumulative = 0;
  let cursor = 0;
  for (const q of quantiles) {
    while (cursor < order.length - 1 && cumulative + weights[order[cursor]] < q * total) {
      cumulative += weights[order[cursor]];
      cursor += 1;
    }
    result[`p${Math.round(q * 100)}`] = values[order[cursor]];
  }
  return result;
}

const toWorld = (grid, row, col) => ({
  x: grid.originX - grid.size / 2 + col * grid.spacing,
  z: grid.originZ - grid.size / 2 + row * grid.spacing,
});

// 4-neighbour connected components. Labels start at 1; 0 = not in mask.
function connectedComponents(mask, grid, weights) {
  const { segments, columns } = grid;
  const labels = new Int32Array(mask.length);
  const regions = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    const id = regions.length + 1;
    const region = { id, samples: 0, area: 0, minRow: Infinity, maxRow: -Infinity, minCol: Infinity, maxCol: -Infinity, sumX: 0, sumZ: 0, edges: new Set() };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop();
      const row = Math.floor(index / columns);
      const col = index % columns;
      const { x, z } = toWorld(grid, row, col);
      region.samples += 1;
      region.area += weights[index];
      region.sumX += x * weights[index];
      region.sumZ += z * weights[index];
      region.minRow = Math.min(region.minRow, row);
      region.maxRow = Math.max(region.maxRow, row);
      region.minCol = Math.min(region.minCol, col);
      region.maxCol = Math.max(region.maxCol, col);
      if (col === 0) region.edges.add('minX');
      if (col === segments) region.edges.add('maxX');
      if (row === 0) region.edges.add('minZ');
      if (row === segments) region.edges.add('maxZ');
      if (row > 0 && mask[index - columns] && !labels[index - columns]) { labels[index - columns] = id; stack.push(index - columns); }
      if (row < segments && mask[index + columns] && !labels[index + columns]) { labels[index + columns] = id; stack.push(index + columns); }
      if (col > 0 && mask[index - 1] && !labels[index - 1]) { labels[index - 1] = id; stack.push(index - 1); }
      if (col < segments && mask[index + 1] && !labels[index + 1]) { labels[index + 1] = id; stack.push(index + 1); }
    }
    regions.push(region);
  }
  return { labels, regions };
}

function summariseRegions({ labels, regions }, grid, chunkArea, maskArea) {
  const sorted = [...regions].sort((a, b) => b.area - a.area);
  const fragments = sorted.filter(region => region.area < ANALYSIS_THRESHOLDS.minRegionArea);
  const describe = region => {
    const min = toWorld(grid, region.minRow, region.minCol);
    const max = toWorld(grid, region.maxRow, region.maxCol);
    return {
      id: region.id,
      area: region.area,
      chunkFraction: region.area / chunkArea,
      samples: region.samples,
      centroid: { x: region.sumX / region.area, z: region.sumZ / region.area },
      bounds: { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z },
      gridBounds: { minRow: region.minRow, maxRow: region.maxRow, minCol: region.minCol, maxCol: region.maxCol },
      touchesEdges: EDGES.filter(edge => region.edges.has(edge)),
    };
  };
  return {
    count: regions.length,
    significantCount: regions.length - fragments.length,
    fragmentCount: fragments.length,
    fragmentArea: fragments.reduce((sum, region) => sum + region.area, 0),
    totalArea: maskArea,
    largestArea: sorted[0]?.area ?? 0,
    largestShareOfMask: sorted.length ? sorted[0].area / maskArea : 0,
    largestShareOfChunk: sorted.length ? sorted[0].area / chunkArea : 0,
    edgeConnected: sorted.filter(region => region.edges.size > 0).length,
    regions: sorted.slice(0, ANALYSIS_THRESHOLDS.regionDetailLimit).map(describe),
    labels,
  };
}

// Weighted PCA of sample positions → major axis, elongation √(λ1/λ2).
function principalAxis(points) {
  let total = 0;
  let meanX = 0;
  let meanZ = 0;
  for (const [x, z, w] of points) { total += w; meanX += x * w; meanZ += z * w; }
  if (!total) return null;
  meanX /= total;
  meanZ /= total;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const [x, z, w] of points) {
    xx += (x - meanX) ** 2 * w;
    zz += (z - meanZ) ** 2 * w;
    xz += (x - meanX) * (z - meanZ) * w;
  }
  xx /= total; zz /= total; xz /= total;
  const trace = xx + zz;
  const root = Math.sqrt(((xx - zz) / 2) ** 2 + xz * xz);
  const major = trace / 2 + root;
  const minor = Math.max(1e-9, trace / 2 - root);
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  return { centre: { x: meanX, z: meanZ }, angle, elongation: Math.sqrt(major / minor) };
}

const axisDegrees = angle => ((angle * 180 / Math.PI) % 180 + 180) % 180;
const directionDegrees = (x, z) => ((Math.atan2(z, x) * 180 / Math.PI) + 360) % 360;
const round = (value, digits = 3) => Number(value.toFixed(digits));

function dominantDirection(fields, water, weights, chunkArea) {
  const { grid, height, waterMask } = fields;
  const { segments, columns, spacing } = grid;
  const t = ANALYSIS_THRESHOLDS;
  const candidates = [];
  const largest = water.regions[0];

  // A. Linear water body (river / channel) crossing the chunk.
  if (largest && largest.chunkFraction >= t.minWaterAreaForAxis) {
    const points = [];
    for (let index = 0; index < waterMask.length; index += 1) {
      if (water.labels[index] !== largest.id) continue;
      const { x, z } = toWorld(grid, Math.floor(index / columns), index % columns);
      points.push([x, z, weights[index]]);
    }
    const axis = principalAxis(points);
    const pass = axis.elongation >= t.linearWaterElongation && largest.touchesEdges.length >= 2;
    candidates.push({ type: 'waterAxis', pass, metric: 'elongation', value: round(axis.elongation), threshold: t.linearWaterElongation, axisDeg: round(axisDegrees(axis.angle), 1) });
  }

  // B. Shoreline of the largest water body, plus the seaward side.
  if (largest && largest.chunkFraction >= t.minWaterAreaForAxis) {
    const shore = [];
    let landX = 0; let landZ = 0; let landW = 0;
    for (let index = 0; index < waterMask.length; index += 1) {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const { x, z } = toWorld(grid, row, col);
      if (!waterMask[index]) { landX += x * weights[index]; landZ += z * weights[index]; landW += weights[index]; continue; }
      if (water.labels[index] !== largest.id) continue;
      const neighbours = [row > 0 && index - columns, row < segments && index + columns, col > 0 && index - 1, col < segments && index + 1];
      if (neighbours.some(next => next !== false && !waterMask[next])) shore.push([x, z, 1]);
    }
    if (shore.length > 1 && landW > 0) {
      const axis = principalAxis(shore);
      const seawardX = largest.centroid.x - landX / landW;
      const seawardZ = largest.centroid.z - landZ / landW;
      const pass = axis.elongation >= t.shorelineElongation && largest.touchesEdges.length >= 2;
      candidates.push({
        type: 'shoreline', pass, metric: 'elongation', value: round(axis.elongation), threshold: t.shorelineElongation,
        axisDeg: round(axisDegrees(axis.angle), 1), seawardDeg: round(directionDegrees(seawardX, seawardZ), 1), shorelineSamples: shore.length,
      });
    }
  }

  // C/D. Land gradient: structure tensor (relief grain) and mean vector (regional slope).
  let jxx = 0; let jzz = 0; let jxz = 0; let gx = 0; let gz = 0; let magnitude = 0; let landWeight = 0;
  for (let row = 0; row <= segments; row += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const index = row * columns + col;
      if (waterMask[index]) continue;
      const c0 = Math.max(0, col - 1); const c1 = Math.min(segments, col + 1);
      const r0 = Math.max(0, row - 1); const r1 = Math.min(segments, row + 1);
      const dx = (height[row * columns + c1] - height[row * columns + c0]) / ((c1 - c0) * spacing);
      const dz = (height[r1 * columns + col] - height[r0 * columns + col]) / ((r1 - r0) * spacing);
      const w = weights[index];
      jxx += dx * dx * w; jzz += dz * dz * w; jxz += dx * dz * w;
      gx += dx * w; gz += dz * w; magnitude += Math.hypot(dx, dz) * w; landWeight += w;
    }
  }
  if (landWeight > 0) {
    const trace = jxx + jzz;
    const root = Math.sqrt(((jxx - jzz) / 2) ** 2 + jxz * jxz);
    const anisotropy = trace > 0 ? (2 * root) / trace : 0;
    // Gradients point across ridges/valleys, so the grain runs perpendicular to the dominant gradient axis.
    const gradientAxis = 0.5 * Math.atan2(2 * jxz, jxx - jzz);
    candidates.push({
      type: 'reliefGrain', pass: anisotropy >= t.reliefAnisotropy, metric: 'anisotropy', value: round(anisotropy), threshold: t.reliefAnisotropy,
      axisDeg: round(axisDegrees(gradientAxis + Math.PI / 2), 1),
    });
    const meanX = gx / landWeight;
    const meanZ = gz / landWeight;
    const coherence = magnitude > 0 ? Math.hypot(meanX, meanZ) / (magnitude / landWeight) : 0;
    const regionalSlope = Math.atan(Math.hypot(meanX, meanZ)) * 180 / Math.PI;
    candidates.push({
      type: 'regionalSlope', pass: coherence >= t.slopeCoherence && regionalSlope >= t.minRegionalSlopeDeg, metric: 'coherence', value: round(coherence), threshold: t.slopeCoherence,
      downslopeDeg: round(directionDegrees(-meanX, -meanZ), 1), regionalSlopeDeg: round(regionalSlope),
    });
  }

  const priority = ['waterAxis', 'shoreline', 'reliefGrain', 'regionalSlope'];
  const primary = priority.map(type => candidates.find(candidate => candidate.type === type && candidate.pass)).find(Boolean);
  return { primary: primary ? primary.type : 'unknown', selected: primary ?? null, candidates, priority };
}

function boundaryConnections(fields, water, buildable) {
  const { grid, waterMask, buildableMask, boundarySamples } = fields;
  const { segments, columns, spacing, size, originX, originZ } = grid;
  const indexOf = {
    minX: step => step * columns,
    maxX: step => step * columns + segments,
    minZ: step => step,
    maxZ: step => segments * columns + step,
  };
  const result = {};
  let sampleMismatches = 0;
  for (const edge of EDGES) {
    const start = (edge.endsWith('X') ? originZ : originX) - size / 2;
    const runs = { water: [], buildable: [] };
    for (const [kind, mask, labels] of [['water', waterMask, water.labels], ['buildable', buildableMask, buildable.labels]]) {
      let open = null;
      for (let step = 0; step <= segments; step += 1) {
        const index = indexOf[edge](step);
        if (kind === 'water' && boundarySamples.edges[edge].outer.water[step] !== waterMask[index]) sampleMismatches += 1;
        const length = step === 0 || step === segments ? spacing / 2 : spacing;
        if (mask[index]) {
          if (!open) open = { from: start + step * spacing, to: start + step * spacing, length: 0, regionIds: new Set() };
          open.to = start + step * spacing;
          open.length += length;
          open.regionIds.add(labels[index]);
        } else if (open) { runs[kind].push(open); open = null; }
      }
      if (open) runs[kind].push(open);
    }
    const pack = list => list.map(run => ({ from: run.from, to: run.to, length: run.length, regionIds: [...run.regionIds] }));
    result[edge] = {
      along: edge.endsWith('X') ? 'z' : 'x',
      waterRuns: pack(runs.water),
      buildableRuns: pack(runs.buildable),
      waterLength: runs.water.reduce((sum, run) => sum + run.length, 0),
      buildableLength: runs.buildable.reduce((sum, run) => sum + run.length, 0),
    };
  }
  return { edges: result, edgeLength: size, sampleMismatches };
}

export function analyseTerrain(fields, config) {
  const { grid, height, slope, waterMask, buildableMask, waterSurface } = fields;
  const weights = cellWeights(grid);
  const chunkArea = grid.size * grid.size;
  const count = height.length;
  const t = ANALYSIS_THRESHOLDS.suitability;

  let weightSum = 0; let waterArea = 0; let buildableArea = 0; let heightSum = 0; let slopeSum = 0; let landSlopeSum = 0;
  let minHeight = Infinity; let maxHeight = -Infinity;
  const landMask = new Uint8Array(count);
  const suitabilityMask = new Uint8Array(count);
  const classArea = [0, 0, 0, 0];
  const slopeHistogram = SLOPE_BINS.map((max, bin) => ({ minDeg: bin ? SLOPE_BINS[bin - 1] : 0, maxDeg: max, area: 0, fraction: 0 }));

  for (let index = 0; index < count; index += 1) {
    const w = weights[index];
    weightSum += w;
    heightSum += height[index] * w;
    slopeSum += slope[index] * w;
    minHeight = Math.min(minHeight, height[index]);
    maxHeight = Math.max(maxHeight, height[index]);
    slopeHistogram[SLOPE_BINS.findIndex(max => slope[index] <= max)].area += w;
    if (waterMask[index]) { waterArea += w; continue; }
    landMask[index] = 1;
    landSlopeSum += slope[index] * w;
    if (buildableMask[index]) buildableArea += w;
    // 3 high / 2 medium: absolute buildable split by slope. 1 low: dry, above freeboard, needs grading. 0: water, low shore, or too steep.
    const surface = waterSurface[index];
    const aboveFreeboard = !Number.isFinite(surface) || height[index] >= surface + config.shoreFreeboard;
    let suitability = 0;
    if (buildableMask[index]) suitability = slope[index] <= t.highMaxSlope ? 3 : 2;
    else if (aboveFreeboard && slope[index] <= t.lowMaxSlope) suitability = 1;
    suitabilityMask[index] = suitability;
    classArea[suitability] += w;
  }
  classArea[0] += waterArea;
  slopeHistogram.forEach(bin => { bin.fraction = bin.area / chunkArea; });

  const water = summariseRegions(connectedComponents(waterMask, grid, weights), grid, chunkArea, waterArea);
  const buildable = summariseRegions(connectedComponents(buildableMask, grid, weights), grid, chunkArea, buildableArea);
  const landArea = chunkArea - waterArea;

  const analysis = {
    version: '02.5',
    source: { landform: config.landform, seed: config.seed, variation: config.variation, transitionWidth: config.transitionWidth },
    units: { length: 'm', area: 'm²', elevation: 'm', slope: 'deg', angle: 'deg from +x toward +z' },
    grid: { ...grid, layout: 'row-major, index = row * columns + col', worldX: 'originX - size/2 + col * spacing', worldZ: 'originZ - size/2 + row * spacing', areaWeighting: 'vertex Voronoi cells (edge 1/2, corner 1/4)' },
    thresholds: ANALYSIS_THRESHOLDS,
    areaCheck: { chunkArea, weightedArea: weightSum },
    elevationStats: {
      min: minHeight, max: maxHeight, range: maxHeight - minHeight, mean: heightSum / weightSum,
      ...weightedPercentiles(height, weights, null, [0.05, 0.5, 0.95]),
    },
    slopeStats: {
      mean: slopeSum / weightSum,
      meanLand: landArea > 0 ? landSlopeSum / landArea : null,
      land: weightedPercentiles(slope, weights, landMask, [0.5, 0.9, 0.95, 0.99]),
      histogram: slopeHistogram,
    },
    waterCoverage: { area: waterArea, fraction: waterArea / chunkArea, landArea, buildableArea, buildableFraction: buildableArea / chunkArea },
    waterRegions: water,
    buildableRegions: buildable,
    suitability: {
      classes: { 0: 'unsuitable (water, low shore, or slope > 20°)', 1: 'low (dry, slope 10–20°, needs grading; not buildable)', 2: 'medium (buildable, slope 5–10°)', 3: 'high (buildable, slope ≤ 5°)' },
      area: classArea,
      fraction: classArea.map(area => area / chunkArea),
    },
    suitabilityMask,
  };
  analysis.dominantDirection = dominantDirection(fields, water, weights, chunkArea);
  analysis.boundaryConnections = boundaryConnections(fields, water, buildable);
  const parts = [suitabilityMask, new Uint8Array(water.labels.buffer), new Uint8Array(buildable.labels.buffer)];
  const combined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => { combined.set(part, offset); return offset + part.length; }, 0);
  analysis.signature = checksum(combined);
  return analysis;
}
