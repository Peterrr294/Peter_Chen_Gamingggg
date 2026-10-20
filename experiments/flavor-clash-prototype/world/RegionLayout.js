export function regionBounds(config) {
  return {
    minX: config.centerX - config.width / 2,
    maxX: config.centerX + config.width / 2,
    minZ: config.centerZ - config.depth / 2,
    maxZ: config.centerZ + config.depth / 2,
  };
}

export function nearestPlazaDirection(config) {
  const horizontal = Math.abs(config.centerX) >= Math.abs(config.centerZ);
  if (horizontal) return config.centerX < 0 ? 'east' : 'west';
  return config.centerZ < 0 ? 'south' : 'north';
}

export function regionExit(config, plazaRadius) {
  const direction = nearestPlazaDirection(config);
  const halfWidth = config.width / 2;
  const halfDepth = config.depth / 2;
  const exits = {
    east: { x: config.centerX + halfWidth, z: config.centerZ, plazaX: -plazaRadius, plazaZ: 0 },
    west: { x: config.centerX - halfWidth, z: config.centerZ, plazaX: plazaRadius, plazaZ: 0 },
    south: { x: config.centerX, z: config.centerZ + halfDepth, plazaX: 0, plazaZ: -plazaRadius },
    north: { x: config.centerX, z: config.centerZ - halfDepth, plazaX: 0, plazaZ: plazaRadius },
  };
  return { direction, ...exits[direction] };
}

export function layoutFitsWorld(worldConfig, regionConfigs) {
  return Object.values(regionConfigs).every(config => {
    const bounds = regionBounds(config);
    return Math.abs(bounds.minX) <= worldConfig.mapWidth / 2
      && Math.abs(bounds.maxX) <= worldConfig.mapWidth / 2
      && Math.abs(bounds.minZ) <= worldConfig.mapDepth / 2
      && Math.abs(bounds.maxZ) <= worldConfig.mapDepth / 2;
  });
}
