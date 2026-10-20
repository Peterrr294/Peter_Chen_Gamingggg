import * as THREE from 'three';
import { sampleHeight } from '../../cellular-noise/noise.js';

function distanceToSegment(x, z, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared > 0
    ? THREE.MathUtils.clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1)
    : 0;
  const closestX = start.x + amount * dx;
  const closestZ = start.z + amount * dz;
  return Math.hypot(x - closestX, z - closestZ);
}

function distanceToPath(x, z, points) {
  let closest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    closest = Math.min(closest, distanceToSegment(x, z, points[index - 1], points[index]));
  }
  return closest;
}

function canalWidthVariation(index, features) {
  const seed = features.canalVariationSeed ?? 731927;
  const variation = sampleHeight(index * 1.7 + 2.5, index * 0.9 + 4.25, {
    seed,
    scale: 9,
    octaves: 2,
    persistence: 0.3,
  });
  return 0.91 + variation * 0.18;
}

function veniceCanalResolution(resolution) {
  return Math.min(resolution * 4, 540);
}

function veniceCanalBoundaryResolution(resolution) {
  return Math.min(resolution * 8, 960);
}

function veniceCanalLanes(x, z, features) {
  const main = [
    { x: -18, z: 0.8 }, { x: -15.2, z: -0.2 }, { x: -12.2, z: -2.8 },
    { x: -8.7, z: -4.2 }, { x: -5.2, z: -3.4 }, { x: -2.4, z: -1.2 }, { x: 0, z: -1.8 },
  ];
  const secondary = [
    [{ x: -18, z: 7.2 }, { x: -15.2, z: 5.4 }, { x: -13.3, z: 2.8 }, { x: -12.2, z: -2.8 }],
    [{ x: -3.2, z: -9 }, { x: -4.0, z: -7.0 }, { x: -5.2, z: -3.4 }],
    [{ x: 0, z: 6.6 }, { x: -1.8, z: 4.0 }, { x: -3.6, z: 0.6 }, { x: -2.4, z: -1.2 }],
    [{ x: -12.2, z: -2.8 }, { x: -10.8, z: -0.9 }, { x: -8.0, z: -0.3 }, { x: -5.2, z: -3.4 }],
  ];
  const branch = [
    [{ x: -18, z: -6.6 }, { x: -15, z: -5.4 }, { x: -12.5, z: -4.0 }, { x: -8.7, z: -4.2 }],
    [{ x: -9.0, z: 9 }, { x: -9.6, z: 6.2 }, { x: -9.4, z: 1.5 }, { x: -8.7, z: -4.2 }],
    [{ x: -18, z: 3.4 }, { x: -16.1, z: 1.8 }, { x: -15.2, z: -0.2 }],
    [{ x: 0, z: 8.2 }, { x: -1.2, z: 6.0 }, { x: -1.8, z: 4.0 }],
  ];
  const lanes = [{ points: main, baseWidth: features.mainCanalWidth ?? 0.72, extraDepth: 0.08 }];
  secondary.forEach(points => lanes.push({ points, baseWidth: features.secondaryCanalWidth ?? 0.44, extraDepth: 0.065 }));
  branch.forEach(points => lanes.push({ points, baseWidth: features.branchCanalWidth ?? 0.3, extraDepth: 0.055 }));
  if (features.canalExtension) {
    const { minX } = features.canalExtension;
    lanes.push(
      { points: [{ x: minX, z: 1.4 }, { x: -47, z: 2.4 }, { x: -39, z: -0.2 }, { x: -27, z: -0.8 }, { x: -18, z: 0.8 }], baseWidth: features.mainCanalWidth ?? 0.72, extraDepth: 0.08 },
      { points: [{ x: minX, z: 15.5 }, { x: -47, z: 12.4 }, { x: -37, z: 7 }, { x: -27, z: -0.8 }], baseWidth: features.secondaryCanalWidth ?? 0.44, extraDepth: 0.065 },
      { points: [{ x: minX, z: -15 }, { x: -45, z: -12 }, { x: -37, z: -8 }, { x: -27, z: -0.8 }], baseWidth: features.secondaryCanalWidth ?? 0.44, extraDepth: 0.065 },
    );
  }
  return lanes.map((lane, index) => ({
    points: lane.points,
    distance: distanceToPath(x, z, lane.points),
    width: lane.baseWidth * canalWidthVariation(index, features),
    extraDepth: lane.extraDepth,
  }));
}

function veniceWaterAt(x, z, features) {
  return veniceCanalSignedDistance(x, z, features) <= 0;
}

