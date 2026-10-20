import * as THREE from 'three';

function disposeLayer(layer) {
  layer.traverse(object => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
    else object.material?.dispose();
  });
  layer.removeFromParent();
}

export class ProjectionDebug {
  constructor(scene, options, surfaceQuery) {
    this.options = options;
    this.surfaceQuery = surfaceQuery;
    this.root = new THREE.Group();
    this.root.name = 'Road projection debug';
    scene.add(this.root);
    this.layer = null;
    this.disposedLayers = 0;
  }

  rebuild(debugPaths) {
    if (this.layer) {
      disposeLayer(this.layer);
      this.disposedLayers += 1;
    }
    const layer = new THREE.Group();
    const rawPositions = [];
    const projectedPositions = [];
    const projectedColors = [];
    const pointPositions = [];
    const pointColors = [];
    const normalPositions = [];
    const gray = new THREE.Color('#8b9297');
    const green = new THREE.Color('#55d187');
    const red = new THREE.Color('#ff5964');

    for (const path of debugPaths) {
      for (let index = 0; index < path.raw.length - 1; index += 1) {
        for (const point of [path.raw[index], path.raw[index + 1]]) {
          const query = this.surfaceQuery.querySurface(point.x, point.z);
          rawPositions.push(point.x, (query.height ?? 0) + this.options.heightOffset * 0.35, point.z);
        }
      }
      for (let index = 0; index < path.samples.length; index += 1) {
        const sample = path.samples[index];
        const color = sample.valid ? green : red;
        pointPositions.push(sample.position.x, sample.position.y, sample.position.z);
        pointColors.push(color.r, color.g, color.b);
        normalPositions.push(
          sample.position.x, sample.position.y, sample.position.z,
          sample.position.x + sample.normal.x * 0.8,
          sample.position.y + sample.normal.y * 0.8,
          sample.position.z + sample.normal.z * 0.8,
        );
        if (index === 0) continue;
        const previous = path.samples[index - 1];
        const segmentColor = sample.valid && previous.valid ? green : red;
        for (const endpoint of [previous, sample]) {
          projectedPositions.push(endpoint.position.x, endpoint.position.y, endpoint.position.z);
          projectedColors.push(segmentColor.r, segmentColor.g, segmentColor.b);
        }
      }
    }

    const rawGeometry = new THREE.BufferGeometry();
    rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rawPositions, 3));
    const rawLines = new THREE.LineSegments(rawGeometry, new THREE.LineBasicMaterial({ color: gray, transparent: true, opacity: 0.72, depthTest: false }));
    const projectedGeometry = new THREE.BufferGeometry();
    projectedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(projectedPositions, 3));
    projectedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(projectedColors, 3));
    const projectedLines = new THREE.LineSegments(projectedGeometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3));
    const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ size: 0.2, vertexColors: true, depthTest: false }));
    const normalGeometry = new THREE.BufferGeometry();
    normalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(normalPositions, 3));
    const normals = new THREE.LineSegments(normalGeometry, new THREE.LineBasicMaterial({ color: 0x66bfff, transparent: true, opacity: 0.68, depthTest: false }));
    for (const object of [rawLines, projectedLines, points, normals]) object.renderOrder = 20;
    layer.add(rawLines, projectedLines, points, normals);
    this.root.add(layer);
    this.layer = layer;
    this.root.visible = this.options.showDebug;
  }

  setVisible(visible) {
    this.options.showDebug = visible;
    this.root.visible = visible;
  }

  dispose() {
    if (this.layer) disposeLayer(this.layer);
    this.root.removeFromParent();
  }
}
