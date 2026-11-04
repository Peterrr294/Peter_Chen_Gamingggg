// A City of Cities — G02c-03a CONTROLLED FIXTURE (TEST ONLY; not a world, not a generator).
// One 1024 m chunk of flat ground at 20 m. A main road enters at the shared edge (minZ) from a neighbour 3 m higher,
// meets a cross street `junctionM` inside the edge, and runs on to a second cross street 200 m further. The junction is
// the only room a ramp has. Variants change one thing each.
const SIZE = 1024; const SEG = 256; const SPACING = SIZE / SEG; const H = SIZE / 2;

export function flatFields(level = 20) {
  const columns = SEG + 1; const n = columns * columns;
  return { grid: { columns, segments: SEG, spacing: SPACING, originX: 0, originZ: 0, size: SIZE }, height: new Float32Array(n).fill(level), waterMask: new Uint8Array(n) };
}

// network: main road x = 0 from the edge to z = -H + junctionM + 200 + ...; cross streets at the junction and 200 m on.
export function junctionNetwork({ junctionM = 60, branchM = H, level = 20 } = {}) {
  const nodes = []; const edges = [];
  const node = (x, z, extra = {}) => { nodes.push({ id: nodes.length, x, y: level, z, degree: 0, onBoundary: false, side: null, kind: 'bend', ...extra }); return nodes.length - 1; };
  const edge = (a, b, roadClass, width) => {
    const A = nodes[a]; const B = nodes[b]; const n = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.z - A.z) / 50));
    const points = Array.from({ length: n + 1 }, (_, k) => ({ x: A.x + ((B.x - A.x) * k) / n, y: level, z: A.z + ((B.z - A.z) * k) / n }));
    edges.push({ id: edges.length, from: a, to: b, kind: 'road', roadClass, width, length: Math.hypot(B.x - A.x, B.z - A.z), points, axisDeg: 0 });
    A.degree += 1; B.degree += 1;
  };
  const port = node(0, -H, { onBoundary: true, side: 'minZ', kind: 'port' });
  const j1 = node(0, -H + junctionM, { kind: 'junction' });
  const j2 = node(0, -H + junctionM + 200, { kind: 'junction' });
  const end = node(0, H, { onBoundary: true, side: 'maxZ', kind: 'port' });
  const w1 = node(-Math.min(branchM, H), -H + junctionM, branchM >= H ? { onBoundary: true, side: 'minX', kind: 'port' } : { kind: 'endpoint' });
  const e1 = node(Math.min(branchM, H), -H + junctionM, branchM >= H ? { onBoundary: true, side: 'maxX', kind: 'port' } : { kind: 'endpoint' });
  const w2 = node(-H, -H + junctionM + 200, { onBoundary: true, side: 'minX', kind: 'port' });
  const e2 = node(H, -H + junctionM + 200, { onBoundary: true, side: 'maxX', kind: 'port' });
  edge(port, j1, 'primary', 30); edge(j1, j2, 'primary', 30); edge(j2, end, 'primary', 30);
  edge(w1, j1, 'secondary', 20); edge(j1, e1, 'secondary', 20); edge(w2, j2, 'secondary', 20); edge(j2, e2, 'secondary', 20);
  const edgePorts = [{ nodeId: port, edgeId: 0, side: 'minZ', position: 0, type: 'road', roadClass: 'primary', directionDeg: 270, elevation: level }];
  return { nodes, edges, edgePorts, signature: 'fixture', stats: { roadLength: edges.reduce((s, e) => s + e.length, 0) } };
}

export const JUNCTION_FIXTURES = Object.freeze({
  feasible: { title: 'Seam 3 m, junction 60 m in, full cross street', junctionM: 60, branchM: H, sourceElevation: 23, profile: 'baseline', expect: 'accepted through the junction' },
  seamTooHigh: { title: 'Seam 8 m (over the 6 m earthwork limit)', junctionM: 60, branchM: H, sourceElevation: 28, profile: 'baseline', expect: 'refused: terrain' },
  shortBranches: { title: 'Cross street arms 20 m, dead ends', junctionM: 60, branchM: 20, sourceElevation: 23, profile: 'baseline', expect: 'refused: a branch cannot return to the ground' },
  conservative: { title: 'Same as feasible at 4 %', junctionM: 60, branchM: H, sourceElevation: 23, profile: 'conservative', expect: 'measured' },
});
