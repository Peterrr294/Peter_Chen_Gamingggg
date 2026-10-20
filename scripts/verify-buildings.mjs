import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4199;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/05-1-buildings-overall.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/05-1-buildings-street-closeup.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/buildings.json');
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
  const inspect = () => page.evaluate(async () => {
    const { CHUNK } = await import('/experiments/seed-terrain/config.js');
    const { ringsIntersect } = await import('/experiments/seed-terrain/BlockGenerator.js');
    const { generateBuildings } = await import('/experiments/seed-terrain/BuildingGenerator.js');
    const lab = window.__seedTerrainLab;
    const fields = lab.fields();
    const graph = lab.network();
    const blocks = lab.blocks();
    const parcels = lab.parcels();
    const result = lab.buildings();
    const rule = result.rules.rule;
    const rules = result.rules;
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;
    const inside = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    const inPoly = (poly, x, z) => inside(poly.polygon, x, z) && !poly.holes.some(hole => inside(hole, x, z));
    const segDist = (x, z, a, b) => { const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
    const ringDist = (ring, x, z) => ring.reduce((best, p, i) => Math.min(best, segDist(x, z, p, ring[(i + 1) % ring.length])), Infinity);
    const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    const crosses = (ringsA, ringsB) => ringsA.some(ra => ringsB.some(rb => ra.some((p, i) => { const q = ra[(i + 1) % ra.length]; return rb.some((r, j) => { const t = rb[(j + 1) % rb.length]; return orient(p, q, r) * orient(p, q, t) < 0 && orient(r, t, p) * orient(r, t, q) < 0; }); })));
    const bilinear = map => (x, z) => {
      const gx = Math.min(segments, Math.max(0, (x - originX + half) / spacing)); const gz = Math.min(segments, Math.max(0, (z - originZ + half) / spacing));
      const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz)); const tx = gx - c0; const tz = gz - r0;
      const at = (r, c) => map(r * columns + c);
      return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
    };
    const heightAt = bilinear(i => fields.height[i]);
    const slopeAt = bilinear(i => fields.slope[i]);
    const freeboardAt = bilinear(i => (Number.isFinite(fields.waterSurface[i]) ? Math.max(-3, Math.min(3, fields.height[i] - fields.waterSurface[i] - CHUNK.shoreFreeboard)) : 3));
    const parcelById = new Map(parcels.parcels.map(parcel => [parcel.id, parcel]));
    const issues = { invalidRing: 0, badOrientation: 0, outsideParcel: 0, setback: 0, badHeight: 0, floorsOutOfRange: 0, floating: 0, floorBelowGround: 0, plinthTooTall: 0, overlapSamples: 0, wet: 0, steep: 0, onRoad: 0, outOfChunk: 0 };
    let streetWall = 0; let orientationDeviation = 0;
    for (const building of result.buildings) {
      const fp = building.footprint;
      const parcel = parcelById.get(building.parcelId);
      const rings = [fp.polygon, ...fp.holes];
      if (rings.some(ring => ring.length < 3) || ringsIntersect(rings)) issues.invalidRing += 1;
      if (area(fp.polygon) <= 0 || fp.holes.some(ring => area(ring) >= 0) || fp.holes.some(hole => !inside(fp.polygon, hole[0].x, hole[0].z))) issues.badOrientation += 1;
      if (!parcel || !fp.polygon.every(p => inPoly(parcel, p.x, p.z)) || crosses(rings, [parcel.polygon, ...parcel.holes])) issues.outsideParcel += 1;
      else if (Math.min(...fp.polygon.map(p => Math.min(ringDist(parcel.polygon, p.x, p.z), ...parcel.holes.map(hole => ringDist(hole, p.x, p.z))))) < rule.sideSetback - 0.2) issues.setback += 1;
      if (rings.some(ring => ring.some(p => Math.abs(p.x - originX) > half || Math.abs(p.z - originZ) > half))) issues.outOfChunk += 1;
      if (!(building.height > 0) || building.floorsEstimate * rule.floorHeight !== building.height) issues.badHeight += 1;
      if (building.floorsEstimate < rule.floors[0] || building.floorsEstimate > rule.floors[1]) issues.floorsOutOfRange += 1;
      // Ground contact, re-sampled independently on a 1 m lattice inside the footprint.
      const xs = fp.polygon.map(p => p.x); const zs = fp.polygon.map(p => p.z);
      const ground = [...fp.polygon.map(p => heightAt(p.x, p.z))];
      for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) if (inPoly(fp, x, z)) ground.push(heightAt(x, z));
      const gMin = Math.min(...ground); const gMax = Math.max(...ground);
      if (building.bottomElevation > gMin + 1e-6) issues.floating += 1;
      if (building.baseElevation < gMax - 0.1) issues.floorBelowGround += 1;
      if (gMax - gMin > rules.maxPlinth + 0.1) issues.plinthTooTall += 1;
      // Street wall and orientation.
      const front = Math.min(...fp.polygon.map(p => Math.min(...parcel.frontageLines.map(line => line.slice(1).reduce((best, b, i) => Math.min(best, segDist(p.x, p.z, line[i], b)), Infinity)))));
      // Street wall: the frontage line is the road edge; intended offsets add up to ≈ 2.9 m
      // (edge margin 0.6 + parcel inset 0.25 + side setback 0.4 + simplification 0.3/0.2/0.15 + 1 m field cell).
      if (front <= rule.frontSetback + 3.0) streetWall += 1;
      let cx = 0; let cz = 0; fp.polygon.forEach(p => { cx += p.x; cz += p.z; }); cx /= fp.polygon.length; cz /= fp.polygon.length;
      let xx = 0; let zz = 0; let xz = 0; fp.polygon.forEach(p => { xx += (p.x - cx) ** 2; zz += (p.z - cz) ** 2; xz += (p.x - cx) * (p.z - cz); });
      const axis = ((0.5 * Math.atan2(2 * xz, xx - zz) * 180 / Math.PI) + 180) % 180;
      const difference = Math.abs(axis - parcel.orientation.frontageAxisDeg) % 90;
      orientationDeviation += Math.min(difference, 90 - difference);
    }
    // Stratified samples: collisions and legality.
    let seedState = 777;
    const random = () => { seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0; return seedState / 4294967296; };
    const grid = new Map();
    result.buildings.forEach(building => {
      const xs = building.footprint.polygon.map(p => p.x); const zs = building.footprint.polygon.map(p => p.z);
      const box = { building, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      for (let gx = Math.floor(box.minX / 32); gx <= Math.floor(box.maxX / 32); gx += 1) for (let gz = Math.floor(box.minZ / 32); gz <= Math.floor(box.maxZ / 32); gz += 1) { const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(box); }
    });
    const roads = graph.edges.filter(edge => ['road', 'bridgeCandidate'].includes(edge.kind)).flatMap(edge => edge.points.slice(1).map((b, i) => ({ a: edge.points[i], b, w: edge.width / 2 })));
    let sampled = 0;
    for (let cz = originZ - half; cz < originZ + half; cz += 2) for (let cx = originX - half; cx < originX + half; cx += 2) {
      const x = cx + random() * 2; const z = cz + random() * 2;
      const owners = (grid.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []).filter(box => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ && inPoly(box.building.footprint, x, z));
      if (!owners.length) continue;
      sampled += 4;
      if (owners.length > 1) issues.overlapSamples += 1;
      if (freeboardAt(x, z) < -0.3) issues.wet += 1;
      if (slopeAt(x, z) > CHUNK.maxBuildableSlope + 0.75) issues.steep += 1;
      if (roads.some(seg => Math.abs(seg.a.x - x) < 60 && Math.abs(seg.a.z - z) < 60 && segDist(x, z, seg.a, seg.b) - seg.w < -0.6)) issues.onRoad += 1;
    }
    // Upstream unchanged: regenerating buildings must not change any upstream signature.
    const before = { network: graph.signature, blocks: blocks.signature, parcels: parcels.signature, terrain: lab.stats().heightSignature };
    const again = generateBuildings({ ...parcels }, { ...fields, height: Float32Array.from(fields.height), grid: fields.grid }, lab.cityMatch(), { seed: result.source.seed, landform: result.source.landform, transitionWidth: lab.stats().transitionWidth });
    const after = { network: lab.network().signature, blocks: lab.blocks().signature, parcels: lab.parcels().signature, terrain: lab.stats().heightSignature };
    const n = result.buildings.length || 1;
    return {
      dna: result.source.dna, signature: result.signature, json: JSON.stringify(result.buildings), regenerated: again.signature,
      upstreamUnchanged: JSON.stringify(before) === JSON.stringify(after) && result.source.parcelsSignature === parcels.signature,
      issues, stats: result.stats, rule: { floors: rule.floors, occupancy: rule.occupancy },
      footprintAreaRel: Math.abs(sampled - result.stats.footprintArea) / Math.max(1, result.stats.footprintArea),
      streetWallShare: streetWall / n, meanOrientationDeviation: orientationDeviation / n,
    };
  });

  const plan = [['plain', 'manhattanGrid'], ['coast', 'fezOrganicCore'], ['riverValley', 'veniceWaterNetwork']];
  const runs = [];
  for (const [landform, dna] of plan) {
    for (const seed of seeds) {
      const id = `${landform} ${seed} ${dna}`;
      await open(`landform=${landform}&seed=${seed}&dna=${dna}&view=buildings`);
      const first = await inspect();
      await open(`landform=${landform}&seed=${seed}&dna=${dna}&view=buildings`);
      const repeat = await inspect();
      // Reproducibility = identical output across page reloads (the in-page regeneration uses 3-decimal exported heights, so it only checks that upstream state is untouched).
      assert(first.signature === repeat.signature && first.json === repeat.json, `${id}: buildings not reproducible.`);
      assert(first.upstreamUnchanged, `${id}: upstream signatures changed.`);
      const bad = Object.entries(first.issues).filter(([, count]) => count > 0);
      assert(bad.length === 0, `${id}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      assert(first.footprintAreaRel < 0.02, `${id}: footprint area vs samples ${first.footprintAreaRel}.`);
      const s = first.stats;
      assert(s.occupancy <= first.rule.occupancy + 0.05 && s.occupancy > 0.5, `${id}: occupancy ${s.occupancy} outside the density rule.`);
      assert(s.distinctFloors >= 3, `${id}: heights not varied enough (${s.distinctFloors} distinct floor counts).`);
      if (dna === 'manhattanGrid') assert(s.heightP90 / Math.max(1, s.heightP10) >= 1.8, `${id}: no clear grid height gradient.`);
      runs.push({ landform, seed, dna, stats: s, streetWallShare: first.streetWallShare, meanOrientationDeviation: first.meanOrientationDeviation, footprintAreaRel: first.footprintAreaRel });
    }
  }
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: (1) full-chunk grey box per DNA; (2) local road–parcel–building close-ups.
  const capture = async query => { await open(query); await page.waitForTimeout(600); return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64'); };
  const composite = async (tiles, file, columns) => {
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(${columns},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const caption = run => `${run.dna} · ${run.landform} ${run.seed} · ${run.stats.buildings} buildings · mean ${run.stats.meanHeight.toFixed(0)} m (p10 ${run.stats.heightP10.toFixed(0)}–p90 ${run.stats.heightP90.toFixed(0)}) · coverage ${(run.stats.coverageOfBuiltParcels * 100).toFixed(0)}%`;
  const overall = [];
  for (const [landform, dna] of plan) {
    const run = runs.find(item => item.landform === landform && item.dna === dna && item.seed === seeds[0]);
    overall.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&view=buildings`)}"><figcaption>${caption(run)}</figcaption></figure>`);
  }
  await composite(overall, overallShot, 3);
  const local = [];
  for (const [landform, dna, focus, note] of [['plain', 'manhattanGrid', '-451,-366,260', 'grid: street-wall towers on frontage lots'], ['riverValley', 'veniceWaterNetwork', '-120,40,260', 'canal-street: low-rise along lanes, quays, river'], ['coast', 'fezOrganicCore', '200,-150,260', 'organic: low-rise with courtyard houses']]) {
    local.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&view=buildings&focus=${focus}`)}"><figcaption>${note}</figcaption></figure>`);
  }
  await composite(local, debugShot, 3);

  const evidence = { task: '05.1', experiment: entry, testedAt: new Date().toISOString(), runs, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.dna.replace(/[A-Z].*/, '')}: ${run.stats.buildings}/${run.stats.parcels} built (${(run.stats.occupancy * 100).toFixed(0)}%) · height mean ${run.stats.meanHeight.toFixed(1)} m p10 ${run.stats.heightP10.toFixed(0)} p50 ${run.stats.heightP50.toFixed(0)} p90 ${run.stats.heightP90.toFixed(0)} max ${run.stats.heightMax.toFixed(0)} (${run.stats.distinctFloors} floor counts) · coverage ${(run.stats.coverageOfBuiltParcels * 100).toFixed(0)}% built / ${(run.stats.coverageOfAllParcels * 100).toFixed(0)}% all parcels · street wall ${(run.streetWallShare * 100).toFixed(0)}% · axis dev ${run.meanOrientationDeviation.toFixed(1)}° · courtyard ${run.stats.courtyards} · corner ${run.stats.corner} · plinth ${run.stats.withPlinth} · canal-facing ${run.stats.canalFacing} · vacant ${JSON.stringify(run.stats.vacantByReason)}`),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
