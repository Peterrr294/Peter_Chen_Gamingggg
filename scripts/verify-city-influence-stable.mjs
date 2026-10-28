// 07.1a City Invasion stable generation. Per world seed (6201, 6202, 6203), Venice (chunk_0_1, manual) invades
// Manhattan (chunk_0_0), radius 384 m:
//   legacy ids  — influence 0 = original; stability of the w = 0 zone at 100 % (the 07.1 defect, reported);
//   spatial ids — influence 0 % / 25 % / 50 % / 100 %: 0 = spatial original, other 7 chunks bit-identical, every w = 0
//                 parcel stable unless its block / frontage roads changed (0 unstable, 0 unexplained); reverse
//                 Manhattan → Venice at 100 % (per-run jitter streams); reload with the same URL reproduces.
// Screenshots (6201): original vs fused comparison, w = 0 stability debug. Writes evidence JSON.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4212;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/city-influence-stable.json');
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

const SEEDS = [6201, 6202, 6203];
const STRENGTHS = [0, 25, 50, 100];
const SOURCE = 'chunk_0_1'; const TARGET = 'chunk_0_0'; const RADIUS = 384;
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
  const openWorld = async query => {
    const started = Date.now();
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 900000 });
    return Date.now() - started;
  };
  const sigs = () => lab(() => Object.fromEntries(window.__worldGridLab.summaries().map(s => [s.chunkId, s.signatures])));
  const setInf = async influence => { const t = Date.now(); const r = await lab(o => window.__worldGridLab.setInfluence(o), influence); return { active: r.active, fusion: r.fusion?.stats ?? null, ms: Date.now() - t, rebuilt: (await lab(() => window.__worldGridLab.lastBuild().prepare.cityStale)) }; };
  const stability = () => lab(() => window.__worldGridLab.stability());
  const bands = (chunkId, influence) => lab(([id, inf]) => window.__worldGridLab.zoneStats(id, inf), [chunkId, influence]);
  const othersOf = (a, b, skip) => Object.keys(a).filter(id => !skip.includes(id)).filter(id => !same(a[id], b[id]));
  const query = seed => `worldSeed=${seed}&city=${SOURCE}:veniceWaterNetwork&invade=${SOURCE}>${TARGET}&radius=${RADIUS}`;
  const runs = [];

  for (const seed of SEEDS) {
    const run = { seed, legacy: {}, spatial: { strengths: [] }, reverse: null };
    // Legacy ids (default World Grid): influence 0 = original; w = 0 stability at 100 %.
    run.legacy.loadMs = await openWorld(query(seed));
    const legacy0 = await sigs();
    const resolved = await lab(() => Object.fromEntries(window.__worldGridLab.summaries().map(s => [s.chunkId, s.resolvedDNA])));
    assert(resolved[SOURCE] === 'veniceWaterNetwork' && resolved[TARGET] === 'manhattanGrid', `${seed}: setup ${JSON.stringify(resolved)}`);
    const l100 = await setInf({ strength: 100 });
    run.legacy.full = { ...l100, stability: await stability(), otherChunksChanged: othersOf(legacy0, await sigs(), [SOURCE, TARGET]) };
    await setInf({ strength: 0 });
    run.legacy.zeroIdentical = same(await sigs(), legacy0);
    assert(run.legacy.zeroIdentical, `${seed}: legacy influence 0 differs from the original`);

    // Spatial ids.
    await lab(() => window.__worldGridLab.setIdMode('spatial'));
    const spatial0 = await sigs();
    run.spatial.identity = await lab(id => window.__worldGridLab.identityStats(id), TARGET);
    run.spatial.vsLegacy = Object.fromEntries(Object.keys(spatial0).map(id => [id, Object.fromEntries(['raw', 'height', 'water', 'network', 'blocks', 'parcels', 'buildings'].map(k => [k, spatial0[id][k] === legacy0[id][k]]))]));
    for (const id of Object.keys(spatial0)) for (const k of ['raw', 'height', 'water', 'network']) assert(spatial0[id][k] === legacy0[id][k], `${seed}: spatial ids changed ${id} ${k}`);
    const before = await bands(TARGET, { strength: 1, radius: RADIUS });
    for (const strength of STRENGTHS) {
      const r = await setInf({ strength });
      const now = await sigs();
      const s = await stability();
      const entry = { strength, active: r.active, fusion: r.fusion, rebuiltCities: r.rebuilt, ms: r.ms, stability: s, otherChunksChanged: othersOf(spatial0, now, [SOURCE, TARGET]), bands: await bands(TARGET, { strength: 1, radius: RADIUS }), signatures: { target: now[TARGET], source: now[SOURCE] } };
      if (strength === 0) assert(same(now, spatial0) && !r.active, `${seed}: spatial influence 0 differs from the spatial original`);
      else {
        assert(!entry.otherChunksChanged.length, `${seed} ${strength}%: unaffected chunks changed ${entry.otherChunksChanged}`);
        assert(s && s.defects === 0, `${seed} ${strength}%: w = 0 defects ${JSON.stringify(s?.counts)}`);
      }
      run.spatial.strengths.push(entry);
    }
    run.spatial.bandsBefore = before;
    await setInf({ strength: 0 });
    assert(same(await sigs(), spatial0), `${seed}: back to 0 differs`);
    // Reverse: Manhattan → Venice (Venice parcels use jitter: per-run streams).
    const rev = await setInf({ source: TARGET, target: SOURCE, strength: 100 });
    const revSigs = await sigs();
    run.reverse = { ...rev, stability: await stability(), otherChunksChanged: othersOf(spatial0, revSigs, [SOURCE, TARGET]) };
    assert(!run.reverse.otherChunksChanged.length && run.reverse.stability?.defects === 0, `${seed}: reverse ${JSON.stringify(run.reverse.stability?.counts)} ${run.reverse.otherChunksChanged}`);
    // Reload with the same parameters (spatial, 100 %) reproduces the in-session result.
    const full = run.spatial.strengths.find(x => x.strength === 100).signatures;
    run.reloadMs = await openWorld(`${query(seed)}&ids=spatial&strength=100`);
    const reload = await sigs();
    run.reproducible = same(reload[TARGET], full.target) && same(reload[SOURCE], full.source) && !othersOf(spatial0, reload, [SOURCE, TARGET]).length;
    assert(run.reproducible, `${seed}: reload did not reproduce`);
    runs.push(run);
    console.log(JSON.stringify({ seed, legacy: run.legacy.full.stability?.counts, spatial: run.spatial.strengths.map(x => [x.strength, x.stability?.counts ?? null]), reverse: run.reverse.stability?.counts }));
  }

  // Screenshots (6201): original vs fused (same camera, composed side by side), w = 0 stability debug (top-down).
  await mkdir(shots, { recursive: true });
  const canvasShot = () => page.locator('#worldCanvas').screenshot();
  await openWorld(`${query(6201)}&ids=spatial&select=${TARGET}&focus=-120,420,760`);
  await page.waitForTimeout(400);
  const original = await canvasShot();
  await setInf({ strength: 100 });
  await page.waitForTimeout(400);
  const fused = await canvasShot();
  const composed = await page.evaluate(async ([a, b]) => {
    const load = src => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement('canvas'); c.width = ia.width + ib.width + 8; c.height = ia.height + 40;
    const g = c.getContext('2d'); g.fillStyle = '#081014'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(ia, 0, 40); g.drawImage(ib, ia.width + 8, 40);
    g.fillStyle = '#f4f1ea'; g.font = '600 22px system-ui, sans-serif';
    g.fillText('Original (influence 0, spatial ids)', 16, 28); g.fillText('Fused (Venice → Manhattan, 100 %, r 384 m)', ia.width + 24, 28);
    return c.toDataURL('image/png').split(',')[1];
  }, [`data:image/png;base64,${original.toString('base64')}`, `data:image/png;base64,${fused.toString('base64')}`]);
  await writeFile(path.join(shots, '07-1a-original-vs-fused-compare.png'), Buffer.from(composed, 'base64'));
  await openWorld(`${query(6201)}&ids=spatial&select=${TARGET}&camera=top&focus=0,150,1250&stability=1&field=1`);
  await setInf({ strength: 100 });
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '07-1a-w0-stability-debug.png') });
  const debugStability = await stability();

  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  const evidence = {
    task: '07.1a', createdAt: new Date().toISOString(), transitionWidth: 128, terrain: 'coordinated (default)', roads: 'joined (default)',
    setup: { source: `${SOURCE} veniceWaterNetwork (manual)`, target: `${TARGET} manhattanGrid (manual)`, radius: RADIUS, strengths: STRENGTHS, seeds: SEEDS },
    runs, debugStability,
    screenshots: ['07-1a-original-vs-fused-compare.png', '07-1a-w0-stability-debug.png'],
    browserErrors,
  };
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('city influence stable generation verification passed');
} finally {
  await browser?.close();
  server.kill();
}
