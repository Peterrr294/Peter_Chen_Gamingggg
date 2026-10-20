import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom.js';

class SurfaceQuery {
  constructor(terrain) {
    this.terrain = terrain;
    this.terrainMesh = terrain.mesh;
    this.classification = terrain.classification;
  }

  querySurface(worldX, worldZ) {
    const classification = this.terrain.classificationAt(worldX, worldZ);
    if (!classification) return null;
    return {
      worldX,
      worldZ,
      height: this.terrain.heightAt(worldX, worldZ),
      classification,
      waterMask: classification.waterMask,
      buildability: classification.buildability,
      slope: classification.slope,
    };
  }
}

function createHouseGeometry(urbanStyle) {
  const width = urbanStyle ? 0.68 : 0.8;
  const depth = urbanStyle ? 0.68 : 0.72;
  const height = urbanStyle ? 2.4 : 1.35;
  const roofHeight = urbanStyle ? 0.48 : 0.5;
  const body = new THREE.BoxGeometry(width, height, depth);
  body.translate(0, height / 2, 0);
  const overhang = 1.08;
  const roofWidth = width * overhang;
  const roofDepth = depth * overhang;
  const roof = new THREE.BufferGeometry();
  const halfWidth = roofWidth / 2;
  const halfDepth = roofDepth / 2;
  roof.setAttribute('position', new THREE.Float32BufferAttribute([
    -halfWidth, height, -halfDepth,
    halfWidth, height, -halfDepth,
    halfWidth, height, halfDepth,
    -halfWidth, height, halfDepth,
    0, height + roofHeight, 0,
  ], 3));
  roof.setIndex([
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
  ]);
  roof.computeVertexNormals();
  return { body, roof, radius: Math.hypot(roofWidth, roofDepth) / 2 };
}

function terrainAxisYaw(terrain) {
  const bounds = terrain.mesh.geometry.boundingBox;
  if (!bounds) return 0;
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return size.x >= size.z ? 0 : Math.PI / 2;
}

