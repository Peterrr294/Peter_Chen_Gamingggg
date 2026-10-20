import * as THREE from 'three';

function disposeObject(object) {
  object.traverse(child => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
    else child.material?.dispose();
  });
  object.removeFromParent();
}

export class RoadDebugPreview {
  constructor(scene, options) {
    this.options = options;
    this.root = new THREE.Group();
    this.root.name = 'Iceland road input debug';
    scene.add(this.root);
    this.pathLayer = null;
    this.queryMarker = null;
    this.normalArrow = null;
  }

  rebuild(validation, surfaceQuery) {
    if (this.pathLayer) disposeObject(this.pathLayer);
    const layer = new THREE.Group();
    layer.name = 'Road samples and control points';
    const linePositions = [];
    const lineColors = [];
    const controlPositions = [];
    const controlColors = [];
    const validColor = new THREE.Color('#55d187');
    const invalidColor = new THREE.Color('#ff5964');

    for (const result of validation.roads) {
      for (let index = 0; index < result.samples.length - 1; index += 1) {
        const start = result.samples[index];
        const end = result.samples[index + 1];
        const valid = start.passable && end.passable;
        const color = valid ? validColor : invalidColor;
        for (const sample of [start, end]) {
          const y = (sample.height ?? this.options.previewHeight) + this.options.previewHeight;
          linePositions.push(sample.x, y, sample.z);
          lineColors.push(color.r, color.g, color.b);
        }
      }
      for (const point of result.road.controlPoints ?? []) {
        const world = surfaceQuery.normalizedToWorld(point);
        const query = surfaceQuery.querySurface(world.x, world.z);
        const color = query.passable ? validColor : invalidColor;
        controlPositions.push(world.x, (query.height ?? 0) + this.options.previewHeight * 1.5, world.z);
        controlColors.push(color.r, color.g, color.b);
      }
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    lines.renderOrder = 15;
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(controlPositions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(controlColors, 3));
    const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ size: 0.34, vertexColors: true, depthTest: false, sizeAttenuation: true }));
    points.renderOrder = 16;
    layer.add(lines, points);
    this.root.add(layer);
    this.pathLayer = layer;
    this.setVisible(this.options.showRoadDebug);
  }

  showQuery(query) {
    if (this.queryMarker) disposeObject(this.queryMarker);
    this.normalArrow?.removeFromParent();
    this.normalArrow?.dispose();
    if (!query?.inBounds) return;
    this.queryMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 8),
      new THREE.MeshBasicMaterial({ color: query.passable ? 0x55d187 : 0xff5964, depthTest: false }),
    );
    this.queryMarker.position.set(query.x, query.height + this.options.previewHeight, query.z);
    this.queryMarker.renderOrder = 18;
    this.normalArrow = new THREE.ArrowHelper(query.normal, this.queryMarker.position, 1.8, 0x66bfff, 0.32, 0.18);
    this.root.add(this.queryMarker, this.normalArrow);
  }

  setVisible(visible) {
    this.options.showRoadDebug = visible;
    this.root.visible = visible;
  }

  dispose() {
    if (this.pathLayer) disposeObject(this.pathLayer);
    if (this.queryMarker) disposeObject(this.queryMarker);
    this.normalArrow?.removeFromParent();
    this.normalArrow?.dispose();
    this.root.removeFromParent();
  }
}
