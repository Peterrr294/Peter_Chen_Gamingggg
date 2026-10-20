import { ShapeUtils, Vector2 } from 'three';
import { CONNECTIVITY } from './networkStrategies.js';

// 05.1b-2 tunnel excavation by local reconstruction (pure data; no global boolean, no voxels).
//
// Per accepted tunnel (straight plan line P → Q from NetworkGraph, road level linear in between):
//   open cut A [u0, sA] and B [sB, u1]: a rotated rectangle of the surface (width = tube + 2 margins)
//     is removed; it is replaced by a road floor at design level, two vertical side walls, a lip
//     wall where the cut starts, and a vertical portal face with an arch-shaped notch;
//   tube [sA, sB]: an arch section lofted along the centreline; its end rings are the portal notches.
// Surface triangles crossed by a cut rectangle are replaced by T − R (exact walk: only canonical
// intersection points and rectangle corners, triangulated with earcut); fully covered ones are dropped.
// All shared boundary points are single objects, so seams weld exactly. Each tunnel adds a handle:
// the closed solid's Euler characteristic becomes 2 − 2·tunnels.

export const TUNNEL_GEOMETRY = Object.freeze({
  // Prototype geometry assumptions (A).
  width: CONNECTIVITY.tunnel.width, // 9 m tube width
  clearance: CONNECTIVITY.tunnel.clearance, // 7 m road to crown
  cutMargin: 1.5, // m each side between tube and open-cut wall
  archSegments: 12,
  portalCover: 1.0, // m of ground over the arch where the portal face is placed
  minRock: 1.0, // m of ground over every tube vertex (else the tube would daylight)
  minCutDepth: 0.2, // m; open-cut walls need ground at least this far above the road
  minTubeLength: 20, // m
  minCutLength: 2, // m
  portalGroundTolerance: 0.5, // m; road level at P and Q must meet the ground
  approachGap: 1.5, // m; on the open approach (P → cut start, cut end → Q) road and ground stay this close
  ringStep: 4, // m between tube rings
  baseClearance: 5, // m between road level and the solid's base
  boundaryMargin: 8, // m between a cut and the chunk edge
  maxGradeChange: 0.12, // reported, not enforced (approach roads come from 03.2 rules)
});

const KIND = { surface: 'surface', floor: 'floor', wall: 'wall', portal: 'portal', tube: 'tube' };

// ---------- surface helpers ----------
function makeSurface(positions, index, segments, columns) {
  const x0 = positions[0]; const z0 = positions[2];
  const spacing = positions[3] - positions[0];
  const vertexCache = new Map();
  const vertex = i => {
    if (!vertexCache.has(i)) vertexCache.set(i, { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2], src: [[i, 1]] });
    return vertexCache.get(i);
  };
  // Height on the rendered triangle mesh (PlaneGeometry layout: (a,b,d) and (b,c,d) per cell).
  const heightAt = (x, z) => {
    const gx = Math.min(segments - 1e-9, Math.max(0, (x - x0) / spacing)); const gz = Math.min(segments - 1e-9, Math.max(0, (z - z0) / spacing));
    const ix = Math.floor(gx); const iy = Math.floor(gz); const fx = gx - ix; const fz = gz - iy;
    const h = (cx, cy) => positions[(cy * columns + cx) * 3 + 1];
    if (fx + fz <= 1) return h(ix, iy) + fx * (h(ix + 1, iy) - h(ix, iy)) + fz * (h(ix, iy + 1) - h(ix, iy));
    return h(ix + 1, iy + 1) + (1 - fx) * (h(ix, iy + 1) - h(ix + 1, iy + 1)) + (1 - fz) * (h(ix + 1, iy) - h(ix + 1, iy + 1));
  };
  return { positions, index, segments, columns, spacing, x0, z0, vertex, heightAt };
}

