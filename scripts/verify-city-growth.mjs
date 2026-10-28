// A City of Cities — G02 Procedural Urban Growth verifier.
// Part A (Node; seeds 6201 / 6202 / 6203): Stage A six origins → Stage B one step → Stage C 10 steps → Stage D 30
//   steps (only after C passed). Invariants after every step: one chunk per step, no overlap, traceable to the core,
//   4-connected territory per city, generation = parent + 1, real chain output with the city's own DNA. Also:
//   reproducible history (twin run), seeds differ, earlier chunks unchanged, save → load → continue = uninterrupted,
//   no call path into the 3 × 3 World Grid class or City Invasion (static scan).
// Part B (browser): the page reproduces the Node history, screenshots (origins, frontier, step 1 / 10 / 30, close-up,
//   seed comparison), timings and heap, Save → reload → Load → continue = uninterrupted continuation.
// Usage: node scripts/verify-city-growth.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = file => import(pathToFileURL(path.join(root, file)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { CITY_IDS } = await mod('experiments/city-of-cities/originConfig.js');

const seedArg = process.argv.find(a => a.startsWith('--seeds='));
const SEEDS = seedArg ? seedArg.split('=')[1].split(',').map(Number) : [6201, 6202, 6203];
const nodeOnly = process.argv.includes('--node-only');
const browserOnly = process.argv.includes('--browser-only');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const evidenceDir = path.join(root, 'experiments/city-of-cities/evidence');
const recordFile = path.join(evidenceDir, 'city-growth.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const json = v => JSON.stringify(v);
const stripMs = history => history.map(({ ms, ...e }) => e);
const sigs = world => Object.fromEntries([...world.chunks.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId)).map(c => [c.chunkId, c.outputs?.signatures ?? null])); // sorted: Map order differs after restore
const heapMB = () => Math.round(process.memoryUsage().heapUsed / 1048576);

