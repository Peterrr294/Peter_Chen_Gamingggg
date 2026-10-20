import * as THREE from 'three';
import { DEFAULT_ROAD_MESH_OPTIONS } from './config.js';

function contiguousValidRuns(samples) {
  const runs = [];
  let current = [];
  for (const sample of samples) {
    if (sample.valid) current.push(sample);
    else {
      if (current.length >= 2) runs.push(current);
      current = [];
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

function sampleVector(sample) {
  return new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z);
}

function sampleNormal(sample) {
  return new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z).normalize();
}

function tangentAt(run, index) {
  const previous = sampleVector(run[Math.max(0, index - 1)]);
  const next = sampleVector(run[Math.min(run.length - 1, index + 1)]);
  return next.sub(previous).normalize();
}

function sideFromTangent(tangent, normal) {
  const side = new THREE.Vector3().crossVectors(tangent, normal);
  if (side.lengthSq() < 0.000001) side.set(1, 0, 0);
  return side.normalize();
}

function offsetAt(run, index, halfWidth, miterLimit) {
  const normal = sampleNormal(run[index]);
  const tangent = tangentAt(run, index);
  const currentSide = sideFromTangent(tangent, normal);
  if (index === 0 || index === run.length - 1) return { offset: currentSide.multiplyScalar(halfWidth), normal, miterLength: halfWidth };
  const point = sampleVector(run[index]);
  const previousTangent = point.clone().sub(sampleVector(run[index - 1])).normalize();
  const nextTangent = sampleVector(run[index + 1]).sub(point).normalize();
  const previousSide = sideFromTangent(previousTangent, normal);
  const nextSide = sideFromTangent(nextTangent, normal);
  const miter = previousSide.clone().add(nextSide);
  if (miter.lengthSq() < 0.000001) return { offset: currentSide.multiplyScalar(halfWidth), normal, miterLength: halfWidth };
  miter.normalize();
  if (miter.dot(currentSide) < 0) miter.multiplyScalar(-1);
  const denominator = Math.max(0.08, Math.abs(miter.dot(nextSide)));
  const requestedLength = halfWidth / denominator;
  const miterLength = Math.min(requestedLength, halfWidth * Math.max(1, miterLimit));
  return { offset: miter.multiplyScalar(miterLength), normal, miterLength };
}

function addLineSegment(target, start, end, height = 0.035) {
  target.push(start.position.x, start.position.y + height, start.position.z, end.position.x, end.position.y + height, end.position.z);
}

function checksumGeometry(positions, indices) {
  let hash = 2166136261;
  const update = value => {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, Number(value), true);
    for (let index = 0; index < 4; index += 1) hash = Math.imul(hash ^ view.getUint8(index), 16777619);
  };
  positions.forEach(update);
  indices.forEach(update);
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export class RoadMeshBuilder {
  constructor(scene, options) {
    this.options = options;
    this.root = new THREE.Group();
    this.root.name = 'Road mesh output';
    this.debugRoot = new THREE.Group();
    this.debugRoot.name = 'Road mesh debug';
    scene.add(this.root, this.debugRoot);
    this.output = { roads: [] };
    this.disposedGeometries = 0;
    this.disposedMaterials = 0;
    this.lastGeometrySignatures = [];
  }

  disposeBuiltObjects() {
    for (const mesh of [...this.root.children]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.disposedGeometries += 1;
      this.disposedMaterials += 1;
      mesh.removeFromParent();
    }
    for (const object of [...this.debugRoot.children]) {
      object.geometry.dispose();
      object.material.dispose();
      this.disposedGeometries += 1;
      this.disposedMaterials += 1;
      object.removeFromParent();
    }
  }

  build(projectedRoadData) {
    this.disposeBuiltObjects();
    const roads = [];
    const signatures = [];
    const validCenterline = [];
    const invalidSegments = [];
    let maxMiterRatio = 1;

    for (const path of projectedRoadData.paths) {
      const positions = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      let length = 0;
      let vertexOffset = 0;
      // Preserve relative widths from ProjectedRoadData while the GUI controls
      // the reference width used by the default road.
      const inputWidth = Number.isFinite(path.width) ? path.width : DEFAULT_ROAD_MESH_OPTIONS.roadWidth;
      const halfWidth = inputWidth * (this.options.roadWidth / DEFAULT_ROAD_MESH_OPTIONS.roadWidth) * 0.5;
      for (const run of contiguousValidRuns(path.samples)) {
        for (let index = 0; index < run.length; index += 1) {
          const sample = run[index];
          const center = sampleVector(sample);
          const { offset, normal, miterLength } = offsetAt(run, index, halfWidth, this.options.miterLimit);
          maxMiterRatio = Math.max(maxMiterRatio, miterLength / Math.max(0.0001, halfWidth));
          center.addScaledVector(normal, this.options.surfaceOffset);
          const left = center.clone().add(offset);
          const right = center.clone().sub(offset);
          positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
          normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
          const v = sample.distance * this.options.uvScale;
          uvs.push(0, v, 1, v);
          if (index > 0) {
            const base = vertexOffset + (index - 1) * 2;
            indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
            length += sampleVector(sample).distanceTo(sampleVector(run[index - 1]));
            addLineSegment(validCenterline, run[index - 1], sample);
          }
        }
        vertexOffset += run.length * 2;
      }
      for (let index = 1; index < path.samples.length; index += 1) {
        if (!path.samples[index - 1].valid || !path.samples[index].valid) addLineSegment(invalidSegments, path.samples[index - 1], path.samples[index], this.options.surfaceOffset + 0.04);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({ color: 0x30363b, roughness: 0.84, metalness: 0.02, wireframe: this.options.showWireframe, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${path.id} road surface`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      signatures.push(checksumGeometry(positions, indices));
      roads.push({ id: path.id, mesh, vertexCount: positions.length / 3, triangleCount: indices.length / 3, length });
    }

    const centerGeometry = new THREE.BufferGeometry();
    centerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(validCenterline, 3));
    const centerline = new THREE.LineSegments(centerGeometry, new THREE.LineBasicMaterial({ color: 0x66bfff, depthTest: false }));
    centerline.name = 'Valid road centerline';
    const invalidGeometry = new THREE.BufferGeometry();
    invalidGeometry.setAttribute('position', new THREE.Float32BufferAttribute(invalidSegments, 3));
    const invalid = new THREE.LineSegments(invalidGeometry, new THREE.LineBasicMaterial({ color: 0xff5964, depthTest: false }));
    invalid.name = 'Invalid road breaks';
    centerline.renderOrder = 20;
    invalid.renderOrder = 21;
    this.debugRoot.add(centerline, invalid);
    this.output = { roads };
    this.lastGeometrySignatures = signatures;
    this.maxMiterRatio = maxMiterRatio;
    this.setCenterlineVisible(this.options.showCenterline);
    this.setInvalidVisible(this.options.showInvalidSegments);
    return this.output;
  }

  setWireframe(value) {
    this.options.showWireframe = value;
    this.output.roads.forEach(road => { road.mesh.material.wireframe = value; road.mesh.material.needsUpdate = true; });
  }

  setCenterlineVisible(value) {
    this.options.showCenterline = value;
    const centerline = this.debugRoot.getObjectByName('Valid road centerline');
    if (centerline) centerline.visible = value;
  }

  setInvalidVisible(value) {
    this.options.showInvalidSegments = value;
    const invalid = this.debugRoot.getObjectByName('Invalid road breaks');
    if (invalid) invalid.visible = value;
  }

  dispose() {
    this.disposeBuiltObjects();
    this.root.removeFromParent();
    this.debugRoot.removeFromParent();
  }
}
