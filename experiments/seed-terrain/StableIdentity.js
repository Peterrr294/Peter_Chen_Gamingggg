import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';

// 07.1a spatial identity (opt-in, `options.identity = { worldSeed }` on blocks / parcels / buildings).
// An object's key is a 64-bit hash of its canonical plan geometry (world metres, the 3-decimal coordinates the
// generators already store): the ring is rotated to start at its smallest (x, z) vertex, holes are sorted. The same
// geometry gives the same key in any generation order; any geometric change gives a new key (a new object).
// Without `options.identity` the generators keep their order-based ids (legacy output, verified signatures).

const q = v => Number(v).toFixed(3);
export function canonicalRing(ring) {
  let start = 0;
  ring.forEach((p, i) => { const s = ring[start]; if (p.x < s.x || (p.x === s.x && p.z < s.z)) start = i; });
  return [...ring.slice(start), ...ring.slice(0, start)].map(p => `${q(p.x)},${q(p.z)}`).join(';');
}
export const canonicalShape = (outer, holes = []) => [canonicalRing(outer), ...holes.map(canonicalRing).sort()].join('|');
export const geometryKey = (...parts) => {
  const text = parts.join('#');
  return hashParts('stable-a', text).toString(36).padStart(7, '0') + hashParts('stable-b', text).toString(36).padStart(7, '0');
};
export const pointKey = p => `${q(p.x)},${q(p.z)}`;

// Assigns `${prefix}${key}` ids. Distinct shapes with a hash collision get a deterministic suffix (order of their
// canonical strings, never of the array). Returns the number of collisions.
export function assignStableIds(items, shapeOf, prefix) {
  const groups = new Map();
  for (const item of items) {
    const shape = shapeOf(item); const key = geometryKey(shape);
    item.stableKey = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, shape });
  }
  let collisions = 0;
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0));
    if (list.length > 1) collisions += list.length - 1;
    list.forEach(({ item }, i) => { item.stableKey = i ? `${key}~${i}` : key; item.id = `${typeof prefix === 'function' ? prefix(item) : prefix}${item.stableKey}`; });
  }
  return collisions;
}