function veniceCanalSignedDistance(x, z, features) {
  return veniceCanalLanes(x, z, features).reduce(
    (distance, lane) => Math.min(distance, lane.distance - lane.width * 0.5),
    Infinity,
  );
}

function veniceShorelineWeightAt(x, z, features) {
  return veniceCanalLanes(x, z, features).reduce((weight, lane) => {
    const edgeDistance = lane.width * 0.5 - lane.distance;
    return Math.max(weight, smooth01(edgeDistance / Math.max(0.08, lane.width * 0.45)));
  }, 0);
}

function veniceCanalCut(x, z, baseHeight, waterHeight, features) {
  const bankWidth = 0.22;
  return veniceCanalLanes(x, z, features).reduce((deepest, lane) => {
    const halfWidth = lane.width * 0.5;
    if (lane.distance > halfWidth + bankWidth) return deepest;
    const waterlineCut = Math.max(0, baseHeight - waterHeight);
    if (lane.distance <= halfWidth) {
      const center = 1 - lane.distance / Math.max(halfWidth, 0.001);
      return Math.max(deepest, waterlineCut + lane.extraDepth * smooth01(center));
    }
    const bank = 1 - (lane.distance - halfWidth) / bankWidth;
    return Math.max(deepest, waterlineCut * smooth01(bank));
  }, 0);
}

