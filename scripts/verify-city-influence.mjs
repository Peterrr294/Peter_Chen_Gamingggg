// 07.1 City Influence & Fusion: Venice (chunk_0_1, coast) invades Manhattan (chunk_0_0, plain) on world seed 6201.
// Checks: influence 0 = original world (all 9 chunk signatures); influence 100 % changes the boundary zone of the
// target (street origin, parcel size, building height by influence band); chunks other than source / target stay
// bit-identical, the target's w = 0 band keeps its buildings; same parameters reproduce (reload + cache path);
// reverse direction (Manhattan → Venice) as data. Writes evidence + 4 screenshots.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4211;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/city-influence.json');
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

const SOURCE = 'chunk_0_1'; const TARGET = 'chunk_0_0'; const RADIUS = 384;
const CITY = `city=${SOURCE}:veniceWaterNetwork`;
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
    await page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
    return Date.now() - started;
  };
  const sigs = () => lab(() => Object.fromEntries(window.__worldGridLab.summaries().map(s => [s.chunkId, s.signatures])));
  const counts = () => lab(() => Object.fromEntries(window.__worldGridLab.summaries().map(s => [s.chunkId, { dna: s.resolvedDNA, counts: s.counts }])));
  const setInf = async (influence) => { const t = Date.now(); const r = await lab(o => window.__worldGridLab.setInfluence(o), influence); return { ...r, ms: Date.now() - t, lastBuild: await lab(() => window.__worldGridLab.lastBuild().prepare) }; };
  const bandsOf = (chunkId, influence) => lab(([id, inf]) => window.__worldGridLab.zoneStats(id, inf), [chunkId, influence]);
  const fingerprint = (chunkId, influence) => lab(([id, inf]) => window.__worldGridLab.cityFingerprint(id, inf), [chunkId, influence]);
  const full = { strength: 1, radius: RADIUS };

  // 1. Original world (no influence) with Venice set manually next to Manhattan.
  const loadMs = await openWorld(CITY);
  const original = await sigs();
  const originalCounts = await counts();
  assert(originalCounts[SOURCE].dna === 'veniceWaterNetwork' && originalCounts[TARGET].dna === 'manhattanGrid', `setup: ${JSON.stringify(originalCounts)}`);
  const baseBands = await bandsOf(TARGET, full); // target bands of the 100 % field, on the unfused city
  const baseFinger = await fingerprint(TARGET, full);
  const sourceBaseBands = await bandsOf(SOURCE, { source: TARGET, target: SOURCE, strength: 1, radius: RADIUS });

  // 2. Influence 0 = original world.
  const zero = await setInf({ source: SOURCE, target: TARGET, strength: 0, radius: RADIUS });
  const zeroSigs = await sigs();
  assert(!zero.active && same(zeroSigs, original), 'influence 0 changed the world');

  // 3. Influence 50 % and 100 %.
  const half = await setInf({ strength: 50 });
  const halfSigs = await sigs();
  const halfBands = await bandsOf(TARGET, full);
  const fullRun = await setInf({ strength: 100 });
  assert(fullRun.active && fullRun.fusion && !fullRun.fusion.unchanged, `100 % did not fuse: ${JSON.stringify(fullRun.reason)}`);
  const fullSigs = await sigs();
  const fullBands = await bandsOf(TARGET, full);
  const fullFinger = await fingerprint(TARGET, full);
  const fullCounts = await counts();
  const others = Object.keys(original).filter(id => id !== SOURCE && id !== TARGET);
  const othersSame = Object.fromEntries(others.map(id => [id, same(original[id], fullSigs[id])]));
  assert(Object.values(othersSame).every(Boolean), `unaffected chunks changed: ${JSON.stringify(othersSame)}`);
  for (const id of [SOURCE, TARGET]) for (const k of ['raw', 'height', 'water', 'rawNetwork']) {
    if (id === TARGET && k === 'rawNetwork') continue; // the target's own pre-seam network is the fused network
    assert(original[id][k] === fullSigs[id][k], `${id} ${k} changed`);
  }
  assert(original[TARGET].buildings !== fullSigs[TARGET].buildings, 'target buildings unchanged at 100 %');
  // Observable change in the core of the fusion zone (w ≥ 0.65), little change where w = 0.
  const zoneCore = b => b.find(x => x.band === 'w ≥ 0.65');
  const zoneNone = b => b.find(x => x.band === 'w = 0');
  const c0 = zoneCore(baseBands); const c1 = zoneCore(fullBands);
  assert(c1.invaderRoadShare > 0.5, `core invader road share ${c1.invaderRoadShare}`);
  assert(c1.meanParcelArea < c0.meanParcelArea && c1.meanFrontage < c0.meanFrontage, `core parcels did not shrink ${c0.meanParcelArea} → ${c1.meanParcelArea}`);
  assert(c1.meanHeight < c0.meanHeight, `core heights did not fall ${c0.meanHeight} → ${c1.meanHeight}`);
  const keep = (a, b, band) => { const keys = new Set(b.filter(x => x.band === band).map(x => x.key)); const list = a.filter(x => x.band === band); return { total: list.length, kept: list.filter(x => keys.has(x.key)).length, share: list.length ? +(list.filter(x => keys.has(x.key)).length / list.length).toFixed(4) : null }; };
  const retention = Object.fromEntries([0, 1, 2, 3].map(band => [baseBands[band].band, { buildings: keep(baseFinger.buildings, fullFinger.buildings, band), parcels: keep(baseFinger.parcels, fullFinger.parcels, band) }]));
  assert(retention['w = 0'].buildings.share >= 0.9, `w = 0 band lost buildings: ${JSON.stringify(retention['w = 0'])}`);
  const sourceFullBands = await bandsOf(SOURCE, { source: TARGET, target: SOURCE, strength: 1, radius: RADIUS });

  // 4. Reproducibility: cache path (0 → 100 %) and reload with the same URL parameters.
  await setInf({ strength: 0 });
  assert(same(await sigs(), original), 'back to 0 did not restore the original world');
  await setInf({ strength: 100 });
  const again = await sigs();
  const reloadMs = await openWorld(`${CITY}&invade=${SOURCE}>${TARGET}&strength=100&radius=${RADIUS}`);
  const reload = await sigs();
  const reloadInf = await lab(() => window.__worldGridLab.influence());
  assert(same(again, fullSigs) && same(reload, fullSigs) && reloadInf.fusion.fusedSignature === fullRun.fusion.fusedSignature, 'same parameters did not reproduce');

  // 5. Reverse direction: Manhattan invades Venice (data only).
  const revBase = await (async () => { await setInf({ strength: 0 }); return bandsOf(SOURCE, { source: TARGET, target: SOURCE, strength: 1, radius: RADIUS }); })();
  const rev = await setInf({ source: TARGET, target: SOURCE, strength: 100 });
  const revBands = await bandsOf(SOURCE, { source: TARGET, target: SOURCE, strength: 1, radius: RADIUS });
  const revSigs = await sigs();
  const revOthersSame = Object.fromEntries(Object.keys(original).filter(id => id !== SOURCE && id !== TARGET).map(id => [id, same(original[id], revSigs[id])]));

  // 6. Screenshots: overall, boundary before / after (same camera), influence debug (top).
  await mkdir(shots, { recursive: true });
  const shot = async (query, file) => { await openWorld(query); await page.waitForTimeout(400); await page.locator('#worldCanvas').screenshot({ path: path.join(shots, file) }); };
  const inv = `${CITY}&invade=${SOURCE}>${TARGET}&radius=${RADIUS}&select=${TARGET}`;
  await shot(`${inv}&strength=100&zone=1`, '07-1-fusion-overall-after.png');
  await shot(`${inv}&strength=0&focus=-120,400,620`, '07-1-boundary-closeup-before.png');
  await shot(`${inv}&strength=100&focus=-120,400,620`, '07-1-boundary-closeup-after.png');
  await shot(`${inv}&strength=100&field=1&zone=1&camera=top&focus=0,256,1500`, '07-1-influence-debug.png');

  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  const evidence = {
    task: '07.1', createdAt: new Date().toISOString(), worldSeed: 6201, transitionWidth: 128, terrain: 'coordinated (default)', roads: 'joined (default)',
    setup: { source: { chunkId: SOURCE, cityId: 'veniceWaterNetwork (manual)' }, target: { chunkId: TARGET, cityId: 'manhattanGrid (manual, default layout)' }, radius: RADIUS },
    timing: { loadMs, reloadMs, halfMs: half.ms, fullMs: fullRun.ms, fusionMs: fullRun.fusion.ms, reverseMs: rev.ms },
    influenceZero: { active: zero.active, reason: zero.reason, identicalToOriginal: true },
    half: { fusion: half.fusion && { unchanged: half.fusion.unchanged, stats: half.fusion.stats }, bands: halfBands, changedChunks: Object.keys(original).filter(id => !same(original[id], halfSigs[id])) },
    full: { fusion: fullRun.fusion, rules: fullRun.rules, rebuilt: fullRun.lastBuild, counts: { before: originalCounts[TARGET], after: fullCounts[TARGET], sourceBefore: originalCounts[SOURCE], sourceAfter: fullCounts[SOURCE] } },
    targetBands: { before: baseBands, after: fullBands },
    sourceBands: { note: 'source chunk banded by its distance to the target (road seam connectors only)', before: sourceBaseBands, after: sourceFullBands },
    unaffected: { otherChunksIdentical: othersSame, targetRetentionByBand: retention, sourceSignatures: { before: original[SOURCE], after: fullSigs[SOURCE] } },
    reproducible: { cachePath: true, reload: true, fusedSignature: fullRun.fusion.fusedSignature },
    reverse: { source: TARGET, target: SOURCE, fusion: rev.fusion && { unchanged: rev.fusion.unchanged, stats: rev.fusion.stats }, bands: { before: revBase, after: revBands }, otherChunksIdentical: revOthersSame },
    screenshots: ['07-1-fusion-overall-after.png', '07-1-boundary-closeup-before.png', '07-1-boundary-closeup-after.png', '07-1-influence-debug.png'],
    browserErrors,
  };
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, timing: evidence.timing, fusion: fullRun.fusion.stats, core: { before: c0, after: c1 }, retention, othersSame, half: evidence.half.changedChunks, reverse: { stats: rev.fusion?.stats, before: zoneCore(revBase), after: zoneCore(revBands) } }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
