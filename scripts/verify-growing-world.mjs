// G01 Multi-Origin Procedural World Growth verifier.
// Part A (Node, data only, WorldGrowthController): cores, one chunk per step, traceability, no overlap, free shape,
//   reproducibility, seed variation, immutability + order independence, save / load continuation — 3 world seeds.
// Part B (browser, real chain + rendering): six cores, early and large worlds (screenshots, time, memory), City IDs
//   resolve to their own generator, save / load in the page and continued growth.
// Usage: node scripts/verify-growing-world.mjs [--node-only] [--large=48]
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WorldGrowthController, networkOf, terrainOf } = await import(pathToFileURL(path.join(root, 'experiments/growing-world/WorldGrowthController.js')));
const { CITY_ORDER, cellOf } = await import(pathToFileURL(path.join(root, 'experiments/growing-world/growthConfig.js')));

const SEEDS = [6201, 1234, 4242];
const STEPS = 24;
const largeArg = process.argv.find(a => a.startsWith('--large='));
const LARGE = largeArg ? Number(largeArg.split('=')[1]) : 48;
const nodeOnly = process.argv.includes('--node-only');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const recordFile = path.join(root, 'experiments/growing-world/evidence/growing-world.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stable = state => JSON.stringify({ ...state, history: state.history.map(({ ms, ...h }) => h) }); // timings excluded
const frozen = r => JSON.stringify({ ...r, generationStatus: undefined });
const cheb = (a, b) => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
const result = { task: 'G01', experiment: 'experiments/growing-world/', testedAt: new Date().toISOString(), seeds: SEEDS, steps: STEPS, node: {}, browser: null };

// ---------- Part A ----------
function checkWorld(c, label) {
  const records = [...c.chunks.values()];
  const ids = new Set(records.map(r => r.chunkId));
  const cells = new Set(records.map(r => `${r.worldGridCoordinate.gx},${r.worldGridCoordinate.gy}`));
  assert(ids.size === records.length && cells.size === records.length, `${label}: duplicate chunk id or cell`);
  for (const r of records) {
    if (!r.parentChunkId) { assert(c.cores.includes(r.chunkId) && r.coreChunkId === r.chunkId, `${label}: ${r.chunkId} has no parent but is not a core`); continue; }
    const p = c.byId(r.parentChunkId);
    assert(p, `${label}: parent ${r.parentChunkId} of ${r.chunkId} missing`);
    assert(Math.abs(p.worldGridCoordinate.gx - r.worldGridCoordinate.gx) + Math.abs(p.worldGridCoordinate.gy - r.worldGridCoordinate.gy) === 1, `${label}: ${r.chunkId} not edge-adjacent to its parent`);
    assert(p.cityId === r.cityId && p.generationIndex < r.generationIndex, `${label}: ${r.chunkId} parent city / order mismatch`);
    // Trace to a core.
    let q = r; let hops = 0;
    while (q.parentChunkId && hops < 1000) { q = c.byId(q.parentChunkId); hops += 1; }
    assert(!q.parentChunkId && q.chunkId === r.coreChunkId && q.cityId === r.originCityId, `${label}: ${r.chunkId} does not trace to its core`);
    const cell = cellOf(c.worldSeed, r.worldGridCoordinate.gx, r.worldGridCoordinate.gy);
    assert(cell.terrainSeed === r.terrainSeed && cell.landform === r.landform, `${label}: ${r.chunkId} terrain identity is not position-keyed`);
  }
  return records;
}

const started = Date.now();
for (const seed of SEEDS) {
  const t0 = Date.now();
  const c = new WorldGrowthController({ worldSeed: seed });
  c.generateCores();
  // 1. Six cores, correct City IDs, distinct cells, min distance.
  const cores = c.cores.map(id => c.byId(id));
  assert(cores.length === 6 && c.chunks.size === 6, `seed ${seed}: ${c.chunks.size} chunks after cores`);
  assert(JSON.stringify(cores.map(r => r.cityId).sort()) === JSON.stringify([...CITY_ORDER].sort()), `seed ${seed}: core City IDs wrong`);
  let minCoreDistance = Infinity;
  for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) minCoreDistance = Math.min(minCoreDistance, cheb(cores[i].worldGridCoordinate, cores[j].worldGridCoordinate));
  assert(minCoreDistance >= c.params.coreMinDistance, `seed ${seed}: cores closer than ${c.params.coreMinDistance}`);
  const coreSnapshot = cores.map(frozen);
  // 2. One valid chunk per step; 8. earlier chunks never change.
  const snapshots = new Map();
  let stalls = 0;
  for (let s = 1; s <= STEPS; s += 1) {
    const before = c.chunks.size;
    const r = c.growStep();
    if (r.stalled) { stalls += 1; assert(c.chunks.size === before, `seed ${seed}: stall changed the world`); continue; }
    assert(c.chunks.size === before + 1, `seed ${seed} step ${s}: ${c.chunks.size - before} chunks added`);
    if (s === 8) for (const rec of c.chunks.values()) snapshots.set(rec.chunkId, frozen(rec));
  }
  const records = checkWorld(c, `seed ${seed}`); // 3, 4
  const unchanged = [...snapshots].every(([id, json]) => frozen(c.byId(id)) === json) && cores.every((r, i) => frozen(c.byId(r.chunkId)) === coreSnapshot[i]);
  assert(unchanged, `seed ${seed}: a chunk changed after later growth`);
  // Order independence: a chunk regenerated alone (cell + City ID) equals its record.
  const probeIds = [records[0], records[Math.floor(records.length / 2)], records.at(-1)];
  const regenerated = probeIds.map(r => {
    const cell = cellOf(seed, r.worldGridCoordinate.gx, r.worldGridCoordinate.gy);
    const terrain = terrainOf(cell);
    const net = networkOf(cell, r.cityId, terrain);
    return { chunkId: r.chunkId, same: terrain.fields.stats.heightSignature === r.signatures.height && net.network.signature === r.signatures.network };
  });
  assert(regenerated.every(x => x.same), `seed ${seed}: regenerated chunk differs from its record`);
  // 5. Shape not a fixed 3 × 3.
  const s = c.summary();
  const width = s.bounds.maxX - s.bounds.minX + 1; const height = s.bounds.maxY - s.bounds.minY + 1;
  assert(width > 3 || height > 3, `seed ${seed}: world fits a 3 × 3 grid`);
  // 6. Same seed + params + steps = same map.
  const twin = new WorldGrowthController({ worldSeed: seed });
  twin.generateCores(); twin.growSteps(STEPS);
  assert(stable(twin.serialise()) === stable(c.serialise()), `seed ${seed}: not reproducible`);
  // 9. Save → JSON → load → continue = uninterrupted growth.
  const half = new WorldGrowthController({ worldSeed: seed });
  half.generateCores(); half.growSteps(STEPS / 2);
  const loaded = WorldGrowthController.restore(JSON.parse(JSON.stringify(half.serialise())));
  loaded.growSteps(STEPS / 2);
  assert(stable(loaded.serialise()) === stable(c.serialise()), `seed ${seed}: save / load continuation differs`);
  result.node[seed] = {
    cores: cores.map(r => ({ chunkId: r.chunkId, cityId: r.cityId, cell: r.worldGridCoordinate, landform: r.landform, terrainSeed: r.terrainSeed, fitScore: r.suitability.fitScore })),
    minCoreDistance, summary: s, shape: { width, height }, stalls, unchangedAfterGrowth: unchanged, regenerated, reproducible: true, saveLoadContinues: true,
    contests: c.history.length && [...c.chunks.values()].reduce((n, r) => n + (r.growthReason.contests?.length ?? 0), 0),
    issues: c.issues.map(i => (i.type === 'suitability' ? `${i.chunkId} ${i.cityId} on ${i.landform}: fit ${i.fitScore}${i.conflicts.length ? ` [${i.conflicts}]` : ''}${i.core ? ' (core)' : ''}` : `${i.type}: ${i.reason}`)),
    history: c.history.map(h => `${h.step}:${h.chunkId}:${h.cityId}<${h.parentChunkId ?? 'core'}`),
    ms: Date.now() - t0,
  };
  console.log(`seed ${seed}: ${s.chunks} chunks, bounds ${width}×${height}, per city ${JSON.stringify(s.perCity)}, edges ${JSON.stringify(s.edges.geometry)}, ${Date.now() - t0} ms`);
}
// 7. Different seeds, different spatial distributions.
const layouts = SEEDS.map(seed => JSON.stringify(result.node[seed].cores.map(c => c.cell)));
assert(new Set(layouts).size === SEEDS.length, 'different seeds gave the same core layout');
const histories = SEEDS.map(seed => result.node[seed].history.join());
assert(new Set(histories).size === SEEDS.length, 'different seeds gave the same growth history');
result.nodeMs = Date.now() - started;
console.log(`Part A passed (${result.nodeMs} ms)`);

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4211; const base = `http://${host}:${port}`; const entry = '/experiments/growing-world/';
  const exists = async file => { try { await access(file); return true; } catch { return false; } };
  const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
  const browserPath = async () => {
    for (const candidate of [process.env.PLAYWRIGHT_CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean)) if (await exists(candidate)) return candidate;
    throw new Error('Chrome or Edge was not found.');
  };
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
  let browser;
  try {
    for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) { if (server.exitCode !== null) throw new Error(`Vite stopped.\n${output}`); await new Promise(r => setTimeout(r, 250)); }
    browser = await chromium.launch({ executablePath: await browserPath(), headless: true, args: ['--enable-precise-memory-info'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`page: ${e.message}`));
    const lab = (fn, arg) => page.evaluate(fn, arg);
    const waitReady = () => page.waitForFunction(() => window.__growthLab?.ready === true, null, { timeout: 1800000 });
    const call = async (fn, arg) => { await lab(fn, arg); await page.waitForTimeout(50); await waitReady(); const e = await lab(() => window.__growthLab.error()); assert(!e, `page error: ${e}`); };
    const shoot = async (name, mode) => { await lab(m => window.__growthLab.camera(m), mode); await page.waitForTimeout(600); const file = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: file }); return path.relative(root, file).replaceAll('\\', '/'); };
    const seed = SEEDS[0];
    const b = { seed, screenshots: {} };

    let t = Date.now();
    await page.goto(`${base}${entry}?worldSeed=${seed}`, { waitUntil: 'networkidle' });
    await waitReady();
    b.coresMs = Date.now() - t;
    const s0 = await lab(() => window.__growthLab.summary());
    const c0 = await lab(() => window.__growthLab.content());
    assert(s0.chunks === 6 && c0.length === 6, `browser: ${s0.chunks} chunks after cores`);
    // 10. Each City ID runs its own generator and produces content.
    b.coreContent = c0.map(c => ({ chunkId: c.chunkId, cityId: c.cityId, resolvedDNA: c.resolvedDNA, ...c.counts }));
    assert(c0.every(c => c.resolvedDNA === c.cityId), 'browser: a core did not resolve to its City DNA generator');
    b.screenshots.cores = await shoot('g01-six-cores-after.png', 'top');
    const coreSigs = Object.fromEntries(c0.map(c => [c.chunkId, c.signatures]));

    t = Date.now();
    await call(() => window.__growthLab.growMany(10));
    b.earlyMs = Date.now() - t;
    const s1 = await lab(() => window.__growthLab.summary());
    assert(s1.chunks === 16, `browser: ${s1.chunks} chunks after 10 steps`);
    await lab(() => window.__growthLab.setLayers({ frontier: true }));
    b.screenshots.early = await shoot('g01-early-growth-after.png', 'top');
    const saved = await lab(() => window.__growthLab.serialise());
    const earlySigs = Object.fromEntries((await lab(() => window.__growthLab.content())).map(c => [c.chunkId, c.signatures]));

    t = Date.now();
    await call(n => window.__growthLab.growTo(n), LARGE);
    b.largeMs = Date.now() - t;
    const s2 = await lab(() => window.__growthLab.summary());
    const c2 = await lab(() => window.__growthLab.content());
    assert(s2.chunks === LARGE, `browser: ${s2.chunks} chunks, expected ${LARGE}`);
    assert(c2.every(c => c.resolvedDNA === c.cityId), 'browser: a grown chunk did not keep its City DNA generator');
    // 8 (rendered content): cores and early chunks unchanged after further growth.
    assert(c2.every(c => !coreSigs[c.chunkId] || JSON.stringify(coreSigs[c.chunkId]) === JSON.stringify(c.signatures)), 'browser: a core changed');
    assert(c2.every(c => !earlySigs[c.chunkId] || JSON.stringify(earlySigs[c.chunkId]) === JSON.stringify(c.signatures)), 'browser: an early chunk changed');
    b.memoryMB = await lab(() => window.__growthLab.memoryMB());
    const steps = await lab(() => window.__growthLab.steps());
    const per = steps.map(x => x.totalMs).sort((x, y) => x - y);
    b.perChunkMs = { median: per[Math.floor(per.length / 2)], max: per.at(-1), mean: Math.round(per.reduce((x, y) => x + y, 0) / per.length) };
    b.large = { summary: s2, edges: await lab(() => window.__growthLab.edges()), buildings: c2.reduce((n, c) => n + c.counts.buildings, 0), roadKm: +c2.reduce((n, c) => n + c.counts.roadKm, 0).toFixed(1) };
    b.large.cityBoundaryEdges = b.large.edges.filter(e => e.identity === 'cityBoundary').map(e => `${e.a}|${e.b} ${e.cities.join('/')} ${e.geometry} Δh ${e.maxDh}`);
    b.large.edges = undefined;
    b.large.noRoadChunks = c2.filter(c => c.counts.roadKm === 0).map(c => `${c.chunkId} ${c.cityId} (${c.counts.buildings} buildings)`); // reported, not hidden
    assert(b.large.cityBoundaryEdges.length > 0, `browser: no city boundary formed at ${LARGE} chunks`);
    b.issues = (await lab(() => window.__growthLab.issues())).length;
    await lab(() => window.__growthLab.setLayers({ frontier: true, seams: true }));
    b.screenshots.large = await shoot('g01-large-world-after.png', 'top');
    b.screenshots.largeOblique = await shoot('g01-large-world-seams-debug.png', 'axo');

    // 9 (page): load the early save into a fresh page, content regenerates identically, then growth continues.
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' });
    await waitReady();
    t = Date.now();
    await call(state => window.__growthLab.load(state), saved);
    b.restoreMs = Date.now() - t;
    const mismatches = await lab(() => window.__growthLab.restoreMismatches());
    const cr = await lab(() => window.__growthLab.content());
    assert(!mismatches.length, `browser: restored chunks differ ${JSON.stringify(mismatches)}`);
    assert(cr.length === 16 && cr.every(c => JSON.stringify(earlySigs[c.chunkId]) === JSON.stringify(c.signatures)), 'browser: restored content differs');
    await call(() => window.__growthLab.growOne());
    const s3 = await lab(() => window.__growthLab.summary());
    assert(s3.chunks === 17 && s3.step === 11, `browser: growth after load gave ${s3.chunks} chunks at step ${s3.step}`);
    b.restore = { chunks: cr.length, mismatches: 0, continued: { chunks: s3.chunks, step: s3.step } };
    b.errors = errors;
    assert(!errors.length, `browser errors:\n${errors.join('\n')}`);
    result.browser = b;
    console.log(`Part B passed: cores ${b.coresMs} ms, +10 steps ${b.earlyMs} ms, to ${LARGE} chunks ${b.largeMs} ms, heap ${b.memoryMB} MB`);
  } finally {
    await browser?.close();
    server.kill();
  }
}

await mkdir(path.dirname(recordFile), { recursive: true });
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(`G01 verification passed. Record: ${path.relative(root, recordFile)}`);