const cross2 = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const planArea = poly => poly.reduce((sum, p, i) => { const q = poly[(i + 1) % poly.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;

// Convex polygon clip by half-plane keep(p) ≥ 0 (used only for volumes and overlap tests).
function clipHalf(poly, f) {
  const out = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const fp = f(p); const fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t }); }
  });
  return out;
}

function convexOverlap(a, b) {
  let poly = a;
  for (let i = 0; i < b.length && poly.length; i += 1) {
    const p = b[i]; const q = b[(i + 1) % b.length];
    poly = clipHalf(poly, r => cross2(p, q, r));
  }
  return poly.length >= 3 ? Math.abs(planArea(poly)) : 0;
}

// ---------- per-tunnel planning ----------
function planTunnel(surface, tunnel, rules, context) {
  const { P, Q } = tunnel;
  const L = Math.hypot(Q.x - P.x, Q.z - P.z);
  const a = { x: (Q.x - P.x) / L, z: (Q.z - P.z) / L };
  const n = { x: -a.z, z: a.x };
  const road = u => P.y + (Q.y - P.y) * u / L;
  const at = (u, v) => ({ x: P.x + a.x * u + n.x * v, z: P.z + a.z * u + n.z * v });
  const H = (u, v) => { const p = at(u, v); return surface.heightAt(p.x, p.z); };
  const W = rules.width; const hw = rules.clearance - W / 2; const Wc = W + 2 * rules.cutMargin;
  const archTop = v => hw + Math.sqrt(Math.max(0, (W / 2) ** 2 - v * v));
  const covered = (u, cover) => { for (let v = -W / 2; v <= W / 2 + 1e-9; v += 1) if (H(u, v) < road(u) + archTop(v) + cover) return false; return true; };
  const reason = text => ({ ok: false, reason: text, L });
  if (L < rules.minTubeLength + 2 * rules.minCutLength) return reason('tunnel too short for portals');
  // Portals must meet the ground: no floating or buried road ends.
  if (Math.abs(H(0, 0) - road(0)) > rules.portalGroundTolerance) return reason(`portal A road ${(road(0) - H(0, 0)).toFixed(1)} m off the ground`);
  if (Math.abs(H(L, 0) - road(L)) > rules.portalGroundTolerance) return reason(`portal B road ${(road(L) - H(L, 0)).toFixed(1)} m off the ground`);
  let sA = null; for (let u = rules.minCutLength; u <= L / 2; u += 0.5) if (covered(u, rules.portalCover)) { sA = u; break; }
  let sB = null; for (let u = L - rules.minCutLength; u >= L / 2; u -= 0.5) if (covered(u, rules.portalCover)) { sB = u; break; }
  if (sA === null || sB === null) return reason('no portal location (ground never covers the arch near a portal)');
  if (sB - sA < rules.minTubeLength) return reason(`tube ${(sB - sA).toFixed(1)} m < ${rules.minTubeLength} m`);
  for (let u = sA; u <= sB + 1e-9; u += 1) if (!covered(Math.min(u, sB), rules.minRock)) return reason(`tube would daylight at u = ${u.toFixed(1)} m (cover < ${rules.minRock} m)`);
  // Open-cut start: walk outward from the portal while the whole cut cross-section stays above the road.
  const cutOk = u => { for (let v = -Wc / 2; v <= Wc / 2 + 1e-9; v += 0.5) if (H(u, v) < road(u) + rules.minCutDepth) return false; return true; };
  let u0 = sA - rules.minCutLength;
  if (!cutOk(u0) || !cutOk(sA)) return reason('portal A cut would need fill (ground below road level)');
  for (let u = u0; u >= 0 && cutOk(u); u -= 0.5) u0 = u;
  for (let u = u0; u <= sA; u += 0.5) if (!cutOk(u)) return reason('portal A cut is not monotone');
  for (let u = 0; u <= u0; u += 0.5) if (Math.abs(H(u, 0) - road(u)) > rules.approachGap) return reason(`open approach A floats or is buried at u = ${u.toFixed(1)} m`);
  let u1 = sB + rules.minCutLength;
  if (!cutOk(u1) || !cutOk(sB)) return reason('portal B cut would need fill (ground below road level)');
  for (let u = u1; u <= L && cutOk(u); u += 0.5) u1 = u;
  for (let u = sB; u <= u1; u += 0.5) if (!cutOk(u)) return reason('portal B cut is not monotone');
  for (let u = u1; u <= L; u += 0.5) if (Math.abs(H(u, 0) - road(u)) > rules.approachGap) return reason(`open approach B floats or is buried at u = ${u.toFixed(1)} m`);
  // Water, base, chunk edge.
  const { waterMask, baseY, grid } = context;
  const cellWater = (x, z) => waterMask[Math.round((z - surface.z0) / surface.spacing) * surface.columns + Math.round((x - surface.x0) / surface.spacing)] === 1;
  for (let u = u0; u <= u1; u += 2) for (let v = -Wc / 2; v <= Wc / 2; v += 2) { const p = at(u, v); if (cellWater(p.x, p.z)) return reason('cut or tube over water'); }
  for (let u = u0; u <= u1; u += 2) if (road(u) - baseY < rules.baseClearance) return reason('road too close to the solid base');
  const rect = (ua, ub, width) => [at(ua, -width / 2), at(ub, -width / 2), at(ub, width / 2), at(ua, width / 2)];
  const cutA = rect(u0, sA, Wc); const cutB = rect(sB, u1, Wc); const tube = rect(sA, sB, W + 2);
  const half = grid.size / 2;
  for (const p of [...cutA, ...cutB]) if (Math.abs(p.x - grid.originX) > half - rules.boundaryMargin || Math.abs(p.z - grid.originZ) > half - rules.boundaryMargin) return reason('cut too close to the chunk edge');
  return { ok: true, L, a, n, road, at, H, W, hw, Wc, sA, sB, u0, u1, cutA, cutB, tube, lipA: H(u0, 0) - road(u0), lipB: H(u1, 0) - road(u1) };
}

