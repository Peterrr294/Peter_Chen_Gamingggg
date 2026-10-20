import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4202;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/05-1b2-tunnel-portals.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/05-1b2-tunnel-xray.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/tunnel-excavation.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };

async function browserPath() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found.');
}

async function startServer() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready(`${base}${entry}`)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  const open = async query => {
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 180000 });
  };
  const earlier = JSON.parse(await readFile(path.join(root, 'experiments/seed-terrain/evidence/solid-terrain.json'), 'utf8'));

  // In-page geometry inspection of the rendered solid and tunnel patch.
  const inspect = () => page.evaluate(async () => {
    const { TUNNEL_GEOMETRY } = await import('/experiments/seed-terrain/TunnelGeometry.js');
    const lab = window.__seedTerrainLab;
    const solid = lab.solid();
    const tunnels = lab.tunnels();
    const graph = lab.network();
    const fields = lab.fields();
    const scene = window.__seedTerrainScene;
    const view = scene.view;
    const tris = [];
    const addMesh = (geometry, kind) => {
      if (!geometry) return;
      const p = geometry.attributes.position.array;
      const idx = geometry.index ? geometry.index.array : null;
      const count = idx ? idx.length : p.length / 3;
      for (let i = 0; i < count; i += 3) {
        const v = [0, 1, 2].map(k => { const j = idx ? idx[i + k] : i + k; return { x: p[j * 3], y: p[j * 3 + 1], z: p[j * 3 + 2] }; });
        tris.push({ v, kind });
      }
    };
    addMesh(view.terrain.geometry, 'surface'); addMesh(view.rim.geometry, 'rim'); addMesh(view.shell.geometry, 'shell'); addMesh(view.tunnelMesh.geometry, 'patch');
    // Segment–triangle intersection (Möller–Trumbore on the segment).
    const hits = (a, b, t) => {
      const [p0, p1, p2] = t.v;
      const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z;
      const e1 = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z]; const e2 = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
      const h = [dy * e2[2] - dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1] - dy * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-12) return false;
      const f = 1 / det; const s = [a.x - p0.x, a.y - p0.y, a.z - p0.z];
      const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 1e-9 || u > 1 - 1e-9) return false;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const w = f * (dx * q[0] + dy * q[1] + dz * q[2]); if (w < 1e-9 || u + w > 1 - 1e-9) return false;
      const tt = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
      return tt > 1e-9 && tt < 1 - 1e-9;
    };
    const segmentBlocked = (a, b) => tris.some(t => {
      const xs = t.v.map(p => p.x); const zs = t.v.map(p => p.z); const ys = t.v.map(p => p.y);
      if (Math.max(...xs) < Math.min(a.x, b.x) || Math.min(...xs) > Math.max(a.x, b.x) || Math.max(...zs) < Math.min(a.z, b.z) || Math.min(...zs) > Math.max(a.z, b.z) || Math.max(...ys) < Math.min(a.y, b.y) || Math.min(...ys) > Math.max(a.y, b.y)) return false;
      return hits(a, b, t);
    });
    const records = [];
    for (const record of tunnels.records.filter(item => item.status === 'accepted')) {
      const edge = graph.edges.find(item => item.id === record.id);
      const [P, Q] = edge.tunnel.portals;
      const L = Math.hypot(Q.x - P.x, Q.z - P.z);
      const a = { x: (Q.x - P.x) / L, z: (Q.z - P.z) / L }; const n = { x: -a.z, z: a.x };
      const road = u => P.y + (Q.y - P.y) * u / L;
      const pt = (u, v, dy) => ({ x: P.x + a.x * u + n.x * v, y: road(u) + dy, z: P.z + a.z * u + n.z * v });
      const W = TUNNEL_GEOMETRY.width;
      // Through-passage rays (centre at half clearance, and near both walls at 1.5 m).
      const rays = [[0, TUNNEL_GEOMETRY.clearance / 2], [-(W / 2 - 1), 1.5], [W / 2 - 1, 1.5]].map(([v, dy]) => segmentBlocked(pt(record.u0 + 0.5, v, dy), pt(record.u1 - 0.5, v, dy)));
      // Floor at design level; tube height / width; cover over tube vertices.
      const patch = view.tunnelData.patch;
      let floorError = 0; let maxRise = 0; let minCover = Infinity; let maxHalfWidth = 0;
      const surfaceAt = (x, z) => {
        const { segments, columns, spacing } = fields.grid; const p = view.terrain.geometry.attributes.position.array;
        const gx = (x - p[0]) / spacing; const gz = (z - p[2]) / spacing; const ix = Math.floor(gx); const iy = Math.floor(gz); const fx = gx - ix; const fz = gz - iy;
        const h = (cx, cy) => p[(cy * columns + cx) * 3 + 1];
        return fx + fz <= 1 ? h(ix, iy) + fx * (h(ix + 1, iy) - h(ix, iy)) + fz * (h(ix, iy + 1) - h(ix, iy)) : h(ix + 1, iy + 1) + (1 - fx) * (h(ix, iy + 1) - h(ix + 1, iy + 1)) + (1 - fz) * (h(ix + 1, iy) - h(ix + 1, iy + 1));
      };
      for (const [p0, p1, p2, kind] of patch) for (const p of [p0, p1, p2]) {
        const u = (p.x - P.x) * a.x + (p.z - P.z) * a.z; const v = (p.x - P.x) * n.x + (p.z - P.z) * n.z;
        if (u < record.u0 - 1 || u > record.u1 + 1 || Math.abs(v) > W) continue;
        if (kind === 'floor') floorError = Math.max(floorError, Math.abs(p.y - road(u)));
        if (kind === 'tube') {
          maxRise = Math.max(maxRise, p.y - road(u)); maxHalfWidth = Math.max(maxHalfWidth, Math.abs(v));
          if (u > record.sA + 0.5 && u < record.sB - 0.5) minCover = Math.min(minCover, surfaceAt(p.x, p.z) - p.y);
        }
      }
      // Portal continuity with the approach roads: grade change at both tunnel nodes.
      const grade = (Q.y - P.y) / L;
      // At each portal node: |tunnel grade going inward + approach-road grade going outward|.
      const gradeChanges = [edge.from, edge.to].flatMap(node => graph.edges.filter(other => other !== edge && other.kind === 'road' && (other.from === node || other.to === node)).map(other => {
        const pts = other.from === node ? other.points : [...other.points].reverse();
        const run = Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z) || 1;
        const outward = (pts[1].y - pts[0].y) / run;
        const inward = node === edge.from ? grade : -grade;
        return Math.abs(inward + outward);
      }));
      // Patch triangles must not cross surface / rim triangles except along shared edges (edge-vs-triangle).
      let crossings = 0;
      const local = tris.filter(t => (t.kind === 'surface' || t.kind === 'rim') && t.v.some(p => { const u = (p.x - P.x) * a.x + (p.z - P.z) * a.z; const v = (p.x - P.x) * n.x + (p.z - P.z) * n.z; return u > record.u0 - 6 && u < record.u1 + 6 && Math.abs(v) < W; }));
      const patchTris = tris.filter(t => t.kind === 'patch');
      const same = (p, q) => p.x === q.x && p.y === q.y && p.z === q.z;
      for (const t of patchTris) for (let e = 0; e < 3; e += 1) {
        const p = t.v[e]; const q = t.v[(e + 1) % 3];
        for (const s of local) { if (s.v.some(x => same(x, p) || same(x, q))) continue; if (hits(p, q, s)) { crossings += 1; break; } }
      }
      for (const s of local) for (let e = 0; e < 3; e += 1) {
        const p = s.v[e]; const q = s.v[(e + 1) % 3];
        for (const t of patchTris) { if (t.v.some(x => same(x, p) || same(x, q))) continue; if (hits(p, q, t)) { crossings += 1; break; } }
      }
      records.push({ id: record.id, tubeLength: record.tubeLength, cutLengths: record.cutLengths, lipHeights: record.lipHeights, grade, raysBlocked: rays, floorError, clearance: maxRise, halfWidth: maxHalfWidth, minCover, maxGradeChange: Math.max(0, ...gradeChanges), crossings, P, Q, sA: record.sA, sB: record.sB, a });
    }
    return { solid, tunnels: { accepted: tunnels.accepted, records: tunnels.records, errors: tunnels.errors }, records };
  });

  const runs = [];
  // A: no tunnel → identical to 05.1b-1 where available.
  for (const [landform, seed, dna] of [['plain', 1101, 'manhattanGrid'], ['mountain', 2202, 'manhattanGrid']]) {
    await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
    const data = await inspect();
    const s = data.solid;
    assert(data.tunnels.accepted.length === 0 && s.watertight && s.eulerCharacteristic === 2 && s.vertices === 67074 && s.faces === 134144, `A ${landform} ${seed}: solid changed without tunnels.`);
    const old = earlier.runs.find(run => run.landform === landform && run.seed === seed && run.variation === 0.5);
    if (old) assert(old.solid.shellHash === s.shellHash && old.solid.signedVolume === s.signedVolume, `A ${landform} ${seed}: differs from 05.1b-1.`);
    runs.push({ case: 'A no tunnel', landform, seed, dna, solid: s, comparedWith051b1: Boolean(old) });
  }
  // B: real tunnels.
  for (const [landform, seed, dna] of [['mountain', 3303, 'manhattanGrid'], ['mountain', 1101, 'fezOrganicCore'], ['mountain', 3303, 'fezOrganicCore']]) {
    const id = `B ${landform} ${seed} ${dna}`;
    await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
    const data = await inspect();
    await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
    const repeat = await inspect();
    const s = data.solid;
    assert(JSON.stringify(data.solid) === JSON.stringify(repeat.solid), `${id}: not reproducible.`);
    assert(data.tunnels.accepted.length === 1 && data.tunnels.errors.length === 0, `${id}: expected one built tunnel, errors ${data.tunnels.errors}.`);
    assert(s.watertight && s.openEdges === 0 && s.nonManifoldEdges === 0 && s.inconsistentEdges === 0 && s.degenerateFaces === 0 && s.duplicateFaces === 0, `${id}: solid not a clean closed manifold.`);
    assert(s.eulerCharacteristic === s.expectedEuler && s.volumeRelativeError < 1e-9, `${id}: Euler ${s.eulerCharacteristic} / volume error ${s.volumeRelativeError}.`);
    for (const r of data.records) {
      assert(r.raysBlocked.every(blocked => !blocked), `${id}: passage blocked ${JSON.stringify(r.raysBlocked)}.`);
      assert(r.floorError < 1e-3 && Math.abs(r.clearance - 7) < 1e-3 && Math.abs(r.halfWidth - 4.5) < 1e-3, `${id}: floor / clearance / width wrong.`);
      assert(r.minCover >= 1 - 1e-6, `${id}: tube cover ${r.minCover}.`);
      assert(r.crossings === 0, `${id}: ${r.crossings} patch / surface crossings.`);
    }
    runs.push({ case: 'B tunnel', landform, seed, dna, solid: s, records: data.records.map(({ P, Q, a, ...rest }) => rest) });
  }
  // C and D: candidates fed directly to the geometry module on real terrain.
  await open('landform=mountain&seed=3303&dna=manhattanGrid');
  const synthetic = await page.evaluate(async () => {
    const { buildTunnelGeometry, trianglesToMesh } = await import('/experiments/seed-terrain/TunnelGeometry.js');
    const { checkClosedMesh, buildShell } = await import('/experiments/seed-terrain/TerrainShell.js');
    const lab = window.__seedTerrainLab; const view = window.__seedTerrainScene.view;
    const fields = lab.fields(); const graph = lab.network();
    const surface = view.terrain.geometry;
    const base = { positions: surface.attributes.position.array, index: view.fullIndex, segments: fields.grid.segments, columns: fields.grid.columns, grid: fields.grid, waterMask: fields.waterMask, baseY: view.shellData.baseY };
    const real = graph.edges.find(edge => edge.kind === 'tunnel');
    const [P, Q] = real.tunnel.portals;
    const L = Math.hypot(Q.x - P.x, Q.z - P.z); const n = { x: -(Q.z - P.z) / L, z: (Q.x - P.x) / L };
    // Synthetic endpoints sit on the rendered surface (portals must meet the ground).
    const pos = surface.attributes.position.array; const cols = fields.grid.columns;
    const ground = (x, z) => { const gx = (x - pos[0]) / 4; const gz = (z - pos[2]) / 4; const ix = Math.floor(gx); const iy = Math.floor(gz); const fx = gx - ix; const fz = gz - iy; const hh = (cx, cy) => pos[(cy * cols + cx) * 3 + 1]; return fx + fz <= 1 ? hh(ix, iy) + fx * (hh(ix + 1, iy) - hh(ix, iy)) + fz * (hh(ix, iy + 1) - hh(ix, iy)) : hh(ix + 1, iy + 1) + (1 - fx) * (hh(ix, iy + 1) - hh(ix + 1, iy + 1)) + (1 - fz) * (hh(ix + 1, iy) - hh(ix + 1, iy + 1)); };
    const onGround = p => ({ ...p, y: ground(p.x, p.z) });
    const shift = (p, d) => onGround({ x: p.x + n.x * d, z: p.z + n.z * d });
    const mid = { x: (P.x + Q.x) / 2, z: (P.z + Q.z) / 2 };
    const rot = (p, angle) => onGround({ x: mid.x + (p.x - mid.x) * Math.cos(angle) - (p.z - mid.z) * Math.sin(angle), z: mid.z + (p.x - mid.x) * Math.sin(angle) + (p.z - mid.z) * Math.cos(angle) });
    const close = data => {
      const kept = []; for (let t = 0; t < base.index.length / 3; t += 1) if (!data.removed[t]) kept.push(base.index[t * 3], base.index[t * 3 + 1], base.index[t * 3 + 2]);
      const shell = buildShell(base.positions, base.index, base.baseY);
      return checkClosedMesh([{ positions: base.positions, indices: new Uint32Array(kept) }, shell, trianglesToMesh(data.rim), trianglesToMesh(data.patch.map(t => t.slice(0, 3)))]);
    };
    const multi = buildTunnelGeometry({ ...base, tunnels: [{ id: 'real', P, Q }, { id: 'shifted+4m', P: shift(P, 4), Q: shift(Q, 4) }, { id: 'crossing60', P: rot(P, Math.PI / 3), Q: rot(Q, Math.PI / 3) }] });
    const limit = buildTunnelGeometry({ ...base, tunnels: [{ id: 'real', P, Q }], maxTunnels: 0 });
    const raised = buildTunnelGeometry({ ...base, tunnels: [{ id: 'raised+20m', P: { ...P, y: P.y + 20 }, Q: { ...Q, y: Q.y + 20 } }] });
    return {
      multi: { accepted: multi.accepted, records: multi.records.map(r => ({ id: r.id, status: r.status, reason: r.reason })), check: close(multi) },
      limit: limit.records.map(r => ({ id: r.id, status: r.status, reason: r.reason })),
      raised: { records: raised.records.map(r => ({ id: r.id, status: r.status, reason: r.reason })), removed: raised.removed.reduce((s, x) => s + x, 0), patch: raised.patch.length },
    };
  });
  // Only one may be built; at least one rejection must come from the intersection test.
  assert(synthetic.multi.accepted.length === 1 && synthetic.multi.records.filter(r => r.status === 'rejected').length === 2 && synthetic.multi.records.some(r => r.reason?.startsWith('intersects tunnel')), `C multi: ${JSON.stringify(synthetic.multi.records)}`);
  assert(synthetic.multi.check.watertight && synthetic.multi.check.eulerCharacteristic === 0, 'C multi: solid not closed.');
  assert(synthetic.limit.every(r => r.status === 'rejected' && r.reason.includes('limit')), 'C limit not enforced.');
  assert(synthetic.raised.records.every(r => r.status === 'rejected') && synthetic.raised.removed === 0 && synthetic.raised.patch === 0, `D raised: ${JSON.stringify(synthetic.raised)}`);
  // D: shallow tunnel on the plain, and a tunnel over sea water on the coast.
  const illegal = [];
  for (const [landform, seed, make] of [['plain', 1101, 'plain'], ['coast', 1101, 'water']]) {
    await open(`landform=${landform}&seed=${seed}&dna=manhattanGrid`);
    illegal.push(await page.evaluate(async kind => {
      const { buildTunnelGeometry } = await import('/experiments/seed-terrain/TunnelGeometry.js');
      const lab = window.__seedTerrainLab; const view = window.__seedTerrainScene.view; const fields = lab.fields();
      const surface = view.terrain.geometry; const p = surface.attributes.position.array;
      const h = (x, z) => p[(Math.round((z + 512) / 4) * fields.grid.columns + Math.round((x + 512) / 4)) * 3 + 1];
      let P; let Q;
      if (kind === 'plain') { P = { x: -150, z: 0, y: h(-150, 0) }; Q = { x: 150, z: 0, y: h(150, 0) }; }
      else {
        // A line from land into the sea: pick the first water sample and a land sample 300 m away along x.
        let water = null; for (let i = 0; i < fields.waterMask.length && !water; i += 1) if (fields.waterMask[i]) { const x = (i % fields.grid.columns) * 4 - 512; const z = Math.floor(i / fields.grid.columns) * 4 - 512; if (Math.abs(x) < 300 && Math.abs(z) < 300) water = { x, z }; }
        P = { x: water.x, z: water.z, y: 0 }; Q = { x: water.x + (water.x < 0 ? 300 : -300), z: water.z, y: 0 };
      }
      const data = buildTunnelGeometry({ positions: p, index: view.fullIndex, segments: fields.grid.segments, columns: fields.grid.columns, grid: fields.grid, waterMask: fields.waterMask, baseY: view.shellData.baseY, tunnels: [{ id: kind, P, Q }] });
      return { kind, records: data.records.map(r => ({ status: r.status, reason: r.reason })), removed: data.removed.reduce((s, x) => s + x, 0), patch: data.patch.length };
    }, make));
  }
  assert(illegal.every(item => item.records.every(r => r.status === 'rejected') && item.removed === 0 && item.patch === 0), `D illegal: ${JSON.stringify(illegal)}`);
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: (1) portal close-ups (real openings); (2) x-ray of the whole tunnel.
  const capture = async query => { await open(query); await page.waitForTimeout(600); return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64'); };
  const composite = async (tiles, file, columns) => {
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(${columns},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const tunnelRuns = runs.filter(run => run.case === 'B tunnel');
  const overall = [];
  for (const run of tunnelRuns.slice(0, 2)) {
    await open(`landform=${run.landform}&seed=${run.seed}&dna=${run.dna}`);
    const focus = await page.evaluate(() => {
      const graph = window.__seedTerrainLab.network(); const t = window.__seedTerrainLab.tunnels().records.find(r => r.status === 'accepted');
      const edge = graph.edges.find(e => e.id === t.id); const [P, Q] = edge.tunnel.portals; const L = Math.hypot(Q.x - P.x, Q.z - P.z);
      const at = u => ({ x: P.x + (Q.x - P.x) * u / L, z: P.z + (Q.z - P.z) * u / L });
      return { A: at((t.u0 + t.sA) / 2), B: at((t.sB + t.u1) / 2) };
    });
    for (const end of ['A', 'B']) overall.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${run.landform}&seed=${run.seed}&dna=${run.dna}&network=off&focus=${focus[end].x.toFixed(1)},${focus[end].z.toFixed(1)},70`)}"><figcaption>${run.dna} · mountain ${run.seed} · portal ${end} · tube ${run.records[0].tubeLength.toFixed(0)} m · chi ${run.solid.eulerCharacteristic}</figcaption></figure>`);
  }
  await composite(overall, overallShot, 2);
  const xray = [];
  for (const run of tunnelRuns.slice(0, 2)) xray.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${run.landform}&seed=${run.seed}&dna=${run.dna}&xray=1&network=off`)}"><figcaption>x-ray · mountain ${run.seed} ${run.dna} · tube ${run.records[0].tubeLength.toFixed(0)} m · clearance ${run.records[0].clearance} m · min cover ${run.records[0].minCover.toFixed(1)} m</figcaption></figure>`);
  await composite(xray, debugShot, 2);

  const evidence = { task: '05.1b-2', experiment: entry, testedAt: new Date().toISOString(), runs, synthetic, illegal, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.case} · ${run.landform} ${run.seed} ${run.dna}: V ${run.solid.vertices} F ${run.solid.faces} chi ${run.solid.eulerCharacteristic} (expected ${run.solid.expectedEuler ?? 2}) · open ${run.solid.openEdges} · inconsistent ${run.solid.inconsistentEdges} · degenerate ${run.solid.degenerateFaces} · volume err ${run.solid.volumeRelativeError.toExponential(1)}${run.records ? ' · ' + run.records.map(r => `tube ${r.tubeLength.toFixed(1)} m, cuts ${r.cutLengths.map(x => x.toFixed(1)).join('/')} m, lips ${r.lipHeights.map(x => x.toFixed(2)).join('/')} m, grade ${(r.grade * 100).toFixed(2)}%, max grade change ${(r.maxGradeChange * 100).toFixed(1)}%, clearance ${r.clearance} m, min cover ${r.minCover.toFixed(1)} m, rays blocked ${r.raysBlocked.filter(Boolean).length}/3, crossings ${r.crossings}`).join('; ') : ''}${run.comparedWith051b1 ? ' · identical to 05.1b-1' : ''}`),
    C: synthetic.multi.records.map(r => `${r.id}: ${r.status}${r.reason ? ' (' + r.reason + ')' : ''}`).concat(synthetic.limit.map(r => `limit: ${r.reason}`)),
    D: [...synthetic.raised.records.map(r => `raised+20m: ${r.reason}`), ...illegal.map(item => `${item.kind}: ${item.records.map(r => r.reason).join('; ')}`)],
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
