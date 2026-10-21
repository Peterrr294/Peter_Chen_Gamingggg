import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createModularAssetCache } from './ModularAssetLoader.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { qualitySettings } from '../flavor-clash-prototype/config/worldConfig.js';
import { Region } from '../flavor-clash-prototype/world/Region.js';
import { createSeamRegionConfigs, DEFAULT_TRANSITION, TERRAIN_SEAM_WORLD_SEED } from './config.js';
import { createSeamDebug } from './SeamDebug.js';
import tinyTokyoUrl from './tiny_tokyo.glb?url';
import japan04Url from './04.glb?url';
import japan05Url from './05.glb?url';
import japan06Url from './06.glb?url';
import japan07Url from './07.glb?url';
import japan08Url from './08.glb?url';
import japan09Url from './09.glb?url';
import japan10Url from './10.glb?url';
import japan11Url from './11.glb?url';
import veniceV01Url from './v_01.glb?url';
import veniceV02Url from './v_02.glb?url';

const query = new URLSearchParams(location.search);
const clampParameter = (name, fallback, minimum, maximum) => {
  const raw = query.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, minimum, maximum) : fallback;
};
const transitionParameters = {
  boundaryIrregularity: clampParameter('irregularity', DEFAULT_TRANSITION.boundaryIrregularity, 0, 2.5),
  transitionWidth: clampParameter('width', DEFAULT_TRANSITION.transitionWidth, 3, 10),
  veniceBuildingSeed: clampParameter('veniceSeed', 2101, 0, 999999),
  veniceBuildingDensity: clampParameter('veniceDensity', 0.35, 0, 1),
  veniceMainCanalWidth: clampParameter('veniceMainWidth', 0.72, 0.35, 1.2),
  veniceSecondaryCanalWidth: clampParameter('veniceSecondaryWidth', 0.44, 0.25, 0.8),
  veniceBranchCanalWidth: clampParameter('veniceBranchWidth', 0.3, 0.2, 0.55),
  japanBuildingSeed: clampParameter('japanSeed', 2202, 0, 999999),
  japanBuildingDensity: clampParameter('japanDensity', 0.45, 0, 1),
  veniceBuildingGridSpacing: clampParameter('veniceSpacing', 1.6, 1, 3.5),
  japanBuildingGridSpacing: clampParameter('japanSpacing', 1.5, 1, 3.5),
};

const canvas = document.querySelector('#seamCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x07100f);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07100f, 0.007);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 320);
camera.position.set(68, 52, 76);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 190;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xcfe7e2, 0x17201c, 2.1));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.position.set(-54, 70, 42);
sun.castShadow = true;
scene.add(sun);

const worldConfig = { worldSeed: TERRAIN_SEAM_WORLD_SEED, quality: 'Standard', centralPlazaRadius: 0, mode: 'Showcase' };
const configs = createSeamRegionConfigs(transitionParameters);
const transition = configs.venice.seam;
const root = new THREE.Group();
root.name = 'Venice Japan seam prototype';
scene.add(root);

function buildRegion(id, config) {
  const region = new Region(id, config, worldConfig, qualitySettings.Standard);
  const result = region.generate(config);
  // Region remains the owner of its complete generated result. This focused
  // view hides unrelated layers without changing their generators.
  result.roads.object3D.visible = false;
  result.mainRoute.object3D.visible = false;
  result.decorations.object3D.visible = false;
  result.debugLayers.object3D.visible = false;
  root.add(result.object3D);
  return { region, result };
}

