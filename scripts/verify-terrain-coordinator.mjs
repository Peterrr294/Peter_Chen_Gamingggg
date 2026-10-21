// 06.3a-R2 World terrain preservation & seam constraints: core-preserving coordinated terrain vs raw (06.2),
// edge-harmonised (06.3a) and macro-ramp (06.3a-R). Checks shared edges (Δh, off-grid sampler, rendered mesh), corners,
// cores unchanged against the world base, water (core water kept, sea level, no river spreading, coverage change and
// where), measured slope kink (resolved vs escarpment-candidate edges, 2° target), escarpment candidates + reasons,
// degradations against 06.3a incl. the 06.3a coast–coast cases, two transition widths per seed, City ID independence,
// downstream invalidation, input-order independence, reproducibility, load time and heap. Writes evidence + screenshots.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4209;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/terrain-coordinator.json');
const KINK_TARGET = 2;
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
    const seams = l.seams(); const summaries = l.summaries(); const h = l.harmony();
    return {
      summaries, build: l.lastBuild(), memoryMB: l.memory(), harmonyMs: h ? Math.round(h.ms) : 0, macro: h?.macro ?? null, budget: h?.slopeBudgetStep ?? null,
      edges: h ? h.edges : null,
      pairs: seams.pairs.map(p => ({ id: p.id, landforms: [p.a, p.b], status: p.harmony?.status ?? 'raw', heightMax: p.height.max, kinkMax: p.slope.kinkMaxDeg, kinkMedian: p.slope.kinkMedianDeg, kinkP95: p.slope.kinkP95Deg, bandMaxSlope: p.slope.bandMaxSlopeDeg, water: p.waterInterface })),
      corners: seams.corners.map(c => c.heightSpread),
      sampling: seams.pairs.map(p => l.edgeSampling(p.id).maxDifference),
      crossing: seams.pairs.map(p => l.crossability(p.id)),
      mesh: summaries.map(s => l.meshConsistency(s.chunkId)),
      water: l.waterAudit(), landform: summaries.map(s => l.landformStats(s.chunkId)), core: l.coreAudit(),
      roads: l.roadSeam().stats.connections,
    };
  });
  const landformOf = new Map();
  const summarise = m => {
    const resolved = m.pairs.filter(p => p.status === 'resolved'); const other = m.pairs.filter(p => p.status !== 'resolved');
    return {
      edgesResolved: resolved.length, maxSeamStep: Math.max(...m.pairs.map(p => p.heightMax)), cornersShared: m.corners.filter(v => v === 0).length,
      kinkResolvedMax: Math.max(0, ...resolved.map(p => p.kinkMax)), kinkResolvedOverTarget: resolved.filter(p => p.kinkMax > KINK_TARGET).length, kinkOtherMax: Math.max(0, ...other.map(p => p.kinkMax)),
      crossableShareMean: +(m.crossing.reduce((s, c) => s + c.share, 0) / m.crossing.length).toFixed(3), waterDiscontinuousEdges: m.pairs.filter(p => p.water.status === 'discontinuous').length,
      coastWet: m.landform.filter(l => l.landform === 'coast').map(l => ({ chunkId: l.chunkId, raw: l.wetShareRaw, now: l.wetShare })),
      untouchedShare: Object.fromEntries(m.landform.map(l => [l.chunkId, l.untouchedShare])),
      roadJoins: m.roads, memoryMB: m.memoryMB, harmonyMs: m.harmonyMs,
    };
  };
  const checkR2 = (m, raw, label) => {
    assert(m.summaries.every(s => s.status.startsWith('ready')), `${label}: not all chunks ready`);
    for (const p of m.pairs) assert(p.heightMax === 0, `${label}: ${p.id} Δh ${p.heightMax}`);
    assert(m.corners.every(v => v === 0), `${label}: corner not shared`);
    assert(m.sampling.every(d => d < 1e-4), `${label}: off-grid sampler differs across an edge`);
    assert(m.mesh.every(x => x.maxHeightError === 0 && x.maxPlanError === 0), `${label}: mesh differs from fields`);
    assert(same(m.summaries.map(s => s.signatures.raw), raw.summaries.map(s => s.signatures.raw)), `${label}: raw height fields changed`);
    assert(m.core.every(c => c.core.changedVsBase === 0 && c.water.coreLost === 0), `${label}: core changed or core water lost ${JSON.stringify(m.core.map(c => [c.chunkId, c.core, c.water]))}`);
    assert(m.water.every(w => w.seaLevelDev === 0 && w.riverOutsideRaw === 0), `${label}: water rule broken ${JSON.stringify(m.water)}`);
    for (const e of m.edges) if (e.status === 'unresolved') assert(e.reason && e.suggestion && e.escarpmentCandidates.length, `${label}: ${e.id} unresolved without reason / candidates`);
  };
  const solidsOk = async summaries => {
    for (const s of summaries) {
      const r = await lab(id => { const x = window.__worldGridLab.solid(id); return x.watertight && x.eulerCharacteristic === x.expectedEuler; }, s.chunkId);
      if (!r) return false;
    }
    return true;
  };

  // 1. Three seeds: raw · 06.3a · 06.3a-R · 06.3a-R2 at W 128, R2 again at W 256 (geometry + statistics), R2 reload.
  const seeds = [];
  let main = null;
  for (const worldSeed of [6201, 6202, 6203]) {
    const runs = {};
    for (const [name, query] of [['raw', 'terrain=raw'], ['harmonized', 'terrain=harmonized'], ['macroRamp', 'terrain=macroRamp'], ['coordinated', '']]) {
      const loadMs = await openWorld(`worldSeed=${worldSeed}${query ? `&${query}` : ''}`);
      runs[name] = { loadMs, ...(await measure()) };
    }
    const c = runs.coordinated;
    for (const s of c.summaries) landformOf.set(s.chunkId, s.landform);
    checkR2(c, runs.raw, `seed ${worldSeed} W 128`);
    assert(await solidsOk(c.summaries), `seed ${worldSeed}: solid not closed`);
    const order = await lab(() => window.__worldGridLab.orderTest());
    assert(order.identical, `seed ${worldSeed}: depends on input order`);
    if (worldSeed === 6201) {
      main = c;
      // City ID change: no coordination rerun, terrain of every chunk unchanged, city layers current.
      const before = await lab(() => window.__worldGridLab.summaries());
      await lab(() => window.__worldGridLab.setCity('chunk_0_1', 'amsterdamCanalRing'));
      const b = await lab(() => window.__worldGridLab.lastBuild());
      const after = await lab(() => window.__worldGridLab.summaries());
      assert(!b.prepare.harmony && b.prepare.raw.length === 0 && b.chunks.every(x => !x.ran.terrain), 'City ID change re-ran terrain');
      assert(after.every(s => ['raw', 'height', 'water'].every(k => s.signatures[k] === before.find(x => x.chunkId === s.chunkId).signatures[k])), 'City ID change altered terrain');
      const audit = await lab(() => window.__worldGridLab.roadAudit());
      assert(audit.cities.every(x => x.stitchedIsCurrent && x.blocksOnStitched), 'stale city layer after City ID change');
      await openWorld(`worldSeed=${worldSeed}`);
    }
    // Second width (and 64 m for 6201): geometry valid, dependent layers rebuilt.
    const widths = [];
    for (const W of worldSeed === 6201 ? [256, 64] : [256]) {
      const prev = await lab(() => window.__worldGridLab.summaries());
      await lab(w => window.__worldGridLab.setWorldOptions({ transitionWidth: w }), W);
      const m = await measure();
      checkR2(m, runs.raw, `seed ${worldSeed} W ${W}`);
      const stale = m.summaries.filter(s => s.resolvedDNA && s.signatures.height !== prev.find(p => p.chunkId === s.chunkId).signatures.height && s.builds.city <= prev.find(p => p.chunkId === s.chunkId).builds.city);
      assert(!stale.length, `W ${W}: stale city layers ${stale.map(s => s.chunkId)}`);
      assert(await solidsOk(m.summaries), `seed ${worldSeed} W ${W}: solid not closed`);
      widths.push({ transitionWidth: W, ...summarise(m), budget: m.budget, edges: m.edges.map(e => ({ id: e.id, status: e.status, continuity: e.continuity, madeSteepCells: e.madeSteepCells, waterConflict: e.waterConflict })), core: m.core.map(x => ({ chunkId: x.chunkId, changedShare: x.changedShare, coreChangedVsBase: x.core.changedVsBase })) });
      await openWorld(`worldSeed=${worldSeed}`);
    }
    const again = await measure();
    assert(same(again.summaries.map(s => s.signatures), c.summaries.map(s => s.signatures)) && same(again.edges, c.edges), `seed ${worldSeed}: not reproducible`);

    // Degradations against 06.3a and the 06.3a coast–coast cases.
    const isCoast = id => landformOf.get(id) === 'coast';
    const degraded = c.edges.filter(e => runs.harmonized.pairs.find(p => p.id === e.id).status === 'resolved' && e.status !== 'resolved')
      .map(e => ({ id: e.id, reason: e.reason, waterConflict: e.waterConflict, harmonizedWater: runs.harmonized.pairs.find(p => p.id === e.id).water, harmonizedOneSided: runs.harmonized.pairs.find(p => p.id === e.id).water.oneSided, rawWater: runs.raw.pairs.find(p => p.id === e.id).water }));
    const coastCases = c.edges.filter(e => isCoast(e.a) && isCoast(e.b) && runs.harmonized.pairs.find(p => p.id === e.id).status === 'resolved')
      .map(e => ({ id: e.id, status: e.status, continuity: e.continuity, waterConflict: e.waterConflict, madeSteepCells: e.madeSteepCells, maxCreatedSlope: e.maxCreatedSlope, escarpmentCandidates: e.escarpmentCandidates, rawWater: runs.raw.pairs.find(p => p.id === e.id).water, harmonizedWater: runs.harmonized.pairs.find(p => p.id === e.id).water, water: c.pairs.find(p => p.id === e.id).water }));
    for (const k of coastCases) assert(k.status === 'resolved' || (k.waterConflict && k.escarpmentCandidates.length), `seed ${worldSeed}: 06.3a coast–coast case ${k.id} lost without a water conflict`);
    seeds.push({
      worldSeed, modes: Object.fromEntries(Object.entries(runs).map(([k, m]) => [k, { loadMs: m.loadMs, ...summarise(m) }])),
      macro: c.macro, budget: c.budget,
      edges: c.edges.map(e => { const p = c.pairs.find(x => x.id === e.id); return { ...e, kinkMax: p.kinkMax, kinkP95: p.kinkP95, bandMaxSlopeMeasured: p.bandMaxSlope, water: p.water, kinkClass: e.status === 'resolved' ? (p.kinkMax <= KINK_TARGET ? 'smooth ≤ 2°' : 'smooth > 2°') : 'escarpment candidate', harmonized: runs.harmonized.pairs.find(x => x.id === e.id).status, macroRamp: runs.macroRamp.pairs.find(x => x.id === e.id).status }; }),
      core: c.core, landform: c.landform, water: c.water, widths, degraded, coastCases,
    });
  }

  // 2. Screenshots (6201, W 128): before (06.3a-R macro ramps) / after (06.3a-R2), section plots, seam debug close-up.
  const worldShots = [];
  for (const [label, query] of [['before: 06.3a-R macro ramps', 'terrain=macroRamp'], ['after: 06.3a-R2 core-preserving coordination', '']]) {
    await openWorld(query);
    await page.waitForTimeout(400);
    worldShots.push({ label, png: (await page.locator('#worldCanvas').screenshot()).toString('base64') });
  }
  const composite = async (html, file, width, height) => {
    await page.setContent(`<html><head><link rel="icon" href="data:,"/></head><body style="margin:0;background:#101214;color:#e8e4dc;font:14px system-ui,sans-serif">${html}</body></html>`);
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(shots, file), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
  };
  await composite(`<div style="padding:10px 14px;font-weight:600">06.3a-R2 · world seed 6201 · transition 128 m · same view</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px 8px">${worldShots.map(s => `<figure style="margin:0"><img src="data:image/png;base64,${s.png}" style="width:100%;display:block"/><figcaption style="padding:6px 4px">${s.label}</figcaption></figure>`).join('')}</div>`, '06-3a-r2-world-compare.png', 2000, 760);

  // Cross-sections from the runtime fields: raw, world base and coordinated heights across two edges.
  await openWorld('');
  const sectionEdges = [['chunk_0_-1|chunk_0_0', 'mountain | plain (escarpment candidate)'], ['chunk_-1_0|chunk_-1_1', 'plain | coast (sea held at the edge)'], ['chunk_0_0|chunk_0_1', 'plain | coast'], ['chunk_-1_0|chunk_0_0', 'plain | plain']];
  const sections = [];
  for (const [id, label] of sectionEdges) sections.push({ label, ...(await lab(pid => window.__worldGridLab.section(pid, 128), id)) });
  const svg = s => {
    const pts = [...s.a.map(p => ({ x: -p.d, ...p })), ...s.b.map(p => ({ x: p.d, ...p }))];
    const ys = pts.flatMap(p => [p.raw, p.base, p.h]); const y0 = Math.min(...ys) - 5; const y1 = Math.max(...ys) + 5;
    const X = x => 40 + ((x + s.W + 96) / (2 * (s.W + 96))) * 880; const Y = y => 300 - ((y - y0) / (y1 - y0)) * 260;
    const line = (arr, sign, key) => arr.map((p, i) => `${i ? 'L' : 'M'}${X(sign * p.d).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ');
    const wet = pts.filter(p => p.wet).map(p => `<rect x="${X(p.x) - 1}" y="${Y(p.h)}" width="2" height="6" fill="#4fa8ff"/>`).join('');
    return `<figure style="margin:0"><svg width="960" height="330" style="background:#0d171b"><line x1="${X(0)}" x2="${X(0)}" y1="20" y2="300" stroke="#e8e4dc" stroke-dasharray="3 3"/><line x1="${X(-s.W)}" x2="${X(-s.W)}" y1="20" y2="300" stroke="#3fd6c5"/><line x1="${X(s.W)}" x2="${X(s.W)}" y1="20" y2="300" stroke="#3fd6c5"/>
      <path d="${line(s.a, -1, 'raw')}" stroke="#8a8f94" fill="none" stroke-dasharray="5 4"/><path d="${line(s.b, 1, 'raw')}" stroke="#8a8f94" fill="none" stroke-dasharray="5 4"/>
      <path d="${line(s.a, -1, 'base')}" stroke="#4f8cff" fill="none"/><path d="${line(s.b, 1, 'base')}" stroke="#4f8cff" fill="none"/>
      <path d="${line(s.a, -1, 'h')}" stroke="#ffb02e" fill="none" stroke-width="2.5"/><path d="${line(s.b, 1, 'h')}" stroke="#ffb02e" fill="none" stroke-width="2.5"/>${wet}
      <text x="44" y="16" fill="#e8e4dc">${s.label} · ${s.pairId} · along index ${s.i} · heights ${y0.toFixed(0)}–${y1.toFixed(0)} m</text><text x="44" y="322" fill="#9fd3c7">← ${s.pairId.split('|')[0]}   distance from edge (m), band ±${s.W} m (cyan)   ${s.pairId.split('|')[1]} →</text></svg></figure>`;
  };
  await composite(`<div style="padding:10px 14px;font-weight:600">06.3a-R2 cross-sections (world seed 6201, W 128): grey dashed = raw chunk · blue = world base (raw + datum shift) · orange = coordinated · blue ticks = water</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px 8px">${sections.map(svg).join('')}</div>`, '06-3a-r2-sections.png', 1960, 760);
  await openWorld('seams=1&focus=-512,512,900');
  await page.waitForTimeout(400);
  await page.locator('.workspace').screenshot({ path: path.join(shots, '06-3a-r2-seam-debug.png') });

  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify({
    task: '06.3a-R2 World Terrain Preservation & Seam Constraints', experiment: entry, testedAt: new Date().toISOString(), kinkTarget: KINK_TARGET,
    rules: main.edges.length ? (await lab(() => window.__worldGridLab.harmony().rules)) : null,
    seeds, sections: sections.map(s => ({ pairId: s.pairId, label: s.label, i: s.i })),
    screenshots: ['06-3a-r2-world-compare.png', '06-3a-r2-sections.png', '06-3a-r2-seam-debug.png'].map(f => `docs/assets/screenshots/procedural-mini-world/${f}`),
    browserErrors,
  }, null, 2)}\n`);
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  for (const s of seeds) {
    console.log(`seed ${s.worldSeed}`);
    for (const [k, m] of Object.entries(s.modes)) console.log(`  ${k.padEnd(11)} resolved ${m.edgesResolved}/12, max step ${m.maxSeamStep} m, corners ${m.cornersShared}/4, kink resolved max ${m.kinkResolvedMax}° (${m.kinkResolvedOverTarget} > 2°), other ${m.kinkOtherMax}°, water discont. ${m.waterDiscontinuousEdges}, coast wet ${m.coastWet.map(x => `${x.raw}→${x.now}`).join(' ')}, load ${m.loadMs} ms, heap ${m.memoryMB} MB`);
    s.widths.forEach(w => console.log(`  R2 W ${w.transitionWidth}: resolved ${w.edgesResolved}/12, kink resolved max ${w.kinkResolvedMax}°, coast wet ${w.coastWet.map(x => `${x.raw}→${x.now}`).join(' ')}`));
    console.log(`  degraded vs 06.3a: ${s.degraded.map(d => `${d.id}${d.waterConflict ? ' (waterConflict)' : ''}`).join(', ') || 'none'}; 06.3a coast–coast cases: ${s.coastCases.map(k => `${k.id} ${k.status}`).join(', ') || 'none'}`);
  }
  console.log('terrain coordinator verification passed');
} finally {
  await browser?.close();
  server.kill();
}
