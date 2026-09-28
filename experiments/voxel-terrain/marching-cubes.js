import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const EDGES = [
  [0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6],
  [7, 6], [4, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

function interpolate(a, b, valueA, valueB) {
  const difference = valueB - valueA;
  const t = Math.abs(difference) < 1e-12 ? 0.5 : -valueA / difference;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function normalAt(point, sample, delta) {
  // SDF 从负值内部走向正值外部，因此梯度方向就是外法线。
  const x = sample({ x: point.x + delta, y: point.y, z: point.z }) - sample({ x: point.x - delta, y: point.y, z: point.z });
  const y = sample({ x: point.x, y: point.y + delta, z: point.z }) - sample({ x: point.x, y: point.y - delta, z: point.z });
  const z = sample({ x: point.x, y: point.y, z: point.z + delta }) - sample({ x: point.x, y: point.y, z: point.z - delta });
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function facePointsOutward(a, b, c, sample, delta) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const face = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
  const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
  const outward = normalAt(center, sample, delta);
  return face.x * outward.x + face.y * outward.y + face.z * outward.z >= 0;
}

export function generateMarchingCubes({ origin, cells, spacing, sample }) {
  const points = cells + 1;
  const density = new Float32Array(points ** 3);
  const index = (x, y, z) => x + points * (y + points * z);
  for (let z = 0; z < points; z += 1) for (let y = 0; y < points; y += 1) for (let x = 0; x < points; x += 1) {
    density[index(x, y, z)] = sample({ x: origin.x + x * spacing, y: origin.y + y * spacing, z: origin.z + z * spacing });
  }

  const positions = [];
  const normals = [];
  const edgeVertices = new Array(12);
  const cornerPoints = new Array(8);
  const cornerValues = new Array(8);
  const normalDelta = spacing * 0.5;

  for (let z = 0; z < cells; z += 1) for (let y = 0; y < cells; y += 1) for (let x = 0; x < cells; x += 1) {
    let cubeIndex = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const [dx, dy, dz] = CORNERS[corner];
      cornerPoints[corner] = { x: origin.x + (x + dx) * spacing, y: origin.y + (y + dy) * spacing, z: origin.z + (z + dz) * spacing };
      cornerValues[corner] = density[index(x + dx, y + dy, z + dz)];
      if (cornerValues[corner] < 0) cubeIndex |= 1 << corner;
    }
    const mask = edgeTable[cubeIndex];
    if (mask === 0) continue;
    for (let edge = 0; edge < 12; edge += 1) if (mask & (1 << edge)) {
      const [a, b] = EDGES[edge];
      edgeVertices[edge] = interpolate(cornerPoints[a], cornerPoints[b], cornerValues[a], cornerValues[b]);
    }
    const tableOffset = cubeIndex * 16;
    for (let item = 0; triTable[tableOffset + item] !== -1; item += 3) {
      let a = edgeVertices[triTable[tableOffset + item]];
      let b = edgeVertices[triTable[tableOffset + item + 1]];
      let c = edgeVertices[triTable[tableOffset + item + 2]];
      if (!facePointsOutward(a, b, c, sample, normalDelta)) [b, c] = [c, b];
      for (const point of [a, b, c]) {
        const normal = normalAt(point, sample, normalDelta);
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  }
  return { density, positions: new Float32Array(positions), normals: new Float32Array(normals), triangleCount: positions.length / 9 };
}

export function compareChunkSeam(a, b, axis, coordinate, epsilon = 1e-5) {
  const component = { x: 0, y: 1, z: 2 }[axis];
  const signature = mesh => {
    const result = new Map();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i + component] - coordinate) > epsilon) continue;
      const other = [0, 1, 2].filter(value => value !== component);
      const key = `${mesh.positions[i + other[0]].toFixed(5)},${mesh.positions[i + other[1]].toFixed(5)}`;
      result.set(key, [mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]);
    }
    return result;
  };
  const left = signature(a), right = signature(b);
  let matches = 0, maxNormalDelta = 0;
  for (const [key, normalA] of left) if (right.has(key)) {
    const normalB = right.get(key); matches += 1;
    maxNormalDelta = Math.max(maxNormalDelta, Math.hypot(normalA[0] - normalB[0], normalA[1] - normalB[1], normalA[2] - normalB[2]));
  }
  return { matches, maxNormalDelta };
}