export function generateBuildings(regionId, config, terrain) {
  const started = performance.now();
  const object3D = new THREE.Group();
  object3D.name = `${config.label} procedural buildings`;
  const accepted = [];
  const rejected = [];
  const surfaceQuery = new SurfaceQuery(terrain);
  if (config.enableBuildingScatter !== true || !Number.isFinite(config.buildingSeed) || !surfaceQuery.classification) {
    return { object3D, accepted, rejected, surfaceQuery, terrainMesh: surfaceQuery.terrainMesh, buildabilityThreshold: config.buildingBuildabilityThreshold, generationTime: performance.now() - started, dispose() {} };
  }

  const random = new SeededRandom(regionId, config.buildingSeed, 'buildings');
  const target = Math.max(0, Math.min(config.buildingCountLimit, Math.round(config.buildingCountLimit * config.buildingDensity)));
  const margin = config.buildingTransitionMargin;
  const requestedGridSpacing = Math.max(config.buildingGridSpacing ?? config.buildingMinSpacing, config.buildingMinSpacing);
  const buildingBounds = config.buildingBounds;
  const boundsMargins = config.buildingBoundsMargins;
  const minimumU = (buildingBounds?.minX ?? config.centerX - config.width / 2) + (boundsMargins?.minX ?? margin) - config.centerX;
  const maximumU = (buildingBounds?.maxX ?? config.centerX + config.width / 2) - (boundsMargins?.maxX ?? margin) - config.centerX;
  const minimumV = (buildingBounds?.minZ ?? config.centerZ - config.depth / 2) + (boundsMargins?.minZ ?? margin) - config.centerZ;
  const maximumV = (buildingBounds?.maxZ ?? config.centerZ + config.depth / 2) - (boundsMargins?.maxZ ?? margin) - config.centerZ;
  const preserveGridSpacing = config.preserveBuildingGridSpacing === true;
  const uCellCount = Math.max(1, preserveGridSpacing
    ? Math.floor((maximumU - minimumU) / requestedGridSpacing)
    : Math.ceil((maximumU - minimumU) / requestedGridSpacing));
  const vCellCount = Math.max(1, preserveGridSpacing
    ? Math.floor((maximumV - minimumV) / requestedGridSpacing)
    : Math.ceil((maximumV - minimumV) / requestedGridSpacing));
  const gridSpacingU = preserveGridSpacing ? requestedGridSpacing : (maximumU - minimumU) / uCellCount;
  const gridSpacingV = preserveGridSpacing ? requestedGridSpacing : (maximumV - minimumV) / vCellCount;
  const urbanStyle = regionId === 'tokyo' || config.heightProfile === 'tokyo';
  const geometry = createHouseGeometry(urbanStyle);
  const axisYaw = terrainAxisYaw(terrain);
  const axisX = Math.cos(axisYaw);
  const axisZ = Math.sin(axisYaw);
  const perpendicularX = -axisZ;
  const perpendicularZ = axisX;
  const phaseU = 0;
  const phaseV = 0;
  const zoneYaw = 0;
  let validGridCells = 0;
  let gridCells = 0;

  for (let uIndex = 0; uIndex <= uCellCount; uIndex += 1) {
    const u = preserveGridSpacing ? minimumU + uIndex * gridSpacingU : (uIndex === uCellCount ? maximumU : minimumU + uIndex * gridSpacingU);
    for (let vIndex = 0; vIndex <= vCellCount; vIndex += 1) {
    const v = preserveGridSpacing ? minimumV + vIndex * gridSpacingV : (vIndex === vCellCount ? maximumV : minimumV + vIndex * gridSpacingV);
    gridCells += 1;
    const x = config.centerX + axisX * u + perpendicularX * v;
    const z = config.centerZ + axisZ * u + perpendicularZ * v;
    const scale = random.range(0.85, 1.15);
    const radius = geometry.radius * scale;
    const surface = surfaceQuery.querySurface(x, z);
    const y = surface?.height ?? null;
    let reason = !surface ? 'outside-zone'
      : surface.waterMask >= 0.5 ? 'water'
        : surface.slope >= config.buildingMaxSlope ? 'slope'
        : surface.buildability < config.buildingBuildabilityThreshold ? 'buildability'
          : null;
    if (!reason) {
      validGridCells += 1;
      const overlaps = accepted.some(item => Math.hypot(x - item.x, z - item.z)
        < Math.max(config.buildingMinSpacing, radius + item.radius + 0.08));
      if (overlaps) reason = 'spacing';
    }
    const point = { x, y, z, scale, radius, buildability: surface?.buildability ?? 0, reason, grid: { uIndex, vIndex } };
    if (reason) rejected.push(point);
    else {
      accepted.push({ ...point, yaw: zoneYaw });
    }
  }
  }

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: urbanStyle ? 0xe45d73 : 0xd7a96d,
    roughness: 0.88,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: urbanStyle ? 0x46d9ff : 0xffd166,
    emissive: urbanStyle ? 0x0c5266 : 0x684a12,
    emissiveIntensity: 0.35,
    roughness: 0.94,
  });
  const bodyMesh = new THREE.InstancedMesh(geometry.body, bodyMaterial, accepted.length);
  const roofMesh = new THREE.InstancedMesh(geometry.roof, roofMaterial, accepted.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  accepted.forEach((building, index) => {
    position.set(building.x, building.y, building.z);
    rotation.setFromAxisAngle(up, building.yaw);
    scale.setScalar(building.scale);
    matrix.compose(position, rotation, scale);
    bodyMesh.setMatrixAt(index, matrix);
    roofMesh.setMatrixAt(index, matrix);
  });
  for (const mesh of [bodyMesh, roofMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object3D.add(mesh);
  }
  bodyMesh.name = `${config.label} house bodies`;
  roofMesh.name = `${config.label} house roofs`;

  return {
    object3D,
    bodyMesh,
    roofMesh,
    accepted,
    rejected,
    target,
    surfaceQuery,
    terrainMesh: surfaceQuery.terrainMesh,
    buildabilityThreshold: config.buildingBuildabilityThreshold,
    maxSlope: config.buildingMaxSlope,
    axisYaw,
    gridSpacing: Math.min(gridSpacingU, gridSpacingV),
    requestedGridSpacing,
    gridCells,
    validGridCells,
    coverageRatio: validGridCells > 0 ? accepted.length / validGridCells : 0,
    roofOverhangRatio: 0.08,
    gridPhase: { u: phaseU, v: phaseV },
    gridStart: { u: minimumU + phaseU, v: minimumV + phaseV },
    zoneYaw,
    generationTime: performance.now() - started,
    dispose() {
      object3D.removeFromParent();
      geometry.body.dispose();
      geometry.roof.dispose();
      bodyMaterial.dispose();
      roofMaterial.dispose();
    },
  };
}
