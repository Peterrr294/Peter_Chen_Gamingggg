// 06.3c seam classification: geometry / landform / hydrology / transport status per shared edge on the default
// (06.3a-R2) terrain for world seeds 6201–6203 and transition widths 128 / 64 / 256 m. Checks the class rules
// (smooth = no made-steep cell and kink ≤ 2°; valid escarpment = continuous + landform pair + ≤ 75° + no pit / ridge;
// legacy resolved count = smooth count, so nothing unresolved is renamed into a success), cores and core water,
// negative controls (raw terrain → all failed; macro-ramp terrain without run data → candidates, never valid), the
// datum audit (relative terrainAnalysis metrics and auto City DNA unchanged by the world datum shift; manual City IDs
// kept), reproducibility. Writes evidence + screenshots.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { SEAM_CLASS_RULES } from '../experiments/world-grid/SeamClassifier.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4210;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/seam-classes.json');
const OVERALL = ['smooth', 'smoothKink', 'escarpment', 'candidate', 'failed'];
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
    await page.goto(`${base}${entry}${query ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
    return Date.now() - started;
  };
  const measure = async () => lab(() => {
    const l = window.__worldGridLab;
    const h = l.harmony();
    return { classes: l.seamClasses(), terrainEdges: h ? h.edges.map(e => ({ id: e.id, status: e.status })) : null, core: l.coreAudit(), summaries: l.summaries(), memoryMB: l.memory(), harmonyMs: h ? Math.round(h.ms) : 0, coast: l.summaries().filter(s => s.landform === 'coast').map(s => ({ chunkId: s.chunkId, ...l.landformStats(s.chunkId) })) };
  });
  // Class rules: the four statuses exist and the overall class follows from them.
  const checkRules = (m, label) => {
    for (const c of m.classes) {
      assert(c.geometryStatus && c.landformStatus && c.hydrologyStatus && c.transportStatus && OVERALL.includes(c.overall), `${label}: ${c.id} incomplete status`);
      if (c.overall === 'smooth' || c.overall === 'smoothKink') assert(c.geometryStatus === 'continuous' && c.landformStatus === 'smooth' && c.landform.steepCells === 0 && (c.overall === 'smoothKink') === !c.landform.kinkWithinTarget, `${label}: ${c.id} smooth rule`);
      if (c.overall === 'escarpment') assert(c.geometryStatus === 'continuous' && Object.values(c.landform.checks).every(Boolean) && c.landform.maxSlope <= 75 && c.landform.overshoot <= 1, `${label}: ${c.id} escarpment rule`);
      if (c.overall === 'candidate') assert(Object.values(c.landform.checks).some(v => !v), `${label}: ${c.id} candidate without a failed check`);
      if (c.overall === 'failed') assert(c.geometryStatus !== 'continuous' || c.landformStatus === 'unresolved' || ['incompatibleLevels', 'coreWaterLost'].includes(c.hydrologyStatus), `${label}: ${c.id} failed without a cause`);
      if (c.transportStatus === 'passable') assert(c.geometryStatus === 'continuous' && c.transport.longestRunM >= 40, `${label}: ${c.id} transport rule`);
    }
    if (m.terrainEdges) {
      const legacyResolved = m.terrainEdges.filter(e => e.status === 'resolved').map(e => e.id).sort();
      const smooth = m.classes.filter(c => c.overall === 'smooth' || c.overall === 'smoothKink').map(c => c.id).sort();
      assert(same(legacyResolved, smooth), `${label}: legacy resolved ≠ smooth (${legacyResolved} vs ${smooth})`);
    }
  };
  const count = m => Object.fromEntries(OVERALL.map(k => [k, m.classes.filter(c => c.overall === k).length]));
  const row = c => ({ id: c.id, landforms: c.landforms.join(' | '), overall: c.overall, geometryStatus: c.geometryStatus, landformStatus: c.landformStatus, hydrologyStatus: c.hydrologyStatus, transportStatus: c.transportStatus, maxStep: c.geometry.maxStep, cornerSpread: c.geometry.cornerSpread, maxBandSlope: c.geometry.maxBandSlope, kinkMax: c.geometry.kinkMax, steepCells: c.landform.steepCells, maxSteepSlope: c.landform.maxSlope, overshoot: c.landform.overshoot, failedChecks: c.landform.checks ? Object.entries(c.landform.checks).filter(([, v]) => !v).map(([k]) => k) : [], reason: c.landform.reason, seaHeld: c.hydrology.seaHeldSamples, bandWaterLoss: c.hydrology.bandWaterLossCells, coreWaterLost: c.hydrology.coreWaterLost, waterReasons: c.hydrology.reasons, crossableShare: c.transport.crossableShare, longestRunM: c.transport.longestRunM, roadJoinsAllowed: c.transport.roadJoinsAllowed });

  // 1. Negative controls (6201): raw terrain → every edge failed; macro-ramp terrain (no run data) → never a valid escarpment.
  await openWorld('terrain=raw');
  const raw = await measure();
  checkRules(raw, 'raw');
  assert(raw.classes.every(c => c.overall === 'failed' && c.geometryStatus === 'discontinuous'), 'raw terrain: an edge is not failed');
  await openWorld('terrain=macroRamp');
  const macro = await measure();
  checkRules(macro, 'macroRamp');
  assert(!macro.classes.some(c => c.overall === 'escarpment'), 'macroRamp terrain: escarpment validated without run data');

  // 2. Default terrain: three seeds × W 128 / 64 / 256.
  const seeds = [];
  for (const worldSeed of [6201, 6202, 6203]) {
    const widths = [];
    for (const W of [128, 64, 256]) {
      const loadMs = await openWorld(`worldSeed=${worldSeed}&transitionWidth=${W}`);
      const m = await measure();
      checkRules(m, `seed ${worldSeed} W ${W}`);
      assert(m.classes.every(c => c.geometryStatus === 'continuous'), `seed ${worldSeed} W ${W}: geometry not continuous`);
      assert(m.core.every(c => c.core.changedVsBase === 0 && c.water.coreLost === 0), `seed ${worldSeed} W ${W}: core changed or core water lost`);
      const entryW = { transitionWidth: W, loadMs, harmonyMs: m.harmonyMs, memoryMB: m.memoryMB, counts: count(m), edges: m.classes.map(row), coast: m.coast.map(x => ({ chunkId: x.chunkId, wetShareRaw: x.wetShareRaw, wetShare: x.wetShare })), core: m.core.map(x => ({ chunkId: x.chunkId, landform: x.landform, changedShare: x.changedShare, coreChangedVsBase: x.core.changedVsBase, maxDelta: x.maxDelta, meanDelta: x.meanDeltaChanged, coreWaterLost: x.water.coreLost, slopeChange: x.slopeChange })) };
      if (W === 128) {
        // Datum audit + reproducibility at the default width.
        const audit = await lab(() => window.__worldGridLab.datumAudit());
        assert(audit.every(a => a.autoTopRaw === a.autoTopBase), `seed ${worldSeed}: auto City DNA changed by the datum shift alone ${JSON.stringify(audit)}`);
        assert(audit.every(a => a.manualKept), `seed ${worldSeed}: a manual City ID changed`);
        const maxRelative = Math.max(0, ...audit.map(a => a.maxRelativeChange));
        assert(audit.every(a => a.nonNumericRelativeDiffs === 0), `seed ${worldSeed}: a categorical terrainAnalysis result changed under a pure datum shift`);
        assert(maxRelative === 0 && audit.every(a => a.relativeDiffs === 0 && a.fieldFlips.waterMask === 0 && a.fieldFlips.buildableMask === 0), `seed ${worldSeed}: relative terrainAnalysis metric or field class changed under a pure datum shift (max ${maxRelative})`);
        entryW.datumAudit = audit;
        entryW.datumAuditMaxRelativeChange = maxRelative;
        await openWorld(`worldSeed=${worldSeed}&transitionWidth=${W}`);
        const again = await lab(() => window.__worldGridLab.seamClasses());
        assert(same(again, m.classes), `seed ${worldSeed}: classes not reproducible`);
        entryW.reproducible = true;
      }
      widths.push(entryW);
    }
    seeds.push({ worldSeed, widths });
  }

  // 3. Screenshots (6201, W 128): classes on the whole world (top view), a mountain escarpment and a coastal escarpment.
  await openWorld('seams=1&camera=top');
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '06-3c-seam-classes-overall.png') });
  await openWorld('seams=1&focus=0,-512,800&select=chunk_0_0');
  await page.waitForTimeout(400);
  await page.locator('.workspace').screenshot({ path: path.join(shots, '06-3c-escarpment-closeup.png') });
  await openWorld('seams=1&focus=1024,512,700&select=chunk_1_1');
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '06-3c-coastal-escarpment-closeup.png') });

  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify({
    task: '06.3c Seam classification and geometric continuity', experiment: entry, testedAt: new Date().toISOString(),
    rules: SEAM_CLASS_RULES,
    negativeControls: { raw: { counts: count(raw) }, macroRamp: { counts: count(macro), edges: macro.classes.map(row) } },
    seeds,
    screenshots: ['06-3c-seam-classes-overall.png', '06-3c-escarpment-closeup.png', '06-3c-coastal-escarpment-closeup.png'].map(f => `docs/assets/screenshots/procedural-mini-world/${f}`),
    browserErrors,
  }, null, 2)}\n`);
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  console.log(`negative controls: raw ${JSON.stringify(count(raw))}; macroRamp ${JSON.stringify(count(macro))}`);
  for (const s of seeds) for (const w of s.widths) console.log(`seed ${s.worldSeed} W ${w.transitionWidth}: ${JSON.stringify(w.counts)} · kink smooth max ${Math.max(0, ...w.edges.filter(e => e.overall.startsWith('smooth')).map(e => e.kinkMax))}° · scarp max ${Math.max(0, ...w.edges.map(e => e.maxSteepSlope))}° · passable ${w.edges.filter(e => e.transportStatus === 'passable').length}/12 · coast wet ${w.coast.map(c => `${c.wetShareRaw}→${c.wetShare}`).join(' ')}${w.datumAudit ? ` · datum audit max relative change ${w.datumAuditMaxRelativeChange}` : ''}`);
  console.log('seam classes verification passed');
} finally {
  await browser?.close();
  server.kill();
}
