export function compareSharedVertices(a, b, decimals = 5) {
  const collect = mesh => {
    const map = new Map();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const key = `${mesh.positions[i].toFixed(decimals)},${mesh.positions[i + 1].toFixed(decimals)},${mesh.positions[i + 2].toFixed(decimals)}`;
      map.set(key, [mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]);
    }
    return map;
  };
  const first = collect(a), second = collect(b);
  let matches = 0, maxNormalDelta = 0;
  for (const [key, normalA] of first) if (second.has(key)) {
    const normalB = second.get(key); matches += 1;
    maxNormalDelta = Math.max(maxNormalDelta, Math.hypot(normalA[0]-normalB[0],normalA[1]-normalB[1],normalA[2]-normalB[2]));
  }
  return { matches, maxNormalDelta };
}