function createVeniceCanalField(config, resolution) {
  const segments = veniceCanalBoundaryResolution(resolution);
  const cells = new Set();
  const boundaryVertices = new Map();
  const boundaryEdges = [];
  const boundaryEdgeKeys = new Set();
  const features = config.terrainFeatures ?? {};
  const stepX = config.width / segments;
  const stepZ = config.depth / segments;
  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const worldX = config.centerX - config.width * 0.5 + (xIndex + 0.5) * config.width / segments;
      const worldZ = config.centerZ - config.depth * 0.5 + (zIndex + 0.5) * config.depth / segments;
      if (veniceWaterAt(worldX, worldZ, features)) cells.add(`${xIndex}:${zIndex}`);
    }
  }
  const addBoundaryVertex = (xIndex, zIndex) => {
    const key = `${xIndex}:${zIndex}`;
    if (boundaryVertices.has(key) || xIndex === 0 || xIndex === segments || zIndex === 0 || zIndex === segments) return;
    const startX = config.centerX - config.width * 0.5 + xIndex * stepX;
    const startZ = config.centerZ - config.depth * 0.5 + zIndex * stepZ;
    let worldX = startX;
    let worldZ = startZ;
    const epsilon = Math.min(stepX, stepZ) * 0.25;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const distance = veniceCanalSignedDistance(worldX, worldZ, features);
      const gradientX = (veniceCanalSignedDistance(worldX + epsilon, worldZ, features)
        - veniceCanalSignedDistance(worldX - epsilon, worldZ, features)) / (epsilon * 2);
      const gradientZ = (veniceCanalSignedDistance(worldX, worldZ + epsilon, features)
        - veniceCanalSignedDistance(worldX, worldZ - epsilon, features)) / (epsilon * 2);
      const gradientLengthSquared = gradientX * gradientX + gradientZ * gradientZ;
      if (gradientLengthSquared < 1e-8) break;
      worldX -= distance * gradientX / gradientLengthSquared;
      worldZ -= distance * gradientZ / gradientLengthSquared;
    }
    const maxOffset = Math.min(stepX, stepZ) * 0.8;
    const offsetX = worldX - startX;
    const offsetZ = worldZ - startZ;
    const offsetLength = Math.hypot(offsetX, offsetZ);
    if (offsetLength > maxOffset) {
      worldX = startX + offsetX / offsetLength * maxOffset;
      worldZ = startZ + offsetZ / offsetLength * maxOffset;
    }
    // Keep refined corners distinct at confluences.  The shared field still
    // controls every surface, but a projected pair must not collapse into a
    // zero-area water triangle or a folded wall segment.
    const minimumSpacing = Math.min(stepX, stepZ) * 0.28;
    const localX = worldX - config.centerX;
    const localZ = worldZ - config.centerZ;
    const collapsed = [...boundaryVertices.values()].some(existing =>
      Math.hypot(localX - existing.x, localZ - existing.z) < minimumSpacing);
    boundaryVertices.set(key, collapsed
      ? { x: startX - config.centerX, z: startZ - config.centerZ }
      : { x: localX, z: localZ });
  };
  const addBoundaryEdge = (ax, az, bx, bz) => {
    addBoundaryVertex(ax, az);
    addBoundaryVertex(bx, bz);
    const aKey = `${ax}:${az}`;
    const bKey = `${bx}:${bz}`;
    const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (boundaryEdgeKeys.has(edgeKey)) return;
    boundaryEdgeKeys.add(edgeKey);
    boundaryEdges.push({ ax, az, bx, bz, aKey, bKey });
  };
  cells.forEach(key => {
    const [xIndex, zIndex] = key.split(':').map(Number);
    if (!cells.has(`${xIndex - 1}:${zIndex}`)) addBoundaryEdge(xIndex, zIndex + 1, xIndex, zIndex);
    if (!cells.has(`${xIndex + 1}:${zIndex}`)) addBoundaryEdge(xIndex + 1, zIndex, xIndex + 1, zIndex + 1);
    if (!cells.has(`${xIndex}:${zIndex - 1}`)) addBoundaryEdge(xIndex, zIndex, xIndex + 1, zIndex);
    if (!cells.has(`${xIndex}:${zIndex + 1}`)) addBoundaryEdge(xIndex + 1, zIndex + 1, xIndex, zIndex + 1);
  });
  // A contour projection can make a narrow cell locally collinear at a
  // confluence even when its corners are distinct.  Revert only those cells
  // to their shared world-grid corners; this preserves the network while
  // preventing folded water quads and matching wall cracks.
  const pointFor = (xIndex, zIndex) => boundaryVertices.get(`${xIndex}:${zIndex}`)
    ?? { x: -config.width * 0.5 + xIndex * stepX, z: -config.depth * 0.5 + zIndex * stepZ };
  const cellArea = (a, b, c) => Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  for (let validationPass = 0; validationPass < 3; validationPass += 1) {
    cells.forEach(key => {
      const [xIndex, zIndex] = key.split(':').map(Number);
      const corners = [[xIndex, zIndex], [xIndex + 1, zIndex], [xIndex, zIndex + 1], [xIndex + 1, zIndex + 1]];
      const [p00, p10, p01, p11] = corners.map(([x, z]) => pointFor(x, z));
      if (Math.min(cellArea(p00, p11, p10), cellArea(p00, p01, p11)) < 1e-8) {
        corners.forEach(([x, z]) => {
          const cornerKey = `${x}:${z}`;
          if (boundaryVertices.has(cornerKey)) {
            boundaryVertices.set(cornerKey, {
              x: -config.width * 0.5 + x * stepX,
              z: -config.depth * 0.5 + z * stepZ,
            });
          }
        });
      }
    });
  }
  // Relax the high-resolution contour as a connected world-space polyline,
  // then project it back to the exact canal zero-isoline. Junctions and
  // terrain-border outlets stay fixed, preserving topology and widths.
  const adjacency = new Map();
  const connect = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  boundaryEdges.forEach(({ aKey, bKey }) => {
    connect(aKey, bKey);
    connect(bKey, aKey);
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const updates = new Map();
    boundaryVertices.forEach((point, key) => {
      const neighbors = [...(adjacency.get(key) ?? [])];
      if (neighbors.length !== 2) return;
      const [xIndex, zIndex] = key.split(':').map(Number);
      if (xIndex === 0 || xIndex === segments || zIndex === 0 || zIndex === segments) return;
      const neighborPoints = neighbors.map(neighborKey => {
        const [nx, nz] = neighborKey.split(':').map(Number);
        return pointFor(nx, nz);
      });
      let worldX = config.centerX + point.x
        + ((neighborPoints[0].x + neighborPoints[1].x) * 0.5 - point.x) * 0.42;
      let worldZ = config.centerZ + point.z
        + ((neighborPoints[0].z + neighborPoints[1].z) * 0.5 - point.z) * 0.42;
      const epsilon = Math.min(stepX, stepZ) * 0.25;
      const distance = veniceCanalSignedDistance(worldX, worldZ, features);
      const gradientX = (veniceCanalSignedDistance(worldX + epsilon, worldZ, features)
        - veniceCanalSignedDistance(worldX - epsilon, worldZ, features)) / (epsilon * 2);
      const gradientZ = (veniceCanalSignedDistance(worldX, worldZ + epsilon, features)
        - veniceCanalSignedDistance(worldX, worldZ - epsilon, features)) / (epsilon * 2);
      const gradientLengthSquared = gradientX * gradientX + gradientZ * gradientZ;
      if (gradientLengthSquared >= 1e-8) {
        worldX -= distance * gradientX / gradientLengthSquared;
        worldZ -= distance * gradientZ / gradientLengthSquared;
      }
      updates.set(key, { x: worldX - config.centerX, z: worldZ - config.centerZ });
    });
    updates.forEach((point, key) => boundaryVertices.set(key, point));
  }
  cells.forEach(key => {
    const [xIndex, zIndex] = key.split(':').map(Number);
    const corners = [[xIndex, zIndex], [xIndex + 1, zIndex], [xIndex, zIndex + 1], [xIndex + 1, zIndex + 1]];
    const [p00, p10, p01, p11] = corners.map(([x, z]) => pointFor(x, z));
    if (Math.min(cellArea(p00, p11, p10), cellArea(p00, p01, p11)) < 1e-8) {
      corners.forEach(([x, z]) => {
        const cornerKey = `${x}:${z}`;
        if (boundaryVertices.has(cornerKey)) {
          boundaryVertices.set(cornerKey, {
            x: -config.width * 0.5 + x * stepX,
            z: -config.depth * 0.5 + z * stepZ,
          });
        }
      });
    }
  });
  return { segments, cells, boundaryVertices, boundaryEdges };
}

