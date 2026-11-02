import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ChunkView } from '../seed-terrain/ChunkView.js';
import { NetworkView } from '../seed-terrain/NetworkView.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { RoadMeshBuilder } from '../road-mesh/RoadMeshBuilder.js';
import { DEFAULT_ROAD_MESH_OPTIONS } from '../road-mesh/config.js';
import { densestPoint, revealBlocks, revealBuildings, revealParcels, revealRoads } from './revealModel.js';
import { STAGES, stageProgress } from './stageManifest.js';

// WEB-01 Film scene (render only). All geometry comes from one finished snapshot of the real chain; each element carries
// the time it appears as a vertex attribute. setTime(t) only writes uniforms, so scrubbing never rebuilds or alters the model.
const c = hex => new THREE.Color(hex);
const PALETTE = {
  land: c('#dcd7cc'), landHigh: c('#cfc8b9'), steep: c('#b6aa97'), shore: c('#ddd3b8'), floor: c('#8ea5ad'), wall: c('#a79f91'), water: c('#8fb0bd'),
  suitability: ['#a47b72', '#cdb186', '#bcc89b', '#8cab8e'].map(c), analysisWater: c('#9db6c0'),
  block: { buildable: c('#efeadf'), partial: c('#e0d6bf'), unbuildable: c('#c6c0b4') }, blockRoad: c('#c9c5bb'), fragment: c('#d3d1c4'), steepInBlock: c('#a99f8d'),
  blockTone: ['#d9c7a8', '#c3cdb8', '#d2bfb4', '#bcc7cc', '#e0d3b4'].map(c), // neighbouring blocks read as separate pieces of land
  parcel: c('#f4f0e7'), reserve: c('#d9d4c6'),
  road: { primary: c('#2f3033'), secondary: c('#55565a'), lane: c('#7d7e80'), canal: c('#5f8fa3'), bridge: c('#3d3f44') },
  blockLine: c('#6a675f'), parcelLine: c('#77736a'), frontage: c('#a4674a'),
  low: c('#f1ece1'), high: c('#6d7883'), courtyard: c('#c9b39a'),
};
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const LIFT = { block: 2.2, parcel: 2.6, frontage: 3 };
const DENSIFY = 12; // m between line samples so outlines follow the terrain

function fnv(hash, array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let h = hash;
  for (let i = 0; i < bytes.length; i += 1) h = Math.imul(h ^ bytes[i], 16777619);
  return h >>> 0;
}

