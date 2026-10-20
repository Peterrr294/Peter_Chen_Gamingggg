import * as THREE from 'three';
import { seamBoundaryCoordinate } from '../flavor-clash-prototype/generation/TerrainGenerator.js';

export function createSeamDebug(leftTerrain, rightTerrain, seam, depth, segments) {
  const edgePositions = [];
  const boundaryPositions = [];
  const bandPositions = [];
  const bandIndices = [];
  const errorPositions = [];
  let maxHeightError = 0;
  let totalHeightError = 0;
  let boundaryMin = Infinity;
  let boundaryMax = -Infinity;
  for (let index = 0; index <= segments; index += 1) {
    const z = -depth / 2 + (index / segments) * depth;
    const x = seam.coordinate;
    const leftHeight = leftTerrain.heightAt(x, z);
    const rightHeight = rightTerrain.heightAt(x, z);
    const error = Math.abs(leftHeight - rightHeight);
    maxHeightError = Math.max(maxHeightError, error);
    totalHeightError += error;
    const y = (leftHeight + rightHeight) * 0.5 + 0.08;
    edgePositions.push(x, y, z);
    if (error > 1e-7) errorPositions.push(x, leftHeight, z, x, rightHeight, z);

    const boundary = seamBoundaryCoordinate(seam, x, z);
    boundaryMin = Math.min(boundaryMin, boundary);
    boundaryMax = Math.max(boundaryMax, boundary);
    const halfWidth = seam.transitionWidth * 0.5;
    const leftX = boundary - halfWidth;
    const rightX = boundary + halfWidth;
    const boundaryY = leftTerrain.heightAt(boundary, z) + 0.11;
    const leftY = leftTerrain.heightAt(leftX, z) + 0.055;
    const rightY = rightTerrain.heightAt(rightX, z) + 0.055;
    boundaryPositions.push(boundary, boundaryY, z);
    bandPositions.push(leftX, leftY, z, rightX, rightY, z);
    if (index > 0) {
      const previous = (index - 1) * 2;
      bandIndices.push(previous, previous + 2, previous + 1, previous + 2, previous + 3, previous + 1);
    }
  }

  const root = new THREE.Group();
  root.name = 'Terrain seam debug';
  const bandGeometry = new THREE.BufferGeometry();
  bandGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bandPositions, 3));
  bandGeometry.setIndex(bandIndices);
  const band = new THREE.Mesh(bandGeometry, new THREE.MeshBasicMaterial({ color: 0x3fd6c5, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  band.name = 'Transition zone';
  band.renderOrder = 28;
  root.add(band);

  const boundaryGeometry = new THREE.BufferGeometry();
  boundaryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(boundaryPositions, 3));
  const boundary = new THREE.Line(boundaryGeometry, new THREE.LineBasicMaterial({ color: 0x59f0a8, depthTest: false }));
  boundary.name = 'Noise displaced biome boundary';
  boundary.renderOrder = 30;
  root.add(boundary);

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0xe8fff3, size: 0.11, depthTest: false }));
  points.name = 'Shared geometric edge vertices';
  points.renderOrder = 31;
  root.add(points);

  const errorGeometry = new THREE.BufferGeometry();
  errorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(errorPositions, 3));
  const errors = new THREE.LineSegments(errorGeometry, new THREE.LineBasicMaterial({ color: 0xff5964, depthTest: false }));
  errors.name = 'Seam height errors';
  errors.renderOrder = 32;
  root.add(errors);

  return {
    object3D: root,
    sampleCount: segments + 1,
    maxHeightError,
    meanHeightError: totalHeightError / (segments + 1),
    boundaryMin,
    boundaryMax,
    dispose() {
      root.traverse(object => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      root.removeFromParent();
    },
  };
}