function createVeniceWaterGeometry(config, canalField) {
  const { segments, cells, boundaryVertices } = canalField;
  const positions = [];
  const indices = [];
  const shorelineWeights = [];
  const waterColors = [];
  const features = config.terrainFeatures ?? {};
  const vertices = new Map();
  const addVertex = (xIndex, zIndex, x, z) => {
    const key = `${xIndex}:${zIndex}`;
    if (vertices.has(key)) return vertices.get(key);
    const refined = boundaryVertices.get(key);
    const vertexX = refined?.x ?? x;
    const vertexZ = refined?.z ?? z;
    const index = positions.length / 3;
    positions.push(vertexX, 0, vertexZ);
    const worldX = config.centerX + vertexX;
    const worldZ = config.centerZ + vertexZ;
    shorelineWeights.push(veniceShorelineWeightAt(worldX, worldZ, features));
    const tone = 0.94 + 0.045 * Math.sin(worldX * 0.31 + worldZ * 0.17 + 1.7);
    waterColors.push(tone, tone, tone);
    vertices.set(key, index);
    return index;
  };
  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    const z0 = -config.depth / 2 + zIndex * config.depth / segments;
    const z1 = -config.depth / 2 + (zIndex + 1) * config.depth / segments;
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const x0 = -config.width / 2 + xIndex * config.width / segments;
      const x1 = -config.width / 2 + (xIndex + 1) * config.width / segments;
      if (!cells.has(`${xIndex}:${zIndex}`)) continue;
      const v00 = addVertex(xIndex, zIndex, x0, z0);
      const v10 = addVertex(xIndex + 1, zIndex, x1, z0);
      const v01 = addVertex(xIndex, zIndex + 1, x0, z1);
      const v11 = addVertex(xIndex + 1, zIndex + 1, x1, z1);
      const triangleArea = (a, b, c) => Math.abs(
        (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2])
        - (positions[b * 3 + 2] - positions[a * 3 + 2]) * (positions[c * 3] - positions[a * 3]),
      );
      const primaryArea = Math.min(triangleArea(v00, v11, v10), triangleArea(v00, v01, v11));
      const alternateArea = Math.min(triangleArea(v00, v01, v10), triangleArea(v10, v01, v11));
      if (alternateArea > primaryArea) indices.push(v00, v01, v10, v10, v01, v11);
      else indices.push(v00, v11, v10, v00, v01, v11);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('shorelineWeight', new THREE.Float32BufferAttribute(shorelineWeights, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createVeniceWaterfrontGeometry(config, materials, heightAt, canalField) {
  const features = config.terrainFeatures ?? {};
  const lanes = veniceCanalLanes(0, 0, features);
  const { segments, boundaryVertices, boundaryEdges } = canalField;
  const bottomY = config.waterLevel - 0.08;
  const wallPositions = [];
  const wallIndices = [];
  const minX = config.centerX - config.width * 0.5;
  const maxX = config.centerX + config.width * 0.5;
  const minZ = config.centerZ - config.depth * 0.5;
  const maxZ = config.centerZ + config.depth * 0.5;
  const stepX = config.width / segments;
  const stepZ = config.depth / segments;
  const vertices = new Map();
  const boundaryEdgeKeys = new Set();
  const wallSegmentKeys = new Set();
  const addVertex = (xIndex, zIndex, top) => {
    const key = `${xIndex}:${zIndex}:${top ? 'top' : 'bottom'}`;
    if (vertices.has(key)) return vertices.get(key);
    const refined = boundaryVertices.get(`${xIndex}:${zIndex}`);
    const x = refined?.x ?? -config.width * 0.5 + xIndex * stepX;
    const z = refined?.z ?? -config.depth * 0.5 + zIndex * stepZ;
    const worldX = config.centerX + x;
    const worldZ = config.centerZ + z;
    const y = top ? Math.max(heightAt(worldX, worldZ), config.waterLevel + 0.055) : bottomY;
    const index = wallPositions.length / 3;
    wallPositions.push(x, y, z);
    vertices.set(key, index);
    return index;
  };
  const addBoundary = (ax, az, bx, bz) => {
    const boundaryKey = (xIndex, zIndex) => {
      const refined = boundaryVertices.get(`${xIndex}:${zIndex}`);
      const x = refined?.x ?? -config.width * 0.5 + xIndex * stepX;
      const z = refined?.z ?? -config.depth * 0.5 + zIndex * stepZ;
      return `${Math.round(x * 1e5)}:${Math.round(z * 1e5)}`;
    };
    const aKey = boundaryKey(ax, az);
    const bKey = boundaryKey(bx, bz);
    const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (boundaryEdgeKeys.has(edgeKey)) return;
    boundaryEdgeKeys.add(edgeKey);
    const aTop = addVertex(ax, az, true);
    const bTop = addVertex(bx, bz, true);
    const aBottom = addVertex(ax, az, false);
    const bBottom = addVertex(bx, bz, false);
    const indexEdgeKey = [aTop, bTop].sort((a, b) => a - b).join('|');
    if (wallSegmentKeys.has(indexEdgeKey)) return;
    wallSegmentKeys.add(indexEdgeKey);
    wallIndices.push(aTop, bTop, bBottom, aTop, bBottom, aBottom);
  };
  boundaryEdges.forEach(({ ax, az, bx, bz }) => addBoundary(ax, az, bx, bz));
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeometry.setIndex(wallIndices);
  wallGeometry.computeVertexNormals();
  wallGeometry.computeBoundingBox();
  wallGeometry.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'Venice shared-field canal boundaries';
  const wallMaterial = materials.dark.clone();
  wallMaterial.side = THREE.DoubleSide;
  const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
  wallMesh.name = 'Venice stitched vertical retaining walls';
  wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const isBorderOutlet = point => Math.abs(point.x - minX) < 1e-6 || Math.abs(point.x - maxX) < 1e-6
    || Math.abs(point.z - minZ) < 1e-6 || Math.abs(point.z - maxZ) < 1e-6;
  let borderOutlets = 0;
  let brokenDeadEnds = 0;
  lanes.forEach((lane, laneIndex) => {
    const halfWidth = lane.width * 0.5;
    [lane.points[0], lane.points[lane.points.length - 1]].forEach(point => {
      const connected = lanes.some((candidate, candidateIndex) => candidateIndex !== laneIndex
        && distanceToPath(point.x, point.z, candidate.points) <= halfWidth + candidate.width * 0.5 + 0.03);
      if (!connected && isBorderOutlet(point)) borderOutlets += 1;
      if (!connected && !isBorderOutlet(point)) brokenDeadEnds += 1;
    });
  });
  group.userData.networkAudit = { laneCount: lanes.length, loopCount: 1, borderOutlets, brokenDeadEnds };
  group.userData.meshAudit = {
    boundarySegments: boundaryEdgeKeys.size,
    indexedVertices: wallPositions.length / 3,
    invalidTriangles: wallIndices.some(index => index < 0 || index >= wallPositions.length / 3) ? 1 : 0,
  };
  group.userData.disposeMaterials = [wallMaterial];
  group.position.set(config.centerX, 0, config.centerZ);
  return group;
}

function normalizedHeight(regionId, x, z, config, seed) {
  const noise = sampleHeight(x, z, {
    seed,
    scale: config.noiseScale,
    octaves: 3,
    persistence: 0.4,
  });
  const localX = (x - config.centerX) / (config.width / 2);
  const localZ = (z - config.centerZ) / (config.depth / 2);
  const radial = Math.min(1, Math.hypot(localX, localZ));
  if (regionId === 'venice') {
    const features = config.terrainFeatures ?? {};
    const baseHeight = 0.268 + (noise - 0.5) * 0.045 * config.noiseStrength;
    const waterHeight = config.waterLevel / config.heightScale;
    return baseHeight - veniceCanalCut(x, z, baseHeight, waterHeight, features);
  }
  if (regionId === 'tokyo') {
    const features = config.terrainFeatures ?? {};
    const rolling = 0.028 * Math.sin((x + 4.2) * 0.42)
      + 0.022 * Math.cos((z - 1.6) * 0.34)
      + 0.014 * Math.sin((x + z) * 0.27);
    const valley = 0.022 * Math.exp(-((z + 1.8) ** 2) / (2 * 2.6 ** 2));
    const streamZ = 3.25 + 0.95 * Math.sin((x - 1.5) * 0.32 + 0.4);
    const stream = Math.exp(-((z - streamZ) ** 2) / (2 * (features.streamWidth ?? 0.8) ** 2));
    return 0.194 + rolling - valley + (noise - 0.5) * 0.035 * config.noiseStrength
      - (features.streamDepth ?? 0.075) * stream;
  }
  if (regionId === 'hawaii') return Math.max(0.08, (1 - radial) * 0.92 + (noise - 0.5) * config.noiseStrength * 0.38);
  const ridge = Math.abs(noise * 2 - 1);
  return 0.18 + (noise * 0.5 + ridge * 0.35) * config.noiseStrength;
}

function smooth01(value) {
  const amount = THREE.MathUtils.clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function seamBoundaryCoordinate(seam, x, z) {
  const tangent = seam.axis === 'z' ? x : z;
  const displacement = sampleHeight(tangent, seam.noiseOffset ?? 0, {
    seed: seam.boundarySeed,
    scale: seam.boundaryNoiseScale,
    octaves: 2,
    persistence: 0.25,
  });
  return seam.coordinate + (displacement - 0.5) * 2 * seam.boundaryIrregularity;
}

function profileHeight(profile, x, z) {
  return normalizedHeight(profile.heightProfile, x, z, profile.config, profile.seed) * profile.config.heightScale;
}

function smoothedProfileHeight(profile, x, z, radius) {
  const center = profileHeight(profile, x, z);
  const neighbors = profileHeight(profile, x - radius, z)
    + profileHeight(profile, x + radius, z)
    + profileHeight(profile, x, z - radius)
    + profileHeight(profile, x, z + radius);
  return center * 0.4 + neighbors * 0.15;
}

function connectedTransitionHeight(x, z, seam) {
  const boundary = seamBoundaryCoordinate(seam, x, z);
  const coordinate = seam.axis === 'z' ? z : x;
  const signedDistance = coordinate - boundary;
  const halfWidth = Math.max(0.0001, seam.transitionWidth * 0.5);
  if (signedDistance <= -halfWidth) return profileHeight(seam.profiles.left, x, z);
  if (signedDistance >= halfWidth) return profileHeight(seam.profiles.right, x, z);
  const blend = smooth01((signedDistance + halfWidth) / (halfWidth * 2));
  const centerWeight = smooth01(1 - Math.abs(signedDistance) / halfWidth);
  const radius = Math.min(0.75, seam.transitionWidth * 0.12);
  const leftRaw = profileHeight(seam.profiles.left, x, z);
  const rightRaw = profileHeight(seam.profiles.right, x, z);
  const smoothing = centerWeight * 0.68;
  const left = THREE.MathUtils.lerp(leftRaw, smoothedProfileHeight(seam.profiles.left, x, z, radius), smoothing);
  const right = THREE.MathUtils.lerp(rightRaw, smoothedProfileHeight(seam.profiles.right, x, z, radius), smoothing);
  return THREE.MathUtils.lerp(left, right, blend);
}

function blendedHeight(regionId, x, z, config, seed) {
  const seam = config.seam;
  if (seam?.profiles) return connectedTransitionHeight(x, z, seam);
  const profile = config.heightProfile ?? regionId;
  return normalizedHeight(profile, x, z, config, seed) * config.heightScale;
}

export function generateTerrain(regionId, config, seed, materials, resolutionScale = 1) {
  const resolution = Math.max(12, Math.round(config.terrainResolution * resolutionScale));
  const geometry = new THREE.PlaneGeometry(config.width, config.depth, resolution, resolution);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const baseColors = new Float32Array(positions.count * 3);
  const displayColors = new Float32Array(positions.count * 3);
  const low = new THREE.Color(config.terrainColor).multiplyScalar(0.62);
  const high = new THREE.Color(config.terrainColor).lerp(new THREE.Color('#ffffff'), regionId === 'iceland' ? 0.7 : 0.24);
  const tint = new THREE.Color();

  const heightAt = (worldX, worldZ) => blendedHeight(regionId, worldX, worldZ, config, seed);
  const delta = Math.min(config.width, config.depth) / resolution;
  const slopeAt = (worldX, worldZ) => {
    const dx = heightAt(worldX + delta, worldZ) - heightAt(worldX - delta, worldZ);
    const dz = heightAt(worldX, worldZ + delta) - heightAt(worldX, worldZ - delta);
    return Math.hypot(dx, dz) / (delta * 2);
  };
  for (let index = 0; index < positions.count; index += 1) {
    const worldX = positions.getX(index) + config.centerX;
    const worldZ = positions.getZ(index) + config.centerZ;
    const height = heightAt(worldX, worldZ);
    const normalized = config.seam
      ? THREE.MathUtils.clamp(height / Math.max(0.001, config.heightScale), 0, 1)
      : normalizedHeight(config.heightProfile ?? regionId, worldX, worldZ, config, seed);
    positions.setY(index, height);
    tint.copy(low).lerp(high, Math.min(1, normalized));
    tint.toArray(baseColors, index * 3);
  }
  displayColors.set(baseColors);
  geometry.setAttribute('color', new THREE.BufferAttribute(displayColors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, materials.terrain);
  mesh.position.set(config.centerX, 0, config.centerZ);
  mesh.name = `${config.label} terrain`;
  mesh.receiveShadow = true;

  const object3D = new THREE.Group();
  object3D.name = `${config.label} terrain layer`;
  object3D.add(mesh);
  let visualTerrainGeometry = null;
  if (config.waterGeometry === 'venice-canals') {
    const visualResolution = veniceCanalResolution(resolution);
    visualTerrainGeometry = new THREE.PlaneGeometry(config.width, config.depth, visualResolution, visualResolution);
    visualTerrainGeometry.rotateX(-Math.PI / 2);
    const visualPositions = visualTerrainGeometry.attributes.position;
    const visualColors = new Float32Array(visualPositions.count * 3);
    for (let index = 0; index < visualPositions.count; index += 1) {
      const worldX = visualPositions.getX(index) + config.centerX;
      const worldZ = visualPositions.getZ(index) + config.centerZ;
      const height = heightAt(worldX, worldZ);
      const normalized = THREE.MathUtils.clamp(height / Math.max(0.001, config.heightScale), 0, 1);
      visualPositions.setY(index, height);
      tint.copy(low).lerp(high, normalized).toArray(visualColors, index * 3);
    }
    visualTerrainGeometry.setAttribute('color', new THREE.BufferAttribute(visualColors, 3));
    visualTerrainGeometry.computeVertexNormals();
    visualTerrainGeometry.computeBoundingBox();
    visualTerrainGeometry.computeBoundingSphere();
    const visualTerrain = new THREE.Mesh(visualTerrainGeometry, materials.terrain);
    visualTerrain.position.copy(mesh.position);
    visualTerrain.name = `${config.label} canal-resolved terrain`;
    visualTerrain.receiveShadow = true;
    mesh.visible = false;
    object3D.add(visualTerrain);
  }
  let water = null;
  let waterfront = null;
  let updateWaterAnimation = () => {};
  if (config.waterLevel >= 0) {
    const canalField = config.waterGeometry === 'venice-canals'
      ? createVeniceCanalField(config, resolution)
      : null;
    const waterGeometry = config.waterGeometry === 'venice-canals'
      ? createVeniceWaterGeometry(config, canalField)
      : new THREE.PlaneGeometry(config.width * 0.96, config.depth * 0.96).rotateX(-Math.PI / 2);
    water = new THREE.Mesh(waterGeometry, materials.water);
    water.position.set(config.centerX, config.waterLevel, config.centerZ);
    water.name = `${config.label} water level`;
    object3D.add(water);
    if (config.waterGeometry === 'venice-canals') {
      materials.water.vertexColors = true;
      materials.water.roughness = 0.22;
      materials.water.metalness = 0.12;
      materials.water.opacity = 0.82;
      materials.water.needsUpdate = true;
      waterfront = createVeniceWaterfrontGeometry(config, materials, heightAt, canalField);
      object3D.add(waterfront);
      const waterPosition = water.geometry.attributes.position;
      const shorelineWeight = water.geometry.attributes.shorelineWeight;
      updateWaterAnimation = time => {
        for (let index = 0; index < waterPosition.count; index += 1) {
          const worldX = waterPosition.getX(index) + config.centerX;
          const worldZ = waterPosition.getZ(index) + config.centerZ;
          const ripple = Math.sin(worldX * 0.78 + worldZ * 0.31 + time * 0.72)
            + 0.55 * Math.sin(worldX * 0.29 - worldZ * 0.64 + time * 0.43);
          waterPosition.setY(index, ripple * 0.0035 * shorelineWeight.getX(index));
        }
        waterPosition.needsUpdate = true;
      };
    }
  }

  const classifiable = config.enableTerrainClassification === true || regionId === 'tokyo' || regionId === 'venice';
  const classification = classifiable ? {
    elevation: new Float32Array(positions.count),
    slope: new Float32Array(positions.count),
    buildability: new Float32Array(positions.count),
    waterMask: new Float32Array(positions.count),
  } : null;
  const heatmapColors = classifiable ? new Float32Array(positions.count * 3) : null;
  const waterMaskColors = classifiable ? new Float32Array(positions.count * 3) : null;
  if (classification) {
    const blocked = new THREE.Color(0xc83f49);
    const caution = new THREE.Color(0xe2bf4f);
    const buildable = new THREE.Color(0x49c978);
    const dry = new THREE.Color(0x5c6470);
    const submergedColor = new THREE.Color(0x1878c8);
    const heat = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const worldX = positions.getX(index) + config.centerX;
      const worldZ = positions.getZ(index) + config.centerZ;
      const height = positions.getY(index);
      const elevation = THREE.MathUtils.clamp(height / Math.max(0.001, config.heightScale), 0, 1);
      const slope = THREE.MathUtils.clamp(slopeAt(worldX, worldZ) / Math.max(0.001, config.maxScatterSlope), 0, 1);
      const submerged = config.waterLevel >= 0 && height <= config.waterLevel;
      const waterSuitability = config.waterLevel >= 0
        ? smooth01((height - config.waterLevel) / Math.max(0.001, config.waterBankWidth ?? 0.55))
        : 1;
      const buildability = submerged ? 0 : THREE.MathUtils.clamp((1 - smooth01(slope)) * waterSuitability, 0, 1);
      classification.elevation[index] = elevation;
      classification.slope[index] = slope;
      classification.buildability[index] = buildability;
      classification.waterMask[index] = submerged ? 1 : 0;
      if (buildability < 0.5) heat.copy(blocked).lerp(caution, buildability * 2);
      else heat.copy(caution).lerp(buildable, (buildability - 0.5) * 2);
      heat.toArray(heatmapColors, index * 3);
      (submerged ? submergedColor : dry).toArray(waterMaskColors, index * 3);
    }
  }

  let buildabilityHeatmapEnabled = false;
  let waterMaskEnabled = false;
  const updateDebugColors = () => {
    const colors = waterMaskEnabled && waterMaskColors
      ? waterMaskColors
      : buildabilityHeatmapEnabled && heatmapColors ? heatmapColors : baseColors;
    displayColors.set(colors);
    geometry.attributes.color.needsUpdate = true;
  };
  const setBuildabilityHeatmap = enabled => {
    buildabilityHeatmapEnabled = enabled;
    updateDebugColors();
  };
  const setWaterMaskOverlay = enabled => {
    waterMaskEnabled = enabled;
    updateDebugColors();
  };
  const classificationAt = (worldX, worldZ) => {
    if (!classification) return null;
    const u = (worldX - (config.centerX - config.width / 2)) / config.width;
    const v = (worldZ - (config.centerZ - config.depth / 2)) / config.depth;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const gridX = u * resolution;
    const gridZ = v * resolution;
    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);
    const x1 = Math.min(resolution, x0 + 1);
    const z1 = Math.min(resolution, z0 + 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const row = resolution + 1;
    const sample = values => {
      const top = THREE.MathUtils.lerp(values[z0 * row + x0], values[z0 * row + x1], tx);
      const bottom = THREE.MathUtils.lerp(values[z1 * row + x0], values[z1 * row + x1], tx);
      return THREE.MathUtils.lerp(top, bottom, tz);
    };
    return {
      elevation: sample(classification.elevation),
      slope: sample(classification.slope),
      buildability: sample(classification.buildability),
      waterMask: sample(classification.waterMask),
    };
  };

  return {
    object3D,
    mesh,
    water,
    waterfront,
    heightAt,
    slopeAt,
    waterDistanceAt: config.waterGeometry === 'venice-canals'
      ? (worldX, worldZ) => veniceCanalSignedDistance(worldX, worldZ, config.terrainFeatures ?? {})
      : null,
    classification,
    classificationAt,
    setBuildabilityHeatmap,
    setWaterMaskOverlay,
    updateWaterAnimation,
    resolution,
    dispose() {
      geometry.dispose();
      visualTerrainGeometry?.dispose();
      water?.geometry.dispose();
      waterfront?.traverse(child => child.geometry?.dispose());
      waterfront?.userData.disposeMaterials?.forEach(material => material.dispose());
    },
  };
}