// ---------- surface clipping: T − R by exact walk ----------
function intersectionPoint(surface, cache, ia, ib, A, B, C1, C2, key) {
  // Canonical: computed from the lower-index vertex, so both triangles sharing the edge get the same object.
  const [i, j, P0, P1] = ia < ib ? [ia, ib, A, B] : [ib, ia, B, A];
  const k = `${i}-${j}|${key}`;
  if (cache.has(k)) return cache.get(k);
  const d1 = cross2(C1, C2, P0); const d2 = cross2(C1, C2, P1);
  const t = d1 / (d1 - d2);
  const point = { x: P0.x + (P1.x - P0.x) * t, y: P0.y + (P1.y - P0.y) * t, z: P0.z + (P1.z - P0.z) * t, src: [[i, 1 - t], [j, t]] };
  cache.set(k, point);
  return point;
}

function clipTriangle(surface, tri, rect, rectKey, cache, corners) {
  // tri: [ia, ib, ic]; returns { status: 'outside'|'inside'|'partial', polygons, insidePoly }
  let ids = tri;
  let V = ids.map(i => surface.vertex(i));
  if (planArea(V) < 0) { ids = [ids[0], ids[2], ids[1]]; V = ids.map(i => surface.vertex(i)); }
  const R = rect; // CCW in plan (positive area)
  const insideR = p => R.every((c, s) => cross2(c, R[(s + 1) % 4], p) > 0);
  const vin = V.map(insideR);
  // Intersections along each triangle edge.
  const events = [];
  const bySide = [[], [], [], []];
  for (let e = 0; e < 3; e += 1) {
    const A = V[e]; const B = V[(e + 1) % 3];
    const hits = [];
    for (let s = 0; s < 4; s += 1) {
      const C1 = R[s]; const C2 = R[(s + 1) % 4];
      const dA = cross2(C1, C2, A); const dB = cross2(C1, C2, B);
      if ((dA > 0) === (dB > 0) || dA === 0 || dB === 0) continue;
      const tE = dA / (dA - dB);
      const ex = { x: A.x + (B.x - A.x) * tE, z: A.z + (B.z - A.z) * tE };
      const lenS = Math.hypot(C2.x - C1.x, C2.z - C1.z);
      const sS = ((ex.x - C1.x) * (C2.x - C1.x) + (ex.z - C1.z) * (C2.z - C1.z)) / (lenS * lenS);
      if (sS <= 0 || sS >= 1) continue;
      const point = intersectionPoint(surface, cache, ids[e], ids[(e + 1) % 3], A, B, C1, C2, `${rectKey}:${s}`);
      hits.push({ point, t: tE, side: s, s: sS });
    }
    hits.sort((p, q) => p.t - q.t);
    events.push({ kind: 'vertex', point: V[e], inside: vin[e] });
    hits.forEach(hit => { const event = { kind: 'cross', ...hit }; events.push(event); bySide[hit.side].push(event); });
  }
  const crossings = events.filter(event => event.kind === 'cross');
  const insideCorners = R.map((c, s) => ({ c, s, inT: [0, 1, 2].every(e => cross2(V[e], V[(e + 1) % 3], c) > 0) }));
  if (!crossings.length && !insideCorners.some(c => c.inT)) {
    return { status: vin.every(Boolean) ? 'inside' : 'outside' };
  }
  // Label crossings along the T boundary: entering R or leaving R.
  let state = vin[0];
  for (const event of events) {
    if (event.kind === 'vertex') { state = event.inside; continue; }
    event.entering = !state;
    state = !state;
  }
  bySide.forEach(list => list.sort((p, q) => p.s - q.s));
  // Walk outside polygons.
  const n = events.length;
  const used = new Set();
  const polygons = [];
  const startCandidates = events.map((event, i) => ({ event, i })).filter(({ event }) => (event.kind === 'vertex' && !event.inside) || (event.kind === 'cross' && !event.entering));
  for (const { i: start } of startCandidates) {
    if (used.has(start)) continue;
    const poly = [];
    let i = start;
    let guard = 0;
    for (;;) {
      if (guard++ > 200) return { status: 'error' };
      const event = events[i];
      used.add(i);
      poly.push(event.point);
      if (event.kind === 'cross' && event.entering) {
        // Follow R backwards (inside T) to the next crossing.
        let side = event.side; let s = event.s;
        let exit = null;
        for (let step = 0; step < 5 && !exit; step += 1) {
          const candidates = bySide[side].filter(item => item.s < s - 1e-12);
          if (candidates.length) { exit = candidates[candidates.length - 1]; break; }
          const corner = insideCorners[side];
          if (!corner.inT) return { status: 'error' };
          poly.push(corners[side]);
          side = (side + 3) % 4; s = 1 + 1e-9;
        }
        if (!exit) return { status: 'error' };
        i = events.indexOf(exit);
        if (i === start) break;
        continue;
      }
      i = (i + 1) % n;
      if (i === start) break;
    }
    polygons.push(poly);
  }
  // T ∩ R (for the excavated volume), by convex clipping.
  let insidePoly = V.map(p => ({ ...p }));
  for (let s = 0; s < 4; s += 1) { const C1 = R[s]; const C2 = R[(s + 1) % 4]; insidePoly = clipHalf(insidePoly, p => cross2(C1, C2, p)); }
  return { status: 'partial', polygons, insidePoly };
}

