export const DEFAULT_ROAD_MESH_OPTIONS = Object.freeze({
  roadWidth: 1.2,
  surfaceOffset: 0.08,
  uvScale: 0.18,
  miterLimit: 2.4,
  showWireframe: false,
  showCenterline: true,
  showInvalidSegments: true,
});

export function createRoadMeshOptions() {
  return { ...DEFAULT_ROAD_MESH_OPTIONS };
}
