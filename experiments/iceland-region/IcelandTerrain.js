import * as THREE from 'three';
import { checksum, sampleHeight } from '../cellular-noise/noise.js';
import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';

function smoothstep(edge0, edge1, value) {
  const amount = THREE.MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function sampleIcelandHeight(x, z, config, numericSeed) {
  const large = sampleHeight(x, z, {
    seed: numericSeed,
    scale: config.largeNoiseScale,
    octaves: 3,
    persistence: 0.48,
  });
  const detail = sampleHeight(x, z, {
    seed: (numericSeed + 1777) >>> 0,
    scale: config.detailNoiseScale,
    octaves: 2,
    persistence: 0.42,
  });
  const ridge = 1 - Math.abs(large * 2 - 1);
  const mountain = large * 0.48 + detail * 0.18 + ridge * ridge * config.ridgeStrength;
  const nx = Math.abs(x) / (config.mapWidth * 0.5);
  const nz = Math.abs(z) / (config.mapDepth * 0.5);
  const edgeDistance = Math.max(nx, nz);
  const coast = 1 - smoothstep(1 - config.coastFalloff, 1, edgeDistance);
  return mountain * config.heightScale * coast - (1 - coast) * config.heightScale * 0.12;
}

export class IcelandTerrain {
  constructor(scene, config) {
    this.config = config;
    this.root = new THREE.Group();
    this.root.name = 'Iceland finite terrain';
    scene.add(this.root);
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
      wireframe: config.wireframe,
    });
    this.waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x214d68,
      roughness: 0.28,
      metalness: 0.05,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    });
    this.terrainMesh = new THREE.Mesh(undefined, this.terrainMaterial);
    this.terrainMesh.name = 'Iceland terrain mesh';
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.waterMesh = new THREE.Mesh(undefined, this.waterMaterial);
    this.waterMesh.name = 'Iceland sea plane';
    this.waterMesh.receiveShadow = true;
    this.root.add(this.terrainMesh, this.waterMesh);
    this.generationCount = 0;
    this.disposedGeometryCount = 0;
    this.lastResult = null;
    this.surfaceData = null;
  }

  regenerate() {
    const started = performance.now();
    const config = this.config;
    const numericSeed = hashParts(config.seed);
    const segments = Math.max(8, Math.round(config.resolution));
    const geometry = new THREE.PlaneGeometry(config.mapWidth, config.mapDepth, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const heights = new Float32Array(positions.count);
    const colors = new Float32Array(positions.count * 3);
    const low = new THREE.Color('#263b3c');
    const grass = new THREE.Color('#587063');
    const rock = new THREE.Color('#727777');
    const snow = new THREE.Color('#e8f0ee');
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const height = sampleIcelandHeight(x, z, config, numericSeed);
      heights[index] = height;
      positions.setY(index, height);
      const normalized = THREE.MathUtils.clamp(height / Math.max(0.001, config.heightScale), 0, 1);
      if (normalized < 0.18) color.copy(low).lerp(grass, normalized / 0.18);
      else if (normalized < 0.58) color.copy(grass).lerp(rock, (normalized - 0.18) / 0.4);
      else color.copy(rock).lerp(snow, (normalized - 0.58) / 0.42);
      color.toArray(colors, index * 3);
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const waterGeometry = new THREE.PlaneGeometry(config.mapWidth * 1.45, config.mapDepth * 1.55);
    waterGeometry.rotateX(-Math.PI / 2);

    if (this.terrainMesh.geometry) {
      this.terrainMesh.geometry.dispose();
      this.disposedGeometryCount += 1;
    }
    if (this.waterMesh.geometry) {
      this.waterMesh.geometry.dispose();
      this.disposedGeometryCount += 1;
    }
    this.terrainMesh.geometry = geometry;
    this.waterMesh.geometry = waterGeometry;
    this.updateWaterLevel(config.waterLevel);
    this.updateWireframe(config.wireframe);
    this.generationCount += 1;
    this.surfaceData = {
      heights,
      segments,
      columns: segments + 1,
      rows: segments + 1,
      width: config.mapWidth,
      depth: config.mapDepth,
    };
    this.lastResult = {
      numericSeed,
      signature: checksum(heights),
      vertices: positions.count,
      generationTime: performance.now() - started,
      geometryUuid: geometry.uuid,
    };
    return this.lastResult;
  }

  updateWaterLevel(value) {
    this.config.waterLevel = value;
    this.waterMesh.position.y = value;
  }

  updateWireframe(value) {
    this.config.wireframe = value;
    this.terrainMaterial.wireframe = value;
    this.terrainMaterial.needsUpdate = true;
  }

  dispose() {
    this.terrainMesh.geometry?.dispose();
    this.waterMesh.geometry?.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.root.removeFromParent();
  }
}