function checkInvariants(w, label) {
  const chunks = [...w.chunks.values()];
  assert(w.occupancy.size === chunks.length && new Set(chunks.map(c => `${c.worldCoordinate.gx},${c.worldCoordinate.gy}`)).size === chunks.length, `${label}: overlap / duplicate cell`);
  for (const c of chunks) {
    if (c.role === 'core') { assert(!c.parentChunkId && c.generation === 0 && c.coreChunkId === c.chunkId, `${label}: bad core ${c.chunkId}`); continue; }
    const p = w.chunks.get(c.parentChunkId);
    assert(p && p.cityId === c.cityId && Math.abs(p.worldCoordinate.gx - c.worldCoordinate.gx) + Math.abs(p.worldCoordinate.gy - c.worldCoordinate.gy) === 1, `${label}: ${c.chunkId} parent rule broken`);
    assert(c.generation === p.generation + 1 && c.growthStep > p.growthStep, `${label}: ${c.chunkId} generation / order`);
    let q = c; let hops = 0;
    while (q.parentChunkId && hops < 999) { q = w.chunks.get(q.parentChunkId); hops += 1; }
    assert(q.role === 'core' && q.chunkId === c.coreChunkId && q.cityId === c.cityId && w.cities.get(c.cityId).originChunkId === q.chunkId, `${label}: ${c.chunkId} does not trace to its city core`);
    assert(c.outputs && c.outputs.resolvedDNA === c.cityId, `${label}: ${c.chunkId} not generated with its city DNA`);
  }
  // 4-connectivity per city (no isolated chunk).
  for (const cityId of CITY_IDS) {
    const mine = chunks.filter(c => c.cityId === cityId);
    const set = new Set(mine.map(c => `${c.worldCoordinate.gx},${c.worldCoordinate.gy}`));
    const start = w.chunks.get(w.cities.get(cityId).originChunkId).worldCoordinate;
    const seen = new Set([`${start.gx},${start.gy}`]); const stack = [start];
    while (stack.length) { const { gx, gy } = stack.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${gx + dx},${gy + dy}`; if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push({ gx: gx + dx, gy: gy + dy }); } } }
    assert(seen.size === set.size, `${label}: ${cityId} territory not 4-connected (${seen.size} of ${set.size})`);
  }
}

async function originsWorld(seed) {
  const w = new WorldContext({ worldSeed: seed });
  const report = w.initialise();
  assert(report.failures.length === 0, `seed ${seed}: placement failures ${json(report.failures)}`);
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return w;
}

const result = { task: 'G02 (A City of Cities) — Procedural Urban Growth', experiment: 'experiments/city-of-cities/', testedAt: new Date().toISOString(), seeds: SEEDS, node: {}, staticScan: null, browser: null };
if (browserOnly) Object.assign(result, (({ node, staticScan, nodeMs }) => ({ node, staticScan, nodeMs }))(JSON.parse(await readFile(recordFile, 'utf8'))));

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 10. Static scan: the growth code path never uses the 3 × 3 World Grid class, seams, or City Invasion.
  const forbidden = ['new WorldGrid', 'fuseNetwork', 'stitchRoads', 'coordinateTerrain', 'harmonizeWorld', 'coordinateWorld', 'influenceField', 'setInfluence', 'mixedRules'];
  const files = (await readdir(path.join(root, 'experiments/city-of-cities'))).filter(f => f.endsWith('.js'));
  const hits = [];
  for (const f of [...files.map(x => `experiments/city-of-cities/${x}`), 'experiments/growing-world/WorldGrowthController.js', 'experiments/growing-world/growthConfig.js']) {
    const text = await readFile(path.join(root, f), 'utf8');
    for (const token of forbidden) if (text.includes(token)) hits.push(`${f}: ${token}`);
  }
  assert(!hits.length, `forbidden call path: ${hits.join(', ')}`);
  result.staticScan = { files: files.length + 2, forbidden, hits: 0, note: 'only the pure layer functions generateRawLayer / generateTerrainLayer / generateNetworkLayer / generateUrbanLayer and the RULES table are imported from world-grid/' };

  for (const seed of SEEDS) {
    const t0 = Date.now(); const heap0 = heapMB();
    // Stage A.
    const w = await originsWorld(seed);
    assert(w.chunks.size === 6, `seed ${seed}: stage A`);
    checkInvariants(w, `seed ${seed} A`);
    const coreSigs = sigs(w);
    const stageAms = Date.now() - t0;
    const g = new WorldGrowthController(w);
    const steps = [];
    const runStep = () => {
      const before = w.chunks.size; const ts = Date.now();
      const r = g.step();
      if (r.stalled) { assert(w.chunks.size === before, `seed ${seed}: stall changed the world`); return r; }
      assert(w.chunks.size === before + 1, `seed ${seed} step ${r.event.step}: ${w.chunks.size - before} chunks added`);
      const c = w.chunks.get(r.event.newChunkId);
      assert(c.role === 'growth' && c.outputs.counts.networkEdges >= 0 && c.outputs.signatures.buildings, `seed ${seed}: step ${r.event.step} without real chain output`);
      checkInvariants(w, `seed ${seed} step ${r.event.step}`);
      steps.push({ step: r.event.step, chunkId: c.chunkId, cityId: c.cityId, parent: c.parentChunkId, generation: c.generation, score: r.event.selectionScore, roadKm: c.outputs.counts.roadKm, buildings: c.outputs.counts.buildings, ms: Date.now() - ts, evaluateMs: r.event.ms.evaluate, generateMs: r.event.ms.generate, heapMB: heapMB() });
      return r;
    };
    // Stage B.
    runStep();
    assert(w.chunks.size === 7, `seed ${seed}: stage B`);
    // Stage C.
    let stalled = null;
    while (w.growth.step < 10 && !stalled) stalled = runStep().stalled ?? null;
    const at5 = Object.fromEntries(Object.entries(sigs(w)).filter(([id]) => w.chunks.get(id).growthStep <= 5));
    const stageCHistory = stripMs(w.growth.history);
    const stageCSigs = sigs(w);
    const stageCStats = g.cityStats();
    // Determinism twin (stage C).
    const twin = await originsWorld(seed); const gt = new WorldGrowthController(twin); gt.grow(10);
    assert(json(stripMs(twin.growth.history)) === json(stageCHistory) && json(sigs(twin)) === json(stageCSigs), `seed ${seed}: 10-step history not reproducible`);
    // Save at step 5 → load → regenerate → continue to 10 = uninterrupted.
    const half = await originsWorld(seed); const gh = new WorldGrowthController(half); gh.grow(5);
    const saved = JSON.parse(json(half.serialise()));
    const loaded = WorldContext.restore(saved);
    for (const c of [...loaded.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) { const { chunk } = loaded.generateChunk(c.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `seed ${seed}: restored ${c.chunkId} differs`); }
    assert(loaded.growth.step === 5 && loaded.chunks.size === 11, `seed ${seed}: restore lost growth state`);
    const gl = new WorldGrowthController(loaded); gl.grow(5);
    assert(json(stripMs(loaded.growth.history)) === json(stageCHistory) && json(sigs(loaded)) === json(stageCSigs), `seed ${seed}: save / load / continue differs from uninterrupted growth`);
    // Stage D (only after C passed).
    while (w.growth.step < 30 && !stalled) stalled = runStep().stalled ?? null;
    // 8. Earlier chunks unchanged (cores and the first five growth chunks).
    const now = sigs(w);
    assert(Object.entries(coreSigs).every(([id, s]) => json(now[id]) === json(s)) && Object.entries(at5).every(([id, s]) => json(now[id]) === json(s)), `seed ${seed}: an earlier chunk changed`);
    checkInvariants(w, `seed ${seed} D`);
    const stats = g.cityStats();
    const conflicts = w.growth.history.flatMap(e => e.conflicts);
    const count = (list, f) => list.reduce((acc, x) => { const k = f(x); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
    if (seed === SEEDS[0]) await writeFile(path.join(evidenceDir, `world-${seed}-g02-step${w.growth.step}-state.json`), `${JSON.stringify(w.serialise(), null, 2)}\n`);
    result.node[seed] = {
      stageAms, steps, stalled, stageC: { history: stageCHistory.map(e => `${e.step}:${e.newChunkId}:${e.cityId}<${e.parentChunkId}`), stats: stageCStats },
      final: { step: w.growth.step, chunks: w.chunks.size, maxGeneration: w.growth.generation, perCity: stats },
      conflicts: { sharedEdges: conflicts.length, sameCity: conflicts.filter(c => c.sameCity).length, cityBoundary: conflicts.filter(c => !c.sameCity).length, geometry: count(conflicts, c => c.geometry), hydrology: count(conflicts, c => c.hydrology), unpairedRoadPorts: conflicts.reduce((n, c) => n + c.roads.unpaired, 0) },
      contestedSteps: w.growth.history.filter(e => e.growthReason.contested.length).map(e => `${e.step}: ${e.cityId} took (${e.targetCoordinate.gx}, ${e.targetCoordinate.gy}) over ${e.growthReason.contested.map(c => c.cityId).join(', ')}`),
      emptyChunks: [...w.chunks.values()].filter(c => c.outputs.counts.buildings === 0).map(c => `${c.chunkId} ${c.cityId} ${c.role}`),
      reproducible: true, saveLoadContinue: true, unchanged: true, totalMs: Date.now() - t0, heapStartMB: heap0, heapEndMB: heapMB(),
    };
    console.log(`seed ${seed}: step ${w.growth.step}${stalled ? ' (stalled)' : ''}, ${w.chunks.size} chunks, per city ${json(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.chunks])))}, ${Date.now() - t0} ms`);
  }
  const histories = SEEDS.map(s => result.node[s].stageC.history.join());
  assert(new Set(histories).size === SEEDS.length, 'different seeds gave identical growth histories');
  if (SEEDS.length === 1) console.log('note: one seed only, seed variation not checked in this run');
  result.nodeMs = Date.now() - started;
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4215; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
  const exists = async file => { try { await access(file); return true; } catch { return false; } };
  const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
  const browserPath = async () => {
    for (const c of [process.env.PLAYWRIGHT_CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean)) if (await exists(c)) return c;
    throw new Error('Chrome or Edge was not found.');
  };
  const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
  let browser;
  try {
    for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) { if (server.exitCode !== null) throw new Error(`Vite stopped.\n${output}`); await new Promise(r => setTimeout(r, 250)); }
    browser = await chromium.launch({ executablePath: await browserPath(), headless: true, args: ['--enable-precise-memory-info'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`page: ${e.message}`));
    const lab = (fn, arg) => page.evaluate(fn, arg);
    const waitReady = () => page.waitForFunction(() => window.__originLab?.ready === true, null, { timeout: 1800000 });
    const call = async (fn, arg) => { await lab(fn, arg); await page.waitForTimeout(50); await waitReady(); const e = await lab(() => window.__originLab.error()); assert(!e, `page error: ${e}`); };
    const shot = async name => { await page.waitForTimeout(700); const file = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: file }); return path.relative(root, file).replaceAll('\\', '/'); };
    const b = { screenshots: {}, seeds: {} };
    const seedPngs = [];
    for (const seed of SEEDS) {
      const s = {};
      const t0 = Date.now();
      await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' });
      await waitReady();
      await call(x => window.__originLab.generate(x), seed);
      s.originsMs = Date.now() - t0; s.originsHeapMB = await lab(() => window.__originLab.memoryMB());
      if (seed === SEEDS[0]) {
        b.screenshots.origins = await shot('g02-growth-origins-after.png');
        // Frontier debug around the first city expected to grow (from the Node run), labels readable.
        const first = result.node[seed].steps[0];
        const core = (await lab(() => window.__originLab.chunks())).find(c => c.cityId === first.cityId && c.role === 'core').worldCoordinate;
        await lab(([gx, gy]) => { window.__originLab.setLayers({ growthFrontier: true }); window.__originLab.fitRegion(gx - 2, gy - 2, gx + 2, gy + 2); }, [core.gx, core.gy]);
        b.screenshots.frontier = await shot('g02-growth-frontier-debug.png');
        await lab(() => window.__originLab.setLayers({ growthFrontier: false }));
      }
      const t1 = Date.now();
      await call(() => window.__originLab.growSteps(1));
      s.step1Ms = Date.now() - t1;
      const c1 = await lab(() => window.__originLab.chunks());
      assert(c1.length === 7 && await lab(() => window.__originLab.sceneChunkCount()) === 7, `browser seed ${seed}: step 1 did not add exactly one rendered chunk`);
      if (seed === SEEDS[0]) { await lab(() => window.__originLab.overview('top')); b.screenshots.step1 = await shot('g02-growth-step1-after.png'); }
      await call(() => window.__originLab.growSteps(9));
      if (seed === SEEDS[0]) { await lab(() => { window.__originLab.setLayers({ history: true }); window.__originLab.overview('top'); }); b.screenshots.step10 = await shot('g02-growth-step10-after.png'); }
      const t2 = Date.now();
      await call(() => window.__originLab.growSteps(20));
      s.steps11to30Ms = Date.now() - t2;
      const hist = await lab(() => window.__originLab.history());
      const nodeHist = result.node[seed];
      // Cross-runtime: the growth history (cells, cities, parents, scores, counts) must equal the Node run.
      const brief = h => h.map(e => `${e.step}:${e.newChunkId}:${e.cityId}<${e.parentChunkId}:${e.selectionScore}:${e.outputs.counts.buildings}`);
      const nodeBrief = nodeHist.steps.map(x => `${x.step}:${x.chunkId}:${x.cityId}<${x.parent}:${x.score}:${x.buildings}`);
      assert(json(brief(hist)) === json(nodeBrief), `browser seed ${seed}: growth history differs from Node`);
      s.timing = await lab(() => window.__originLab.growthTiming());
      s.heapMB = await lab(() => window.__originLab.memoryMB());
      s.chunks = (await lab(() => window.__originLab.chunks())).length;
      await lab(() => { window.__originLab.setLayers({ history: true, growthFrontier: false }); window.__originLab.overview('top'); });
      const tmp = path.join((await import('node:os')).tmpdir(), `g02-growth-step30-seed${seed}.png`);
      await page.waitForTimeout(700); await page.locator('#worldCanvas').screenshot({ path: tmp });
      seedPngs.push([seed, tmp]);
      if (seed === SEEDS[0]) {
        b.screenshots.step30 = await shot('g02-growth-step30-after.png');
        // Close-up of the growth chunk with the most buildings.
        const best = (await lab(() => window.__originLab.chunks())).filter(c => c.role === 'growth').sort((a, c) => c.outputs.counts.buildings - a.outputs.counts.buildings)[0];
        await lab(id => { window.__originLab.setLayers({ history: false }); window.__originLab.selectChunk(id); window.__originLab.focusChunk(id); }, best.chunkId);
        b.screenshots.closeup = await shot('g02-growth-chunk-closeup-after.png'); b.closeupChunk = { chunkId: best.chunkId, cityId: best.cityId, step: best.growthStep, ...best.outputs.counts };
        // Save at 30 → one more step (reference) → reload → load → one step = same event.
        await lab(() => window.__originLab.saveLocal());
        await call(() => window.__originLab.growSteps(1));
        const reference = (await lab(() => window.__originLab.history())).at(-1);
        await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' });
        await waitReady();
        const t3 = Date.now();
        await call(() => window.__originLab.loadLocal());
        b.restoreMs = Date.now() - t3;
        assert(json(await lab(() => window.__originLab.mismatches())) === '[]', 'browser: restored chunks differ from their saved signatures');
        assert((await lab(() => window.__originLab.chunks())).length === 36, 'browser: restore lost chunks');
        await call(() => window.__originLab.growSteps(1));
        const after = (await lab(() => window.__originLab.history())).at(-1);
        const { ms: m1, ...ra } = reference; const { ms: m2, ...rb } = after;
        assert(json(ra) === json(rb), 'browser: growth after reload differs from the uninterrupted step');
        b.restore = { chunks: 36, mismatches: 0, continuedStep: after.step, sameAsUninterrupted: true };
      }
      b.seeds[seed] = s;
      console.log(`browser seed ${seed}: origins ${s.originsMs} ms, step 1 ${s.step1Ms} ms, steps 11–30 ${s.steps11to30Ms} ms, ${s.chunks} chunks, heap ${s.heapMB} MB`);
    }
    // Seed comparison sheet (step 30 of the three seeds).
    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: 2400, height: 620 });
    const imgs = await Promise.all(seedPngs.map(async ([seed, file]) => [seed, (await readFile(file)).toString('base64')]));
    await sheet.setContent(`<body style="margin:0;background:#081014;color:#f4f1ea;font:18px system-ui"><div style="display:flex;gap:10px;padding:10px">${imgs.map(([seed, png]) => `<figure style="margin:0;flex:1"><figcaption style="padding:6px 0">world seed ${seed} · 30 growth steps · 36 chunks</figcaption><img src="data:image/png;base64,${png}" style="width:100%;display:block"/></figure>`).join('')}</div></body>`);
    b.screenshots.compare = path.relative(root, path.join(shots, 'g02-growth-seed-compare.png')).replaceAll('\\', '/');
    await sheet.screenshot({ path: path.join(root, b.screenshots.compare), fullPage: true });
    b.errors = errors;
    assert(!errors.length, `browser errors:\n${errors.join('\n')}`);
    result.browser = b;
    console.log('Part B passed');
  } finally {
    await browser?.close();
    server.kill();
  }
}

await mkdir(evidenceDir, { recursive: true });
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(`G02 verification passed. Record: ${path.relative(root, recordFile)}`);
