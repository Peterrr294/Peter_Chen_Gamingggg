import * as THREE from 'three';
import WFC from 'wavefunctioncollapse';
import { SeededRandom } from '../world/SeededRandom.js';
import { nearestPlazaDirection } from '../world/RegionLayout.js';

const { SimpleTiledModel } = WFC;
const directions = [
  { dx: 0, dy: -1, socket: 0, opposite: 2 },
  { dx: 1, dy: 0, socket: 1, opposite: 3 },
  { dx: 0, dy: 1, socket: 2, opposite: 0 },
  { dx: -1, dy: 0, socket: 3, opposite: 1 },
];
const cardinality = { X: 1, I: 2, L: 4, T: 4 };

function rotateSockets(sockets, turns) {
  let result = [...sockets];
  for (let turn = 0; turn < turns; turn += 1) result = [result[3], result[0], result[1], result[2]];
  return result;
}

function definitions(roadDensity) {
  return [
    { name: 'empty', symmetry: 'X', sockets: [0, 0, 0, 0], weight: Math.max(0.35, 3.2 * (1 - roadDensity)) },
    { name: 'straight', symmetry: 'I', sockets: [1, 0, 1, 0], weight: 1.35 },
    { name: 'corner', symmetry: 'L', sockets: [1, 1, 0, 0], weight: 1.1 },
    { name: 't-junction', symmetry: 'T', sockets: [1, 1, 1, 0], weight: 0.65 },
    { name: 'cross', symmetry: 'X', sockets: [1, 1, 1, 1], weight: 0.28 + roadDensity * 0.35 },
    { name: 'dead-end', symmetry: 'L', sockets: [1, 0, 0, 0], weight: 0.42 },
  ];
}

function makeTileData(roadDensity) {
  const bases = definitions(roadDensity);
  const variants = [];
  for (const base of bases) {
    const count = cardinality[base.symmetry] ?? 1;
    for (let rotation = 0; rotation < count; rotation += 1) {
      variants.push({ name: base.name, base: base.name, rotation, sockets: rotateSockets(base.sockets, rotation) });
    }
  }
  const token = variant => `${variant.base} ${variant.rotation}`;
  const neighbors = [];
  for (const left of variants) {
    for (const right of variants) {
      if (left.sockets[1] === right.sockets[3]) neighbors.push({ left: token(left), right: token(right) });
    }
  }
  return {
    data: {
      tilesize: 1,
      unique: false,
      tiles: bases.map((base, index) => ({ ...base, bitmap: [35 + index * 20, 35 + index * 20, 35 + index * 20, 255] })),
      neighbors,
    },
    variants,
  };
}

function exitConstraint(config, columns, rows) {
  const direction = nearestPlazaDirection(config);
  if (direction === 'east') return { x: columns - 1, y: Math.floor(rows / 2), socket: 1 };
  if (direction === 'west') return { x: 0, y: Math.floor(rows / 2), socket: 3 };
  if (direction === 'south') return { x: Math.floor(columns / 2), y: rows - 1, socket: 2 };
  return { x: Math.floor(columns / 2), y: 0, socket: 0 };
}

function applyBoundaryConstraints(model, variants, columns, rows, exit) {
  model.initialize();
  model.clear();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const index = x + y * columns;
      variants.forEach((variant, tileIndex) => {
        const outward = (y === 0 && variant.sockets[0])
          || (x === columns - 1 && variant.sockets[1])
          || (y === rows - 1 && variant.sockets[2])
          || (x === 0 && variant.sockets[3]);
        const isExit = x === exit.x && y === exit.y;
        if ((outward && !isExit) || (isExit && !variant.sockets[exit.socket])) model.ban(index, tileIndex);
      });
    }
  }
  model.propagate();
}

function connectedToExit(tiles, columns, rows, exit) {
  const start = exit.x + exit.y * columns;
  if (!tiles[start] || tiles[start].name === 'empty') return new Set();
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const index = queue.shift();
    const x = index % columns;
    const y = Math.floor(index / columns);
    const tile = tiles[index];
    directions.forEach(direction => {
      if (!tile.sockets[direction.socket]) return;
      const nx = x + direction.dx;
      const ny = y + direction.dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) return;
      const neighborIndex = nx + ny * columns;
      const neighbor = tiles[neighborIndex];
      if (!neighbor?.sockets[direction.opposite] || visited.has(neighborIndex)) return;
      visited.add(neighborIndex);
      queue.push(neighborIndex);
    });
  }
  return visited;
}