const left = buildRegion('venice', configs.venice);
const right = buildRegion('japan', configs.japan);
const testAssetRoot = new THREE.Group();
testAssetRoot.name = 'Japan GLB test asset';
right.result.object3D.add(testAssetRoot);
const assetCache = createModularAssetCache();
const assetUrl = tinyTokyoUrl;
const sourceAsset = await assetCache.loadSource(assetUrl);
const assetBounds = new THREE.Box3().setFromObject(sourceAsset.scene);
const assetSize = assetBounds.getSize(new THREE.Vector3());
const assetHorizontalSize = Math.max(assetSize.x, assetSize.z);
const assetScale = assetHorizontalSize > 0 ? 4 / assetHorizontalSize : 1;
const assetInstance = await assetCache.instantiate(assetUrl, { yaw: 0, scale: assetScale });
const assetScene = assetInstance.scene;
const japanAnchor = right.result.buildings.surfaceQuery.querySurface(configs.japan.referenceAnchor.x, configs.japan.referenceAnchor.z);
if (japanAnchor) {
  assetScene.position.add(new THREE.Vector3(japanAnchor.worldX, japanAnchor.height, japanAnchor.worldZ));
}
testAssetRoot.add(assetScene);
const testAssetMeshes = [];
assetScene.traverse(node => { if (node.isMesh) testAssetMeshes.push(node); });
assetScene.updateMatrixWorld(true);
const assetWorldBounds = new THREE.Box3().setFromObject(assetScene);
const assetHierarchyNodes = [];
const assetMeshParents = new Set();
const assetMaterials = new Map();
assetScene.traverse(node => {
  assetHierarchyNodes.push(node);
  if (node.isMesh) {
    assetMeshParents.add(node.parent?.name || '(unnamed)');
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (material) assetMaterials.set(material.uuid, { name: material.name || '(unnamed)', type: material.type, transparent: material.transparent });
    }
  }
});
const assetInventory = {
  nodeCount: assetHierarchyNodes.length,
  groupCount: assetHierarchyNodes.filter(node => !node.isMesh).length,
  meshCount: testAssetMeshes.length,
  meshParentCount: assetMeshParents.size,
  materialCount: assetMaterials.size,
  materials: [...assetMaterials.values()],
  worldBounds: { min: assetWorldBounds.min.toArray(), max: assetWorldBounds.max.toArray() },
  separableBuildings: false,
  segmentationNote: 'Flat component groups; semantic names mix roofs, props, infrastructure, and building parts. Manual segmentation required.',
};
const standaloneAssets = [
  ['glb-04', japan04Url],
  ['glb-05', japan05Url],
  ['glb-06', japan06Url],
  ['glb-07', japan07Url],
  ['glb-08', japan08Url],
  ['glb-09', japan09Url],
  ['glb-10', japan10Url],
  ['glb-11', japan11Url],
].map(([id, url]) => ({ id, url, format: 'gltf', weight: 1 }));
const assetAudit = [];
const japanAssetOrientationOverrides = {
  'glb-02': { x: 0, z: -Math.PI / 2 },
  'glb-03': { x: 0, z: 0 },
};
const japanAssetSpanOverrides = {
  'glb-02': { u: 2, v: 3 },
  'glb-03': { u: 2, v: 2 },
};
const standaloneSources = (await Promise.all(standaloneAssets.map(async asset => {
  try {
    const source = await assetCache.loadSource(asset.url, asset.format);
    const sourceScene = source.scene ?? source;
    const sourceBounds = new THREE.Box3().setFromObject(sourceScene);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const sourceMaterials = new Set();
    sourceScene.traverse(node => {
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) if (material) sourceMaterials.add(material.uuid);
    });
    const maxAxis = ['x', 'y', 'z'].reduce((best, axis) => sourceSize[axis] > sourceSize[best] ? axis : best, 'y');
    // FBX files are Y-up, but several exports carry their building height on
    // X or Z. Bring only that asset's local height axis back to world Y once.
    const inferredRotation = maxAxis === 'x'
      ? { x: 0, z: -Math.PI / 2 }
      : maxAxis === 'z'
        ? { x: Math.PI / 2, z: 0 }
        : { x: 0, z: 0 };
    const frontRotation = japanAssetOrientationOverrides[asset.id] ?? inferredRotation;
    const orientedPreview = sourceScene.clone(true);
    orientedPreview.rotation.order = 'YXZ';
    orientedPreview.rotation.set(frontRotation.x, 0, frontRotation.z);
    orientedPreview.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(orientedPreview);
    assetAudit.push({ id: asset.id, status: 'loaded', spawned: false, reason: null });
    return {
      ...asset,
      source,
      size: bounds.getSize(new THREE.Vector3()),
      sourceSize,
      sourceParentRotation: sourceScene.parent?.rotation?.toArray?.() ?? [0, 0, 0, 'XYZ'],
      materialCount: sourceMaterials.size,
      sourceUp: sourceScene.up.toArray(),
      sourceRotation: sourceScene.rotation.toArray(),
      dominantAxis: maxAxis,
      frontRotation,
    };
  } catch (error) {
    assetAudit.push({ id: asset.id, status: 'rejected', spawned: false, reason: `load-failed: ${error.message}` });
    return null;
  }
}))).filter(Boolean);
const grid = right.result.buildings;
const validByCell = new Map();
for (const [index, point] of grid.accepted.entries()) {
  const axis = grid.axisYaw;
  const u = Math.cos(axis) * (point.x - right.result.terrain.mesh.position.x) + Math.sin(axis) * (point.z - right.result.terrain.mesh.position.z);
  const v = -Math.sin(axis) * (point.x - right.result.terrain.mesh.position.x) + Math.cos(axis) * (point.z - right.result.terrain.mesh.position.z);
  const uIndex = Math.round((u - grid.gridStart.u) / grid.gridSpacing);
  const vIndex = Math.round((v - grid.gridStart.v) / grid.gridSpacing);
  validByCell.set(`${uIndex}:${vIndex}`, { index, point, uIndex, vIndex });
}
const assetRandom = new SeededRandom('japan-assets', configs.japan.buildingSeed, 'weighted-glb-selection');
const standaloneRoot = new THREE.Group();
standaloneRoot.name = 'Japan standalone GLB replacements';
right.result.object3D.add(standaloneRoot);
const reservedCells = new Set();
const standalonePlacements = [];
const weightedAsset = () => {
  const total = standaloneSources.reduce((sum, asset) => sum + Math.max(0, asset.weight), 0);
  let pick = assetRandom.range(0, total);
  return standaloneSources.find(asset => (pick -= Math.max(0, asset.weight)) <= 0) || standaloneSources[standaloneSources.length - 1];
};
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
const placementOrder = [...standaloneSources].sort((left, right) => (assetRandom.range(0, 1) / Math.max(right.weight, 0.001)) - (assetRandom.range(0, 1) / Math.max(left.weight, 0.001)));
const processedAssetIds = new Set();
for (const asset of placementOrder) {
  processedAssetIds.add(asset.id);
  const aspect = asset.size.x / Math.max(asset.size.z, Number.EPSILON);
  const span = japanAssetSpanOverrides[asset.id] ?? { u: aspect >= 1 ? 2 : 1, v: aspect >= 1 ? 1 : 2 };
  const spanU = span.u;
  const spanV = span.v;
  const candidates = [...validByCell.values()].filter(cell => {
    const cells = [];
    for (let du = 0; du < spanU; du += 1) for (let dv = 0; dv < spanV; dv += 1) {
      const occupied = validByCell.get(`${cell.uIndex + du}:${cell.vIndex + dv}`);
      if (occupied) cells.push(occupied);
    }
    return cells.length === spanU * spanV && cells.every(occupied => !reservedCells.has(occupied.index));
  });
  if (!candidates.length) {
    assetAudit.find(entry => entry.id === asset.id).reason = 'no-valid-unreserved-footprint';
    continue;
  }
  const start = candidates[Math.floor(assetRandom.range(0, candidates.length))];
  const cells = [];
  for (let du = 0; du < spanU; du += 1) for (let dv = 0; dv < spanV; dv += 1) cells.push(validByCell.get(`${start.uIndex + du}:${start.vIndex + dv}`));
  const scale = Math.min((grid.gridSpacing * spanU) / asset.size.x, (grid.gridSpacing * spanV) / asset.size.z) * 0.98;
  const instance = await assetCache.instantiate(asset.url, {
    format: asset.format,
    yaw: grid.zoneYaw,
    frontRotation: asset.frontRotation,
    scale,
  });
  const center = cells.reduce((sum, cell) => sum.add(new THREE.Vector3(cell.point.x, cell.point.y, cell.point.z)), new THREE.Vector3()).multiplyScalar(1 / cells.length);
  const samples = [-1, 1].flatMap(x => [-1, 1].map(z => grid.surfaceQuery.querySurface(center.x + x * instance.footprint.width / 2, center.z + z * instance.footprint.depth / 2)));
  const heights = samples.filter(Boolean).map(sample => sample.height);
  if (samples.length !== 4 || samples.some(sample => !sample) || Math.max(...heights) - Math.min(...heights) > 0.75) continue;
  instance.scene.position.add(new THREE.Vector3(center.x, center.y, center.z));
  standaloneRoot.add(instance.scene);
  for (const cell of cells) {
    reservedCells.add(cell.index);
    for (const mesh of [grid.bodyMesh, grid.roofMesh]) mesh.setMatrixAt(cell.index, hiddenMatrix);
  }
  grid.bodyMesh.instanceMatrix.needsUpdate = true;
  grid.roofMesh.instanceMatrix.needsUpdate = true;
  standalonePlacements.push({ assetId: asset.id, indices: cells.map(cell => cell.index), span: { u: spanU, v: spanV }, footprint: instance.footprint, uniformScale: scale, yaw: grid.zoneYaw });
  assetAudit.find(entry => entry.id === asset.id).spawned = true;
}
for (const entry of assetAudit) if (!processedAssetIds.has(entry.id) && entry.status === 'loaded' && !entry.reason) entry.reason = 'no-valid-placement';
// Venice reference buildings are an independent pool: the complete scene is
// intentionally not loaded here. Each source keeps its own materials and
// proportions while the instance root is normalized to the Venice grid.
const veniceAssetCache = createModularAssetCache();
// Only the two active Venice models are bundled; local alternatives stay excluded.
const veniceAssetDefinitions = [
  { id: 'venice-v01', url: veniceV01Url, format: 'gltf', weight: 1, span: { u: 2, v: 2 } },
  { id: 'venice-v02', url: veniceV02Url, format: 'gltf', weight: 1, span: { u: 1, v: 2 } },
];
const veniceAssetAudit = [];
const veniceAssetYaw = { 'venice-v01': Math.PI / 2, 'venice-v02': 0 };
const veniceSources = (await Promise.all(veniceAssetDefinitions.map(async asset => {
  try {
    const source = await veniceAssetCache.loadSource(asset.url, asset.format);
    const sourceScene = source.scene ?? source;
    const sourceBounds = new THREE.Box3().setFromObject(sourceScene);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const localYaw = veniceAssetYaw[asset.id] ?? 0;
    const orientedPreview = sourceScene.clone(true);
    orientedPreview.rotation.order = 'YXZ';
    orientedPreview.rotation.set(0, localYaw, 0);
    orientedPreview.updateMatrixWorld(true);
    const orientedSize = new THREE.Box3().setFromObject(orientedPreview).getSize(new THREE.Vector3());
    veniceAssetAudit.push({ id: asset.id, status: 'loaded', spawned: 0, sourceSize: sourceSize.toArray(), rotation: { x: 0, y: localYaw, z: 0 }, reason: null });
    return { ...asset, source, size: orientedSize, frontRotation: { x: 0, z: 0 }, localYaw };
  } catch (error) {
    veniceAssetAudit.push({ id: asset.id, status: 'rejected', spawned: 0, reason: `load-failed: ${error.message}` });
    return null;
  }
}))).filter(Boolean);
const veniceGrid = left.result.buildings;
const veniceReference = veniceSources.find(asset => asset.id === 'venice-v02');
const veniceReferenceScale = veniceReference && !Number.isFinite(configs.venice.urbanReferenceLongSide)
  ? Math.min((veniceGrid.gridSpacing * veniceReference.span.u) / veniceReference.size.x, (veniceGrid.gridSpacing * veniceReference.span.v) / veniceReference.size.z) * 0.94
  : 1;
