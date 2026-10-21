// 06.3a Multi-chunk terrain & water seam: shared-edge equality, corners, slope / normal continuity, unresolved
// edges, water interfaces, raw vs harmonised, transition widths, world seeds, City ID independence, determinism,
// input-order independence, mesh / solid consistency, known tunnel failure isolation, performance.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4206;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/world-seam.json');
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
  // 06.3a measures terrain seams with each chunk's own network (06.3b road joins off; verify-road-seam.mjs covers them).
  const openWorld = async query => {
    const started = Date.now();
    query = `${query}${query ? '&' : ''}roads=independent`;
    if (!query.includes('terrain=')) query += '&terrain=harmonized'; // 06.3a edge-local joins (06.3a-R made coordinated terrain the default)
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
    return Date.now() - started;
  };
  const sigs = list => Object.fromEntries(list.map(s => [s.chunkId, s.signatures]));

  // Full measurement of the currently loaded world.
  const measure = async () => lab(() => {
    const l = window.__worldGridLab;
    const seams = l.seams(); const harmony = l.harmony(); const summaries = l.summaries();
    return {
      harmony, summaries, build: l.lastBuild(),
      pairs: seams.pairs.map(p => ({ id: p.id, status: p.harmony?.status ?? 'raw', continuity: p.harmony?.continuity ?? null, rawMaxStep: p.harmony?.rawMaxStep ?? null, reason: p.harmony?.reason ?? null, slopeNote: p.harmony?.slopeNote ?? null, positionError: p.positionError, heightMax: p.height.max, heightMean: p.height.mean, slope: p.slope, water: p.waterInterface, rawWaterCounts: p.water, ports: { paired: p.ports.matched.length, unpaired: p.ports.unmatchedA.length + p.ports.unmatchedB.length, status: p.ports.status } })),
      corners: seams.corners.map(c => ({ at: c.at, heightSpread: c.heightSpread, positionSpread: c.positionSpread })),
      normals: seams.pairs.map(p => l.edgeNormals(p.id)),
      sampling: seams.pairs.map(p => l.edgeSampling(p.id)),
      differences: summaries.map(s => l.difference(s.chunkId)),
      mesh: summaries.map(s => l.meshConsistency(s.chunkId)),
      isolation: l.tunnelIsolation(),
    };
  });
  const summarise = m => {
    const resolved = m.pairs.filter(p => p.status === 'resolved');
    return {
      edgesResolved: resolved.length, edgesC1: resolved.filter(p => p.continuity.startsWith('C1')).length, edgesUnresolved: m.pairs.filter(p => p.status === 'unresolved').length,
      maxSeamStepResolved: Math.max(0, ...resolved.map(p => p.heightMax)), maxSeamStepAll: Math.max(...m.pairs.map(p => p.heightMax)),
      maxBandSlopeResolved: Math.max(0, ...resolved.map(p => p.slope.bandMaxSlopeDeg)), maxBandSlopeAll: Math.max(...m.pairs.map(p => p.slope.bandMaxSlopeDeg)),
      maxKinkResolved: Math.max(0, ...resolved.map(p => p.slope.kinkMaxDeg)), medianKinkResolved: resolved.map(p => p.slope.kinkMedianDeg),
      maxNormalResolved: Math.max(0, ...m.normals.filter(n => resolved.some(p => p.id === n.pairId)).map(n => n.maxDeg)),
      waterDiscontinuousEdges: m.pairs.filter(p => p.water.status === 'discontinuous').length, waterOneSidedSamples: m.pairs.reduce((s, p) => s + p.water.oneSided, 0),
      cornersClosed: m.corners.filter(c => c.heightSpread === 0).length, maxCornerSpread: Math.max(...m.corners.map(c => c.heightSpread)),
    };
  };

  // 1. Raw (06.2) reference and harmonised default world (world seed 6201, W = 128).
  const rawLoadMs = await openWorld('terrain=raw');
  const raw = await measure();
  const loadMs = await openWorld('');
  const main = await measure();
  assert(main.summaries.every(s => s.status.startsWith('ready')), 'not all chunks ready');
  assert(same(main.summaries.map(s => s.signatures.raw), raw.summaries.map(s => s.signatures.raw)), 'raw height fields changed by harmonisation');

  // 2. Shared edges: resolved edges match exactly (data, sampler, rendered vertices); unresolved edges keep their raw step.
  for (const p of main.pairs) {
    assert(p.positionError === 0, `${p.id}: boundary positions differ`);
    if (p.status === 'resolved') assert(p.heightMax === 0, `${p.id}: resolved edge has Δh ${p.heightMax}`);
    else assert(p.heightMax > 0.5, `${p.id}: unresolved edge has no step (flag inconsistent)`);
  }
  for (const s of main.sampling) if (main.pairs.find(p => p.id === s.pairId).status === 'resolved') assert(s.maxDifference < 1e-4, `${s.pairId}: sampler differs across the edge (${s.maxDifference})`);
  assert(main.mesh.every(m => m.maxHeightError === 0 && m.maxPlanError === 0), `mesh vertices differ from fields: ${JSON.stringify(main.mesh.filter(m => m.maxHeightError || m.maxPlanError))}`);
  assert(main.differences.every(d => d.changedOutsideBand === 0), 'harmonisation changed cells outside the transition band');
  assert(main.harmony.edges.filter(e => e.status === 'resolved').every(e => e.madeSteepCells === 0), 'a resolved edge still has made-steep cells');
  // 3. Corners: closed corners are one point for all four chunks.
  const closed = main.harmony.corners.filter(c => c.closed);
  for (const c of closed) assert(main.corners.find(x => x.at.x === c.at.x && x.at.z === c.at.z).heightSpread === 0, `closed corner ${c.at.x},${c.at.z} not unified`);
  // 4. Solids closed after the terrain change (tunnels rebuilt by the existing flow).
  const solids = [];
  for (const s of main.summaries) solids.push({ chunkId: s.chunkId, ...(await lab(id => { const r = window.__worldGridLab.solid(id); return { watertight: r.watertight, euler: r.eulerCharacteristic, expected: r.expectedEuler, tunnels: r.tunnels, volumeRelativeError: r.volumeRelativeError }; }, s.chunkId)) });
  assert(solids.every(s => s.watertight && s.euler === s.expected && s.volumeRelativeError < 1e-6), `solid not closed: ${JSON.stringify(solids)}`);
  // 5. Water: the raw one-sided edges and what happened to each.
  const waterEdges = raw.pairs.filter(p => p.water.oneSided > 0 || p.water.status === 'discontinuous').map(p => {
    const after = main.pairs.find(q => q.id === p.id);
    return { id: p.id, rawOneSided: p.water.oneSided, after: after.water.status, afterOneSided: after.water.oneSided, terrain: after.status, outcome: after.water.status === 'discontinuous' ? 'retained discontinuity' : 'resolved', reasons: after.water.reasons };
  });

  // 6. City ID switch: no harmonisation rerun, no terrain change anywhere.
  const beforeCity = sigs(main.summaries);
  await lab(() => window.__worldGridLab.setCity('chunk_0_1', 'amsterdamCanalRing'));
  const cityBuild = await lab(() => window.__worldGridLab.lastBuild());
  const afterCity = await lab(() => window.__worldGridLab.summaries());
  assert(!cityBuild.prepare.harmony && cityBuild.prepare.raw.length === 0 && cityBuild.chunks.length === 1 && !cityBuild.chunks[0].ran.terrain, `City ID change re-ran terrain: ${JSON.stringify(cityBuild)}`);
  assert(afterCity.every(s => s.signatures.height === beforeCity[s.chunkId].height && s.signatures.water === beforeCity[s.chunkId].water), 'City ID change altered terrain');
  // 7. Order independence + reload determinism.
  const order = await lab(() => window.__worldGridLab.orderTest());
  assert(order.identical, 'harmonisation depends on input order');
  await openWorld('');
  const reload = await measure();
  assert(same(sigs(reload.summaries), sigs(main.summaries)) && same(reload.harmony.edges, main.harmony.edges), 'reload differs');

  // Screenshots: whole world, seam close-up raw vs harmonised at a closed corner (else a joined edge), debug view.
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '06-3a-world-harmonized-overall.png') });
  const focusAt = closed[0]?.at ?? (() => { const e = main.pairs.find(p => p.status === 'resolved'); return { x: 0, z: 0, id: e?.id }; })();
  const closeups = [];
  for (const [label, query] of [['raw chunks (06.2)', 'terrain=raw'], ['harmonised (06.3a)', '']]) {
    await openWorld(`${query}${query ? '&' : ''}focus=${focusAt.x},${focusAt.z},700`);
    await page.waitForTimeout(400);
    closeups.push({ label, png: (await page.locator('#worldCanvas').screenshot()).toString('base64') });
  }
  await page.setContent(`<html><head><link rel="icon" href="data:,"/></head><body style="margin:0;background:#101214;color:#e8e4dc;font:14px system-ui,sans-serif">
    <div style="padding:10px 14px;font-weight:600">06.3a · seam close-up at x ${focusAt.x} m, z ${focusAt.z} m · world seed 6201 · transition 128 m</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px 8px">${closeups.map(c => `<figure style="margin:0"><img src="data:image/png;base64,${c.png}" style="width:100%;display:block"/><figcaption style="padding:6px 4px">${c.label}</figcaption></figure>`).join('')}</div></body></html>`);
  await page.setViewportSize({ width: 2000, height: 760 });
  await page.screenshot({ path: path.join(shots, '06-3a-seam-closeup-compare.png'), fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorld('seams=1');
  await page.waitForTimeout(400);
  await page.locator('.workspace').screenshot({ path: path.join(shots, '06-3a-seam-debug.png') });

  // 8. Transition widths (world seed 6201): only necessary layers rebuilt, no stale city data.
  const widths = [];
  for (const W of [64, 256, 128]) {
    const before = await lab(() => window.__worldGridLab.summaries());
    await lab(w => window.__worldGridLab.setWorldOptions({ transitionWidth: w }), W);
    const m = await measure();
    const stale = m.summaries.filter(s => s.resolvedDNA && s.builds.city <= before.find(b => b.chunkId === s.chunkId).builds.city);
    assert(!stale.length, `city layers kept after a transition change: ${stale.map(s => s.chunkId)}`);
    assert(m.summaries.every(s => s.transitionWidth === W), 'transition width not applied');
    assert(m.pairs.filter(p => p.status === 'resolved').every(p => p.heightMax === 0) && m.differences.every(d => d.changedOutsideBand === 0), `W ${W}: seam or band rule broken`);
    widths.push({ transitionWidth: W, ...summarise(m), harmonyMs: m.build.prepare.harmonyMs, rebuildMs: m.build.totalMs, edges: m.pairs.map(p => ({ id: p.id, status: p.status, continuity: p.continuity, rawMaxStep: p.rawMaxStep, heightMax: p.heightMax, kinkMax: p.slope.kinkMaxDeg, bandMaxSlope: p.slope.bandMaxSlopeDeg, water: p.water.status })) });
  }

  // 9. Three world seeds at W = 128 (raw vs harmonised statistics).
  const seeds = [];
  for (const worldSeed of [6201, 6202, 6203]) {
    const rawMs = await openWorld(`worldSeed=${worldSeed}&terrain=raw`);
    const r = await measure();
    const ms = await openWorld(`worldSeed=${worldSeed}`);
    const h = await measure();
    assert(h.pairs.filter(p => p.status === 'resolved').every(p => p.heightMax === 0), `seed ${worldSeed}: resolved edge not matched`);
    assert(h.mesh.every(x => x.maxHeightError === 0) && h.differences.every(d => d.changedOutsideBand === 0), `seed ${worldSeed}: mesh / band rule broken`);
    seeds.push({ worldSeed, raw: { ...summarise(r), loadMs: rawMs }, harmonized: { ...summarise(h), loadMs: ms, harmonyMs: h.build.prepare.harmonyMs }, edges: h.pairs.map(p => ({ id: p.id, status: p.status, continuity: p.continuity, rawMaxStep: p.rawMaxStep, reason: p.reason, water: p.water.status, waterReasons: p.water.reasons })), isolation: h.isolation, changedShare: h.differences.map(d => [d.chunkId, d.changedShare, d.maxDelta, d.wetChanged]) });
  }

  // 10. Known tunnel failure (world seed 6202, chunk_0_-1, Chicago): isolated, solid stays closed; valid tunnel (6203) kept.
  const tunnels = {};
  for (const [worldSeed, label] of [[6202, 'knownFailure'], [6203, 'valid']]) {
    await openWorld(`worldSeed=${worldSeed}`);
    await lab(() => window.__worldGridLab.setCity('chunk_0_-1', 'chicagoGrid'));
    const isolation = await lab(() => window.__worldGridLab.tunnelIsolation());
    const solid = await lab(() => { const r = window.__worldGridLab.solid('chunk_0_-1'); return { watertight: r.watertight, euler: r.eulerCharacteristic, expected: r.expectedEuler, tunnels: r.tunnels }; });
    tunnels[label] = { worldSeed, isolation, solid };
    assert(solid.watertight && solid.euler === solid.expected, `${label}: solid not closed ${JSON.stringify(solid)}`);
  }
  assert(tunnels.knownFailure.isolation.some(i => i.chunkId === 'chunk_0_-1') && tunnels.valid.solid.tunnels === 1 && !tunnels.valid.isolation.length, `tunnel isolation unexpected: ${JSON.stringify(tunnels)}`);

  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify({
    task: '06.3a Multi-Chunk Terrain & Water Seam', experiment: entry, testedAt: new Date().toISOString(),
    rules: main.harmony.rules,
    default: { worldSeed: 6201, transitionWidth: 128, raw: summarise(raw), harmonized: summarise(main), rawLoadMs, loadMs, harmonyMs: main.build.prepare.harmonyMs, edges: main.pairs, harmonyEdges: main.harmony.edges, corners: main.harmony.corners, measuredCorners: main.corners, normals: main.normals, sampling: main.sampling, differences: main.differences, solids, waterEdges, iterations: main.harmony.iterations, exchanges: main.harmony.exchanges },
    autoMatchChanges: main.summaries.map(s => { const r = raw.summaries.find(x => x.chunkId === s.chunkId); return { chunkId: s.chunkId, cityMode: s.cityMode, raw: r.resolvedDNA, harmonized: s.resolvedDNA, changed: r.resolvedDNA !== s.resolvedDNA }; }),
    cityIndependence: { change: 'chunk_0_1 → amsterdamCanalRing', build: cityBuild, terrainUnchanged: true },
    orderIndependent: order.identical, reloadIdentical: true,
    widths, seeds, tunnels,
    screenshots: ['06-3a-world-harmonized-overall.png', '06-3a-seam-closeup-compare.png', '06-3a-seam-debug.png'].map(f => `docs/assets/screenshots/procedural-mini-world/${f}`),
    browserErrors,
  }, null, 2)}\n`);
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  const d = summarise(main);
  console.log(`6201 W128: ${d.edgesResolved}/12 joined (${d.edgesC1} C1), max step joined ${d.maxSeamStepResolved} m / all ${d.maxSeamStepAll} m, kink max ${d.maxKinkResolved}°, normal max ${d.maxNormalResolved}°, band slope joined ${d.maxBandSlopeResolved}° / all ${d.maxBandSlopeAll}°, water discontinuous ${d.waterDiscontinuousEdges} (raw ${summarise(raw).waterDiscontinuousEdges}), corners closed ${closed.length}/4`);
  console.log(`load raw ${rawLoadMs} ms vs harmonised ${loadMs} ms (harmonisation ${main.build.prepare.harmonyMs} ms)`);
  widths.forEach(w => console.log(`W ${w.transitionWidth}: ${w.edgesResolved}/12 joined, band slope joined ${w.maxBandSlopeResolved}°, water discontinuous ${w.waterDiscontinuousEdges}, rebuild ${w.rebuildMs} ms`));
  seeds.forEach(s => console.log(`seed ${s.worldSeed}: joined ${s.harmonized.edgesResolved}/12, water discontinuous ${s.raw.waterDiscontinuousEdges} → ${s.harmonized.waterDiscontinuousEdges}, max step ${s.raw.maxSeamStepAll} → joined 0 / unresolved max ${s.harmonized.maxSeamStepAll} m`));
  console.log('world seam verification passed');
} finally {
  await browser?.close();
  server.kill();
}
