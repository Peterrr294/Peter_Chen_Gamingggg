import * as THREE from 'three';
import { CITY_COLOR } from '../city-of-cities/originConfig.js';
import { CASE_ORDER, CASE_SECONDS, GROWTH_STEP_SECONDS, REVEAL_SECONDS, chunkStarts } from './sceneManifest.js';

// WEB-01c World scene (render only): Part II of the film, in its own group, sharing the renderer and camera with Part I. Every chunk is real baked output.
// setTime(t) only writes uniforms and visibility, so scrubbing and any playback speed show the same result at the same t.
const TERRACOTTA = 0xc2410c;
const muted = id => new THREE.Color(CITY_COLOR[id] ?? '#888888').lerp(new THREE.Color('#9aa0a6'), 0.3);

export class WorldScene {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Film world';
    this.root.visible = false;
    scene.add(this.root);
    this.groups = new Map(); // group name → chunk records
    this.linkUniform = { value: 1 };
    this.layers = { territory: true, roads: true, lots: true, buildings: true, links: true };
    this.level = 'live'; // live | light: the same data, drawn more cheaply
    this.times = { originStart: 0, originEnd: 0, growthStart: 0, caseStart: 0 };
    this.info = {};
    this.history = [];
    this.active = null;
  }

  // Materials share one program per kind; each chunk owns only its progress uniform.
  material(kind, base, record) {
    const material = base;
    material.customProgramCacheKey = () => `film-world-${kind}-${material.type}`;
    material.onBeforeCompile = shader => {
      shader.uniforms.uP = record.progress;
      shader.uniforms.uBase = record.base;
      shader.uniforms.uTint = record.tint;
      shader.uniforms.uTintColor = record.tintColor;
      const head = 'uniform float uP, uBase, uTint; uniform vec3 uTintColor;';
      if (kind === 'terrain') {
        shader.vertexShader = `${head}\n${shader.vertexShader
          .replace('#include <color_vertex>', '#include <color_vertex>\n vColor = mix(vColor, uTintColor, uTint);')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y = uBase + (transformed.y - uBase) * smoothstep(0.0, 0.3, uP);')}`;
      } else if (kind === 'water') {
        shader.vertexShader = `${head}\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y = uBase + (transformed.y - uBase) * smoothstep(0.0, 0.3, uP);')}`;
      } else if (kind === 'roads') {
        shader.vertexShader = `attribute float aT; varying float vT;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vT = aT;')}`;
        shader.fragmentShader = `uniform float uP; varying float vT;\n${shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vT >= (uP - 0.18) / 0.35) discard;')}`;
      } else if (kind === 'buildings') {
        shader.vertexShader = `attribute vec4 aS; uniform float uP; varying float vGrow;\n${shader.vertexShader
          .replace('#include <color_vertex>', '#include <color_vertex>\n vColor *= mix(0.74, 1.0, clamp((position.y - aS.z) / max(1.0, aS.w), 0.0, 1.0));')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGrow = smoothstep(aS.x, aS.x + aS.y, (uP - 0.62) / 0.38);\n transformed.y = aS.z + (transformed.y - aS.z) * vGrow;')}`;
        shader.fragmentShader = `varying float vGrow;\n${shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vGrow < 0.002) discard;')}`;
      }
    };
    return material;
  }

  lines(positions, times, color, opacity, gate, record) {
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(times, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uP: record.progress, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uFrom: { value: gate[0] }, uSpan: { value: gate[1] } },
      vertexShader: 'attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uP, uOpacity, uFrom, uSpan; uniform vec3 uColor; varying float vT;
        void main() {
          if (vT >= (uP - uFrom) / uSpan) discard;
          gl_FragColor = vec4(uColor, uOpacity);
          #include <colorspace_fragment>
        }`,
    });
    return new THREE.LineSegments(geometry, material);
  }

  addChunk(group, meta, g) {
    const record = { meta, group, minY: g.minY, maxY: g.maxY, progress: { value: 0 }, base: { value: g.baseY }, tint: { value: 0.16 }, tintColor: { value: muted(meta.cityId) }, start: 0 };
    const node = new THREE.Group();
    node.visible = false;
    const tri = (attributes, kind, material) => {
      const geometry = new THREE.BufferGeometry();
      for (const [name, array, size] of attributes) geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
      const mesh = new THREE.Mesh(geometry, this.material(kind, material, record));
      node.add(mesh); // shaders only lower or shrink geometry, so the stored bounds stay safe for culling
      return mesh;
    };
    record.terrain = tri([['position', g.terrain.position, 3], ['normal', g.terrain.normal, 3], ['color', g.terrain.color, 3]], 'terrain', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
    record.terrainLite = tri([['position', g.terrainLite.position, 3], ['normal', g.terrainLite.normal, 3], ['color', g.terrainLite.color, 3]], 'terrain', new THREE.MeshLambertMaterial({ vertexColors: true }));
    record.terrainLite.visible = false;
    if (g.water.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.water, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, this.material('water', new THREE.MeshStandardMaterial({ color: 0x8fb0bd, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.82, side: THREE.DoubleSide }), record));
      node.add(mesh);
    }
    if (g.roads.position.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.roads.position, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(g.roads.color, 3));
      geometry.setAttribute('aT', new THREE.BufferAttribute(g.roads.time, 1));
      geometry.computeVertexNormals();
      record.roads = new THREE.Mesh(geometry, this.material('roads', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }), record));
      node.add(record.roads);
      // Roads under one pixel wide at world scale stay readable through their real centrelines.
      record.centre = this.lines(g.centre.position, g.centre.time, '#2f3033', 0.75, [0.18, 0.35], record);
      if (record.centre) node.add(record.centre);
    }
    record.blockLines = this.lines(g.blocks.positions, g.blocks.times, '#6a675f', 0.45, [0.5, 0.15], record);
    record.parcelLines = this.lines(g.parcels.positions, g.parcels.times, '#77736a', 0.3, [0.58, 0.15], record);
    for (const line of [record.blockLines, record.parcelLines]) if (line) node.add(line);
    if (g.buildings.position.length) {
      record.buildings = tri([['position', g.buildings.position, 3], ['normal', g.buildings.normal, 3], ['color', g.buildings.color, 3], ['aS', g.buildings.build, 4]], 'buildings', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }));
      record.buildingsFull = record.buildings.material;
      record.buildingsLite = this.material('buildings', new THREE.MeshLambertMaterial({ vertexColors: true }), record);
      record.roofStart = g.buildings.roofStart;
      record.vertexCount = g.buildings.position.length / 3;
    }
    // City border: the real chunk square, coloured by City ID.
    const half = 510; const y = g.maxY + 6;
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(meta.x + a * half, y, meta.z + b * half))), new THREE.LineBasicMaterial({ color: muted(meta.cityId) }));
    node.add(rim);
    record.rim = rim;
    record.node = node;
    this.root.add(node);
    if (!this.groups.has(group)) this.groups.set(group, []);
    this.groups.get(group).push(record);
  }

  // The world's schedule, from the data: origins in their real claim order, growth in its recorded steps.
  scheduleWorld(info, originStart, originEnd, growthStart) {
    this.info.world = info;
    this.history = info.history;
    this.times = { ...this.times, originStart, originEnd, growthStart };
    const records = this.groups.get('world');
    const starts = chunkStarts(info, originStart, originEnd, growthStart);
    for (const record of records) record.start = starts.get(record.meta.id);
    this.buildLinks(records);
  }

  scheduleCases(info, caseStart) {
    this.info.cases = info;
    this.times.caseStart = caseStart;
    CASE_ORDER.forEach((name, index) => {
      const open = caseStart + index * CASE_SECONDS;
      for (const record of this.groups.get(name) ?? []) record.start = open + 0.3 + (record.meta.role === 'core' ? 0 : (record.meta.order ?? 1) * 1.1);
    });
  }

  // Parent → child arrows from the recorded parentChunkId, and the parent's real edge facing the new chunk.
  buildLinks(records) {
    const byId = new Map(records.map(record => [record.meta.id, record]));
    const top = Math.max(...records.map(record => record.maxY)) + 30;
    for (const record of records) {
      const parent = byId.get(record.meta.parent);
      if (!parent) continue;
      const a = new THREE.Vector3(parent.meta.x, top, parent.meta.z); const b = new THREE.Vector3(record.meta.x, top, record.meta.z);
      record.link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: muted(record.meta.cityId), depthTest: false }));
      record.link.renderOrder = 7;
      record.link.visible = false;
      this.root.add(record.link);
      const dx = Math.sign(record.meta.x - parent.meta.x); const dz = Math.sign(record.meta.z - parent.meta.z);
      const mx = parent.meta.x + dx * 512; const mz = parent.meta.z + dz * 512; const y = parent.maxY + 10;
      record.front = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(mx - dz * 512, y, mz - dx * 512), new THREE.Vector3(mx + dz * 512, y, mz + dx * 512)]), new THREE.LineBasicMaterial({ color: TERRACOTTA, depthTest: false }));
      record.front.renderOrder = 8;
      record.front.visible = false;
      this.root.add(record.front);
    }
  }

  activeGroup(t) {
    const { caseStart } = this.times;
    if (caseStart && t >= caseStart) return CASE_ORDER[Math.min(CASE_ORDER.length - 1, Math.floor((t - caseStart) / CASE_SECONDS))];
    return 'world';
  }

  setTime(t) {
    const name = this.activeGroup(t);
    this.active = name;
    for (const [group, records] of this.groups) {
      for (const record of records) {
        const on = group === name;
        const p = on ? Math.min(1.0001, Math.max(0, (t - record.start) / REVEAL_SECONDS)) : 0;
        record.progress.value = p;
        record.node.visible = p > 0;
        if (record.link) record.link.visible = on && p > 0 && this.layers.links;
        if (record.front) record.front.visible = on && t > record.start - 0.7 && t < record.start + 0.6;
      }
    }
    this.applyLayers();
  }

  setLevel(level) { this.level = level; this.applyLayers(); }

  applyLayers() {
    const L = this.layers;
    const light = this.level === 'light';
    for (const records of this.groups.values()) {
      for (const record of records) {
        record.tint.value = L.territory ? 0.16 : 0;
        record.rim.visible = L.territory;
        record.terrain.visible = !light;
        record.terrainLite.visible = light;
        if (record.roads) record.roads.visible = L.roads && !light;
        if (record.centre) record.centre.visible = L.roads;
        if (record.blockLines) record.blockLines.visible = L.lots;
        if (record.parcelLines) record.parcelLines.visible = L.lots && !light;
        if (record.buildings) {
          record.buildings.visible = L.buildings;
          record.buildings.material = light ? record.buildingsLite : record.buildingsFull;
          record.buildings.geometry.setDrawRange(light ? record.roofStart : 0, light ? record.vertexCount - record.roofStart : record.vertexCount);
        }
        if (record.link && !L.links) record.link.visible = false;
      }
    }
  }

  visibleRecords() { return [...(this.groups.get(this.active) ?? [])].filter(record => record.progress.value > 0); }
  recordsOf(cityId) { return (this.groups.get(this.active) ?? []).filter(record => record.meta.cityId === cityId && record.progress.value > 0); }

  // Box of chunks, for the camera.
  boxOf(records) {
    if (!records.length) return null;
    return {
      minX: Math.min(...records.map(r => r.meta.x)) - 512, maxX: Math.max(...records.map(r => r.meta.x)) + 512,
      minZ: Math.min(...records.map(r => r.meta.z)) - 512, maxZ: Math.max(...records.map(r => r.meta.z)) + 512,
      minY: Math.min(...records.map(r => r.base.value)), maxY: Math.max(...records.map(r => r.maxY)) + 60,
    };
  }

  // Real chunk under a screen point. Reads stored data only.
  pick(ndc, camera) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    let best = null;
    for (const record of this.visibleRecords()) {
      const hit = ray.intersectObject(this.level === 'light' ? record.terrainLite : record.terrain)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, record };
    }
    return best ? best.record : null;
  }

  setHighlight(record) {
    if (this.highlight) { this.highlight.geometry.dispose(); this.highlight.material.dispose(); this.highlight.removeFromParent(); this.highlight = null; }
    if (!record) return;
    const half = 512; const y = record.maxY + 12;
    this.highlight = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(record.meta.x + a * half, y, record.meta.z + b * half))), new THREE.LineBasicMaterial({ color: TERRACOTTA, depthTest: false }));
    this.highlight.renderOrder = 9;
    this.root.add(this.highlight);
  }

}