const veniceReferenceLongSide = Number.isFinite(configs.venice.urbanReferenceLongSide)
  ? configs.venice.urbanReferenceLongSide
  : veniceReference
  ? Math.max(veniceReference.size.x, veniceReference.size.z) * veniceReferenceScale
  : veniceGrid.gridSpacing;
const veniceUniformScaleFor = asset => Math.min(
  veniceReferenceLongSide / Math.max(asset.size.x, asset.size.z),
  (veniceGrid.gridSpacing * asset.span.u) / asset.size.x,
  (veniceGrid.gridSpacing * asset.span.v) / asset.size.z,
) * 0.94;
const veniceTargetHeight = veniceReference
  ? veniceReference.size.y * veniceUniformScaleFor(veniceReference)
  : 0;
const veniceValidByCell = new Map();
for (const [index, point] of veniceGrid.accepted.entries()) {
  const uIndex = point.grid.uIndex;
  const vIndex = point.grid.vIndex;
  veniceValidByCell.set(`${uIndex}:${vIndex}`, { index, point, uIndex, vIndex });
}
const veniceRandom = new SeededRandom('venice-assets', configs.venice.buildingSeed, 'reference-guided-density');
const veniceRoot = new THREE.Group();
veniceRoot.name = 'Venice standalone reference buildings';
left.result.object3D.add(veniceRoot);
const veniceReservedCells = new Set();
const venicePlacements = [];
const veniceCandidateAudit = {
  candidateWindows: 0,
  rejected: { missingCells: 0, shorelineClearance: 0, invalidSurface: 0, densityFalloff: 0, overlap: 0, placementLimit: 0 },
  waterfrontPlaced: 0,
  inlandPlaced: 0,
};
const veniceCandidateQueues = new Map();
const smoothDensity = value => {
  const amount = THREE.MathUtils.clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
};
for (const asset of veniceSources) {
  const { u: spanU, v: spanV } = asset.span;
  const scale = veniceUniformScaleFor(asset);
  const footprint = { width: asset.size.x * scale, depth: asset.size.z * scale };
  const candidates = [];
  for (const cell of veniceValidByCell.values()) {
    veniceCandidateAudit.candidateWindows += 1;
    const cells = [];
    for (let du = 0; du < spanU; du += 1) for (let dv = 0; dv < spanV; dv += 1) {
      const occupied = veniceValidByCell.get(`${cell.uIndex + du}:${cell.vIndex + dv}`);
      if (occupied) cells.push(occupied);
    }
    if (cells.length !== spanU * spanV) {
      veniceCandidateAudit.rejected.missingCells += 1;
      continue;
    }
    const center = cells.reduce((sum, item) => sum.add(new THREE.Vector3(item.point.x, item.point.y, item.point.z)), new THREE.Vector3()).multiplyScalar(1 / cells.length);
    const footprintPoints = [{ x: center.x, z: center.z }, ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: center.x + x * footprint.width / 2, z: center.z + z * footprint.depth / 2 })))];
    const samples = footprintPoints.map(point => veniceGrid.surfaceQuery.querySurface(point.x, point.z));
  const heights = samples.filter(Boolean).map(sample => sample.height);
    if (samples.some(sample => !sample || sample.waterMask >= 0.5 || sample.slope >= veniceGrid.maxSlope || sample.buildability < veniceGrid.buildabilityThreshold)
      || Math.max(...heights) - Math.min(...heights) > 0.75) {
      veniceCandidateAudit.rejected.invalidSurface += 1;
      continue;
    }
    const shorelineClearance = Math.min(...footprintPoints.map(point => left.result.terrain.waterDistanceAt(point.x, point.z)));
    if (shorelineClearance < configs.venice.urbanQuayClearance) {
      veniceCandidateAudit.rejected.shorelineClearance += 1;
      continue;
    }
    const bounds = configs.venice.buildingBounds;
    const edgeDistance = Math.min(center.x - bounds.minX, bounds.maxX - center.x, center.z - bounds.minZ, bounds.maxZ - center.z);
    const edgeFactor = 0.32 + 0.68 * smoothDensity(edgeDistance / 7);
    const waterfrontWeight = 1 - smoothDensity((shorelineClearance - configs.venice.urbanQuayClearance)
      / (configs.venice.urbanWaterfrontDistance - configs.venice.urbanQuayClearance));
    const densityChance = (0.34 + waterfrontWeight * 0.5) * edgeFactor;
    const variation = veniceRandom.range(0, 1);
    if (variation > densityChance) {
      veniceCandidateAudit.rejected.densityFalloff += 1;
      continue;
    }
    candidates.push({ asset, cells, center, scale, footprint, shorelineClearance, waterfrontWeight, priority: waterfrontWeight * 2 + edgeFactor * 0.4 + variation * 0.08 });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  veniceCandidateQueues.set(asset.id, candidates);
}
const veniceMaxPlacements = configs.venice.urbanMaxPlacements;
const veniceWaterfrontTarget = Math.round(veniceMaxPlacements * 2 / 3);
let exhaustedQueues = 0;
for (let placementAttempt = 0; venicePlacements.length < veniceMaxPlacements && exhaustedQueues < veniceSources.length; placementAttempt += 1) {
  const asset = veniceSources[placementAttempt % Math.max(veniceSources.length, 1)];
  const queue = veniceCandidateQueues.get(asset.id) ?? [];
  let candidate = null;
  while (queue.length && !candidate) {
    const prioritizeWaterfront = veniceCandidateAudit.waterfrontPlaced < veniceWaterfrontTarget;
    const preferredIndex = queue.findIndex(item => (item.shorelineClearance <= configs.venice.urbanWaterfrontDistance) === prioritizeWaterfront);
    const [next] = queue.splice(preferredIndex >= 0 ? preferredIndex : 0, 1);
    if (next.cells.some(cell => veniceReservedCells.has(cell.index))) veniceCandidateAudit.rejected.overlap += 1;
    else candidate = next;
  }
  if (!candidate) {
    exhaustedQueues += 1;
    continue;
  }
  exhaustedQueues = 0;
  const { cells, center, scale } = candidate;
  const instance = await veniceAssetCache.instantiate(asset.url, { format: asset.format, yaw: veniceGrid.zoneYaw + asset.localYaw, frontRotation: asset.frontRotation, scale });
  const originalSize = instance.bounds.getSize(new THREE.Vector3());
  const heightNormalization = veniceTargetHeight / Math.max(originalSize.y, Number.EPSILON);
  instance.scene.scale.y *= heightNormalization;
  instance.scene.updateMatrixWorld(true);
  const scaledBounds = new THREE.Box3().setFromObject(instance.scene);
  instance.scene.position.y -= scaledBounds.min.y;
  instance.scene.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(instance.scene);
  const normalizedSize = normalizedBounds.getSize(new THREE.Vector3());
  const normalizedFootprint = { width: normalizedSize.x, depth: normalizedSize.z };
  instance.scene.position.add(new THREE.Vector3(center.x, center.y, center.z));
  instance.scene.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(instance.scene);
  veniceRoot.add(instance.scene);
  for (const cell of cells) {
    veniceReservedCells.add(cell.index);
    for (const mesh of [veniceGrid.bodyMesh, veniceGrid.roofMesh]) mesh.setMatrixAt(cell.index, hiddenMatrix);
  }
  veniceGrid.bodyMesh.instanceMatrix.needsUpdate = true;
  veniceGrid.roofMesh.instanceMatrix.needsUpdate = true;
  venicePlacements.push({
    assetId: asset.id,
    indices: cells.map(cell => cell.index),
    span: asset.span,
    footprint: normalizedFootprint,
    originalFootprint: instance.footprint,
    uniformScale: scale,
    heightNormalization,
    height: normalizedSize.y,
    baseHeightError: Math.abs(worldBounds.min.y - center.y),
    rotation: { x: 0, y: veniceGrid.zoneYaw + asset.localYaw, z: 0 },
    shorelineClearance: candidate.shorelineClearance,
  });
  if (candidate.shorelineClearance <= configs.venice.urbanWaterfrontDistance) veniceCandidateAudit.waterfrontPlaced += 1;
  else veniceCandidateAudit.inlandPlaced += 1;
  veniceAssetAudit.find(entry => entry.id === asset.id).spawned += 1;
}
veniceCandidateAudit.rejected.placementLimit = [...veniceCandidateQueues.values()].reduce((sum, queue) => sum + queue.length, 0);
veniceGrid.bodyMesh.visible = false;
veniceGrid.roofMesh.visible = false;
const venicePlacementBounds = venicePlacements.reduce((bounds, placement) => {
  const cell = veniceGrid.accepted[placement.indices[0]];
  if (!cell) return bounds;
  bounds.minX = Math.min(bounds.minX, cell.x);
  bounds.maxX = Math.max(bounds.maxX, cell.x);
  bounds.minZ = Math.min(bounds.minZ, cell.z);
  bounds.maxZ = Math.max(bounds.maxZ, cell.z);
  return bounds;
}, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
const veniceGridRejected = veniceGrid.rejected.reduce((counts, point) => {
  counts[point.reason] = (counts[point.reason] ?? 0) + 1;
  return counts;
}, {});
const veniceUrbanAudit = {
  domain: { ...configs.venice.buildingBounds },
  placementBounds: venicePlacementBounds,
  span: { x: venicePlacementBounds.maxX - venicePlacementBounds.minX, z: venicePlacementBounds.maxZ - venicePlacementBounds.minZ },
  gridCells: veniceGrid.gridCells,
  validGridCells: veniceValidByCell.size,
  gridRejected: veniceGridRejected,
  placed: venicePlacements.length,
  reservedCells: veniceReservedCells.size,
  occupiedCellCoverage: veniceValidByCell.size ? veniceReservedCells.size / veniceValidByCell.size : 0,
  ...veniceCandidateAudit,
  heightNormalization: {
    targetHeight: veniceTargetHeight,
    minHeight: Math.min(...venicePlacements.map(placement => placement.height)),
    maxHeight: Math.max(...venicePlacements.map(placement => placement.height)),
    maxFootprintError: Math.max(...venicePlacements.map(placement => Math.max(
      Math.abs(placement.footprint.width - placement.originalFootprint.width),
      Math.abs(placement.footprint.depth - placement.originalFootprint.depth),
    ))),
    maxBaseHeightError: Math.max(...venicePlacements.map(placement => placement.baseHeightError)),
  },
};
const seamDebug = createSeamDebug(
  left.result.terrain,
  right.result.terrain,
  transition,
  configs.venice.depth,
  configs.venice.terrainResolution,
);
root.add(seamDebug.object3D);

const leftSpacing = configs.venice.width / configs.venice.terrainResolution;
const rightSpacing = configs.japan.width / configs.japan.terrainResolution;
document.querySelector('#heightError').textContent = seamDebug.maxHeightError.toExponential(3);
document.querySelector('#sampleCount').textContent = seamDebug.sampleCount;
document.querySelector('#vertexSpacing').textContent = `${leftSpacing.toFixed(3)} / ${rightSpacing.toFixed(3)}`;
document.querySelector('#sharedBoundary').textContent = `x = ${transition.coordinate.toFixed(1)}`;
document.querySelector('#leftBuildings').textContent = left.result.buildings.accepted.length;
document.querySelector('#rightBuildings').textContent = right.result.buildings.accepted.length;
document.querySelector('#japanGlbMeshes').textContent = testAssetMeshes.length;
document.body.dataset.seamHeightError = String(seamDebug.maxHeightError);
const transitionForm = document.querySelector('#transitionForm');
const irregularityInput = document.querySelector('#boundaryIrregularity');
const widthInput = document.querySelector('#transitionWidth');
irregularityInput.value = transitionParameters.boundaryIrregularity;
widthInput.value = transitionParameters.transitionWidth;
for (const [id, value] of Object.entries({
  veniceBuildingSeed: transitionParameters.veniceBuildingSeed,
  veniceBuildingDensity: transitionParameters.veniceBuildingDensity,
  veniceMainCanalWidth: transitionParameters.veniceMainCanalWidth,
  veniceSecondaryCanalWidth: transitionParameters.veniceSecondaryCanalWidth,
  veniceBranchCanalWidth: transitionParameters.veniceBranchCanalWidth,
  japanBuildingSeed: transitionParameters.japanBuildingSeed,
  japanBuildingDensity: transitionParameters.japanBuildingDensity,
  veniceBuildingGridSpacing: transitionParameters.veniceBuildingGridSpacing,
  japanBuildingGridSpacing: transitionParameters.japanBuildingGridSpacing,
})) document.querySelector(`#${id}`).value = value;
transitionForm.addEventListener('submit', event => {
  event.preventDefault();
  const next = new URLSearchParams(location.search);
  next.set('irregularity', irregularityInput.value);
  next.set('width', widthInput.value);
  next.set('veniceSeed', document.querySelector('#veniceBuildingSeed').value);
  next.set('veniceDensity', document.querySelector('#veniceBuildingDensity').value);
  next.set('veniceMainWidth', document.querySelector('#veniceMainCanalWidth').value);
  next.set('veniceSecondaryWidth', document.querySelector('#veniceSecondaryCanalWidth').value);
  next.set('veniceBranchWidth', document.querySelector('#veniceBranchCanalWidth').value);
  next.set('japanSeed', document.querySelector('#japanBuildingSeed').value);
  next.set('japanDensity', document.querySelector('#japanBuildingDensity').value);
  next.set('veniceSpacing', document.querySelector('#veniceBuildingGridSpacing').value);
  next.set('japanSpacing', document.querySelector('#japanBuildingGridSpacing').value);
  location.search = next.toString();
});
document.querySelector('#resetTransition').addEventListener('click', () => { location.search = ''; });

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

let running = true;
const waterClock = new THREE.Clock();
function animate() {
  if (!running) return;
  resize();
  controls.update();
  left.result.terrain.updateWaterAnimation(waterClock.getElapsedTime());
  right.result.terrain.updateWaterAnimation(waterClock.getElapsedTime());
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.__terrainSeamLab = {
  ready: true,
  camera,
  controls,
  configs,
  left,
  right,
  seamDebug,
  testAsset: {
    object3D: testAssetRoot,
    meshCount: testAssetMeshes.length,
    meshNames: testAssetMeshes.map(mesh => mesh.name || 'unnamed'),
    sourceSize: assetSize,
    uniformScale: assetScale,
    url: assetUrl,
    cacheSize: assetCache.size(),
    footprint: assetInstance.footprint,
    normalizedBaseOrigin: true,
    standaloneReplacements: standalonePlacements,
    standaloneAssetCount: standalonePlacements.length,
    anchor: japanAnchor ? { x: japanAnchor.worldX, y: japanAnchor.height, z: japanAnchor.worldZ } : null,
    inventory: assetInventory,
  },
  snapshot: () => ({
    leftSeed: left.result.seed,
    rightSeed: right.result.seed,
    leftMaterial: left.result.materials.terrain.uuid,
    rightMaterial: right.result.materials.terrain.uuid,
    leftBoundary: configs.venice.centerX + configs.venice.width / 2,
    rightBoundary: configs.japan.centerX - configs.japan.width / 2,
    leftDimensions: { width: configs.venice.width, depth: configs.venice.depth, resolution: configs.venice.terrainResolution },
    rightDimensions: { width: configs.japan.width, depth: configs.japan.depth, resolution: configs.japan.terrainResolution },
    leftSpacing,
    rightSpacing,
    maxHeightError: seamDebug.maxHeightError,
    meanHeightError: seamDebug.meanHeightError,
    seamSamples: seamDebug.sampleCount,
    boundaryIrregularity: transition.boundaryIrregularity,
    transitionWidth: transition.transitionWidth,
    boundaryMin: seamDebug.boundaryMin,
    boundaryMax: seamDebug.boundaryMax,
    leftBuildings: left.result.buildings.accepted.length,
    rightBuildings: right.result.buildings.accepted.length,
    leftBuildingSeed: configs.venice.buildingSeed,
    rightBuildingSeed: configs.japan.buildingSeed,
    leftBuildingDensity: configs.venice.buildingDensity,
    veniceCanalWidths: { ...configs.venice.terrainFeatures },
    rightBuildingDensity: configs.japan.buildingDensity,
    leftBuildingGridSpacing: configs.venice.buildingGridSpacing,
    rightBuildingGridSpacing: configs.japan.buildingGridSpacing,
    leftValidGridCells: left.result.buildings.validGridCells,
    rightValidGridCells: right.result.buildings.validGridCells,
    leftBuildingCoverage: left.result.buildings.coverageRatio,
    rightBuildingCoverage: right.result.buildings.coverageRatio,
    leftBuildingYaw: left.result.buildings.zoneYaw,
    rightBuildingYaw: right.result.buildings.zoneYaw,
    japanGlbMeshes: testAssetMeshes.length,
    japanGlbUniformScale: assetScale,
    japanGlbCacheSize: assetCache.size(),
    japanStandaloneReplacement: standalonePlacements.flatMap(placement => placement.indices),
    japanStandaloneCount: standalonePlacements.length,
    japanStandaloneAssetIds: standalonePlacements.map(placement => placement.assetId),
    japanAssetAudit: assetAudit,
    veniceAssetAudit,
    veniceStandaloneCount: venicePlacements.length,
    veniceReferenceLongSide,
    venicePlacementDetails: venicePlacements,
    veniceUrbanAudit,
    japanAssetOrientation: standaloneSources.map(asset => ({
      id: asset.id,
      format: asset.format,
      sourceUp: asset.sourceUp,
      sourceRotation: asset.sourceRotation,
      sourceSize: asset.sourceSize.toArray(),
      sourceParentRotation: asset.sourceParentRotation,
      materialCount: asset.materialCount,
      dominantAxis: asset.dominantAxis,
      frontRotation: asset.frontRotation,
    })),
    japanGlbInventory: assetInventory,
  }),
};

window.addEventListener('pagehide', () => {
  running = false;
  seamDebug.dispose();
  left.region.dispose();
  right.region.dispose();
  testAssetRoot.removeFromParent();
  standaloneRoot.removeFromParent();
  controls.dispose();
  renderer.dispose();
  root.removeFromParent();
}, { once: true });
