import { checksum } from '../cellular-noise/noise.js';
import { SeededRandom } from '../flavor-clash-prototype/world/SeededRandom.js';
import { BUILDING_RULES } from './buildingRules.js';
import { contours, dedupeRing, label, ringArea, ringsIntersect, simplifyRing } from './BlockGenerator.js';
import { edgePointLocal } from './ParcelGenerator.js';

// 05.1 building footprints and heights (pure data; rendering lives in BuildingView).
//
// Building { id, parcelId, blockId, footprint{polygon, holes}, footprintArea, baseElevation (floor level),
//            groundMin, plinthHeight, bottomElevation, height, floorsEstimate, coverageRatio,
//            frontageRoadId, frontageType, orientationDeg, buildingType, validationFlags }
// Vacant { parcelId, blockId, reason } for parcels left empty.

const segmentDistance = (x, z, a, b) => {
  const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
};
const inside = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
const ringDistance = (ring, x, z) => { let best = Infinity; for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(x, z, ring[i], ring[(i + 1) % ring.length])); return best; };
const round = ring => ring.map(p => ({ x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) }));
const perimeter = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + Math.hypot(q.x - p.x, q.z - p.z); }, 0);

// Footprint polygons from a local field over the parcel bbox; returns the largest valid part.
function footprintAt(parcel, rule, rules, useCourtyard, h) {
  const xs = parcel.polygon.map(p => p.x); const zs = parcel.polygon.map(p => p.z);
  const x0 = Math.min(...xs) - 2 * h; const z0 = Math.min(...zs) - 2 * h;
  const size = Math.ceil(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / h) + 5;
  const m = size + 2;
  const value = new Float32Array(m * m).fill(-1);
  const fronts = parcel.frontageLines.flatMap(line => line.slice(1).map((b, i) => [line[i], b]));
  for (let i = 0; i < size; i += 1) for (let j = 0; j < size; j += 1) {
    const x = x0 + j * h; const z = z0 + i * h;
    const within = inside(parcel.polygon, x, z) && !parcel.holes.some(hole => inside(hole, x, z));
    const edge = Math.min(ringDistance(parcel.polygon, x, z), ...parcel.holes.map(hole => ringDistance(hole, x, z)));
    const signed = within ? edge : -edge;
    let front = Infinity;
    for (const [a, b] of fronts) front = Math.min(front, segmentDistance(x, z, a, b));
    let v = Math.min(signed - rule.sideSetback, front - rule.frontSetback);
    if (useCourtyard) v = Math.min(v, rule.sideSetback + rule.courtyard.ringWidth - signed); // ring band → inner void
    else v = Math.min(v, rule.maxDepth - front);
    value[(i + 1) * m + (j + 1)] = v;
  }
  const field = { value, m, n: size, h, x0, z0 };
  const { labels } = label(field);
  const parts = new Map();
  for (const ring of contours(field).rings) {
    const part = labels[ring.ref];
    const points = ring.ids.map(id => edgePointLocal(field, id));
    if (!parts.has(part)) parts.set(part, []);
    parts.get(part).push({ points, area: ringArea(points) });
  }
  let best = null;
  for (const partRings of parts.values()) {
    partRings.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const sign = Math.sign(partRings[0].area);
    let outer = dedupeRing(sign > 0 ? partRings[0].points : [...partRings[0].points].reverse());
    if (ringArea(outer) < 0) outer.reverse();
    let holes = partRings.slice(1).filter(r => Math.sign(r.area) === -sign).map(r => dedupeRing(sign > 0 ? [...r.points].reverse() : r.points)).filter(r => r.length >= 3).map(r => (ringArea(r) < 0 ? r : [...r].reverse()));
    if (outer.length < 3) continue;
    const simplified = [simplifyRing(outer, rules.simplifyTolerance), ...holes.map(r => simplifyRing(r, rules.simplifyTolerance))];
    if (simplified.every(r => r.length >= 3) && !ringsIntersect(simplified)) [outer, ...holes] = simplified;
    const area = ringArea(outer) - holes.reduce((sum, r) => sum + Math.abs(ringArea(r)), 0);
    if (!best || area > best.area) best = { outer, holes, area, parts: parts.size };
  }
  return best;
}

// Containment: every footprint vertex at least (sideSetback − 0.1) m inside the parcel and no edge crossing.
function contained(footprint, parcel, rule) {
  const parcelRings = [parcel.polygon, ...parcel.holes];
  const rings = [footprint.outer, ...footprint.holes];
  const minDistance = Math.min(...rings.flat().map(p => Math.min(...parcelRings.map(ring => ringDistance(ring, p.x, p.z)))));
  if (minDistance < rule.sideSetback - 0.1) return false;
  if (!footprint.outer.every(p => inside(parcel.polygon, p.x, p.z) && !parcel.holes.some(hole => inside(hole, p.x, p.z)))) return false;
  const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (const ra of rings) for (let i = 0; i < ra.length; i += 1) {
    const p = ra[i]; const q = ra[(i + 1) % ra.length];
    for (const rb of parcelRings) for (let j = 0; j < rb.length; j += 1) {
      const a = rb[j]; const b = rb[(j + 1) % rb.length];
      if (orient(p, q, a) * orient(p, q, b) < 0 && orient(a, b, p) * orient(a, b, q) < 0) return false;
    }
  }
  return true;
}

