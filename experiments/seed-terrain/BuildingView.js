import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Buildings layer (render only): grey-box extrusions of the Building data, merged into one
// mesh (≈ 2,000 buildings per chunk). Replaceable later without touching the data model.
const LOW = new THREE.Color('#d8d2c4');
const HIGH = new THREE.Color('#5d7f9e');
const COURTYARD = new THREE.Color('#c9a27a');

export class BuildingView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Buildings layer';
    scene.add(this.root);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.mesh = null;
  }

  update(result) {
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.removeFromParent(); this.mesh = null; }
    if (!result.buildings.length) return;
    const maxHeight = Math.max(...result.buildings.map(building => building.height));
    const color = new THREE.Color();
    const geometries = result.buildings.map(building => {
      // Shape in (x, −z) so that rotating −90° about x puts the extrusion on +y and the plan back on (x, z).
      const toShape = ring => ring.map(p => new THREE.Vector2(p.x, -p.z));
      const shape = new THREE.Shape(toShape(building.footprint.polygon));
      building.footprint.holes.forEach(hole => shape.holes.push(new THREE.Path(toShape(hole))));
      const top = building.baseElevation + building.height;
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: top - building.bottomElevation, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, building.bottomElevation, 0);
      color.copy(building.validationFlags.courtyard ? COURTYARD : LOW).lerp(HIGH, Math.min(1, building.height / Math.max(1, maxHeight)));
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < geometry.attributes.position.count; i += 1) color.toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    this.mesh = new THREE.Mesh(merged, this.material);
    this.mesh.name = `Buildings (${result.buildings.length})`;
    this.root.add(this.mesh);
  }

  setVisible(value) { this.root.visible = value; }
}
