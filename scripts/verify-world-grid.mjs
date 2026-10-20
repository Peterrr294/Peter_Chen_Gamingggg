// 06.2 World Grid: placement, per-chunk City ID, selective invalidation, reproducibility,
// save / restore, single-chunk equivalence, seams (detection only), tunnels in world coordinates.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4204;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/world-grid.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) browserErrors.push(`http ${response.status()}: ${response.url()}`); });
  const lab = (fn, arg) => page.evaluate(fn, arg);
  const waitReady = () => page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
  const openWorld = async query => {
    const started = Date.now();
    await page.goto(`${base}${entry}${query ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
    await waitReady();
    return Date.now() - started;
  };
  const sigs = list => Object.fromEntries(list.map(s => [s.chunkId, s.signatures]));

  // 1. Initial world.
  const loadMs = await openWorld('terrain=raw');
  const world = await lab(() => window.__worldGridLab.world());
  const initial = await lab(() => window.__worldGridLab.summaries());
  const firstBuild = await lab(() => window.__worldGridLab.lastBuild());
  const memory = await lab(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  assert(initial.length === 9 && initial.every(s => s.status.startsWith('ready')), `not all chunks ready: ${initial.map(s => `${s.chunkId}:${s.status} ${s.error ?? ''}`).join(', ')}`);

  // 2. Placement: data origin, mesh bounds, no overlap, no gap.
  const bounds = await lab(() => window.__worldGridLab.bounds());
  const placement = initial.map(s => {
    const b = bounds.find(item => item.chunkId === s.chunkId);
    const expected = { minX: s.gridX * 1024 - 512, maxX: s.gridX * 1024 + 512, minZ: s.gridY * 1024 - 512, maxZ: s.gridY * 1024 + 512 };
    const error = Math.max(Math.abs(b.min[0] - expected.minX), Math.abs(b.max[0] - expected.maxX), Math.abs(b.min[2] - expected.minZ), Math.abs(b.max[2] - expected.maxZ));
    return { chunkId: s.chunkId, origin: s.worldOrigin, dataOrigin: s.grid, meshMin: [b.min[0], b.min[2]], meshMax: [b.max[0], b.max[2]], meshError: error, dataOk: s.grid.originX === s.worldOrigin.x && s.grid.originZ === s.worldOrigin.z && s.worldOrigin.x === s.gridX * 1024 && s.worldOrigin.z === s.gridY * 1024 };
  });
  let overlapArea = 0;
  for (let i = 0; i < placement.length; i += 1) for (let j = i + 1; j < placement.length; j += 1) {
    const a = placement[i]; const b = placement[j];
    const w = Math.min(a.meshMax[0], b.meshMax[0]) - Math.max(a.meshMin[0], b.meshMin[0]);
    const h = Math.min(a.meshMax[1], b.meshMax[1]) - Math.max(a.meshMin[1], b.meshMin[1]);
    if (w > 1e-6 && h > 1e-6) overlapArea += w * h;
  }
  const coveredArea = placement.reduce((s, p) => s + (p.meshMax[0] - p.meshMin[0]) * (p.meshMax[1] - p.meshMin[1]), 0);
  assert(placement.every(p => p.dataOk && p.meshError < 1e-3), `placement error: ${JSON.stringify(placement.filter(p => !p.dataOk || p.meshError >= 1e-3))}`);
  assert(overlapArea === 0 && Math.abs(coveredArea - 3072 * 3072) < 1, `overlap ${overlapArea} or gap (covered ${coveredArea})`);

  // 3. Seeds from worldSeed + coordinate + landform; editing one slot leaves the other seeds unchanged.
  const seedCheck = await lab(async () => {
    const m = await import('/experiments/world-grid/worldConfig.js');
    const w = window.__worldGridLab.world();
    const formula = w.slots.every(s => s.terrainSeed === m.terrainSeedOf(w.worldSeed, s.gridX, s.gridY, s.landform));
    const edited = m.createWorldConfig({ worldSeed: w.worldSeed, slots: [{ gridX: 1, gridY: 1, landform: 'plain' }] });
    const changed = edited.slots.filter((s, i) => s.terrainSeed !== w.slots[i].terrainSeed).map(s => s.chunkId);
    const otherWorld = m.createWorldConfig({ worldSeed: w.worldSeed + 1 }).slots.filter((s, i) => s.terrainSeed !== w.slots[i].terrainSeed).length;
    return { formula, changedByEditingOneSlot: changed, changedByWorldSeed: otherWorld, seeds: w.slots.map(s => [s.chunkId, s.landform, s.terrainSeed]) };
  });
  assert(seedCheck.formula && same(seedCheck.changedByEditingOneSlot, ['chunk_1_1']), `seed derivation: ${JSON.stringify(seedCheck)}`);

  // 4. Different City DNAs and all three slot states.
  const modes = new Set(initial.map(s => s.cityMode));
  const resolved = new Set(initial.map(s => s.resolvedDNA).filter(Boolean));
  assert(['empty', 'auto', 'manual'].every(m => modes.has(m)) && resolved.size >= 4, `modes ${[...modes]} DNAs ${[...resolved]}`);
  assert(initial.filter(s => s.cityMode === 'manual').every(s => s.resolvedDNA === s.cityId) && initial.filter(s => s.cityMode === 'auto').every(s => s.resolvedDNA === s.autoTopId) && initial.filter(s => s.cityMode === 'empty').every(s => s.counts === null && s.signatures.network === null), 'cityId / resolved DNA inconsistent');

  // 5. Seams (detection only).
  const seams = await lab(() => window.__worldGridLab.seams());
  assert(seams.pairs.length === 12 && seams.corners.length === 4, `expected 12 shared edges and 4 interior corners, got ${seams.pairs.length} / ${seams.corners.length}`);
  assert(seams.pairs.every(p => p.positionError === 0 && p.sampleOrder.startsWith('aligned') && p.samples === 257 && p.transitionWidth.a === p.transitionWidth.b), 'boundary position / order / transition mismatch');
  assert(seams.corners.every(c => c.positionSpread === 0), 'interior corners do not coincide');

  // 6. Change one City ID: only that chunk's city layers rebuild.
  const target = 'chunk_1_0';
  const before = await lab(() => window.__worldGridLab.summaries());
  const changed = await lab(id => window.__worldGridLab.setCity(id, 'amsterdamCanalRing'), target);
  const changeBuild = await lab(() => window.__worldGridLab.lastBuild());
  const after = await lab(() => window.__worldGridLab.summaries());
  const others = after.filter(s => s.chunkId !== target).every(s => same(s, before.find(b => b.chunkId === s.chunkId)));
  const t0 = before.find(s => s.chunkId === target); const t1 = after.find(s => s.chunkId === target);
  assert(others, 'changing one City ID changed another chunk');
  assert(changeBuild.chunks.length === 1 && changeBuild.chunks[0].chunkId === target && !changeBuild.chunks[0].ran.terrain && changeBuild.chunks[0].ran.city, `unexpected rebuild: ${JSON.stringify(changeBuild)}`);
  assert(t1.signatures.height === t0.signatures.height && t1.signatures.water === t0.signatures.water && t1.builds.terrain === t0.builds.terrain && t1.resolvedDNA === 'amsterdamCanalRing' && t1.signatures.network !== t0.signatures.network, 'target chunk terrain changed or city did not');
  const selection = await lab(id => window.__worldGridLab.select(id), target);
  const guiLabels = await lab(() => window.__worldGridLab.selectedGuiLabels());
  const amsterdamLabel = await lab(async () => (await import('/experiments/seed-terrain/cityMatchRules.js')).CITY_DNA.amsterdamCanalRing.label);
  assert(selection.uiCity === 'amsterdamCanalRing' && guiLabels.includes(amsterdamLabel) && guiLabels.includes(target) && selection.panel.includes(amsterdamLabel), `selection display inconsistent: ${JSON.stringify({ selection, guiLabels })}`);
  await page.locator('#worldCanvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('.workspace').screenshot({ path: path.join(shots, '06-2-world-grid-selected-chunk.png') });

  // 7. Empty → manual again reproduces the original city layers (no hidden state).
  await lab(() => window.__worldGridLab.setCity('chunk_0_0', null));
  const emptied = (await lab(() => window.__worldGridLab.summaries())).find(s => s.chunkId === 'chunk_0_0');
  const emptyTunnels = await lab(() => window.__worldGridLab.tunnels('chunk_0_0'));
  await lab(() => window.__worldGridLab.setCity('chunk_0_0', 'manhattanGrid'));
  const refilled = (await lab(() => window.__worldGridLab.summaries())).find(s => s.chunkId === 'chunk_0_0');
  assert(emptied.counts === null && emptied.status === 'ready (terrain only)' && emptyTunnels.accepted.length === 0, 'empty slot still has city layers');
  assert(same(refilled.signatures, before.find(s => s.chunkId === 'chunk_0_0').signatures), 'empty → manhattanGrid did not reproduce the original city layers');

  // 8. Save / restore.
  const saved = await lab(() => window.__worldGridLab.save());
  const savedSigs = sigs(await lab(() => window.__worldGridLab.summaries()));
  await lab(() => window.__worldGridLab.setCity('chunk_-1_0', 'fezOrganicCore'));
  await lab(() => window.__worldGridLab.setCity('chunk_0_1', null));
  const restoreStarted = Date.now();
  const restored = await lab(s => window.__worldGridLab.restore(s), saved);
  const restoreMs = Date.now() - restoreStarted;
  const restoredSummaries = await lab(() => window.__worldGridLab.summaries());
  assert(same(restored, saved), 'restored config differs from saved');
  assert(same(sigs(restoredSummaries), savedSigs), 'restored chunks differ from saved state');
  assert(restoredSummaries.every(s => { const slot = saved.slots.find(x => x.gridX === s.gridX && x.gridY === s.gridY); return slot.cityId === s.cityId && slot.terrainSeed === s.terrainSeed; }), 'City ID / seed mismatch after restore');
  const tamperRejected = await lab(async s => { try { const m = await import('/experiments/world-grid/worldConfig.js'); m.restoreWorld({ ...s, slots: s.slots.map((x, i) => (i === 0 ? { ...x, terrainSeed: x.terrainSeed + 1 } : x)) }); return false; } catch (error) { return error.message; } }, saved);
  assert(typeof tamperRejected === 'string' && tamperRejected.includes('Seed mismatch'), 'a saved config with a wrong seed was accepted');

  // 9. Tunnels / closed solid in world coordinates (frozen 05.1b-2 code, non-zero origins).
  const solids = [];
  for (const s of restoredSummaries) {
    const solid = await lab(id => window.__worldGridLab.solid(id), s.chunkId);
    solids.push({ chunkId: s.chunkId, tunnels: solid.tunnels, watertight: solid.watertight, euler: solid.eulerCharacteristic, expectedEuler: solid.expectedEuler, volumeRelativeError: solid.volumeRelativeError });
  }
  assert(solids.every(s => s.watertight && s.euler === s.expectedEuler && s.volumeRelativeError < 1e-6), `solid check failed: ${JSON.stringify(solids.filter(s => !s.watertight || s.euler !== s.expectedEuler || s.volumeRelativeError >= 1e-6))}`);

  // 10. Reload with the same configuration: identical data.
  const reloadMs = await openWorld('terrain=raw');
  const reloaded = await lab(() => window.__worldGridLab.summaries());
  assert(same(sigs(reloaded), sigs(initial)), 'reload produced different chunk data');

  // Screenshots: whole world (oblique), seam debug (top).
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '06-2-world-grid-overall.png') });
  await openWorld('seams=1&focus=512,0,1300&terrain=raw'); // seam chunk_0_0 | chunk_1_0 (plain vs river valley)
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '06-2-world-grid-seams-debug.png') });

  // 10b. Tunnels at a non-zero origin (chunk_0_-1: x 0, z −1024, Chicago grid). The world result must equal the
  // same chunk generated at origin 0 on the single-chunk page. 6203 = valid tunnel; 6202 = pre-existing 05.1b-2
  // defect on that terrain (reproduced at origin 0), which must be reproduced identically, not fixed or hidden.
  const tunnelCase = async worldSeed => {
    await openWorld(`worldSeed=${worldSeed}&terrain=raw`);
    await lab(() => window.__worldGridLab.setCity('chunk_0_-1', 'chicagoGrid'));
    const chunk = (await lab(() => window.__worldGridLab.summaries())).find(item => item.chunkId === 'chunk_0_-1');
    const pick = s => ({ tunnels: s.tunnels, watertight: s.watertight, euler: s.eulerCharacteristic, expectedEuler: s.expectedEuler, nonManifold: s.nonManifoldEdges, inconsistent: s.inconsistentEdges, degenerate: s.degenerateFaces, excavatedVolume: s.excavatedVolume, volumeRelativeError: s.volumeRelativeError });
    const world = pick(await lab(() => window.__worldGridLab.solid('chunk_0_-1')));
    const records = (await lab(() => window.__worldGridLab.tunnels('chunk_0_-1'))).records;
    const isolation = await lab(() => window.__worldGridLab.tunnelIsolation());
    await page.goto(`${base}/experiments/seed-terrain/?landform=mountain&seed=${chunk.terrainSeed}&dna=chicagoGrid`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 180000 });
    const single = pick(await page.evaluate(() => window.__seedTerrainLab.solid()));
    const sameOutcome = world.tunnels === single.tunnels && world.watertight === single.watertight && world.euler === single.euler && world.nonManifold === single.nonManifold && world.inconsistent === single.inconsistent && world.degenerate === single.degenerate
      && ((!Number.isFinite(world.excavatedVolume) && !Number.isFinite(single.excavatedVolume)) || Math.abs(world.excavatedVolume - single.excavatedVolume) / single.excavatedVolume < 1e-6);
    return { worldSeed, chunkId: 'chunk_0_-1', terrainSeed: chunk.terrainSeed, origin: chunk.worldOrigin, records, isolation, world, singleAtOrigin: single, sameOutcome };
  };
  const tunnelCheck = { valid: await tunnelCase(6203), knownDefect: await tunnelCase(6202) };
  const v = tunnelCheck.valid.world;
  assert(v.tunnels >= 1 && v.watertight && v.euler === v.expectedEuler && v.volumeRelativeError < 1e-6 && tunnelCheck.valid.sameOutcome, `tunnel at non-zero origin failed: ${JSON.stringify(tunnelCheck.valid)}`);
  // Since 06.3a the world isolates the known 05.1b-2 failure (cut removed, solid closed); the single page still shows it.
  const k = tunnelCheck.knownDefect;
  assert(!k.singleAtOrigin.watertight && k.isolation.some(i => i.chunkId === 'chunk_0_-1' && i.euler === k.singleAtOrigin.euler) && k.world.watertight && k.world.tunnels === 0, `6202 known tunnel failure not isolated: ${JSON.stringify(k)}`);

  // 11. Single-chunk entry: same landform / seed / DNA at origin 0 = identical data; non-zero origin = same counts.
  const single = async (summary, dna) => {
    await page.goto(`${base}/experiments/seed-terrain/?landform=${summary.landform}&seed=${summary.terrainSeed}&dna=${dna}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 180000 });
    return page.evaluate(() => {
      const l = window.__seedTerrainLab; const n = l.network(); const b = l.buildings(); const p = l.parcels(); const k = l.blocks();
      return { signatures: { height: l.stats().heightSignature, water: l.stats().waterSignature, network: n.signature, blocks: k.signature, parcels: p.signature, buildings: b.signature }, counts: { edges: n.edges.length, ports: n.edgePorts.length, blocks: k.stats.blocks, parcels: p.stats.parcels, buildings: b.stats.buildings } };
    });
  };
  const centre = initial.find(s => s.chunkId === 'chunk_0_0');
  const centreSingle = await single(centre, centre.resolvedDNA);
  assert(same(centreSingle.signatures, (({ raw, ...rest }) => rest)(centre.signatures)), `centre chunk differs from the single-chunk page: ${JSON.stringify({ world: centre.signatures, single: centreSingle.signatures })}`);
  const translation = [];
  for (const s of initial.filter(item => item.resolvedDNA && item.chunkId !== 'chunk_0_0')) {
    const ref = await single(s, s.resolvedDNA);
    translation.push({ chunkId: s.chunkId, dna: s.resolvedDNA, heightEqual: ref.signatures.height === s.signatures.height, world: s.counts, singleAtOrigin: ref.counts, countsEqual: ref.counts.blocks === s.counts.blocks && ref.counts.parcels === s.counts.parcels && ref.counts.buildings === s.counts.buildings && ref.counts.ports === s.counts.ports });
  }
  assert(translation.every(t => t.heightEqual), 'placed chunk heights differ from the local generation');

  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify({
    task: '06.2 World Grid & City Placement', experiment: entry, testedAt: new Date().toISOString(),
    world, seedCheck,
    performance: { firstLoadMs: loadMs, reloadMs, firstBuild, cityChange: changeBuild, restoreMs, jsHeapMB: memory },
    placement: { chunks: placement, overlapArea, coveredArea },
    chunks: initial,
    cityChange: { target, to: 'amsterdamCanalRing', before: t0, after: t1, otherChunksUnchanged: others, selection, guiLabels },
    emptySlot: { emptied, emptyTunnels, refilledEqualsOriginal: true },
    saveRestore: { saved, restoredEqual: true, tamperRejected },
    solids, tunnelCheck, centreSingle, translation,
    seams,
    screenshots: ['06-2-world-grid-overall.png', '06-2-world-grid-selected-chunk.png', '06-2-world-grid-seams-debug.png'].map(f => `docs/assets/screenshots/procedural-mini-world/${f}`),
    browserErrors,
  }, null, 2)}\n`);
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  const flagged = key => seams.pairs.filter(p => p.flags[key]).length;
  console.log(`first build ${firstBuild.totalMs} ms (${firstBuild.chunks.map(c => `${c.chunkId} ${c.dataMs}+${c.renderMs}`).join(', ')})`);
  console.log(`city change ${changeBuild.totalMs} ms · restore ${restoreMs} ms · heap ${memory} MB · seams: height ${flagged('heightDiscontinuity')}/12, water ${flagged('waterInterfaceMismatch')}/12, ports ${flagged('portMismatch')}/12`);
  console.log(`tunnel 6203 at (0, −1024): ${v.tunnels} accepted, χ ${v.euler}, watertight ${v.watertight}, excavated ${v.excavatedVolume.toFixed(0)} m³ (origin 0: ${tunnelCheck.valid.singleAtOrigin.excavatedVolume.toFixed(0)}) · 6202 defect (χ ${tunnelCheck.knownDefect.singleAtOrigin.euler} at origin 0) isolated in the world: χ ${tunnelCheck.knownDefect.world.euler}`);
  console.log(`translation counts equal ${translation.filter(t => t.countsEqual).length}/${translation.length}`);
  console.log('world grid verification passed');
} finally {
  await browser?.close();
  server.kill();
}
