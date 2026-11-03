// A City of Cities — G03c-03 Urban Interface & Morphological Transition verifier.
// Part A (Node):
//   0. gate: G02c records, G03c-01, G03c-02 (actual connection state)
//   1. Phase A, same city: the historic Chicago case (seed 6202, G02c-01 state: core c_1_2, growth c_1_3) and the current
//      grade-aware run; Manhattan (seed 6201, G02b chain); Fez (seed 6202). Every building height decomposed and recomputed
//      by the generator rule (lineage); every same-city shared edge measured at equal distance from the city centre;
//      block / parcel fabric per edge; core stability after growth; determinism
//   2. inter-city interface classification from the real encounter records (A connected / B adjacent, disconnected /
//      C geographic separation / D unresolved); no public space without a verified connection
// Part B (browser): axonometric of Chicago across the edge (borders hidden) and a height profile sheet from real buildings.
// Usage: node --max-old-space-size=8192 scripts/verify-urban-interface.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { MorphologicalGrowth } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const { buildingLineage, edgeContinuity } = await mod('experiments/city-of-cities/UrbanMorphologyField.js');
const { DIRECTIONS } = await mod('experiments/city-of-cities/growthDNA.js');
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'urban-interface.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const result = { task: 'G03c-03 Urban Interface & Morphological Transition', testedAt: new Date().toISOString(), node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;
const readJson = async f => JSON.parse(await readFile(path.join(evidence, f), 'utf8'));

