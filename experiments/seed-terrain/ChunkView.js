import * as THREE from 'three';
import { buildShell, checkClosedMesh, heightfieldVolume, shellBase } from './TerrainShell.js';
import { buildTunnelGeometry, trianglesToMesh } from './TunnelGeometry.js';

const TUNNEL_COLORS = { floor: new THREE.Color('#34373c'), wall: new THREE.Color('#9d978c'), portal: new THREE.Color('#b8b2a6'), tube: new THREE.Color('#8a857c') };

// Rendering only: reads derived fields, never changes them.
const WATER_FLOOR = new THREE.Color('#173f54');
const BUILDABLE = new THREE.Color('#63b477');
const STEEP = new THREE.Color('#8d775d');
const SHORE = new THREE.Color('#b9a46a');
const TRANSITION = new THREE.Color('#c9b6ff');
const WEIGHT_RAMP = ['#26343a', '#5b3f8c', '#c2507a', '#f2a541', '#f7e66b'].map(hex => new THREE.Color(hex));
// Suitability classes 0–3 (TerrainAnalysis) and slope bands for the analysis debug views.
const SUITABILITY = ['#5a2f35', '#c98a3c', '#9fcf6a', '#2f9e5b'].map(hex => new THREE.Color(hex));
const SLOPE_BANDS = [[2, '#2f9e5b'], [5, '#7cc46a'], [10, '#d8d26a'], [20, '#e09a45'], [35, '#c4553d'], [90, '#6e2a3c']].map(([max, hex]) => [max, new THREE.Color(hex)]);
const WATER_DEBUG = new THREE.Color('#1d5f86');
// Block debug colours (04.1): status family, clipped blocks pushed toward orange.
const BLOCK_STATUS = { buildable: new THREE.Color('#3fae6a'), partial: new THREE.Color('#d9c25a'), unbuildable: new THREE.Color('#8a8f94') };
const BLOCK_ROAD = new THREE.Color('#2a3036');
const BLOCK_REMNANT = new THREE.Color('#d04fd0');
const BLOCK_INVALID = new THREE.Color('#ff2b2b');
const BLOCK_CLIPPED = new THREE.Color('#ff9a3c');
// 04.1b fragment classes and unbuildable land inside blocks.
const FRAGMENT = { waterfrontReserve: new THREE.Color('#2fd0c0'), publicSpaceCandidate: new THREE.Color('#b07cff'), unbuildable: new THREE.Color('#d04fd0'), buildableFragment: new THREE.Color('#9be27a') };
const UNBUILDABLE_IN_BLOCK = new THREE.Color('#4a3f3a');
// 04.2 parcels: one pastel per parcel (index hash), reserve in magenta.
const PARCEL_RESERVE = new THREE.Color('#c23fb8');
const parcelColor = (index, target) => target.setHSL(((index * 0.61803398875) % 1), 0.55, 0.62);

function rampColor(weight, target) {
  const scaled = Math.min(0.9999, Math.max(0, weight)) * (WEIGHT_RAMP.length - 1);
  const index = Math.floor(scaled);
  return target.copy(WEIGHT_RAMP[index]).lerp(WEIGHT_RAMP[index + 1], scaled - index);
}

