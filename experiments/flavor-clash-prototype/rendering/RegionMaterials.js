import * as THREE from 'three';

export function createRegionMaterials(config) {
  return {
    terrain: new THREE.MeshStandardMaterial({ color: config.terrainColor, roughness: 0.92, metalness: 0, vertexColors: true }),
    road: new THREE.MeshStandardMaterial({ color: config.roadColor, roughness: 0.9, metalness: 0.02 }),
    accent: new THREE.MeshStandardMaterial({ color: config.accentColor, roughness: 0.78, metalness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(config.terrainColor).multiplyScalar(0.48), roughness: 1 }),
    light: new THREE.MeshStandardMaterial({ color: new THREE.Color(config.terrainColor).lerp(new THREE.Color('#ffffff'), 0.35), roughness: 0.95 }),
    water: new THREE.MeshStandardMaterial({ color: config.label === 'Venice' ? 0x277f9a : 0x416f86, transparent: true, opacity: 0.78, roughness: 0.28, metalness: 0.08 }),
  };
}

export function updateRegionMaterials(materials, config) {
  materials.terrain.color.set(config.terrainColor);
  materials.road.color.set(config.roadColor);
  materials.accent.color.set(config.accentColor);
  materials.dark.color.set(config.terrainColor).multiplyScalar(0.48);
  materials.light.color.set(config.terrainColor).lerp(new THREE.Color('#ffffff'), 0.35);
  Object.values(materials).forEach(material => { material.needsUpdate = true; });
}

export function disposeRegionMaterials(materials) {
  Object.values(materials).forEach(material => material.dispose());
}