function newWorld(seed) {
  const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise();
  assert(!rep.failures.length, `seed ${seed}: placement failed`);
  return w;
}
// Generates every chunk of a world in growth order and keeps lineage for the chosen cities.
function analyse(w, cities) {
  const data = new Map();
  for (const c of [...w.chunks.values()].sort((a, b) => a.growthStep - b.growthStep || a.chunkId.localeCompare(b.chunkId))) {
    const { chunk, layers } = w.generateChunk(c.chunkId);
    if (cities.includes(c.cityId)) data.set(c.chunkId, { chunk, layers: { city: { parcels: layers.city.parcels, buildings: layers.city.buildings } }, lineage: buildingLineage(w, chunk, layers) });
  }
  return data;
}
function cityReport(w, data, cityId) {
  const mine = [...data.values()].filter(d => d.chunk.cityId === cityId);
  const lineage = mine.flatMap(d => d.lineage);
  const exact = lineage.filter(x => x.exact).length;
  assert(exact === lineage.length, `${cityId}: ${lineage.length - exact} heights not reproduced by the rule`);
  const edges = [];
  for (const a of mine) for (const [, [dx, dy]] of Object.entries(DIRECTIONS)) {
    const b = data.get(w.chunkAt(a.chunk.worldCoordinate.gx + dx, a.chunk.worldCoordinate.gy + dy)?.chunkId);
    if (b && b.chunk.cityId === cityId && a.chunk.chunkId < b.chunk.chunkId) { const [p, q] = a.chunk.growthStep <= b.chunk.growthStep ? [a, b] : [b, a]; edges.push(edgeContinuity(p, q)); }
  }
  const chunkMax = Object.fromEntries(mine.map(d => [d.chunk.chunkId, { role: d.chunk.role, maxM: Math.max(...d.lineage.map(x => x.height)), meanM: +(d.lineage.reduce((s, x) => s + x.height, 0) / d.lineage.length).toFixed(1), buildings: d.lineage.length }]));
  const sources = lineage.reduce((o, x) => { const k = x.factors.centre >= 0.05 ? 'centre-led (centre factor ≥ 0.05)' : x.appliedConstraint === 'DNA minimum floors' ? 'DNA minimum' : 'road / area led'; o[k] = (o[k] ?? 0) + 1; return o; }, {});
  return { cityId, chunks: mine.length, buildings: lineage.length, heightsReproduced: `${exact} of ${lineage.length}`, chunkHeights: chunkMax, heightSources: sources, edges };
}

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 0. Gate.
  const g2 = await readJson('grade-aware-growth.json'); const g3 = await readJson('emergent-encounter.json');
  let g32 = null; try { g32 = await readJson('inter-city-connection.json'); } catch { g32 = null; }
  const naturalConnections = g32 ? Object.values(g32.node.testB ?? {}).reduce((s, r) => s + (r.connections?.length ?? 0), 0) : null;
  result.node.gate = {
    g02c: { roadInheritance: 'verified (G02c-01, G02c-02)', ramps3d: `${g2.node.testB.checks.graphOk} of ${g2.node.testB.checks.checked} joins continuous` },
    g03c01: { encountersFromRealGrowth: true, adjacentOnKnownSeeds: g3.node.runs[6202].counts.adjacent },
    g03c02: g32 ? { naturalConnectionsBuilt: naturalConnections, controlledConstruction: g32.node.constructionCheck?.connection?.connectionStatus ?? null, verdict: naturalConnections ? 'connections exist' : 'no verified inter-city connection: inter-city morphology stays a proposal' } : 'record missing',
  };
  console.log(`gate: ${json(result.node.gate.g03c02)}`);
  // 1. Phase A.
  result.node.phaseA = {};
  {
    const state = await readJson('world-6202-g02c-step12-state.json');
    const w = WorldContext.restore(state); const data = analyse(w, ['chicagoGrid', 'fezOrganicCore']);
    result.node.phaseA.chicago6202History = { source: 'world-6202-g02c-step12-state.json (G02c-01 run, the reported 171 m / 38 m case)', ...cityReport(w, data, 'chicagoGrid') };
    result.node.phaseA.fez6202History = cityReport(w, data, 'fezOrganicCore');
    const core = result.node.phaseA.chicago6202History.chunkHeights;
    console.log(`Chicago 6202 (history): maxima ${json(Object.fromEntries(Object.entries(core).map(([k, v]) => [k, v.maxM])))}; edges ${result.node.phaseA.chicago6202History.edges.map(e => `${e.edge} ${e.reading} (max same-distance difference ${e.maxSameDistanceDifferenceM} m)`).join('; ')}`);
    // Core stability: the core's lineage before any growth equals the one after 12 steps.
    const w0 = newWorld(6202); const d0 = analyse(w0, ['chicagoGrid']);
    const before = d0.get('c_1_2').lineage; const after = data.get('c_1_2').lineage;
    assert(json(before) === json(after.map(x => ({ ...x }))), 'core lineage changed after growth');
    result.node.phaseA.coreStability = { chunk: 'c_1_2', buildings: before.length, identicalAfter12Steps: true };
  }
  {
    // Current grade-aware world (6 % ramp plan): the same reading on the chunks it grows.
    const w = newWorld(6202); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
    const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline' }); for (let i = 0; i < 12; i += 1) if (g.step().stalled) break;
    const data = analyse(w, ['chicagoGrid', 'manhattanGrid']);
    result.node.phaseA.chicago6202Grade = cityReport(w, data, 'chicagoGrid');
    result.node.phaseA.manhattan6202Grade = cityReport(w, data, 'manhattanGrid');
    const again = analyse(WorldContext.restore(JSON.parse(json(w.serialise()))), ['chicagoGrid']);
    assert(json([...again.values()].map(d => d.lineage)) === json([...data.values()].filter(d => d.chunk.cityId === 'chicagoGrid').map(d => d.lineage)), 'lineage not reproduced after save / load');
    result.node.phaseA.saveLoadLineage = 'identical (seed 6202, 6 % run, Chicago)';
  }
  {
    // Manhattan, seed 6201: the G02b chain (core c_-2_0, two road-first steps).
    const w = newWorld(6201); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
    const m = new MorphologicalGrowth(w); m.grow('manhattanGrid'); m.grow('manhattanGrid');
    const data = analyse(w, ['manhattanGrid']);
    result.node.phaseA.manhattan6201G02b = cityReport(w, data, 'manhattanGrid');
  }
  for (const [k, v] of Object.entries(result.node.phaseA)) if (v.edges) console.log(`${k}: ${v.heightsReproduced} heights reproduced; ${v.edges.length} edge(s): ${v.edges.map(e => `${e.reading.split(':')[0]} ${e.maxSameDistanceDifferenceM} m`).join('; ')}`);
  // 2. Interface classification (real encounters only; the G03b fixture is not used).
  const classify = s => {
    if (s.states.connected) return 'A connected urban interface';
    if (s.states.adjacent) { const sep = s.relationshipStatus === 'separationAccepted' || s.terrainConditions?.some(t => t.barrier); return sep ? 'C geographic separation' : 'B adjacent but disconnected'; }
    return s.states.constrained ? 'D unresolved (approaching, constrained cell between)' : 'D unresolved (approaching)';
  };
  const interfaces = [];
  for (const [seed, run] of Object.entries(g3.node.runs)) for (const s of run.encounters) interfaces.push({ source: `G03c-01 run, seed ${seed}`, encounterId: s.encounterId, origin: s.origin, states: s.states, relationshipStatus: s.relationshipStatus, classification: classify(s), publicSpace: 'none: no verified road connection' });
  if (g32) for (const [seed, run] of Object.entries(g32.node.testB ?? {})) for (const s of run.encounters ?? []) interfaces.push({ source: `G03c-02 regrowth with inter-city connection, seed ${seed}`, encounterId: s.encounterId, states: s.states, relationshipStatus: s.relationshipStatus, classification: classify(s), publicSpace: 'none: no verified road connection' });
  result.node.interfaces = { list: interfaces, counts: interfaces.reduce((o, x) => ({ ...o, [x.classification]: (o[x.classification] ?? 0) + 1 }), {}), publicSpaceNodes: 0, reason: 'Road Junction Public Node requires a verified inter-city connection; none exists in real growth' };
  console.log(`interfaces: ${json(result.node.interfaces.counts)}`);
  result.nodeMs = Date.now() - started;
  await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Part A done (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4222; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const b = { screenshots: {}, captions: {} };
    // The historic case: load the saved G02c-01 state of seed 6202.
    const state = await readJson('world-6202-g02c-step12-state.json');
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await page.evaluate(s => localStorage.setItem('procedural-mini-world/a-city-of-cities/world-state', JSON.stringify(s)), state);
    await call(() => window.__originLab.loadLocal());
    await lab(() => window.__originLab.setLayers({ chunkBorders: false, ownership: false }));
    const chunks = await lab(() => window.__originLab.chunks()); const A = chunks.find(c => c.chunkId === 'c_1_2'); const B = chunks.find(c => c.chunkId === 'c_1_3');
    await lab(f => window.__originLab.focusPoint(f.x, f.z, 1500), { x: (A.worldOrigin.x + B.worldOrigin.x) / 2, z: (A.worldOrigin.z + B.worldOrigin.z) / 2 });
    await page.waitForTimeout(900);
    b.screenshots.axonometric = path.relative(root, path.join(shots, 'g03c-03-chicago-axonometric.png')).replaceAll('\\', '/');
    await page.locator('#worldCanvas').screenshot({ path: path.join(root, b.screenshots.axonometric) });
    b.captions.axonometric = 'seed 6202, G02c-01 state step 12, Chicago core c_1_2 (back) and growth c_1_3 (front), chunk borders hidden, camera focusPoint 1500 m on the shared edge midpoint';
    // Height profile across the shared edge, from the generated buildings (Node lineage of the same state).
    const w = WorldContext.restore(state); const data = new Map();
    for (const c of [...w.chunks.values()].sort((p, q) => p.growthStep - q.growthStep)) { const { chunk, layers } = w.generateChunk(c.chunkId); if (['c_1_2', 'c_1_3'].includes(c.chunkId)) data.set(c.chunkId, buildingLineage(w, chunk, layers)); }
    const centre = data.get('c_1_2')[0].relevantMorphologySource.centre; const edgeZ = (A.worldOrigin.z + B.worldOrigin.z) / 2;
    const pts = [...data.values()].flat().filter(x => Math.abs(x.point.x - centre.x) <= 150);
    const W = 1400; const H = 420; const zs = pts.map(p => p.point.z); const z0 = Math.min(...zs); const z1 = Math.max(...zs); const hMax = Math.max(...pts.map(p => p.height));
    const X = z => 60 + ((z - z0) / (z1 - z0)) * (W - 90); const Y = h => H - 40 - (h / hMax) * (H - 70);
    const dots = pts.map(p => `<circle cx="${X(p.point.z).toFixed(1)}" cy="${Y(p.height).toFixed(1)}" r="2.2" fill="${p.chunkId === 'c_1_2' ? '#f2a541' : '#3fe0ff'}"/>`).join('');
    const sheet = await context.newPage(); await sheet.setViewportSize({ width: 1500, height: 620 });
    await sheet.setContent(`<body style="margin:0;padding:24px;background:#0f1215;color:#e8ecee;font:15px 'Segoe UI',Arial"><h3 style="font-weight:400;margin:0 0 4px">G03c-03 · Chicago building heights across the core / growth edge (seed 6202)</h3><p style="color:#9aa3a8;margin:0 0 10px">every generated building within 150 m of the line x = ${centre.x} (through the city centre), by its z position · orange: core c_1_2 · cyan: growth c_1_3 · dashed: chunk edge · heights recomputed exactly by the generator rule</p><svg width="${W}" height="${H}" style="background:#151a1e">${dots}<line x1="${X(edgeZ)}" x2="${X(edgeZ)}" y1="20" y2="${H - 40}" stroke="#e8ecee" stroke-dasharray="6 5"/><line x1="${X(centre.z)}" x2="${X(centre.z)}" y1="20" y2="${H - 40}" stroke="#ff6a6a" stroke-dasharray="2 4"/><text x="${X(centre.z) + 6}" y="34" fill="#ff8080" font-size="12">city height centre</text><text x="${X(edgeZ) + 6}" y="34" fill="#e8ecee" font-size="12">chunk edge (${Math.round(edgeZ - centre.z)} m from the centre)</text><text x="8" y="${Y(hMax) + 4}" fill="#9aa3a8" font-size="12">${hMax} m</text><text x="8" y="${Y(0) + 4}" fill="#9aa3a8" font-size="12">0</text><text x="60" y="${H - 14}" fill="#9aa3a8" font-size="12">z ${Math.round(z0)} m</text><text x="${W - 110}" y="${H - 14}" fill="#9aa3a8" font-size="12">z ${Math.round(z1)} m</text></svg></body>`);
    b.screenshots.profile = path.relative(root, path.join(shots, 'g03c-03-chicago-height-profile.png')).replaceAll('\\', '/');
    await sheet.screenshot({ path: path.join(root, b.screenshots.profile), fullPage: true });
    b.errors = errors; assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G03c-03 verification finished. Record: experiments/city-of-cities/evidence/urban-interface.json');
