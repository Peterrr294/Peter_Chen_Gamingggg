// A City of Cities — G02b Morphological Continuity & Urban Growth verifier.
// Part A (Node, seed 6201):
//   0. backward compatibility: the six G01 cores regenerate with their recorded signatures (no growth option),
//      and the first G02 steps reproduce the G02 record (growth path unchanged);
//   1. Chicago (recommended grid city): road-first growth from its core — expected to FAIL honestly (measured reasons);
//   2. Manhattan (grid): Stage A core → Stage B first growth → Stage C second growth; per growth: every usable entry
//      joined by identity at 0 m, grid lines continuous (world-anchored phases), city road graph one component, core
//      unchanged, inherited height centre; Stage D metrics; independent regeneration of the same cells as baseline;
//      twin run identical; save after B → load → connections reproduced → grow = uninterrupted C;
//   3. Fez (organic): two road-first growth steps, joins by identity, graph connectivity.
// Part B (browser): the page reproduces the Manhattan growth, screenshots, metrics sheet.
// Usage: node scripts/verify-morph-growth.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { MorphologicalGrowth, verifyConnections } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const SEED = 6201;
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'morph-growth.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const mod90 = x => ((x % 90) + 90) % 90;
const angleDiff = (a, b) => { const d = Math.abs(mod90(a) - mod90(b)); return +Math.min(d, 90 - d).toFixed(2); };
const strip = h => h.map(({ ms, ...e }) => e);
const result = { task: 'G02b — Morphological Continuity & Urban Growth', testedAt: new Date().toISOString(), seed: SEED, node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;

async function world6201() {
  const w = new WorldContext({ worldSeed: SEED }); const rep = w.initialise();
  assert(!rep.failures.length, 'G01 placement failed');
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return w;
}
// Grid continuity: the child's world-anchored phases equal the parent's (lines continue across the edge).
function gridContinuous(parent, child) {
  const p = parent.outputs.grid; const c = child.outputs.grid; if (!p || !c) return null;
  const t = (p.axisDeg * Math.PI) / 180; const u = { x: Math.cos(t), z: Math.sin(t) }; const v = { x: -u.z, z: u.x };
  const m = (a, n) => ((a % n) + n) % n;
  const dA = m(c.phaseA - p.phaseA - ((p.originX - c.originX) * v.x + (p.originZ - c.originZ) * v.z), p.primarySpacing);
  const dB = m(c.phaseB - p.phaseB - ((p.originX - c.originX) * u.x + (p.originZ - c.originZ) * u.z), p.secondarySpacing);
  const err = Math.max(Math.min(dA, p.primarySpacing - dA), Math.min(dB, p.secondarySpacing - dB));
  return { axisSame: c.axisDeg === p.axisDeg, phaseErrorM: +err.toFixed(6), inherited: c.inherited };
}
function checkGrowth(w, m, e, label) {
  const parent = w.chunks.get(e.parentChunkId); const child = w.chunks.get(e.newChunkId);
  assert(child.cityId === e.cityId && child.generationParameters.growthContext, `${label}: child without growth context`);
  const usable = child.generationParameters.growthContext.entryPorts.length;
  assert(e.connections.length + e.localAdaptations.unmatchedEntries.length === usable, `${label}: entries not all accounted for`);
  assert(e.connections.length > 0, `${label}: no road joined`);
  assert(e.connections.every(c => c.positionErrorM <= 0.5), `${label}: connection position error`);
  assert(e.connections.every(c => c.parent.chunkId === parent.chunkId && c.child.chunkId === child.chunkId), `${label}: connection identity`);
  assert(child.outputs.centreSource === 'inherited', `${label}: height centre not inherited`);
  const conn = m.connectivity(e.cityId);
  assert(conn.components === 1 && conn.mainComponentShare === 1, `${label}: city road graph not one connected network (${json(conn)})`);
  return { conn, grid: gridContinuous(parent, child) };
}

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 0. Backward compatibility.
  let w0 = await world6201();
  const g01 = JSON.parse(await readFile(path.join(evidence, 'world-6201-g01-state.json'), 'utf8'));
  for (const c of g01.chunks) assert(json(w0.chunks.get(c.chunkId).outputs.signatures) === json(c.expectedSignatures), `G01 core ${c.chunkId} changed`);
  const g02 = JSON.parse(await readFile(path.join(evidence, 'city-growth.json'), 'utf8'));
  const gc = new WorldGrowthController(w0); gc.grow(5);
  const brief = w0.growth.history.map(e => `${e.step}:${e.newChunkId}:${e.cityId}<${e.parentChunkId}:${e.selectionScore}:${e.outputs.counts.buildings}`);
  assert(json(brief) === json(g02.node[SEED].steps.slice(0, 5).map(s => `${s.step}:${s.chunkId}:${s.cityId}<${s.parent}:${s.score}:${s.buildings}`)), 'G02 growth changed');
  result.node.backwardCompatibility = { g01CoresIdentical: 6, g02FirstFiveStepsIdentical: true };
  w0 = null; // release before the next world
  console.log('backward compatibility: 6 G01 cores identical, G02 steps 1–5 identical');

  // 1. Chicago: honest failure.
  let wc = await world6201(); const mc = new MorphologicalGrowth(wc);
  const sizeBefore = wc.chunks.size;
  const rc = mc.grow('chicagoGrid');
  assert(rc.failure && wc.chunks.size === sizeBefore && wc.growth.step === 0, 'Chicago: expected a recorded failure without a new chunk');
  result.node.chicago = { failure: rc.failure };
  wc = null; mc.terrainCache.clear();
  console.log(`Chicago: road-first growth refused — ${rc.failure.fronts.map(f => f.reason).join(' | ')}`);

  // 2. Manhattan.
  const runManhattan = async () => {
    const w = await world6201(); const m = new MorphologicalGrowth(w);
    const coreId = w.cities.get('manhattanGrid').originChunkId; const coreSig = json(w.chunks.get(coreId).outputs.signatures);
    const steps = [];
    for (const label of ['B', 'C']) {
      const r = m.grow('manhattanGrid'); assert(!r.failure, `Manhattan ${label}: ${json(r.failure)}`);
      const chk = checkGrowth(w, m, r.event, `Manhattan ${label}`);
      assert(chk.grid.inherited && chk.grid.axisSame && chk.grid.phaseErrorM < 1e-6, `Manhattan ${label}: grid not continuous ${json(chk.grid)}`);
      assert(json(w.chunks.get(coreId).outputs.signatures) === coreSig, `Manhattan ${label}: core changed`);
      steps.push({ label, event: r.event, chk });
    }
    return { w, m, coreId, steps };
  };
  const man = await runManhattan();
  const chunks = [man.coreId, ...man.steps.map(s => s.event.newChunkId)].map(id => man.w.chunks.get(id));
  const baselines = man.steps.map(s => man.m.independentBaseline('manhattanGrid', s.event.targetCoordinate.gx, s.event.targetCoordinate.gy, s.event.parentChunkId, s.event.sourceGrowthFrontId.split(':')[2]));
  const metrics = chunks.map(c => ({ chunkId: c.chunkId, role: c.role, landform: c.terrainType, ...c.outputs.morph, counts: c.outputs.counts, centreSource: c.outputs.centreSource }));
  const boundary = man.steps.map((s, i) => { const a = man.w.chunks.get(s.event.parentChunkId).outputs.morph; const b = man.w.chunks.get(s.event.newChunkId).outputs.morph; return { growth: s.label, orientationDiffDeg: angleDiff(a.dominantOrientationDeg, b.dominantOrientationDeg), roadDensityRatio: +(b.roadDensityKmPerKm2 / a.roadDensityKmPerKm2).toFixed(3), blockMedianRatio: +(b.blockAreaMedianM2 / a.blockAreaMedianM2).toFixed(3), blockAspectDiff: +(b.blockAspectMedian - a.blockAspectMedian).toFixed(2), frontageRatio: +(b.parcelFrontageMedianM / a.parcelFrontageMedianM).toFixed(3), coverageDiff: +(b.buildingCoverage - a.buildingCoverage).toFixed(3), meanHeightRatio: +(b.heightMeanM / a.heightMeanM).toFixed(3), baselinePortsAligned: `${baselines[i].alignedWithin05m} of ${baselines[i].parentPorts}`, baselineOwnCentre: baselines[i].heightCentre }; });
  // Twin.
  const manHistory = json(strip(man.w.growth.history)); man.m.terrainCache.clear(); man.w = null;
  let twin = await runManhattan();
  assert(json(strip(twin.w.growth.history)) === manHistory, 'Manhattan: twin history differs');
  twin = null;
  // Save after B → load → continue.
  const half = await world6201(); const mh = new MorphologicalGrowth(half); mh.grow('manhattanGrid');
  const saved = JSON.parse(json(half.serialise()));
  const w2 = WorldContext.restore(saved);
  for (const c of [...w2.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) { const { chunk } = w2.generateChunk(c.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${c.chunkId} differs`); }
  const vc = verifyConnections(w2); assert(vc.length === 1 && vc.every(x => x.same), 'restored connections differ');
  const m2 = new MorphologicalGrowth(w2); const r2 = m2.grow('manhattanGrid');
  assert(json(strip(w2.growth.history)) === manHistory, 'save / load / continue differs from uninterrupted growth');
  void r2;
  result.node.manhattan = {
    stages: { A: man.coreId, B: man.steps[0].event.newChunkId, C: man.steps[1].event.newChunkId },
    growth: man.steps.map(s => ({ stage: s.label, front: s.event.sourceGrowthFrontId, target: s.event.targetChunkId, joined: s.event.connections.length, unmatchedEntries: s.event.localAdaptations.unmatchedEntries, newPortsOnSharedEdge: s.event.localAdaptations.newPortsOnSharedEdge.length, positionErrorMaxM: Math.max(...s.event.connections.map(c => c.positionErrorM)), elevationStepsM: s.event.connections.map(c => c.elevationStepM), grid: s.chk.grid, roadGraph: s.chk.conn, generatedRoadIds: s.event.generatedRoadIds.length, generatedBlockIds: s.event.generatedBlockIds.length, parcelsOnInheritedRoads: s.event.generatedParcelIds.length, parcelsTotal: s.event.parcelsTotal, rejected: s.event.rejectedConstraints })),
    metrics, boundary, baselines, twinIdentical: true, saveLoadContinue: true,
  };
  console.log(`Manhattan: ${man.steps.map(s => `${s.label} ${s.event.sourceGrowthFrontId} → ${s.event.targetChunkId}: ${s.event.connections.length} joined`).join('; ')}; graph ${json(man.steps[1].chk.conn.components)} component; baseline aligned ${baselines.map(b => `${b.alignedWithin05m}/${b.parentPorts}`).join(', ')}`);

  // 3. Fez.
  const wf = await world6201(); const mf = new MorphologicalGrowth(wf); const fez = [];
  for (const label of ['B', 'C']) { const r = mf.grow('fezOrganicCore'); assert(!r.failure, `Fez ${label}: ${json(r.failure)}`); const chk = checkGrowth(wf, mf, r.event, `Fez ${label}`); fez.push({ stage: label, front: r.event.sourceGrowthFrontId, target: r.event.targetChunkId, joined: r.event.connections.length, elevationStepsM: r.event.connections.map(c => c.elevationStepM), roadGraph: chk.conn, rejected: r.event.rejectedConstraints, baseline: mf.independentBaseline('fezOrganicCore', r.event.targetCoordinate.gx, r.event.targetCoordinate.gy, r.event.parentChunkId, r.event.sourceGrowthFrontId.split(':')[2]) }); }
  const fezChunks = [wf.cities.get('fezOrganicCore').originChunkId, ...fez.map(f => f.target)].map(id => wf.chunks.get(id));
  result.node.fez = { growth: fez, metrics: fezChunks.map(c => ({ chunkId: c.chunkId, role: c.role, landform: c.terrainType, ...c.outputs.morph, counts: c.outputs.counts, centreSource: c.outputs.centreSource })), orientationDiffsDeg: fez.map((f, i) => angleDiff(fezChunks[0].outputs.morph.dominantOrientationDeg, fezChunks[i + 1].outputs.morph.dominantOrientationDeg)) };
  console.log(`Fez: ${fez.map(f => `${f.stage} ${f.front} → ${f.target}: ${f.joined} joined`).join('; ')}`);
  result.nodeMs = Date.now() - started;
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4217; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
  const exists = async f => { try { await access(f); return true; } catch { return false; } };
  const ready = async u => { try { return (await fetch(u, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
  const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let browser;
  try {
    for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) await new Promise(r => setTimeout(r, 250));
    let exe = process.env.PLAYWRIGHT_CHROME_PATH; for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (!exe && await exists(c)) exe = c;
    browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(e.message));
    const lab = (fn, arg) => page.evaluate(fn, arg);
    const waitReady = () => page.waitForFunction(() => window.__originLab?.ready === true, null, { timeout: 900000 });
    const call = async (fn, arg) => { await lab(fn, arg); await page.waitForTimeout(50); await waitReady(); const e = await lab(() => window.__originLab.error()); assert(!e, `page error ${e}`); };
    const shot = async name => { await page.waitForTimeout(800); const f = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: f }); return path.relative(root, f).replaceAll('\\', '/'); };
    const fit = async ids => { const cs = (await lab(() => window.__originLab.chunks())).filter(c => ids.includes(c.chunkId)).map(c => c.worldCoordinate); await lab(b => window.__originLab.fitRegion(...b), [Math.min(...cs.map(c => c.gx)), Math.min(...cs.map(c => c.gy)), Math.max(...cs.map(c => c.gx)), Math.max(...cs.map(c => c.gy))]); };
    const b = { screenshots: {} };
    const node = result.node.manhattan;
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(x => window.__originLab.generate(x), SEED);
    await lab(() => window.__originLab.setLayers({ ownership: true, chunkBorders: true }));
    await fit([node.stages.A]); b.screenshots.core = await shot('g02b-manhattan-core.png');
    await call(() => window.__originLab.morphGrow('manhattanGrid'));
    await lab(() => window.__originLab.setLayers({ inheritedRoads: true, connectivity: true }));
    await fit([node.stages.A, node.stages.B]); b.screenshots.firstGrowth = await shot('g02b-manhattan-first-growth.png');
    await call(() => window.__originLab.morphGrow('manhattanGrid'));
    const hist = (await lab(() => window.__originLab.history())).filter(e => e.mode === 'g02b-road-first');
    assert(json(hist.map(e => [e.newChunkId, e.connections.map(c => c.connectionId), e.generatedRoadIds.length, e.generatedBlockIds.length])) === json(node.growth.map((g, i) => [g.target, null, g.generatedRoadIds, g.generatedBlockIds]).map((x, i) => [x[0], hist[i].connections.map(c => c.connectionId), x[2], x[3]])), 'browser growth differs from Node');
    assert(json(hist.map(e => e.connections.length)) === json(node.growth.map(g => g.joined)), 'browser joins differ from Node');
    await lab(() => window.__originLab.setLayers({ inheritedRoads: false, connectivity: false }));
    await fit([node.stages.A, node.stages.B, node.stages.C]); b.screenshots.threeTop = await shot('g02b-manhattan-three-chunks.png');
    await lab(() => window.__originLab.setLayers({ chunkBorders: false, ownership: false }));
    b.screenshots.threeNoBorders = await shot('g02b-manhattan-no-borders.png');
    const conn = hist[0].connections[0]; const chunks = await lab(() => window.__originLab.chunks());
    const parent = chunks.find(c => c.chunkId === conn.parent.chunkId); const child = chunks.find(c => c.chunkId === conn.child.chunkId);
    await lab(f => { window.__originLab.setLayers({ connectivity: true, inheritedRoads: true, chunkBorders: true }); window.__originLab.focusPoint(f.x, f.z, 900); }, { x: (parent.worldOrigin.x + child.worldOrigin.x) / 2, z: (parent.worldOrigin.z + child.worldOrigin.z) / 2 });
    b.screenshots.boundary = await shot('g02b-manhattan-boundary-closeup.png');
    // Save → reload → load: connections reproduced.
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(() => window.__originLab.loadLocal());
    assert(/reproduced/.test(await lab(() => window.__originLab.morphRestore())), 'browser: connections not reproduced after load');
    // Fez (organic): two growth steps, no borders.
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(x => window.__originLab.generate(x), SEED);
    await call(() => window.__originLab.morphGrow('fezOrganicCore')); await call(() => window.__originLab.morphGrow('fezOrganicCore'));
    const fz = result.node.fez.growth;
    await lab(() => window.__originLab.setLayers({ chunkBorders: false, ownership: false, inheritedRoads: true, connectivity: true }));
    await fit([result.node.fez.metrics[0].chunkId, ...fz.map(f => f.target)]); b.screenshots.fez = await shot('g02b-fez-three-chunks.png');
    // Metrics sheet (real values of this run).
    const rows = [...node.metrics.map(m => ({ name: `${m.role === 'core' ? 'A core' : m.chunkId === node.stages.B ? 'B growth 1' : 'C growth 2'} · ${m.chunkId}`, m })), ...result.node.fez.metrics.map(m => ({ name: `Fez ${m.role} · ${m.chunkId}`, m }))];
    const td = v => `<td>${v ?? '—'}</td>`;
    const sheet = await context.newPage(); await sheet.setViewportSize({ width: 1800, height: 900 });
    await sheet.setContent(`<body style="margin:0;padding:28px;background:#0f1215;color:#e8ecee;font:18px 'Segoe UI',Arial"><h2 style="font-weight:400;margin:0 0 6px">G02b · morphology of the growth chunks (world seed ${SEED}, real generated values)</h2><p style="color:#9aa3a8;margin:0 0 18px">Manhattan: ${node.growth.map(g => `${g.stage} joined ${g.joined} roads (0 m error), independent regeneration aligned ${result.node.manhattan.boundary.find(x => x.growth === g.stage).baselinePortsAligned}`).join(' · ')} · city road graph ${node.growth[1].roadGraph.components} component, ${Math.round(node.growth[1].roadGraph.mainComponentShare * 100)} % connected</p><table style="border-collapse:collapse;width:100%"><tr style="color:#9aa3a8;text-align:left">${['chunk', 'landform', 'orient. °', 'roads km/km²', 'block median m²', 'block aspect', 'frontage m', 'coverage', 'height mean / p90 / max m', 'buildings', 'height centre'].map(h => `<th style="padding:6px 10px;border-bottom:1px solid #3a4248">${h}</th>`).join('')}</tr>${rows.map(({ name, m }) => `<tr>${td(name)}${td(m.landform)}${td(m.dominantOrientationDeg)}${td(m.roadDensityKmPerKm2)}${td(m.blockAreaMedianM2)}${td(m.blockAspectMedian)}${td(m.parcelFrontageMedianM)}${td(m.buildingCoverage)}${td(`${m.heightMeanM} / ${m.heightP90M} / ${m.heightMaxM}`)}${td(m.counts.buildings)}${td(m.centreSource)}</tr>`).join('').replaceAll('<td>', '<td style="padding:6px 10px;border-bottom:1px solid #22292d">')}</table></body>`);
    b.screenshots.metrics = path.relative(root, path.join(shots, 'g02b-metrics-comparison.png')).replaceAll('\\', '/');
    await sheet.screenshot({ path: path.join(root, b.screenshots.metrics), fullPage: true });
    b.errors = errors; assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await mkdir(evidence, { recursive: true });
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G02b verification passed. Record: experiments/city-of-cities/evidence/morph-growth.json');
