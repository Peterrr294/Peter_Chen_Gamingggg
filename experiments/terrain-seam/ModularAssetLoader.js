import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Cache source scenes, not placed instances: each future building can receive
// its own transform while the GLB payload is fetched only once.
export function createModularAssetCache(loader = new GLTFLoader()) {
  const sourceCache = new Map();
  const fbxLoader = new FBXLoader();

  const loadSource = (url, format = url.toLowerCase().endsWith('.fbx') ? 'fbx' : 'gltf') => {
    if (!sourceCache.has(url)) {
      sourceCache.set(url, new Promise((resolve, reject) => {
        (format === 'fbx' ? fbxLoader : loader).load(url, resolve, undefined, reject);
      }));
    }
    return sourceCache.get(url);
  };

  const instantiate = async (url, options = {}) => {
    const source = await loadSource(url, options.format);
    const sourceScene = source.scene ?? source;
    const scene = sourceScene.clone(true);
    const yaw = options.yaw ?? 0;
    // Imported FBX assets use a front axis that is rotated relative to the
    // scene's Y-up convention. Apply this once at the shared asset root so
    // every mesh, bound and placement calculation sees the same orientation.
    const frontRotation = options.frontRotation ?? {
      x: 0,
      z: options.frontCorrection ?? 0,
    };
    const scale = options.scale ?? 1;
    scene.rotation.order = 'YXZ';
    scene.rotation.set(frontRotation.x ?? 0, yaw, frontRotation.z ?? 0);
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(scene);
    const center = bounds.getCenter(new THREE.Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= bounds.min.y;
    scene.updateMatrixWorld(true);
    const normalizedBounds = new THREE.Box3().setFromObject(scene);
    const size = normalizedBounds.getSize(new THREE.Vector3());
    return {
      scene,
      source,
      yaw,
      frontRotation: { x: frontRotation.x ?? 0, z: frontRotation.z ?? 0 },
      scale,
      footprint: { width: size.x, depth: size.z },
      bounds: normalizedBounds,
    };
  };

  return {
    loadSource,
    instantiate,
    has: url => sourceCache.has(url),
    size: () => sourceCache.size,
  };
}