// Interpolating the distance field across a cell can bulge the contour at sharp parcel corners;
// a footprint that is not contained is recomputed on a finer grid, else the parcel stays vacant.
function footprintOf(parcel, rule, rules, useCourtyard) {
  for (const h of [rules.resolution, rules.resolution / 2, rules.resolution / 4]) {
    const footprint = footprintAt(parcel, rule, rules, useCourtyard, h);
    if (!footprint) return null;
    if (contained(footprint, parcel, rule)) return { ...footprint, resolution: h };
  }
  return { uncontained: true };
}

export function generateBuildings(parcelsResult, fields, cityMatch, config) {
  const rules = BUILDING_RULES;
  const dna = cityMatch.selectedDNA.id;
  const rule = rules.byDNA[dna];
  const { columns, segments, spacing, size, originX, originZ } = fields.grid;
  const half = size / 2;
  const heightAt = (x, z) => {
    const gx = Math.min(segments, Math.max(0, (x - originX + half) / spacing)); const gz = Math.min(segments, Math.max(0, (z - originZ + half) / spacing));
    const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz)); const tx = gx - c0; const tz = gz - r0;
    const at = (r, c) => fields.height[r * columns + c];
    return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
  };
  // Seeded height centre (independent stream; never touches terrain or network seeds).
  const centreRandom = new SeededRandom(config.seed, 'buildings-centre', dna);
  const centre = { x: originX + (centreRandom.next() - 0.5) * size * 0.5, z: originZ + (centreRandom.next() - 0.5) * size * 0.5 };
  const maxArea = Math.max(1, ...parcelsResult.parcels.map(parcel => parcel.area));

  const buildings = [];
  const vacant = [];
  for (const parcel of parcelsResult.parcels) {
    // Per-parcel random stream keyed by the parcel id: adding or removing other parcels does not shift it.
    const random = new SeededRandom(config.seed, 'building', dna, parcel.id);
    const occupied = random.next() < rule.occupancy;
    const jitter = random.next();
    if (!occupied) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: `density rule (occupancy ${rule.occupancy})` }); continue; }
    if (!parcel.frontageLines.length) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: 'no frontage line' }); continue; }
    const useCourtyard = Boolean(rule.courtyard) && parcel.area >= rule.courtyard.minParcelArea;
    let footprint = footprintOf(parcel, rule, rules, useCourtyard);
    if (footprint?.uncontained) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: 'footprint could not be kept inside the parcel setback' }); continue; }
    let courtyard = useCourtyard && footprint && footprint.holes.length > 0 && footprint.holes.some(hole => Math.abs(ringArea(hole)) >= rule.courtyard.minVoidArea);
    if (useCourtyard && !courtyard) { footprint = footprintOf(parcel, rule, rules, false); courtyard = false; }
    if (footprint?.uncontained) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: 'footprint could not be kept inside the parcel setback' }); continue; }
    if (!footprint) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: 'no footprint after setbacks' }); continue; }
    if (footprint.area < rules.minFootprintArea) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: `footprint ${footprint.area.toFixed(0)} m² < ${rules.minFootprintArea} m²` }); continue; }
    const width = 2 * footprint.area / perimeter(footprint.outer);
    if (width < rules.minFootprintWidth) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: `footprint width ${width.toFixed(1)} m < ${rules.minFootprintWidth} m` }); continue; }
    if (ringsIntersect([footprint.outer, ...footprint.holes])) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: 'invalid footprint' }); continue; }

    // Ground contact: sample the terrain under the footprint (vertices + interior lattice).
    // Ground under the footprint: edges every 0.5 m plus a 1 m interior lattice (bilinear terrain).
    const samples = [];
    footprint.outer.forEach((p, i) => { const q = footprint.outer[(i + 1) % footprint.outer.length]; const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.5)); for (let k = 0; k < steps; k += 1) samples.push({ x: p.x + (q.x - p.x) * k / steps, z: p.z + (q.z - p.z) * k / steps }); });
    const xs = footprint.outer.map(p => p.x); const zs = footprint.outer.map(p => p.z);
    for (let x = Math.min(...xs) + 0.5; x <= Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z <= Math.max(...zs); z += 1) if (inside(footprint.outer, x, z)) samples.push({ x, z });
    const heights = samples.map(p => heightAt(p.x, p.z));
    const groundMin = Math.min(...heights); const groundMax = Math.max(...heights);
    const plinthHeight = groundMax - groundMin;
    if (plinthHeight > rules.maxPlinth) { vacant.push({ parcelId: parcel.id, blockId: parcel.blockId, reason: `ground drop ${plinthHeight.toFixed(1)} m > ${rules.maxPlinth} m under footprint` }); continue; }

    // Height: smooth seeded centre gradient + road class + parcel area + bounded jitter.
    let cx = 0; let cz = 0; footprint.outer.forEach(p => { cx += p.x; cz += p.z; }); cx /= footprint.outer.length; cz /= footprint.outer.length;
    const centreFactor = Math.exp(-((cx - centre.x) ** 2 + (cz - centre.z) ** 2) / (rule.centreRadius ** 2));
    const roadFactor = Math.max(...parcel.frontages.map(item => rules.roadClassWeight[item.roadClass] ?? 0));
    const areaFactor = Math.min(1, parcel.area / maxArea);
    const w = rule.weights;
    const mix = Math.min(1, Math.max(0, (w.centre * centreFactor + w.road * roadFactor + w.area * areaFactor) * (1 - rule.jitter / 2 + rule.jitter * jitter)));
    const floors = Math.max(rule.floors[0], Math.round(rule.floors[0] + (rule.floors[1] - rule.floors[0]) * mix));
    const height = floors * rule.floorHeight;
    const coverageRatio = footprint.area / parcel.area;
    buildings.push({
      id: `${parcel.id}-H`,
      parcelId: parcel.id,
      blockId: parcel.blockId,
      footprint: { polygon: round(footprint.outer), holes: footprint.holes.map(round) },
      footprintArea: footprint.area,
      baseElevation: groundMax, // ground-floor level: never below the ground anywhere under the footprint
      groundMin,
      plinthHeight,
      bottomElevation: groundMin - rules.plinthBelow,
      height,
      floorsEstimate: floors,
      coverageRatio,
      frontageRoadId: parcel.frontageRoadId,
      frontageType: parcel.frontageType,
      orientationDeg: parcel.orientation.inwardDeg,
      buildingType: courtyard ? 'courtyard' : parcel.frontageType === 'corner' ? 'cornerFrontage' : 'streetFrontage',
      validationFlags: {
        inTransition: parcel.mayBeAdjusted,
        plinth: plinthHeight > 0.5,
        courtyard,
        canalFacing: parcel.canalFrontage > 1, // orientation only; access stays on the road
        multiPartDropped: footprint.parts > 1,
        refinedResolution: footprint.resolution < rules.resolution,
      },
    });
  }

  const heights = buildings.map(b => b.height).sort((a, b) => a - b);
  const pct = q => (heights.length ? heights[Math.min(heights.length - 1, Math.floor(q * (heights.length - 1)))] : 0);
  const builtParcelArea = buildings.reduce((sum, b) => sum + b.footprintArea / b.coverageRatio, 0);
  const footprintArea = buildings.reduce((sum, b) => sum + b.footprintArea, 0);
  const result = {
    version: '05.1',
    source: { dna, seed: config.seed, landform: config.landform, parcelsSignature: parcelsResult.signature, centre },
    units: { length: 'm', area: 'm²', height: 'm', floors: 'count' },
    rules: { ...rules, rule },
    buildings,
    vacant,
    stats: {
      parcels: parcelsResult.parcels.length,
      buildings: buildings.length,
      occupancy: parcelsResult.parcels.length ? buildings.length / parcelsResult.parcels.length : 0,
      meanHeight: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0,
      heightP10: pct(0.1), heightP50: pct(0.5), heightP90: pct(0.9), heightMax: pct(1),
      distinctFloors: new Set(buildings.map(b => b.floorsEstimate)).size,
      footprintArea,
      coverageOfBuiltParcels: builtParcelArea ? footprintArea / builtParcelArea : 0,
      coverageOfAllParcels: parcelsResult.stats.parcelArea ? footprintArea / parcelsResult.stats.parcelArea : 0,
      courtyards: buildings.filter(b => b.validationFlags.courtyard).length,
      corner: buildings.filter(b => b.buildingType === 'cornerFrontage').length,
      canalFacing: buildings.filter(b => b.validationFlags.canalFacing).length,
      withPlinth: buildings.filter(b => b.validationFlags.plinth).length,
      inTransition: buildings.filter(b => b.validationFlags.inTransition).length,
      vacantByReason: vacant.reduce((acc, item) => { const key = item.reason.replace(/[0-9.]+/g, '#'); acc[key] = (acc[key] ?? 0) + 1; return acc; }, {}),
    },
  };
  result.signature = checksum(new TextEncoder().encode(JSON.stringify(buildings.map(b => [b.id, b.footprint.polygon, b.height, b.baseElevation]))));
  return result;
}