function triangulate(poly) {
  const contour = poly.map(p => new Vector2(p.x, p.z));
  const faces = ShapeUtils.triangulateShape(contour, []);
  return faces.map(([i, j, k]) => [poly[i], poly[j], poly[k]]);
}

// Barycentric height (and colour source) of a point inside surface triangle tri.
function pointInTriangle(surface, tri, x, z) {
  const [A, B, C] = tri.map(i => surface.vertex(i));
  const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
  const wa = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / d;
  const wb = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / d;
  const wc = 1 - wa - wb;
  return { x, z, y: wa * A.y + wb * B.y + wc * C.y, src: [[tri[0], wa], [tri[1], wb], [tri[2], wc]], weights: [wa, wb, wc] };
}

// ---------- main entry ----------
export function buildTunnelGeometry({ positions, index, segments, columns, grid, waterMask, baseY, tunnels, obstacles = {}, maxTunnels = CONNECTIVITY.tunnel.maxPerChunk }) {
  const rules = TUNNEL_GEOMETRY;
  const surface = makeSurface(positions, index, segments, columns);
  const accepted = [];
  const records = [];
  for (const tunnel of tunnels) {
    const record = { id: tunnel.id, planLength: Math.hypot(tunnel.Q.x - tunnel.P.x, tunnel.Q.z - tunnel.P.z) };
    if (accepted.length >= maxTunnels) { records.push({ ...record, status: 'rejected', reason: `tunnel limit ${maxTunnels} per chunk reached` }); continue; }
    const plan = planTunnel(surface, tunnel, rules, { waterMask, baseY, grid });
    if (!plan.ok) { records.push({ ...record, status: 'rejected', reason: plan.reason }); continue; }
    const ccw = r => (planArea(r) > 0 ? r : [...r].reverse());
    const footprints = [plan.cutA, plan.cutB, plan.tube].map(ccw);
    const clash = accepted.find(other => [other.plan.cutA, other.plan.cutB, other.plan.tube].map(ccw).some(fp => footprints.some(own => convexOverlap(own, fp) > 0)));
    if (clash) { records.push({ ...record, status: 'rejected', reason: `intersects tunnel ${clash.tunnel.id}` }); continue; }
    // obstacles.roads: [{ edgeId, quad }] road corridor quads (CCW or CW) of surface roads not attached to this tunnel.
    const roadHit = (obstacles.roads ?? []).find(road => [plan.cutA, plan.cutB].some(cut => convexOverlap(cut, planArea(road.quad) > 0 ? road.quad : [...road.quad].reverse()) > 0));
    if (roadHit) { records.push({ ...record, status: 'rejected', reason: `open cut crosses surface road edge ${roadHit.edgeId}` }); continue; }
    const buildingHit = (obstacles.buildings ?? []).find(b => [plan.cutA, plan.cutB].map(ccw).some(cut => b.polygon.some(p => cut.every((c, s) => cross2(c, cut[(s + 1) % 4], p) > 0))));
    if (buildingHit) { records.push({ ...record, status: 'rejected', reason: `open cut under building ${buildingHit.id}` }); continue; }
    accepted.push({ tunnel, plan });
    records.push({ ...record, status: 'accepted', sA: plan.sA, sB: plan.sB, u0: plan.u0, u1: plan.u1, tubeLength: plan.sB - plan.sA, cutLengths: [plan.sA - plan.u0, plan.u1 - plan.sB], grade: (tunnel.Q.y - tunnel.P.y) / record.planLength, lipHeights: [plan.lipA, plan.lipB] });
  }

  // Cut rectangles (CCW) with canonical corner points (height from the surface triangle).
  const cuts = [];
  accepted.forEach(({ plan }, t) => {
    for (const [which, rect] of [['A', plan.cutA], ['B', plan.cutB]]) {
      const ccw = planArea(rect) > 0 ? rect : [rect[0], rect[3], rect[2], rect[1]];
      cuts.push({ key: `${t}${which}`, tunnelIndex: t, which, rect: ccw, minX: Math.min(...ccw.map(p => p.x)), maxX: Math.max(...ccw.map(p => p.x)), minZ: Math.min(...ccw.map(p => p.z)), maxZ: Math.max(...ccw.map(p => p.z)), corners: [] });
    }
  });
  const removed = new Uint8Array(index.length / 3);
  const rim = [];
  const cache = new Map();
  const trenchVolume = accepted.map(() => 0);
  const errors = [];
  const triangleAt = (x, z) => {
    const gx = (x - surface.x0) / surface.spacing; const gz = (z - surface.z0) / surface.spacing;
    const ix = Math.floor(gx); const iy = Math.floor(gz); const fx = gx - ix; const fz = gz - iy;
    const t = (iy * segments + ix) * 2 + (fx + fz <= 1 ? 0 : 1);
    return [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
  };
  for (const cut of cuts) cut.corners = cut.rect.map(c => pointInTriangle(surface, triangleAt(c.x, c.z), c.x, c.z));
  for (let t = 0; t < index.length / 3; t += 1) {
    const tri = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    const xs = tri.map(i => positions[i * 3]); const zs = tri.map(i => positions[i * 3 + 2]);
    const cut = cuts.find(c => Math.max(...xs) >= c.minX && Math.min(...xs) <= c.maxX && Math.max(...zs) >= c.minZ && Math.min(...zs) <= c.maxZ);
    if (!cut) continue;
    const result = clipTriangle(surface, tri, cut.rect, cut.key, cache, cut.corners);
    if (result.status === 'outside') continue;
    removed[t] = 1;
    const plan = accepted[cut.tunnelIndex].plan;
    const roadAt = p => plan.road(((p.x - plan.at(0, 0).x) * plan.a.x + (p.z - plan.at(0, 0).z) * plan.a.z));
    const addVolume = poly => {
      if (poly.length < 3) return;
      const area = Math.abs(planArea(poly));
      let cx = 0; let cz = 0; let cy = 0; let w = 0;
      for (let i = 1; i < poly.length - 1; i += 1) {
        const tri3 = [poly[0], poly[i], poly[i + 1]];
        const ta = Math.abs(planArea(tri3));
        cx += ta * (tri3[0].x + tri3[1].x + tri3[2].x) / 3; cz += ta * (tri3[0].z + tri3[1].z + tri3[2].z) / 3; cy += ta * (tri3[0].y + tri3[1].y + tri3[2].y) / 3; w += ta;
      }
      trenchVolume[cut.tunnelIndex] += area * (cy / w - roadAt({ x: cx / w, z: cz / w }));
    };
    if (result.status === 'inside') { addVolume(tri.map(i => surface.vertex(i))); continue; }
    if (result.status === 'error') { errors.push(`clip failed at triangle ${t}`); removed[t] = 0; continue; }
    addVolume(result.insidePoly);
    for (const poly of result.polygons) {
      const faces = triangulate(poly);
      if (faces.length !== poly.length - 2) errors.push(`earcut dropped points at triangle ${t}`);
      // +y normal ⇔ negative plan area in (x, z).
      faces.forEach(face => rim.push(planArea(face) < 0 ? face : [face[0], face[2], face[1]]));
    }
  }

  // Hole boundary points per cut side, sorted along the side.
  const boundary = cut => {
    const sides = [[], [], [], []];
    for (const [k, point] of cache) {
      if (!k.includes(`|${cut.key}:`)) continue;
      const s = Number(k.split(':').pop());
      const C1 = cut.rect[s]; const C2 = cut.rect[(s + 1) % 4];
      const len2 = (C2.x - C1.x) ** 2 + (C2.z - C1.z) ** 2;
      sides[s].push({ point, s: ((point.x - C1.x) * (C2.x - C1.x) + (point.z - C1.z) * (C2.z - C1.z)) / len2 });
    }
    return sides.map((list, s) => [cut.corners[s], ...list.sort((p, q) => p.s - q.s).map(item => item.point), cut.corners[(s + 1) % 4]]);
  };

  // Patch geometry per accepted tunnel.
  const patch = [];
  const tubeVolume = [];
  const profileOf = plan => {
    const pts = [{ v: -plan.W / 2, y: 0 }, { v: -plan.W / 2, y: plan.hw }];
    for (let k = 1; k < rules.archSegments; k += 1) { const angle = Math.PI - Math.PI * k / rules.archSegments; pts.push({ v: (plan.W / 2) * Math.cos(angle), y: plan.hw + (plan.W / 2) * Math.sin(angle) }); }
    pts.push({ v: plan.W / 2, y: plan.hw }, { v: plan.W / 2, y: 0 });
    return pts; // open chain from (−W/2, 0) over the arch to (W/2, 0); the floor closes it
  };
  const push = (a, b, c, kind, expected) => {
    const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z; const vx = c.x - a.x; const vy = c.y - a.y; const vz = c.z - a.z;
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const dot = nx * expected.x + ny * expected.y + nz * expected.z;
    patch.push(dot >= 0 ? [a, b, c, kind] : [a, c, b, kind]);
  };
  accepted.forEach(({ plan }, t) => {
    const profile = profileOf(plan);
    let profileArea = 0;
    const closed = [...profile];
    closed.forEach((p, i) => { const q = closed[(i + 1) % closed.length]; profileArea += p.v * q.y - q.v * p.y; });
    profileArea = Math.abs(profileArea) / 2;
    tubeVolume.push(profileArea * (plan.sB - plan.sA));
    const P3 = (u, v, y) => { const p = plan.at(u, v); return { x: p.x, y, z: p.z }; };
    // Tube rings (shared by both portals' notches).
    const stations = [plan.sA];
    const count = Math.max(1, Math.round((plan.sB - plan.sA) / rules.ringStep));
    for (let k = 1; k < count; k += 1) stations.push(plan.sA + (plan.sB - plan.sA) * k / count);
    stations.push(plan.sB);
    const rings = stations.map(u => profile.map(p => P3(u, p.v, plan.road(u) + p.y)));
    for (let r = 0; r < rings.length - 1; r += 1) {
      const A = rings[r]; const B = rings[r + 1];
      const centre = u => P3(u, 0, plan.road(u) + rules.clearance / 2);
      for (let i = 0; i < A.length; i += 1) {
        const j = (i + 1) % A.length; // last segment (W/2,0)→(−W/2,0) is the tube floor
        const mid = { x: (A[i].x + B[j].x) / 2, y: (A[i].y + B[j].y) / 2, z: (A[i].z + B[j].z) / 2 };
        const c = centre((stations[r] + stations[r + 1]) / 2);
        const expected = { x: c.x - mid.x, y: c.y - mid.y, z: c.z - mid.z }; // tube faces point into the cavity
        const kind = j === 0 ? KIND.floor : KIND.tube;
        push(A[i], B[i], B[j], kind, expected);
        push(A[i], B[j], A[j], kind, expected);
      }
    }
    // Open cuts: A (portal at sA, faces −u) and B (portal at sB, faces +u).
    for (const which of ['A', 'B']) {
      const cut = cuts.find(c => c.tunnelIndex === t && c.which === which);
      const sides = boundary(cut);
      const ring = which === 'A' ? rings[0] : rings[rings.length - 1];
      const sPortal = which === 'A' ? plan.sA : plan.sB;
      const uOf = p => (p.x - plan.at(0, 0).x) * plan.a.x + (p.z - plan.at(0, 0).z) * plan.a.z;
      const vOf = p => (p.x - plan.at(0, 0).x) * plan.n.x + (p.z - plan.at(0, 0).z) * plan.n.z;
      const bottoms = new Map();
      const bottom = p => { if (!bottoms.has(p)) bottoms.set(p, { x: p.x, y: plan.road(uOf(p)), z: p.z }); return bottoms.get(p); };
      // Identify which rectangle side is the portal side (u = sPortal) and which is the lip (the other u end).
      const sideU = sides.map(list => (uOf(list[0]) + uOf(list[list.length - 1])) / 2);
      const sideIsU = sides.map(list => Math.abs(uOf(list[0]) - uOf(list[list.length - 1])) < 1e-6);
      const portalSide = sides.findIndex((list, s) => sideIsU[s] && Math.abs(sideU[s] - sPortal) < 1e-6);
      const centreXZ = plan.at((uOf(cut.rect[0]) + uOf(cut.rect[2])) / 2, 0);
      // Walls (side and lip): vertical strips from the hole boundary down to road level, facing into the cut.
      sides.forEach((list, s) => {
        if (s === portalSide) return;
        for (let i = 0; i < list.length - 1; i += 1) {
          const top0 = list[i]; const top1 = list[i + 1];
          const b0 = bottom(top0); const b1 = bottom(top1);
          const mid = { x: (top0.x + top1.x) / 2, z: (top0.z + top1.z) / 2 };
          const expected = { x: centreXZ.x - mid.x, y: 0, z: centreXZ.z - mid.z };
          push(top0, b0, b1, KIND.wall, expected);
          push(top0, b1, top1, KIND.wall, expected);
        }
      });
      // Portal face: v-monotone zipper between the top profile and road-level + arch-notch chain.
      const top = sides[portalSide];
      const leftTop = top[0]; const rightTop = top[top.length - 1];
      const notch = ring; // ring order runs from v = −W/2 over the arch to +W/2
      const lowCorner = vOf(leftTop) < vOf(rightTop) ? [bottom(leftTop), bottom(rightTop)] : [bottom(rightTop), bottom(leftTop)];
      const bottomChain = [lowCorner[0], ...notch, lowCorner[1]];
      const topChain = vOf(leftTop) < vOf(rightTop) ? top : [...top].reverse();
      const facing = which === 'A' ? -1 : 1;
      const expected = { x: plan.a.x * facing, y: 0, z: plan.a.z * facing };
      // The face is a simple polygon (top profile, corners, arch notch); earcut keeps triangles inside it.
      // (A zipper between the chains folds where chords from sparse top points dip under the arch dome.)
      const loop = [...topChain, ...[...bottomChain].reverse()];
      const faces = ShapeUtils.triangulateShape(loop.map(p => new Vector2(vOf(p), p.y)), []);
      if (faces.length !== loop.length - 2) errors.push(`portal ${which} of tunnel ${t}: earcut returned ${faces.length} of ${loop.length - 2} triangles`);
      faces.forEach(([i, j, k]) => push(loop[i], loop[j], loop[k], KIND.portal, expected));
      // Floor: centroid fan over all road-level boundary points (portal side: corners + tube floor ends).
      const floorLoop = [];
      sides.forEach((list, s) => {
        if (s === portalSide) {
          const pts = [bottom(list[0]), ...(vOf(list[0]) < vOf(list[list.length - 1]) ? [ring[0], ring[ring.length - 1]] : [ring[ring.length - 1], ring[0]])];
          floorLoop.push(...pts);
        } else list.slice(0, -1).forEach(p => floorLoop.push(bottom(p)));
      });
      const cu = floorLoop.reduce((sum, p) => sum + uOf(p), 0) / floorLoop.length;
      const cv = floorLoop.reduce((sum, p) => sum + vOf(p), 0) / floorLoop.length;
      const centre = P3(cu, cv, plan.road(cu));
      for (let k = 0; k < floorLoop.length; k += 1) push(centre, floorLoop[k], floorLoop[(k + 1) % floorLoop.length], KIND.floor, { x: 0, y: 1, z: 0 });
    }
  });

  return {
    accepted: accepted.map(({ tunnel }) => tunnel.id),
    records,
    removed,
    rim,
    patch,
    volumes: { trench: trenchVolume, tube: tubeVolume },
    errors,
    rules,
  };
}

// Flatten point-object triangles into positions / indices (points shared by identity).
export function trianglesToMesh(triangles) {
  const ids = new Map();
  const positions = [];
  const indices = [];
  for (const triangle of triangles) {
    for (let k = 0; k < 3; k += 1) {
      const p = triangle[k];
      if (!ids.has(p)) { ids.set(p, positions.length / 3); positions.push(p.x, p.y, p.z); }
      indices.push(ids.get(p));
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
