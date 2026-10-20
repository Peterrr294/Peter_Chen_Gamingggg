import * as THREE from 'three';

function pointsObject(items, color, size, name) {
  const positions = new Float32Array(items.length * 3);
  items.forEach((item, index) => {
    positions[index * 3] = item.x;
    positions[index * 3 + 1] = item.y + 0.22;
    positions[index * 3 + 2] = item.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.PointsMaterial({ color, size, depthTest: false, sizeAttenuation: true });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.renderOrder = 20;
  return points;
}

export function createDebugLayers(config, terrain, roads, mainRoute, scatter) {
  const root = new THREE.Group();
  root.name = `${config.label} debug layers`;

  const boundsSource = new THREE.BoxGeometry(config.width, Math.max(0.4, config.heightScale), config.depth);
  const boundsGeometry = new THREE.EdgesGeometry(boundsSource);
  boundsSource.dispose();
  const boundsMaterial = new THREE.LineBasicMaterial({ color: config.accentColor, transparent: true, opacity: 0.72 });
  const bounds = new THREE.LineSegments(boundsGeometry, boundsMaterial);
  bounds.position.set(config.centerX, config.heightScale / 2, config.centerZ);
  bounds.name = 'Region bounds';

  const grid = new THREE.GridHelper(config.width, roads.columns, config.accentColor, 0x353842);
  grid.scale.z = config.depth / config.width;
  grid.position.set(config.centerX, 0.08, config.centerZ);
  grid.name = 'WFC module grid';

  const roadConnections = pointsObject([...roads.roadPoints, ...mainRoute.samples.filter((_, index) => index % 6 === 0)], 0x48a3ff, 0.2, 'Road connections');
  const scatterCandidates = pointsObject(scatter.candidates, 0xffcc55, 0.12, 'Scatter candidates');
  const scatterRejected = pointsObject(scatter.rejected, 0xff4d61, 0.2, 'Scatter rejected');
  root.add(bounds, grid, roadConnections, scatterCandidates, scatterRejected);

  return {
    object3D: root,
    bounds,
    grid,
    roadConnections,
    scatterCandidates,
    scatterRejected,
    setVisibility({ mode, showRegionBounds, showRoadConnections, showWfcGrid, showScatterCandidates, showRejectedScatter }) {
      const systems = mode === 'Systems';
      bounds.visible = systems && showRegionBounds;
      grid.visible = systems && showWfcGrid;
      roadConnections.visible = systems && showRoadConnections;
      scatterCandidates.visible = systems && showScatterCandidates;
      scatterRejected.visible = systems && showRejectedScatter;
    },
    dispose() {
      root.traverse(object => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else object.material?.dispose();
      });
    },
  };
}
