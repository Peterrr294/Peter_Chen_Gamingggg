import * as THREE from 'three';
import { checksum, sampleHeight } from '../cellular-noise/noise.js';
import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';

function smooth01(value) {
  const amount = THREE.MathUtils.clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function shorelineDistance(x, z, config, numericSeed) {
  const meander = sampleHeight(z, 17.5, {
    seed: (numericSeed + 4039) >>> 0,
    scale: 24,
    octaves: 2,
    persistence: 0.34,
  });
  const halfLandWidth = config.mapWidth * (0.355 + (meander - 0.5) * 0.055);
  return halfLandWidth - Math.abs(x);
}

function terrainHeight(x, z, config, numericSeed) {
  const broad = sampleHeight(x, z, {
    seed: numericSeed,
    scale: config.largeNoiseScale,
    octaves: 3,
    persistence: 0.42,
  });
  const detail = sampleHeight(x, z, {
    seed: (numericSeed + 1777) >>> 0,
    scale: config.detailNoiseScale,
    octaves: 2,
    persistence: 0.35,
  });
  const dryHeight = config.baseElevation
    + (broad - 0.5) * config.relief
    + (detail - 0.5) * config.relief * 0.28;
  const distance = shorelineDistance(x, z, config, numericSeed);
  const landBlend = smooth01((distance + config.coastTransition) / (config.coastTransition * 2));
  return THREE.MathUtils.lerp(config.waterLevel - 0.42, dryHeight, landBlend);
}

export class ManhattanTerrain {
  constructor(scene, config) {
    this.config = config;
    this.root = new THREE.Group();
    this.root.name = 'Manhattan terrain water buildability greybox';
    scene.add(this.root);

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x24678a,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    this.terrainMesh = new THREE.Mesh(undefined, this.terrainMaterial);
    this.terrainMesh.name = 'Manhattan study terrain';
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.waterMesh = new THREE.Mesh(undefined, this.waterMaterial);
    this.waterMesh.name = 'Hudson and East River water plane';
    this.waterMesh.receiveShadow = true;
    this.root.add(this.terrainMesh, this.waterMesh);
    this.surfaceData = null;
    this.lastResult = null;
  }

  regenerate() {
    const config = this.config;
    const numericSeed = hashParts(config.seed);
    const segments = Math.max(8, Math.round(config.resolution));
    const columns = segments + 1;
    const geometry = new THREE.PlaneGeometry(config.mapWidth, config.mapDepth, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const heights = new Float32Array(positions.count);
    const slopes = new Float32Array(positions.count);
    const buildability = new Uint8Array(positions.count);
    const waterMask = new Uint8Array(positions.count);
    const colors = new Float32Array(positions.count * 3);
    const coordinates = new Float32Array(positions.count * 2);

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const height = terrainHeight(x, z, config, numericSeed);
      coordinates[index * 2] = x;
      coordinates[index * 2 + 1] = z;
      heights[index] = height;
      positions.setY(index, height);
    }

    const stepX = config.mapWidth / segments;
    const stepZ = config.mapDepth / segments;
    const blockedColor = new THREE.Color('#8d775d');
    const buildableColor = new THREE.Color('#63b477');
    const submergedColor = new THREE.Color('#173f54');
    const color = new THREE.Color();
    let buildableVertices = 0;
    let waterVertices = 0;
    for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
      for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
        const index = zIndex * columns + xIndex;
        const left = heights[zIndex * columns + Math.max(0, xIndex - 1)];
        const right = heights[zIndex * columns + Math.min(segments, xIndex + 1)];
        const back = heights[Math.max(0, zIndex - 1) * columns + xIndex];
        const front = heights[Math.min(segments, zIndex + 1) * columns + xIndex];
        const normal = new THREE.Vector3(
          -(right - left) / (stepX * 2),
          1,
          -(front - back) / (stepZ * 2),
        ).normalize();
        const slope = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)));
        const x = coordinates[index * 2];
        const z = coordinates[index * 2 + 1];
        const water = heights[index] <= config.waterLevel;
        const canBuild = !water
          && shorelineDistance(x, z, config, numericSeed) >= config.shoreSetback
          && slope <= config.maxBuildableSlope;
        slopes[index] = slope;
        waterMask[index] = water ? 1 : 0;
        buildability[index] = canBuild ? 1 : 0;
        if (water) waterVertices += 1;
        if (canBuild) buildableVertices += 1;
        color.copy(water ? submergedColor : canBuild ? buildableColor : blockedColor);
        color.toArray(colors, index * 3);
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const waterGeometry = new THREE.PlaneGeometry(config.mapWidth * 1.55, config.mapDepth * 1.08);
    waterGeometry.rotateX(-Math.PI / 2);

    this.terrainMesh.geometry?.dispose();
    this.waterMesh.geometry?.dispose();
    this.terrainMesh.geometry = geometry;
    this.waterMesh.geometry = waterGeometry;
    this.waterMesh.position.y = config.waterLevel;
    this.surfaceData = {
      heights,
      slopes,
      buildability,
      waterMask,
      segments,
      columns,
      rows: columns,
      width: config.mapWidth,
      depth: config.mapDepth,
    };
    this.lastResult = {
      seed: config.seed,
      numericSeed,
      signature: checksum(heights),
      vertices: positions.count,
      buildableVertices,
      waterVertices,
      blockedVertices: positions.count - buildableVertices - waterVertices,
    };
    return this.lastResult;
  }

  dispose() {
    this.terrainMesh.geometry?.dispose();
    this.waterMesh.geometry?.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.root.removeFromParent();
  }
}