function cellPosition(config, columns, rows, x, y) {
  return {
    x: config.centerX - config.width / 2 + (x + 0.5) * (config.width / columns),
    z: config.centerZ - config.depth / 2 + (y + 0.5) * (config.depth / rows),
  };
}

function buildRoadMesh(config, result, terrain, material) {
  const group = new THREE.Group();
  group.name = `${config.label} WFC roads`;
  const cellWidth = config.width / result.columns;
  const cellDepth = config.depth / result.rows;
  const roadWidth = Math.min(cellWidth, cellDepth) * 0.28;
  const geometry = new THREE.BoxGeometry(1, 0.08, 1);
  const transforms = [];
  const roadPoints = [];
  for (const index of result.connected) {
    const tile = result.tiles[index];
    const x = index % result.columns;
    const y = Math.floor(index / result.columns);
    const center = cellPosition(config, result.columns, result.rows, x, y);
    const height = terrain.heightAt(center.x, center.z) + 0.08;
    transforms.push({ x: center.x, y: height, z: center.z, sx: roadWidth, sz: roadWidth });
    roadPoints.push({ x: center.x, y: height, z: center.z });
    tile.sockets.forEach((socket, direction) => {
      if (!socket) return;
      const horizontal = direction === 1 || direction === 3;
      transforms.push({
        x: center.x + (direction === 1 ? cellWidth * 0.25 : direction === 3 ? -cellWidth * 0.25 : 0),
        y: height,
        z: center.z + (direction === 2 ? cellDepth * 0.25 : direction === 0 ? -cellDepth * 0.25 : 0),
        sx: horizontal ? cellWidth * 0.56 : roadWidth,
        sz: horizontal ? roadWidth : cellDepth * 0.56,
      });
    });
  }
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const matrix = new THREE.Matrix4();
  transforms.forEach((transform, index) => {
    matrix.compose(
      new THREE.Vector3(transform.x, transform.y, transform.z),
      new THREE.Quaternion(),
      new THREE.Vector3(transform.sx, 1, transform.sz),
    );
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = `${config.label} road instances`;
  group.add(mesh);
  return { group, mesh, geometry, roadPoints };
}

export function generateWFCRoads(regionId, config, regionSeed, terrain, material) {
  const started = performance.now();
  const columns = Math.max(5, Math.round(5 + config.roadDensity * 7));
  const rows = Math.max(5, Math.round(5 + config.roadDensity * 7));
  const { data, variants } = makeTileData(config.roadDensity);
  const exit = exitConstraint(config, columns, rows);
  let selected = null;
  let retries = 0;
  for (; retries <= config.wfcRetryLimit; retries += 1) {
    const random = new SeededRandom(regionSeed, 'wfc', retries);
    const model = new SimpleTiledModel(data, null, columns, rows, false);
    applyBoundaryConstraints(model, variants, columns, rows, exit);
    const success = model.iterate(0, () => random.next());
    if (!success || !model.observed) continue;
    const tiles = model.observed.map(index => variants[index]);
    const connected = connectedToExit(tiles, columns, rows, exit);
    if (connected.size < 3) continue;
    selected = { tiles, connected, columns, rows, exit };
    break;
  }
  if (!selected) {
    const empty = variants.find(variant => variant.name === 'empty');
    const fallback = variants.find(variant => variant.name === 'dead-end' && variant.sockets[exit.socket]);
    const tiles = Array(columns * rows).fill(empty);
    const exitIndex = exit.x + exit.y * columns;
    tiles[exitIndex] = fallback;
    selected = { tiles, connected: new Set([exitIndex]), columns, rows, exit };
  }
  const meshData = buildRoadMesh(config, selected, terrain, material);
  return {
    ...selected,
    object3D: meshData.group,
    mesh: meshData.mesh,
    roadPoints: meshData.roadPoints,
    success: selected.connected.size >= 3,
    retries,
    generationTime: performance.now() - started,
    dispose() {
      meshData.mesh.dispose();
      meshData.geometry.dispose();
    },
  };
}
