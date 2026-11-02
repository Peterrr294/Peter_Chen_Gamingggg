import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';

// WEB-01 Reveal model (pure data, no Three.js). Turns the real outputs of one chunk into "when does this element appear",
// each value normalised to 0–1 inside its stage. It reads the generators' results and never changes them.
// Honest limit: the generators do not log events, so this order is DERIVED from the data's own topology
// (road graph distance, block → adjacent roads, parcel → block, building → parcel), not a replay of the algorithm's run.
const CLASS_COST = { primary: 1, canal: 1, bridge: 1.2, secondary: 1.7, lane: 2.4 };
const JITTER = 0.12; // seeded ± share of an edge's growth speed

export function revealRoads(network, grid, seed) {
  const random = new SeededRandom(seed, 'film-roads', network.dna ?? 'dna');
  const costs = new Map(network.edges.map(edge => [edge.id, Math.max(1, edge.length) * (CLASS_COST[edge.roadClass] ?? 1.5) * (1 + (random.next() * 2 - 1) * JITTER)]));
  const links = new Map(network.nodes.map(node => [node.id, []]));
  network.edges.forEach(edge => { links.get(edge.from).push(edge); links.get(edge.to).push(edge); });
  const arrival = new Map();
  const nodes = [...network.nodes];
  if (!nodes.length) return { edges: new Map(), startNode: null };
  // Growth starts at the best-connected node of the main network nearest the chunk centre.
  const primaryNodes = new Set(network.edges.filter(edge => edge.roadClass === 'primary' || edge.kind === 'canal').flatMap(edge => [edge.from, edge.to]));
  const seedScore = node => (primaryNodes.has(node.id) ? 2000 : 0) + node.degree * 200 - Math.hypot(node.x - grid.originX, node.z - grid.originZ);
  const flood = (startId, startTime) => {
    const queue = [[startTime, startId]];
    arrival.set(startId, startTime);
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const [time, id] = queue.shift();
      if (time > arrival.get(id)) continue;
      for (const edge of links.get(id)) {
        const other = edge.from === id ? edge.to : edge.from;
        const next = time + costs.get(edge.id);
        if (!arrival.has(other) || next < arrival.get(other)) { arrival.set(other, next); queue.push([next, other]); }
      }
    }
  };
  flood(nodes.reduce((best, node) => (seedScore(node) > seedScore(best) ? node : best)).id, 0);
  // Disconnected components start when the growth has come closest to them.
  for (;;) {
    const rest = nodes.filter(node => !arrival.has(node.id));
    if (!rest.length) break;
    let best = null;
    for (const node of rest) {
      for (const reached of nodes) {
        if (!arrival.has(reached.id)) continue;
        const time = arrival.get(reached.id) + Math.hypot(node.x - reached.x, node.z - reached.z);
        if (!best || time < best.time || (time === best.time && node.id < best.id)) best = { id: node.id, time };
      }
    }
    flood(best.id, best.time);
  }
  const edges = new Map();
  let maxTime = 1;
  for (const edge of network.edges) {
    const a = arrival.get(edge.from); const b = arrival.get(edge.to);
    const begin = Math.min(a, b);
    const end = begin + costs.get(edge.id);
    maxTime = Math.max(maxTime, end);
    edges.set(edge.id, { begin, end, forward: a <= b });
  }
  for (const value of edges.values()) { value.begin /= maxTime; value.end /= maxTime; }
  return { edges };
}

// A block closes when the last road around it is complete; unroaded blocks come last.
export function revealBlocks(blocks, roads) {
  const closing = blocks.blocks.map(block => {
    const times = block.adjacentRoads.map(road => roads.edges.get(road.edgeId)?.end).filter(Number.isFinite);
    return times.length ? Math.max(...times) : 1;
  });
  const order = closing.map((time, index) => [time, index]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const span = Math.max(1, order.length - 1);
  const time = new Float32Array(closing.length);
  order.forEach(([, index], rank) => { time[index] = (rank / span) * 0.84; }); // 0.16 left for the fade of the last block
  return time;
}

export function revealParcels(parcels, blocks, blockTime) {
  const blockIndex = new Map(blocks.blocks.map((block, index) => [block.id, index]));
  const seen = new Map();
  const counts = new Map();
  parcels.parcels.forEach(parcel => counts.set(parcel.blockId, (counts.get(parcel.blockId) ?? 0) + 1));
  const time = new Float32Array(parcels.parcels.length);
  parcels.parcels.forEach((parcel, index) => {
    const rank = seen.get(parcel.blockId) ?? 0;
    seen.set(parcel.blockId, rank + 1);
    const base = blockTime[blockIndex.get(parcel.blockId)] ?? 0.84;
    time[index] = base * 0.86 + (rank / Math.max(1, counts.get(parcel.blockId))) * 0.12; // siblings subdivide in sequence
  });
  return time;
}

export function revealBuildings(buildings, parcels, parcelTime, seed) {
  const random = new SeededRandom(seed, 'film-buildings', buildings.source?.dna ?? 'dna');
  const parcelIndex = new Map(parcels.parcels.map((parcel, index) => [parcel.id, index]));
  const maxHeight = Math.max(1, ...buildings.buildings.map(building => building.height));
  return buildings.buildings.map(building => {
    const start = (parcelTime[parcelIndex.get(building.parcelId)] ?? 0.9) * 0.62 + random.next() * 0.1;
    const duration = 0.06 + 0.2 * Math.pow(building.height / maxHeight, 0.7); // taller rises longer
    return { start, duration };
  });
}

// Where parcels are densest: the local view of the parcel and building stages (128 m bins, deterministic).
export function densestPoint(parcels, grid) {
  const size = 128;
  const bins = new Map();
  for (const parcel of parcels.parcels) {
    const c = parcel.polygon.reduce((sum, p) => [sum[0] + p.x, sum[1] + p.z], [0, 0]).map(v => v / parcel.polygon.length);
    if (Math.max(Math.abs(c[0] - grid.originX), Math.abs(c[1] - grid.originZ)) > grid.size * 0.34) continue;
    const key = `${Math.floor(c[0] / size)},${Math.floor(c[1] / size)}`;
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  let best = null;
  for (const [key, count] of [...bins.entries()].sort()) if (!best || count > best.count) best = { key, count };
  if (!best) return { x: grid.originX, z: grid.originZ };
  const [a, b] = best.key.split(',').map(Number);
  return { x: (a + 0.5) * size, z: (b + 0.5) * size };
}
