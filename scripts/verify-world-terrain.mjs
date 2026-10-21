// 06.3a-R World-coherent terrain: coordinated heightfield vs raw (06.2) and edge-harmonised (06.3a). Checks every
// shared edge (Δh, off-grid sampler, rendered mesh), interior corners, slope kink / band slope, made-steep cells and
// unresolved reasons, geometry validity at several transition widths, water (sea level, no river spreading, edge
// interfaces), road-candidate feasibility per edge, landform character per chunk, City ID independence, raw fields
// untouched, downstream invalidation, input-order independence, reload identity, three world seeds, load time and
// heap. Writes evidence + screenshots (6201 before / after, one seam debug close-up).
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4208;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/world-terrain.json');
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
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) browserErrors.push(`http ${response.status()}: ${response.url()}`); });
  const lab = (fn, arg) => page.evaluate(fn, arg);
  const openWorld = async query => {
    const started = Date.now();
    if (!query.includes('terrain=')) query = `${query}${query ? '&' : ''}terrain=macroRamp`; // 06.3a-R (06.3a-R2 made core-preserving terrain the default)
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
    return Date.now() - started;
  };
  const measure = async () => lab(() => {
    const l = window.__worldGridLab;
    const seams = l.seams(); const summaries = l.summaries(); const h = l.harmony();
    return {
      summaries, build: l.lastBuild(), memoryMB: l.memory(),
      harmonyEdges: h ? h.edges : null, harmonyMs: h ? Math.round(h.ms) : 0, macro: h?.macro ?? null,
      pairs: seams.pairs.map(p => ({ id: p.id, status: p.harmony?.status ?? 'raw', heightMax: p.height.max, heightMean: p.height.mean, kinkMax: p.slope.kinkMaxDeg, kinkMedian: p.slope.kinkMedianDeg, bandMaxSlope: p.slope.bandMaxSlopeDeg, water: p.waterInterface })),
      corners: seams.corners.map(c => ({ at: c.at, heightSpread: c.heightSpread })),
      sampling: seams.pairs.map(p => l.edgeSampling(p.id).maxDifference),
      normals: seams.pairs.map(p => l.edgeNormals(p.id).maxDeg),
      crossing: seams.pairs.map(p => l.crossability(p.id)),
      mesh: summaries.map(s => l.meshConsistency(s.chunkId)),
      water: l.waterAudit(), landform: summaries.map(s => l.landformStats(s.chunkId)), differences: summaries.map(s => l.difference(s.chunkId)),
      roads: (() => { const r = l.roadSeam(); return { connections: r.stats.connections, pairs: r.stats.pairs, stubs: r.stats.stubs, connected: r.stats.connected, crossChunkComponents: r.stats.crossChunkComponents }; })(),
    };
  });
  const solidsOf = async summaries => {
    const out = [];
    for (const s of summaries) out.push({ chunkId: s.chunkId, ...(await lab(id => { const r = window.__worldGridLab.solid(id); return { watertight: r.watertight, euler: r.eulerCharacteristic, expected: r.expectedEuler }; }, s.chunkId)) });
    return out;
  };
  const summarise = m => ({
    edgesResolved: m.pairs.filter(p => p.status === 'resolved').length, edgesUnresolved: m.pairs.filter(p => p.status === 'unresolved').length,
    maxSeamStep: Math.max(...m.pairs.map(p => p.heightMax)), edgesWithStep: m.pairs.filter(p => p.heightMax > 0.5).length,
    maxCornerSpread: Math.max(...m.corners.map(c => c.heightSpread)), cornersClosed: m.corners.filter(c => c.heightSpread === 0).length,
    maxKinkAll: Math.max(...m.pairs.map(p => p.kinkMax)), maxKinkResolved: Math.max(0, ...m.pairs.filter(p => p.status === 'resolved').map(p => p.kinkMax)),
    maxBandSlopeResolved: Math.max(0, ...m.pairs.filter(p => p.status === 'resolved').map(p => p.bandMaxSlope)), maxBandSlopeAll: Math.max(...m.pairs.map(p => p.bandMaxSlope)),
    maxSamplerDiff: Math.max(...m.sampling), maxNormalDeg: Math.max(...m.normals),
    waterDiscontinuousEdges: m.pairs.filter(p => p.water.status === 'discontinuous').length, waterOneSided: m.pairs.reduce((s, p) => s + p.water.oneSided, 0),
    crossableShareMean: +(m.crossing.reduce((s, c) => s + c.share, 0) / m.crossing.length).toFixed(3), edgesCrossable: m.crossing.filter(c => c.longestRunM >= 40).length,
    roadJoins: m.roads.connections, memoryMB: m.memoryMB,
  });
  // Assertions for a coordinated world.
  const checkCoordinated = (m, raw, label) => {
    assert(m.summaries.every(s => s.status.startsWith('ready')), `${label}: not all chunks ready`);
    for (const p of m.pairs) assert(p.heightMax === 0, `${label}: ${p.id} Δh ${p.heightMax} (shared edge not one surface)`);
    assert(m.corners.every(c => c.heightSpread === 0), `${label}: interior corner not shared ${JSON.stringify(m.corners)}`);
    assert(m.sampling.every(d => d < 1e-4), `${label}: off-grid sampler differs across an edge`);
    assert(m.mesh.every(x => x.maxHeightError === 0 && x.maxPlanError === 0), `${label}: rendered mesh differs from fields`);
    assert(same(m.summaries.map(s => s.signatures.raw), raw.summaries.map(s => s.signatures.raw)), `${label}: raw height fields changed`);
    for (const e of m.harmonyEdges) if (e.status === 'unresolved') assert(e.reason && e.suggestion, `${label}: ${e.id} unresolved without reason / suggestion`);
    assert(m.water.every(w => w.seaLevelDev === 0 && w.riverOutsideRaw === 0), `${label}: water rule broken ${JSON.stringify(m.water)}`);
    for (const d of m.differences) assert(Number.isFinite(d.maxDelta), `${label}: non-finite height in ${d.chunkId}`);
  };

  // 1. World seed 6201, W 128: raw (06.2) · harmonised (06.3a) · coordinated (06.3a-R, default).
  const modes = {};
  for (const [name, query] of [['raw', 'terrain=raw'], ['harmonized', 'terrain=harmonized'], ['coordinated', '']]) {
    const loadMs = await openWorld(query);
    modes[name] = { loadMs, ...(await measure()) };
  }
  const main = modes.coordinated;
  checkCoordinated(main, modes.raw, '6201');
  const solids = await solidsOf(main.summaries);
  assert(solids.every(s => s.watertight && s.euler === s.expected), `solid not closed: ${JSON.stringify(solids)}`);
  const order = await lab(() => window.__worldGridLab.orderTest());
  assert(order.identical, 'coordination depends on input order');

  // 2. City ID change: terrain unchanged (no coordination rerun), raw fields of every chunk unchanged.
  const before = await lab(() => window.__worldGridLab.summaries());
  await lab(() => window.__worldGridLab.setCity('chunk_0_1', 'amsterdamCanalRing'));
  const cityBuild = await lab(() => window.__worldGridLab.lastBuild());
  const after = await lab(() => window.__worldGridLab.summaries());
  assert(!cityBuild.prepare.harmony && cityBuild.prepare.raw.length === 0 && cityBuild.chunks.every(c => !c.ran.terrain), `City ID change re-ran terrain: ${JSON.stringify(cityBuild.prepare)}`);
  assert(after.every(s => s.signatures.raw === before.find(b => b.chunkId === s.chunkId).signatures.raw && s.signatures.height === before.find(b => b.chunkId === s.chunkId).signatures.height && s.signatures.water === before.find(b => b.chunkId === s.chunkId).signatures.water), 'City ID change altered terrain');
  const cityAudit = await lab(() => window.__worldGridLab.roadAudit());
  assert(cityAudit.cities.every(c => c.stitchedIsCurrent && c.blocksOnStitched), 'stale city layer after City ID change');

  // 3. Transition widths (6201): geometry valid at every width; terrain change rebuilds every dependent layer.
  const widths = [];
  for (const W of [64, 256, 128]) {
    const prev = await lab(() => window.__worldGridLab.summaries());
    await lab(w => window.__worldGridLab.setWorldOptions({ transitionWidth: w }), W);
    const m = await measure();
    checkCoordinated(m, modes.raw, `W ${W}`);
    const stale = m.summaries.filter(s => s.signatures.height !== prev.find(p => p.chunkId === s.chunkId).signatures.height && s.resolvedDNA && s.builds.city <= prev.find(p => p.chunkId === s.chunkId).builds.city);
    assert(!stale.length, `W ${W}: city layers kept on changed terrain: ${stale.map(s => s.chunkId)}`);
    const audit = await lab(() => window.__worldGridLab.roadAudit());
    assert(audit.cities.every(c => c.stitchedIsCurrent && c.blocksOnStitched), `W ${W}: stale city layer`);
    const sol = await solidsOf(m.summaries);
    assert(sol.every(s => s.watertight && s.euler === s.expected), `W ${W}: solid not closed`);
    widths.push({ transitionWidth: W, ...summarise(m), rebuildMs: m.build.totalMs, harmonyMs: m.harmonyMs, edges: m.harmonyEdges.map(e => ({ id: e.id, status: e.status, madeSteepCells: e.madeSteepCells, steepInBand: e.steepInBand, steepInRamp: e.steepInRamp, maxCreatedSlope: e.maxCreatedSlope, bandMaxSlope: e.bandMaxSlope })) });
  }

  // 4. Reload identity.
  await openWorld('');
  const reload = await measure();
  assert(same(reload.summaries.map(s => s.signatures), main.summaries.map(s => s.signatures)) && same(reload.harmonyEdges, main.harmonyEdges), 'reload differs');

  // 5. Screenshots (6201, W 128): whole world before (06.3a) / after (06.3a-R); seam debug close-up at the
  //    mountain · river valley · plain · river valley corner (x 512, z −512).
  for (const [file, query] of [['06-3a-r-world-before.png', 'terrain=harmonized'], ['06-3a-r-world-after.png', '']]) {
    await openWorld(query);
    await page.waitForTimeout(400);
    await page.locator('#worldCanvas').screenshot({ path: path.join(shots, file) });
  }
  await openWorld('seams=1&focus=512,-512,1100');
  await page.waitForTimeout(400);
  await page.locator('.workspace').screenshot({ path: path.join(shots, '06-3a-r-seam-debug.png') });

  // 6. Three world seeds at W 128: raw / harmonised / coordinated statistics; coordinated loaded twice.
  const seeds = [];
  for (const worldSeed of [6201, 6202, 6203]) {
    const r = { loadMs: await openWorld(`worldSeed=${worldSeed}&terrain=raw`) }; Object.assign(r, await measure());
    const h = { loadMs: await openWorld(`worldSeed=${worldSeed}&terrain=harmonized`) }; Object.assign(h, await measure());
    const c = { loadMs: await openWorld(`worldSeed=${worldSeed}`) }; Object.assign(c, await measure());
    checkCoordinated(c, r, `seed ${worldSeed}`);
    await openWorld(`worldSeed=${worldSeed}`);
    const again = await lab(() => ({ summaries: window.__worldGridLab.summaries(), edges: window.__worldGridLab.harmony().edges }));
    assert(same(again.summaries.map(s => s.signatures), c.summaries.map(s => s.signatures)) && same(again.edges, c.harmonyEdges), `seed ${worldSeed}: not reproducible`);
    seeds.push({
      worldSeed, raw: { ...summarise(r), loadMs: r.loadMs }, harmonized: { ...summarise(h), loadMs: h.loadMs, harmonyMs: h.harmonyMs }, coordinated: { ...summarise(c), loadMs: c.loadMs, harmonyMs: c.harmonyMs },
      macro: c.macro,
      edges: c.harmonyEdges.map(e => {
        const hp = h.pairs.find(p => p.id === e.id); const rp = r.pairs.find(p => p.id === e.id); const cp = c.pairs.find(p => p.id === e.id);
        const cross = (m, id) => m.crossing.find(x => x.pairId === id);
        return { id: e.id, status: e.status, harmonizedStatus: hp.status, rawMaxStep: e.rawMaxStep, madeSteepCells: e.madeSteepCells, steepInBand: e.steepInBand, steepInRamp: e.steepInRamp, maxCreatedSlope: e.maxCreatedSlope, bandMaxSlope: e.bandMaxSlope, kinkMax: cp.kinkMax, edgeBase: e.edgeBase, reason: e.reason, waterRaw: rp.water.status, waterHarmonized: hp.water.status, water: cp.water.status, waterReasons: cp.water.reasons, crossableRaw: cross(r, e.id).share, crossableHarmonized: cross(h, e.id).share, crossable: cross(c, e.id).share };
      }),
      landform: c.landform, water: c.water,
      roads: { raw: r.roads, harmonized: h.roads, coordinated: c.roads },
    });
  }

  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify({
    task: '06.3a-R World-Coherent Terrain', experiment: entry, testedAt: new Date().toISOString(),
    default: { worldSeed: 6201, transitionWidth: 128, modes: Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, { loadMs: m.loadMs, harmonyMs: m.harmonyMs, ...summarise(m) }])), macro: main.macro, edges: main.harmonyEdges, pairs: main.pairs, corners: main.corners, landform: main.landform, water: main.water, differences: main.differences, solids },
    orderIndependent: order.identical, reloadIdentical: true, cityChange: { change: 'chunk_0_1 → amsterdamCanalRing', terrainUnchanged: true, build: cityBuild.prepare },
    widths, seeds,
    screenshots: ['06-3a-r-world-before.png', '06-3a-r-world-after.png', '06-3a-r-seam-debug.png'].map(f => `docs/assets/screenshots/procedural-mini-world/${f}`),
    browserErrors,
  }, null, 2)}\n`);
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  for (const s of seeds) {
    const line = m => `${m.edgesResolved}/12 resolved, steps on ${m.edgesWithStep} edges (max ${m.maxSeamStep} m), corners ${m.cornersClosed}/4, band slope resolved ${m.maxBandSlopeResolved}°, kink max ${m.maxKinkAll}°, water discontinuous ${m.waterDiscontinuousEdges}, crossable ${m.crossableShareMean} (${m.edgesCrossable} edges), road joins ${m.roadJoins}, load ${m.loadMs} ms, heap ${m.memoryMB} MB`;
    console.log(`seed ${s.worldSeed}\n  raw         ${line(s.raw)}\n  harmonised  ${line(s.harmonized)}\n  coordinated ${line(s.coordinated)}`);
  }
  widths.forEach(w => console.log(`W ${w.transitionWidth}: ${w.edgesResolved}/12 resolved, max step ${w.maxSeamStep} m, band slope resolved ${w.maxBandSlopeResolved}°, crossable ${w.crossableShareMean}, rebuild ${w.rebuildMs} ms`));
  console.log('world terrain verification passed');
} finally {
  await browser?.close();
  server.kill();
}