export class ChunkView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Seed terrain chunk view';
    scene.add(this.root);
    this.terrain = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    this.water = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({
      color: 0x2c7fa8, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    }));
    // 05.1b-1 solid: walls + base built from the rendered surface's own boundary vertices.
    this.shell = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.95, metalness: 0, flatShading: true }));
    this.shell.name = 'Terrain solid walls and base';
    // 05.1b-2 tunnels: clipped surface pieces (rim) and the excavation patch (cuts, portals, tube).
    this.rim = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    this.rim.name = 'Terrain rim around tunnel cuts';
    this.tunnelMesh = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true }));
    this.tunnelMesh.name = 'Tunnel excavation';
    this.tunnelData = null;
    this.root.add(this.terrain, this.water, this.shell, this.rim, this.tunnelMesh);
  }

  update(fields, config, view, analysis, blocks, parcels) {
    const { size, segments, columns, originX, originZ } = fields.grid;
    const origin = `${originX},${originZ}`;
    if (!this.terrain.geometry || this.terrain.geometry.userData.segments !== segments || this.terrain.geometry.userData.origin !== origin) {
      const geometry = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
      // 06.2 world placement: vertices in world coordinates (origin 0, the single-chunk page, is left untouched).
      if (originX || originZ) geometry.translate(originX, 0, originZ);
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
      geometry.userData.segments = segments;
      geometry.userData.origin = origin;
      this.fullIndex = geometry.index.array.slice();
      this.terrain.geometry?.dispose();
      this.terrain.geometry = geometry;
    }
    const geometry = this.terrain.geometry;
    const positions = geometry.attributes.position;
    const colors = geometry.attributes.color;
    const color = new THREE.Color();
    for (let index = 0; index < fields.height.length; index += 1) {
      positions.setY(index, fields.height[index]);
      const weight = fields.transitionWeight[index];
      const parcelIndex = view === 'parcels' && parcels ? parcels.terrainParcelIndex[index] : -1;
      if (view === 'parcels' && parcelIndex >= 0) parcelColor(parcelIndex, color);
      else if (view === 'parcels' && parcelIndex === -5) color.copy(PARCEL_RESERVE);
      else if ((view === 'blocks' || view === 'parcels') && blocks) {
        const blockIndex = blocks.terrainBlockIndex[index];
        if (blockIndex === -3) color.copy(WATER_DEBUG);
        else if (blockIndex === -2) color.copy(BLOCK_ROAD);
        else if (blockIndex <= -10) {
          const fragment = blocks.fragments?.[-10 - blockIndex];
          color.copy(FRAGMENT[fragment?.fragmentClassification?.class] ?? BLOCK_REMNANT);
        } else {
          const block = blocks.blocks[blockIndex];
          if (block.fragmentClassification) color.copy(FRAGMENT[block.fragmentClassification.class]);
          else {
            color.copy(block.valid ? BLOCK_STATUS[block.buildableStatus] : BLOCK_INVALID);
            if (block.clippedByBoundary) color.lerp(BLOCK_CLIPPED, 0.35);
            color.multiplyScalar(0.82 + ((blockIndex * 37) % 11) / 30); // neighbour blocks differ slightly
          }
          // Land inside the block that fails the buildable rule is shaded down.
          if (!fields.buildableMask[index]) color.lerp(UNBUILDABLE_IN_BLOCK, 0.6);
        }
      } else if (view === 'suitability' || view === 'slope') {
        if (fields.waterMask[index]) color.copy(WATER_DEBUG);
        else if (view === 'suitability') color.copy(SUITABILITY[analysis.suitabilityMask[index]]);
        else color.copy(SLOPE_BANDS.find(([max]) => fields.slope[index] <= max)[1]);
      } else if (view === 'transition') {
        rampColor(weight, color);
        // Iso-lines at 0.25 / 0.5 / 0.75 make corner continuity visible.
        const band = weight * 4;
        if (weight > 0.01 && weight < 0.99 && Math.abs(band - Math.round(band)) < 0.05) color.multiplyScalar(0.35);
      } else {
        if (fields.waterMask[index]) color.copy(WATER_FLOOR);
        else if (fields.buildableMask[index]) color.copy(BUILDABLE);
        else if (fields.height[index] < fields.waterSurface[index] + config.shoreFreeboard) color.copy(SHORE);
        else color.copy(STEEP);
        color.lerp(TRANSITION, weight * 0.3);
      }
      color.toArray(colors.array, index * 3);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.updateShell(fields);
    this.updateRimColors();
    this.updateWater(fields, segments, columns);
  }

  updateShell(fields) {
    const surface = this.terrain.geometry;
    const baseY = shellBase(fields.height);
    // Always from the full surface index: tunnel cut holes must not get chunk walls.
    const shell = buildShell(surface.attributes.position.array, this.fullIndex, baseY);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(shell.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.shell.geometry?.dispose();
    this.shell.geometry = geometry;
    this.shellData = shell;
  }

  // Rebuild tunnel geometry from NetworkGraph tunnel edges (local; the height field is untouched).
  updateTunnels(network, fields, buildings) {
    const surface = this.terrain.geometry;
    const { segments, columns } = fields.grid;
    const tunnels = network.edges.filter(edge => edge.kind === 'tunnel').map(edge => ({ id: edge.id, P: edge.tunnel.portals[0], Q: edge.tunnel.portals[1], nodes: [edge.from, edge.to] }));
    const tunnelNodes = new Set(tunnels.flatMap(tunnel => tunnel.nodes));
    const roads = network.edges.filter(edge => (edge.kind === 'road' || edge.kind === 'bridgeCandidate') && !tunnelNodes.has(edge.from) && !tunnelNodes.has(edge.to)).flatMap(edge => edge.points.slice(1).map((b, i) => {
      const a = edge.points[i]; const length = Math.hypot(b.x - a.x, b.z - a.z) || 1; const w = edge.width / 2;
      const nx = -(b.z - a.z) / length * w; const nz = (b.x - a.x) / length * w;
      return { edgeId: edge.id, quad: [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }] };
    }));
    const data = buildTunnelGeometry({
      positions: surface.attributes.position.array, index: this.fullIndex, segments, columns, grid: fields.grid,
      waterMask: fields.waterMask, baseY: this.shellData.baseY, tunnels,
      obstacles: { roads, buildings: (buildings?.buildings ?? []).map(building => ({ id: building.id, polygon: building.footprint.polygon })) },
    });
    const kept = [];
    for (let t = 0; t < this.fullIndex.length / 3; t += 1) if (!data.removed[t]) kept.push(this.fullIndex[t * 3], this.fullIndex[t * 3 + 1], this.fullIndex[t * 3 + 2]);
    surface.setIndex(kept);
    surface.computeVertexNormals();
    // Rim: clipped surface pieces; colours follow the terrain colours through their source weights.
    const rim = trianglesToMesh(data.rim);
    const rimGeometry = new THREE.BufferGeometry();
    rimGeometry.setAttribute('position', new THREE.BufferAttribute(rim.positions, 3));
    rimGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rim.positions.length), 3));
    rimGeometry.setIndex(new THREE.BufferAttribute(rim.indices, 1));
    rimGeometry.computeVertexNormals();
    this.rim.geometry?.dispose();
    this.rim.geometry = rimGeometry;
    this.rimSources = [];
    const seen = new Set();
    data.rim.flat().forEach(point => { if (!seen.has(point)) { seen.add(point); this.rimSources.push(point.src); } });
    // Tunnel patch: non-indexed, coloured by kind.
    const positions = []; const colors = [];
    data.patch.forEach(([a, b, c, kind]) => { [a, b, c].forEach(p => { positions.push(p.x, p.y, p.z); TUNNEL_COLORS[kind].toArray(colors, colors.length); }); });
    const patchGeometry = new THREE.BufferGeometry();
    patchGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    patchGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    patchGeometry.computeVertexNormals();
    this.tunnelMesh.geometry?.dispose();
    this.tunnelMesh.geometry = patchGeometry;
    this.tunnelData = data;
    this.updateRimColors();
    return data;
  }

  updateRimColors() {
    if (!this.rimSources || !this.rim.geometry) return;
    const source = this.terrain.geometry.attributes.color.array;
    const target = this.rim.geometry.attributes.color;
    this.rimSources.forEach((src, i) => {
      let r = 0; let g = 0; let b = 0;
      for (const [index, weight] of src) { r += source[index * 3] * weight; g += source[index * 3 + 1] * weight; b += source[index * 3 + 2] * weight; }
      target.array[i * 3] = r; target.array[i * 3 + 1] = g; target.array[i * 3 + 2] = b;
    });
    target.needsUpdate = true;
  }

  // ?xray=1: see-through terrain to inspect tunnel geometry inside the solid.
  setXray(value) {
    for (const mesh of [this.terrain, this.shell, this.rim]) {
      mesh.material.transparent = value; mesh.material.opacity = value ? 0.3 : 1; mesh.material.depthWrite = !value; mesh.material.needsUpdate = true;
    }
  }

  // Topology report of the rendered solid (surface + shell welded by exact position).
  solidReport(fields) {
    const surface = this.terrain.geometry;
    const parts = [
      { positions: surface.attributes.position.array, indices: surface.index.array },
      { positions: this.shellData.positions, indices: this.shellData.indices },
    ];
    const tunnels = this.tunnelData?.accepted.length ?? 0;
    if (tunnels) parts.push(trianglesToMesh(this.tunnelData.rim), trianglesToMesh(this.tunnelData.patch.map(t => t.slice(0, 3))));
    const check = checkClosedMesh(parts);
    let minHeight = Infinity; let maxHeight = -Infinity; let heightMismatch = 0;
    const positions = surface.attributes.position.array;
    for (let i = 0; i < fields.height.length; i += 1) {
      minHeight = Math.min(minHeight, fields.height[i]); maxHeight = Math.max(maxHeight, fields.height[i]);
      if (positions[i * 3 + 1] !== fields.height[i]) heightMismatch += 1;
    }
    const prism = heightfieldVolume(positions, this.fullIndex, this.shellData.baseY);
    const excavated = tunnels ? this.tunnelData.volumes.trench.reduce((s, x) => s + x, 0) + this.tunnelData.volumes.tube.reduce((s, x) => s + x, 0) : 0;
    return { ...check, baseY: this.shellData.baseY, minHeight, maxHeight, minThickness: minHeight - this.shellData.baseY, prismVolume: prism, excavatedVolume: excavated, tunnels, expectedEuler: 2 - 2 * tunnels, volumeRelativeError: Math.abs(check.signedVolume - (prism - excavated)) / (prism - excavated), boundaryEdges: this.shellData.boundaryEdges, surfaceHeightMismatch: heightMismatch };
  }

  // Water mesh only over cells that touch water, at the local water surface
  // (sloped along rivers, flat at sea level).
  updateWater(fields, segments, columns) {
    const source = this.terrain.geometry.attributes.position;
    const positions = new Float32Array(source.count * 3);
    for (let index = 0; index < source.count; index += 1) {
      const surface = fields.waterSurface[index];
      positions[index * 3] = source.getX(index);
      positions[index * 3 + 1] = Number.isFinite(surface) ? surface : 0;
      positions[index * 3 + 2] = source.getZ(index);
    }
    const indices = [];
    for (let row = 0; row < segments; row += 1) {
      for (let col = 0; col < segments; col += 1) {
        const a = row * columns + col;
        const b = a + 1;
        const c = a + columns;
        const d = c + 1;
        if (fields.waterMask[a] || fields.waterMask[b] || fields.waterMask[c] || fields.waterMask[d]) indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.water.geometry?.dispose();
    this.water.geometry = geometry;
    this.water.visible = indices.length > 0;
  }
}
