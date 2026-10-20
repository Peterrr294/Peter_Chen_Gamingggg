// 05.1b-1 closed terrain solid (pure data). The existing surface heightfield stays the only
// elevation authority; this adds four walls and a flat base so surface + shell bound a volume.
//
// Mesh structure (after welding by exact position):
//   surface  257 × 257 vertices, 2 × 256² triangles (same triangulation as THREE.PlaneGeometry)
//   walls    one quad (2 triangles) per boundary half-edge of the surface, down to baseY
//   base     triangle fan from one centre vertex to the base ring (a corner fan would create
//            degenerate triangles because ring points along a side are collinear)
// Walls take the opposite winding of each surface boundary half-edge, so orientation is
// consistent by construction and outward when the surface faces +y.

export const SHELL_RULES = Object.freeze({
  baseElevation: -60, // m; common base for every chunk (simplifies later joins)
  minThickness: 20, // m; the base is lowered further if terrain comes closer than this
});

export function shellBase(heights) {
  let min = Infinity;
  for (const h of heights) if (h < min) min = h;
  return Math.min(SHELL_RULES.baseElevation, min - SHELL_RULES.minThickness);
}

// Surface triangles exactly as THREE.PlaneGeometry builds them (then rotated to y-up).
export function surfaceTriangles(segments) {
  const columns = segments + 1;
  const indices = new Uint32Array(segments * segments * 6);
  let k = 0;
  for (let iy = 0; iy < segments; iy += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = ix + columns * iy; const b = ix + columns * (iy + 1);
      const c = ix + 1 + columns * (iy + 1); const d = ix + 1 + columns * iy;
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }
  return indices;
}

// Walls + base from the surface's boundary half-edges. surfacePositions are the rendered
// surface vertices (x, y, z), so the shell's top ring copies them bit for bit.
export function buildShell(surfacePositions, surfaceIndices, baseY) {
  const count = new Map();
  const key = (u, v) => (u < v ? u * 4294967296 + v : v * 4294967296 + u);
  for (let t = 0; t < surfaceIndices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const u = surfaceIndices[t + e]; const v = surfaceIndices[t + (e + 1) % 3];
      count.set(key(u, v), (count.get(key(u, v)) ?? 0) + 1);
    }
  }
  const boundary = [];
  for (let t = 0; t < surfaceIndices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const u = surfaceIndices[t + e]; const v = surfaceIndices[t + (e + 1) % 3];
      if (count.get(key(u, v)) === 1) boundary.push([u, v]);
    }
  }
  const positions = [];
  const indices = [];
  const topOf = new Map(); const bottomOf = new Map();
  const vertex = (x, y, z) => { positions.push(x, y, z); return positions.length / 3 - 1; };
  const top = u => { if (!topOf.has(u)) topOf.set(u, vertex(surfacePositions[u * 3], surfacePositions[u * 3 + 1], surfacePositions[u * 3 + 2])); return topOf.get(u); };
  const bottom = u => { if (!bottomOf.has(u)) bottomOf.set(u, vertex(surfacePositions[u * 3], baseY, surfacePositions[u * 3 + 2])); return bottomOf.get(u); };
  let cx = 0; let cz = 0;
  for (const [u] of boundary) { cx += surfacePositions[u * 3]; cz += surfacePositions[u * 3 + 2]; }
  for (const [u, v] of boundary) {
    // Surface has u→v; the wall uses v→u, so the shared edge is traversed once in each direction.
    indices.push(top(v), top(u), bottom(u));
    indices.push(top(v), bottom(u), bottom(v));
  }
  const centre = vertex(cx / boundary.length, baseY, cz / boundary.length);
  for (const [u, v] of boundary) indices.push(centre, bottom(v), bottom(u));
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), boundaryEdges: boundary.length, baseY };
}

// Topology / geometry check of a triangle soup welded by exact position.
export function checkClosedMesh(parts) {
  const ids = new Map();
  const welded = [];
  const triangles = [];
  for (const { positions, indices } of parts) {
    const local = new Int32Array(positions.length / 3);
    for (let i = 0; i < local.length; i += 1) {
      const k = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
      if (!ids.has(k)) { ids.set(k, welded.length / 3); welded.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
      local[i] = ids.get(k);
    }
    for (let t = 0; t < indices.length; t += 3) triangles.push([local[indices[t]], local[indices[t + 1]], local[indices[t + 2]]]);
  }
  const directed = new Map();
  let degenerate = 0; let volume = 0; let duplicateFaces = 0;
  const faceKeys = new Set();
  const p = i => [welded[i * 3], welded[i * 3 + 1], welded[i * 3 + 2]];
  for (const [a, b, c] of triangles) {
    const faceKey = [a, b, c].sort((x, y) => x - y).join(',');
    if (faceKeys.has(faceKey)) duplicateFaces += 1;
    faceKeys.add(faceKey);
    const A = p(a); const B = p(b); const C = p(c);
    const ux = B[0] - A[0]; const uy = B[1] - A[1]; const uz = B[2] - A[2];
    const vx = C[0] - A[0]; const vy = C[1] - A[1]; const vz = C[2] - A[2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (a === b || b === c || a === c || area < 1e-9) degenerate += 1;
    volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.set(`${u}>${v}`, (directed.get(`${u}>${v}`) ?? 0) + 1);
  }
  let open = 0; let nonManifold = 0; let inconsistent = 0; let edges = 0;
  const seen = new Set();
  for (const [k, n] of directed) {
    const [u, v] = k.split('>');
    const undirected = u < v ? `${u}|${v}` : `${v}|${u}`;
    if (seen.has(undirected)) continue;
    seen.add(undirected);
    edges += 1;
    const forward = n; const backward = directed.get(`${v}>${u}`) ?? 0;
    if (forward > 1 || backward > 1) inconsistent += 1; // same direction used twice → flipped neighbour
    if (forward + backward === 1) open += 1;
    else if (forward + backward > 2) nonManifold += 1;
  }
  // Count only vertices that triangles reference (cut-away grid vertices stay in buffers unused).
  const vertices = new Set(triangles.flat()).size;
  return {
    vertices, edges, faces: triangles.length,
    eulerCharacteristic: vertices - edges + triangles.length,
    openEdges: open, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent,
    degenerateFaces: degenerate, duplicateFaces, signedVolume: volume,
    watertight: open === 0 && nonManifold === 0 && inconsistent === 0,
  };
}

// Exact volume between the piecewise-linear surface and the flat base (prism sum).
export function heightfieldVolume(surfacePositions, surfaceIndices, baseY) {
  let volume = 0;
  for (let t = 0; t < surfaceIndices.length; t += 3) {
    const [a, b, c] = [surfaceIndices[t], surfaceIndices[t + 1], surfaceIndices[t + 2]];
    const ax = surfacePositions[a * 3]; const az = surfacePositions[a * 3 + 2];
    const bx = surfacePositions[b * 3]; const bz = surfacePositions[b * 3 + 2];
    const cx = surfacePositions[c * 3]; const cz = surfacePositions[c * 3 + 2];
    const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    volume += area * ((surfacePositions[a * 3 + 1] + surfacePositions[b * 3 + 1] + surfacePositions[c * 3 + 1]) / 3 - baseY);
  }
  return volume;
}