export class FilmScene {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.uniforms = {
      uRise: { value: 0 }, uMin: { value: 0 }, uMax: { value: 1 }, uBase: { value: 0 }, uSize: { value: 1024 },
      uAnal: { value: 0 }, uAnalOut: { value: 0 }, uRoads: { value: 0 }, uBlocks: { value: 0 }, uParcels: { value: 0 }, uBuild: { value: 0 }, uDebug: { value: 0 },
    };
    this.view = null;
    this.counts = null;
    this.markers = null;
    this.debugCache = new Map();
    this.surface = 'none';
  }

  dispose() {
    this.root.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    this.root.clear();
    this.highlight = null;
    this.footprints = null;
    this.debugCache = new Map();
    this.surface = 'none';
    this.uniforms.uDebug.value = 0;
    if (this.markers) {
      this.markers.root.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      this.markers.root.removeFromParent();
      this.markers = null;
    }
    if (this.view) {
      this.view.root.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      this.view.root.removeFromParent();
      this.view = null;
    }
  }

  build(snapshot) {
    this.dispose();
    const { fields, config, analysis, network, blocks, parcels, buildings } = snapshot;
    const { grid } = fields;
    const heightAt = createSampler(fields).height;
    const roads = revealRoads(network, grid, config.seed);
    const blockTime = revealBlocks(blocks, roads);
    const parcelTime = revealParcels(parcels, blocks, blockTime);
    const buildingTime = revealBuildings(buildings, parcels, parcelTime, config.seed);
    this.snapshot = snapshot;
    this.blockTime = blockTime;
    this.parcelTime = parcelTime;
    this.buildingTime = buildingTime;
    this.heightAt = heightAt;
    this.buildTerrain(snapshot, blockTime, parcelTime);
    this.roadReveal = this.buildRoads(network, roads, heightAt);
    this.buildLines(blocks, parcels, blockTime, parcelTime, heightAt);
    this.buildingReveal = this.buildBuildings(buildings, buildingTime);
    const { minHeight, maxHeight } = fields.stats;
    const top = Math.max(maxHeight, ...buildings.buildings.map(b => b.baseElevation + b.height), minHeight + 1);
    const half = grid.size / 2;
    this.box = { minX: grid.originX - half, maxX: grid.originX + half, minZ: grid.originZ - half, maxZ: grid.originZ + half, minY: this.uniforms.uBase.value, maxY: top };
    this.focus = densestPoint(parcels, grid);
    this.focus.y = heightAt(this.focus.x, this.focus.z);
    // Live counters read the same reveal times the shaders use.
    const sorted = values => Float32Array.from(values).sort();
    const edgeEnds = network.edges.filter(e => e.kind !== 'tunnel').map(e => ({ end: roads.edges.get(e.id).end, length: e.length })).sort((a, b) => a.end - b.end);
    let total = 0;
    this.counts = {
      roadEnds: Float32Array.from(edgeEnds.map(e => e.end)),
      roadCumulative: Float32Array.from(edgeEnds.map(e => { total += e.length; return total; })),
      blocks: sorted(blockTime), parcels: sorted(parcelTime), buildings: sorted(buildingTime.map(b => b.start)),
    };
    this.signature = this.revealSignature();
    this.setTime(0);
  }

  buildTerrain({ fields, config, analysis, blocks, parcels }, blockTime, parcelTime) {
    this.view = new ChunkView(this.scene);
    this.view.update(fields, config, 'classes', analysis, blocks, parcels);
    const { terrain, shell, water } = this.view;
    const geometry = terrain.geometry;
    const n = fields.height.length;
    const base = new Float32Array(n * 3); const anal = new Float32Array(n * 3); const block = new Float32Array(n * 3); const parc = new Float32Array(n * 3);
    const bt = new Float32Array(n); const pt = new Float32Array(n);
    const { minHeight, maxHeight } = fields.stats;
    const span = Math.max(1, maxHeight - minHeight);
    const color = new THREE.Color();
    for (let i = 0; i < n; i += 1) {
      if (fields.waterMask[i]) color.copy(PALETTE.floor);
      else if (fields.buildableMask[i]) color.copy(PALETTE.land).lerp(PALETTE.landHigh, (fields.height[i] - minHeight) / span);
      else if (fields.height[i] < fields.waterSurface[i] + config.shoreFreeboard) color.copy(PALETTE.shore);
      else color.copy(PALETTE.steep);
      color.toArray(base, i * 3);
      (fields.waterMask[i] ? PALETTE.analysisWater : PALETTE.suitability[analysis.suitabilityMask[i]]).toArray(anal, i * 3);
      const b = blocks.terrainBlockIndex[i];
      bt[i] = -1;
      if (b === -2) { color.copy(PALETTE.blockRoad); bt[i] = 0; }
      else if (b <= -10) { color.copy(PALETTE.fragment); bt[i] = 0.84; }
      else if (b >= 0) {
        const record = blocks.blocks[b];
        color.copy(PALETTE.block[record.buildableStatus] ?? PALETTE.block.partial).lerp(PALETTE.blockTone[(b * 37) % PALETTE.blockTone.length], 0.55);
        if (!fields.buildableMask[i]) color.lerp(PALETTE.steepInBlock, 0.28);
        bt[i] = blockTime[b];
      }
      color.toArray(block, i * 3);
      const p = parcels.terrainParcelIndex[i];
      pt[i] = -1;
      if (p >= 0) { color.copy(PALETTE.parcel).multiplyScalar(0.95 + ((p * 61) % 17) / 170); pt[i] = parcelTime[p]; color.toArray(parc, i * 3); }
      else if (p === -5) { color.copy(PALETTE.reserve); pt[i] = 0.5; color.toArray(parc, i * 3); }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(base, 3));
    for (const [name, array, size] of [['aAnal', anal, 3], ['aBlock', block, 3], ['aParc', parc, 3], ['aBT', bt, 1], ['aPT', pt, 1], ['aDebug', new Float32Array(n * 3), 3]]) geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    const U = this.uniforms;
    U.uMin.value = minHeight; U.uMax.value = maxHeight; U.uBase.value = this.view.shellData.baseY; U.uSize.value = fields.grid.size;
    const rise = `uniform float uRise, uMin, uMax, uBase;
      float riseY(float y) { float d = clamp((y - uMin) / max(1.0, uMax - uMin), 0.0, 1.0); float k = smoothstep(d * 0.45, d * 0.45 + 0.55, uRise); return uBase + (y - uBase) * k; }`;
    const withRise = (material, extra) => {
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, U);
        shader.vertexShader = `${rise}\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y = riseY(transformed.y);')}`;
        extra?.(shader);
      };
      return material;
    };
    terrain.material.dispose();
    terrain.material = withRise(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }), shader => {
      shader.vertexShader = `attribute vec3 aAnal, aBlock, aParc, aDebug; attribute float aBT, aPT; uniform float uSize, uAnal, uAnalOut, uBlocks, uParcels, uDebug;\n${shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        float sweep = (position.x + position.z) / (2.0 * uSize) + 0.5;
        vec3 film = mix(color, aAnal, smoothstep(sweep - 0.1, sweep + 0.1, uAnal * 1.2 - 0.1) * (1.0 - uAnalOut));
        if (aBT >= 0.0) film = mix(film, aBlock, smoothstep(aBT, aBT + 0.16, uBlocks));
        if (aPT >= 0.0) film = mix(film, aParc, smoothstep(aPT, aPT + 0.1, uParcels));
        vColor = mix(film, aDebug, uDebug);`)}`;
    });
    shell.material.dispose();
    shell.material = withRise(new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 1, metalness: 0, flatShading: true }));
    water.material.dispose();
    water.material = withRise(new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.35, metalness: 0, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    this.waterMaterial = water.material;
  }

  // Ribbons from the existing RoadMeshBuilder and NetworkView sampling, merged, each vertex timed along its own edge.
  buildRoads(network, roads, heightAt) {
    const surface = network.edges.filter(edge => edge.kind !== 'tunnel');
    if (!surface.length) return null;
    const holder = new THREE.Group();
    const builder = new RoadMeshBuilder(holder, { ...DEFAULT_ROAD_MESH_OPTIONS, surfaceOffset: 1.5, showCenterline: false, showInvalidSegments: false });
    const sampleEdge = NetworkView.prototype.samples;
    const output = builder.build({ paths: surface.map(edge => ({ id: `edge-${edge.id}`, width: edge.width, samples: sampleEdge(edge, heightAt) })) });
    const parts = output.roads.map((road, index) => {
      const edge = surface[index];
      const { begin, end, forward } = roads.edges.get(edge.id);
      const geometry = road.mesh.geometry.clone();
      const uv = geometry.attributes.uv;
      let maxV = 1e-6;
      for (let i = 0; i < uv.count; i += 1) maxV = Math.max(maxV, uv.getY(i));
      const times = new Float32Array(uv.count);
      const colors = new Float32Array(uv.count * 3);
      const tint = PALETTE.road[edge.roadClass] ?? PALETTE.road.lane;
      for (let i = 0; i < uv.count; i += 1) {
        const along = uv.getY(i) / maxV;
        times[i] = begin + (forward ? along : 1 - along) * (end - begin);
        tint.toArray(colors, i * 3);
      }
      geometry.setAttribute('aT', new THREE.BufferAttribute(times, 1));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.deleteAttribute('uv');
      return geometry;
    });
    builder.disposeBuiltObjects();
    this.roadRanges = [];
    let roadVertices = 0;
    parts.forEach((part, index) => { this.roadRanges.push({ first: roadVertices, edgeId: surface[index].id }); roadVertices += part.attributes.position.count; });
    const merged = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    material.onBeforeCompile = shader => {
      shader.uniforms.uRoads = this.uniforms.uRoads;
      shader.vertexShader = `attribute float aT; varying float vT;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vT = aT;')}`;
      shader.fragmentShader = `uniform float uRoads; varying float vT;\n${shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vT >= uRoads) discard;')}`;
    };
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'Film roads';
    this.roadMesh = mesh;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    return merged.attributes.aT.array;
  }

  buildLines(blocks, parcels, blockTime, parcelTime, heightAt) {
    const collect = () => ({ positions: [], times: [] });
    const blockLines = collect(); const parcelLines = collect(); const frontageLines = collect();
    const path = (target, points, closed, lift, start, duration) => {
      const count = closed ? points.length : points.length - 1;
      let total = 0;
      for (let i = 0; i < count; i += 1) { const p = points[i]; const q = points[(i + 1) % points.length]; total += Math.hypot(q.x - p.x, q.z - p.z); }
      if (!total) return;
      let walked = 0;
      for (let i = 0; i < count; i += 1) {
        const p = points[i]; const q = points[(i + 1) % points.length];
        const length = Math.hypot(q.x - p.x, q.z - p.z);
        const steps = Math.max(1, Math.ceil(length / DENSIFY));
        for (let s = 0; s < steps; s += 1) {
          const k0 = s / steps; const k1 = (s + 1) / steps;
          const x0 = p.x + (q.x - p.x) * k0; const z0 = p.z + (q.z - p.z) * k0;
          const x1 = p.x + (q.x - p.x) * k1; const z1 = p.z + (q.z - p.z) * k1;
          target.positions.push(x0, heightAt(x0, z0) + lift, z0, x1, heightAt(x1, z1) + lift, z1);
          const t0 = start + ((walked + length * k0) / total) * duration; const t1 = start + ((walked + length * k1) / total) * duration;
          target.times.push(t0, t1);
        }
        walked += length;
      }
    };
    blocks.blocks.forEach((block, index) => path(blockLines, block.polygon, true, LIFT.block, blockTime[index], 0.12));
    parcels.parcels.forEach((parcel, index) => {
      path(parcelLines, parcel.polygon, true, LIFT.parcel, parcelTime[index], 0.08);
      parcel.frontageLines.forEach(line => path(frontageLines, line, false, LIFT.frontage, parcelTime[index], 0.06));
    });
    const make = (data, uniformName, color, name) => {
      if (!data.positions.length) return { uOpacity: { value: 0 } };
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('aT', new THREE.Float32BufferAttribute(data.times, 1));
      const uOpacity = { value: 1 };
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uU: this.uniforms[uniformName], uColor: { value: color }, uOpacity },
        vertexShader: 'attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uU, uOpacity; uniform vec3 uColor; varying float vT;
          void main() {
            if (vT >= uU) discard;
            gl_FragColor = vec4(uColor, uOpacity);
            #include <colorspace_fragment>
          }`,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.name = name;
      lines.renderOrder = 4;
      this.root.add(lines);
      return { uOpacity, object: lines };
    };
    this.lines = {
      block: make(blockLines, 'uBlocks', PALETTE.blockLine, 'Film block outlines'),
      parcel: make(parcelLines, 'uParcels', PALETTE.parcelLine, 'Film parcel outlines'),
      frontage: make(frontageLines, 'uParcels', PALETTE.frontage, 'Film frontage lines'),
    };
  }

  // Same extrusion as BuildingView; per-vertex start, duration and foot let each building rise from its real footprint.
  buildBuildings(result, times) {
    if (!result.buildings.length) return null;
    const maxHeight = Math.max(...result.buildings.map(building => building.height));
    const color = new THREE.Color();
    const parts = result.buildings.map((building, index) => {
      const toShape = ring => ring.map(p => new THREE.Vector2(p.x, -p.z));
      const shape = new THREE.Shape(toShape(building.footprint.polygon));
      building.footprint.holes.forEach(hole => shape.holes.push(new THREE.Path(toShape(hole))));
      const top = building.baseElevation + building.height;
      const depth = top - building.bottomElevation;
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, building.bottomElevation, 0);
      geometry.deleteAttribute('uv');
      const count = geometry.attributes.position.count;
      const colors = new Float32Array(count * 3);
      color.copy(building.validationFlags.courtyard ? PALETTE.courtyard : PALETTE.low).lerp(PALETTE.high, Math.min(1, building.height / Math.max(1, maxHeight)));
      for (let i = 0; i < count; i += 1) color.toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('aBuild', new THREE.BufferAttribute(new Float32Array(count * 4).map((_, i) => [times[index].start, times[index].duration, building.bottomElevation, depth][i % 4]), 4));
      return geometry;
    });
    this.buildingRanges = [];
    let buildingVertices = 0;
    parts.forEach(part => { this.buildingRanges.push(buildingVertices); buildingVertices += part.attributes.position.count; });
    const merged = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    material.onBeforeCompile = shader => {
      shader.uniforms.uBuild = this.uniforms.uBuild;
      shader.vertexShader = `attribute vec4 aBuild; uniform float uBuild; varying float vGrow;\n${shader.vertexShader
        .replace('#include <color_vertex>', '#include <color_vertex>\n vColor *= mix(0.74, 1.0, clamp((position.y - aBuild.z) / max(1.0, aBuild.w), 0.0, 1.0));')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGrow = smoothstep(aBuild.x, aBuild.x + aBuild.y, uBuild);\n transformed.y = aBuild.z + (transformed.y - aBuild.z) * vGrow;')}`;
      shader.fragmentShader = `varying float vGrow;\n${shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vGrow < 0.002) discard;')}`;
    };
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `Film buildings (${result.buildings.length})`;
    mesh.frustumCulled = false;
    this.buildingMesh = mesh;
    this.root.add(mesh);
    return merged.attributes.aBuild.array;
  }

  // The film state as a function of t alone.
  setTime(t) {
    const U = this.uniforms;
    const at = id => stageProgress(t, STAGES.findIndex(stage => stage.id === id));
    U.uRise.value = Math.min(1, at('terrain') / 0.86);
    if (this.waterMaterial) this.waterMaterial.opacity = 0.82 * smooth(0.5, 0.95, at('terrain'));
    U.uAnal.value = Math.min(1, at('analysis') / 0.7);
    U.uAnalOut.value = smooth(0, 0.14, at('roads'));
    U.uRoads.value = Math.min(1.0001, at('roads') / 0.95);
    U.uBlocks.value = Math.min(1.0001, at('blocks') / 0.95);
    U.uParcels.value = Math.min(1.0001, at('parcels') / 0.95);
    U.uBuild.value = Math.min(1.0001, at('buildings') / 0.92);
    if (this.lines) {
      this.lines.block.uOpacity.value = 0.75 - 0.5 * smooth(0, 0.5, at('parcels'));
      this.lines.parcel.uOpacity.value = 0.55 - 0.25 * smooth(0, 0.5, at('buildings'));
      this.lines.frontage.uOpacity.value = 0.9 - 0.6 * smooth(0, 0.5, at('buildings'));
    }
  }

  // Elements visible so far (same reveal times as the shaders), for the stage readout.
  liveCount(stageId) {
    const count = (sorted, u) => { let lo = 0; let hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= u) lo = mid + 1; else hi = mid; } return lo; };
    const U = this.uniforms;
    if (stageId === 'roads') { const n = count(this.counts.roadEnds, U.uRoads.value); return n ? this.counts.roadCumulative[n - 1] : 0; }
    if (stageId === 'blocks') return count(this.counts.blocks, U.uBlocks.value);
    if (stageId === 'parcels') return count(this.counts.parcels, U.uParcels.value);
    if (stageId === 'buildings') return count(this.counts.buildings, U.uBuild.value);
    return null;
  }

  setVisible(visible) {
    this.root.visible = visible;
    if (this.view) this.view.root.visible = visible;
    if (this.markers) this.markers.root.visible = visible && this.markersWanted !== false;
  }

  // Everything the timeline has reached so far, for the Inspector.
  liveCounts() {
    const count = (sorted, u) => { if (u <= 0) return 0; let lo = 0; let hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= u) lo = mid + 1; else hi = mid; } return lo; };
    const U = this.uniforms;
    const edges = count(this.counts.roadEnds, U.uRoads.value);
    return {
      roadEdges: edges,
      roadLength: edges ? this.counts.roadCumulative[edges - 1] : 0,
      blocks: count(this.counts.blocks, U.uBlocks.value),
      parcels: count(this.counts.parcels, U.uParcels.value),
      buildings: count(this.counts.buildings, U.uBuild.value),
    };
  }

  // Debug colours of the existing ChunkView, generated once per view and shown as an overlay. The film's own colours are restored at once.
  setSurface(view) {
    this.surface = view;
    const U = this.uniforms;
    if (view === 'none' || !this.view) { U.uDebug.value = 0; return; }
    if (!this.debugCache.has(view)) {
      const { fields, config, analysis, blocks, parcels } = this.snapshot;
      const colors = this.view.terrain.geometry.attributes.color;
      const own = colors.array.slice();
      this.view.update(fields, config, view, analysis, blocks, parcels);
      this.debugCache.set(view, colors.array.slice());
      colors.array.set(own);
      colors.needsUpdate = true;
    }
    const target = this.view.terrain.geometry.attributes.aDebug;
    target.array.set(this.debugCache.get(view));
    target.needsUpdate = true;
    U.uDebug.value = 1;
  }

  setLayerVisible(layer, visible) {
    if (layer === 'roads' && this.roadMesh) this.roadMesh.visible = visible;
    else if (layer === 'buildings' && this.buildingMesh) this.buildingMesh.visible = visible;
    else if (layer === 'blockLines') { if (this.lines.block.object) this.lines.block.object.visible = visible; }
    else if (layer === 'parcelLines') {
      if (this.lines.parcel.object) this.lines.parcel.object.visible = visible;
      if (this.lines.frontage.object) this.lines.frontage.object.visible = visible;
    } else if (layer === 'nodes') {
      if (visible && !this.markers) {
        // Existing NetworkView markers: junctions white, edge ports red. Its ribbons stay hidden: the film draws its own.
        this.markers = new NetworkView(this.scene);
        this.markers.update(this.snapshot.network, this.heightAt);
        this.markers.ribbons.root.visible = false;
      }
      if (this.markers) this.markers.root.visible = visible;
    } else if (layer === 'footprints') {
      if (visible && !this.footprints) this.buildFootprints();
      if (this.footprints) this.footprints.visible = visible;
    }
  }

  buildFootprints() {
    const positions = [];
    const times = [];
    this.snapshot.buildings.buildings.forEach((building, index) => {
      const y = building.baseElevation + 0.6;
      const start = this.buildingTime[index].start;
      for (const ring of [building.footprint.polygon, ...building.footprint.holes]) {
        ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]; positions.push(p.x, y, p.z, q.x, y, q.z); times.push(start, start); });
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.Float32BufferAttribute(times, 1));
    const material = this.lines.frontage.object.material.clone();
    material.uniforms = { uU: this.uniforms.uBuild, uColor: { value: new THREE.Color('#1f2024') }, uOpacity: { value: 1 } };
    material.depthTest = false;
    this.footprints = new THREE.LineSegments(geometry, material);
    this.footprints.name = 'Film building footprints';
    this.footprints.renderOrder = 6;
    this.root.add(this.footprints);
  }

  // Real object under a screen point, only if the timeline has already revealed it. No generator runs.
  pick(ndc, camera) {
    if (this.uniforms.uRise.value < 1) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const U = this.uniforms;
    const { blocks, parcels } = this.snapshot;
    const lower = (ranges, value, key = r => r) => { let lo = 0; let hi = ranges.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (key(ranges[mid]) <= value) lo = mid; else hi = mid - 1; } return lo; };
    const hits = [];
    if (this.buildingMesh?.visible && U.uBuild.value > 0) {
      for (const hit of ray.intersectObject(this.buildingMesh)) {
        const index = lower(this.buildingRanges, hit.faceIndex * 3);
        const time = this.buildingTime[index];
        if (U.uBuild.value >= time.start + time.duration) { hits.push({ distance: hit.distance, kind: 'building', index, id: this.snapshot.buildings.buildings[index].id }); break; }
      }
    }
    if (this.roadMesh?.visible && U.uRoads.value > 0) {
      const attribute = this.roadMesh.geometry.attributes.aT;
      for (const hit of ray.intersectObject(this.roadMesh)) {
        if (attribute.getX(hit.face.a) < U.uRoads.value) { hits.push({ distance: hit.distance, kind: 'road', id: this.roadRanges[lower(this.roadRanges, hit.face.a, r => r.first)].edgeId }); break; }
      }
    }
    const ground = ray.intersectObject(this.view.terrain)[0];
    if (ground) {
      const { x, z } = ground.point;
      const { grid } = this.snapshot.fields;
      const col = Math.round((x - grid.originX + grid.size / 2) / grid.spacing); const row = Math.round((z - grid.originZ + grid.size / 2) / grid.spacing);
      const i = row * grid.columns + col;
      const parcel = parcels.terrainParcelIndex[i]; const block = blocks.terrainBlockIndex[i];
      const base = { distance: ground.distance };
      if (parcel >= 0 && U.uParcels.value >= this.parcelTime[parcel]) hits.push({ ...base, kind: 'parcel', index: parcel, id: parcels.parcels[parcel].id });
      else if (block >= 0 && U.uBlocks.value >= this.blockTime[block]) hits.push({ ...base, kind: 'block', index: block, id: blocks.blocks[block].id });
      else hits.push({ ...base, kind: 'chunk', id: 'chunk', x, z, height: ground.point.y });
    }
    if (!hits.length) return null;
    return hits.reduce((best, hit) => (hit.distance < best.distance - 0.01 ? hit : best));
  }

  // True while the picked object is still revealed at this t.
  isRevealed(picked) {
    const U = this.uniforms;
    if (picked.kind === 'building') { const time = this.buildingTime[picked.index]; return U.uBuild.value >= time.start + time.duration; }
    if (picked.kind === 'road') return U.uRoads.value > this.edgeBegin(picked.id);
    if (picked.kind === 'parcel') return U.uParcels.value >= this.parcelTime[picked.index];
    if (picked.kind === 'block') return U.uBlocks.value >= this.blockTime[picked.index];
    return U.uRise.value >= 1;
  }

  edgeBegin(id) {
    const attribute = this.roadMesh.geometry.attributes.aT;
    const at = this.roadRanges.findIndex(range => range.edgeId === id);
    const last = at + 1 < this.roadRanges.length ? this.roadRanges[at + 1].first : attribute.count;
    let begin = Infinity;
    for (let i = this.roadRanges[at].first; i < last; i += 1) begin = Math.min(begin, attribute.getX(i));
    return begin;
  }

  setHighlight(picked) {
    if (this.highlight) { this.highlight.geometry.dispose(); this.highlight.material.dispose(); this.highlight.removeFromParent(); this.highlight = null; }
    if (!picked || picked.kind === 'chunk') return;
    const { buildings, parcels, blocks, network } = this.snapshot;
    let points;
    if (picked.kind === 'building') { const b = buildings.buildings[picked.index]; const y = b.baseElevation + b.height + 0.5; points = b.footprint.polygon.map(p => new THREE.Vector3(p.x, y, p.z)); }
    else if (picked.kind === 'road') points = network.edges.find(edge => edge.id === picked.id).points.map(p => new THREE.Vector3(p.x, this.heightAt(p.x, p.z) + 3, p.z));
    else points = (picked.kind === 'parcel' ? parcels.parcels : blocks.blocks)[picked.index].polygon.map(p => new THREE.Vector3(p.x, this.heightAt(p.x, p.z) + 4, p.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xc2410c, depthTest: false });
    this.highlight = picked.kind === 'road' ? new THREE.Line(geometry, material) : new THREE.LineLoop(geometry, material);
    this.highlight.renderOrder = 8;
    this.root.add(this.highlight);
  }

  revealSignature() {
    let hash = 2166136261;
    if (this.roadReveal) hash = fnv(hash, this.roadReveal);
    if (this.buildingReveal) hash = fnv(hash, this.buildingReveal);
    return hash.toString(16).padStart(8, '0').toUpperCase();
  }
}

