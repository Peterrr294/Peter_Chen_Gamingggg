// 06.3b Road network seam: cross-chunk joins on harmonised edges. Checks every connection (one node per side at the
// same world point and height, both in the stitched NetworkGraphs), no visual-only contacts, no new crossings,
// connectors inside the band / on land / within the DNA slope limit, reasons for every port left unjoined, no joins
// on unresolved edges, world reachability through the joints, fresh blocks / parcels / buildings on the stitched
// network (no building on a connector), unchanged chunks bit-identical to independent roads, City ID change
// propagation, input-order independence, reload identity, three world seeds. Writes evidence + screenshots.
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4207;
const base = `http://${host}:${port}`;
const entry = '/experiments/world-grid/';
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const record = path.join(root, 'experiments/world-grid/evidence/world-road-seam.json');
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
  const openWorld = async query => {
    const started = Date.now();
    if (!query.includes('terrain=')) query = `${query}${query ? '&' : ''}terrain=harmonized`; // 06.3b was measured on 06.3a terrain (06.3a-R made coordinated terrain the default)
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
    return Date.now() - started;
  };
  const measure = async () => lab(() => {
    const l = window.__worldGridLab;
    return { seam: l.roadSeam(), audit: l.roadAudit(), reach: l.reach(), summaries: l.summaries(), build: l.lastBuild(), harmony: l.harmony().edges.map(e => ({ id: e.id, status: e.status })) };
  });
  const sigs = list => Object.fromEntries(list.map(s => [s.chunkId, s.signatures]));
  const check = (m, label) => {
    assert(m.audit.ok, `${label}: audit failed ${JSON.stringify({ visualOnly: m.audit.visualOnly, crossings: m.audit.crossings.filter(c => c.stitched > c.own), connectors: m.audit.connectors.filter(k => k.wetSamples || !k.withinBand || k.maxCellSlope > (k.slopeLimit ?? 90)), cities: m.audit.cities.filter(c => !c.stitchedIsCurrent || !c.blocksOnStitched || c.buildingConflicts), connections: m.audit.connections.filter(c => !c.found || c.positionError !== 0), unresolvedJoins: m.audit.unresolvedJoins, unexplained: m.audit.unexplained })}`);
    for (const e of m.seam.edges.filter(x => !x.terrain.startsWith('joined'))) assert(e.summary.pairs + e.summary.stubs === 0, `${label}: join on terrain edge ${e.id} (${e.terrain})`);
    assert(m.seam.ports.every(p => p.status === 'connected' || (p.reason && p.reason !== 'not evaluated')), `${label}: port without a reason`);
    assert(m.reach.viaConnections.every(v => v.reachable), `${label}: a joint is not traversable in the world graph`);
    for (const c of m.reach.components) for (let i = 0; i < c.chunks.length; i += 1) for (let j = i + 1; j < c.chunks.length; j += 1) {
      const p = m.reach.paths.find(x => (x.from === c.chunks[i] && x.to === c.chunks[j]) || (x.from === c.chunks[j] && x.to === c.chunks[i]));
      assert(p?.reachable && p.seamLinks >= 1, `${label}: ${c.chunks[i]} → ${c.chunks[j]} share a component but no routed path`);
    }
    assert(m.summaries.every(s => s.status.startsWith('ready')), `${label}: not all chunks ready`);
  };
  const statsOf = m => ({
    ...m.seam.stats, maxJointElevationDiff: Math.max(0, ...m.audit.connections.map(c => c.elevationDiff)), maxJointPositionError: Math.max(0, ...m.audit.connections.map(c => c.positionError)),
    maxConnectorGradeDeg: Math.max(0, ...m.audit.connectors.map(k => k.maxGradeDeg)), maxConnectorDepth: Math.max(0, ...m.audit.connectors.map(k => k.maxDepth)),
    newCrossings: m.audit.crossings.reduce((s, c) => s + Math.max(0, c.stitched - c.own), 0), buildingConflicts: m.audit.cities.reduce((s, c) => s + c.buildingConflicts, 0),
    reachablePairs: m.reach.paths.filter(p => p.reachable).map(p => `${p.from}→${p.to} ${p.length} m, ${p.seamLinks} seam link(s)`),
    edgesJoinedTerrain: m.harmony.filter(e => e.status === 'resolved').length,
  });

  // 1. Independent roads (06.3a behaviour) vs joined roads, world seed 6201, W 128.
  const indepMs = await openWorld('roads=independent');
  const indep = await lab(() => ({ summaries: window.__worldGridLab.summaries(), seams: window.__worldGridLab.seams().pairs.map(p => ({ id: p.id, ports: { paired: p.ports.matched.length, unpaired: p.ports.unmatchedA.length + p.ports.unmatchedB.length } })) }));
  const loadMs = await openWorld('');
  const main = await measure();
  check(main, '6201');
  assert(main.seam.stats.connections > 0, 'no connection at all on world 6201');
  const indepSigs = sigs(indep.summaries); const mainSigs = sigs(main.summaries);
  for (const s of main.summaries) {
    const a = indepSigs[s.chunkId]; const b = mainSigs[s.chunkId];
    assert(a.height === b.height && a.water === b.water && a.raw === b.raw, `${s.chunkId}: terrain changed by road joins`);
    if (!s.resolvedDNA) continue;
    assert(b.rawNetwork === a.network, `${s.chunkId}: own network differs from the independent network`);
    if (main.seam.stats.chunksChanged.includes(s.chunkId)) assert(b.network !== a.network && b.blocks !== a.blocks, `${s.chunkId}: changed roads but city layers identical`);
    else assert(b.network === a.network && b.blocks === a.blocks && b.parcels === a.parcels && b.buildings === a.buildings, `${s.chunkId}: unchanged chunk differs from independent roads`);
  }
  const order = await lab(() => window.__worldGridLab.roadOrderTest());
  assert(order.identical, 'road seam depends on input order');
  const changedCounts = main.summaries.filter(s => main.seam.stats.chunksChanged.includes(s.chunkId)).map(s => ({ chunkId: s.chunkId, dna: s.resolvedDNA, independent: indep.summaries.find(x => x.chunkId === s.chunkId).counts, joined: s.counts }));

  // 2. City ID change next to joined edges: only that network rebuilds; city layers of every chunk whose stitched roads
  //    changed are rebuilt (no stale stubs / buildings); everything else untouched. Switching back restores the seam.
  const target = 'chunk_0_1';
  const cityChange = {};
  for (const [label, cityId] of [['toAmsterdam', 'amsterdamCanalRing'], ['back', 'auto']]) {
    const before = await lab(() => window.__worldGridLab.summaries());
    await lab(([id, c]) => window.__worldGridLab.setCity(id, c), [target, cityId]);
    const m = await measure();
    check(m, `city change ${label}`);
    const b = m.build;
    const changedNets = m.summaries.filter(s => s.signatures.network !== before.find(x => x.chunkId === s.chunkId).signatures.network).map(s => s.chunkId);
    const rebuiltCity = b.chunks.filter(c => c.ran.city).map(c => c.chunkId);
    assert(!b.prepare.harmony && b.prepare.raw.length === 0 && b.chunks.every(c => !c.ran.terrain), `${label}: terrain rebuilt`);
    assert(same(b.chunks.filter(c => c.ran.network).map(c => c.chunkId), [target]), `${label}: networks rebuilt ${JSON.stringify(b.chunks)}`);
    assert(same([...rebuiltCity].sort(), [...new Set([target, ...changedNets])].sort()), `${label}: city rebuilt ${rebuiltCity} vs stitched changes ${changedNets}`);
    for (const s of m.summaries) if (!rebuiltCity.includes(s.chunkId)) assert(same(s.signatures, before.find(x => x.chunkId === s.chunkId).signatures), `${label}: ${s.chunkId} changed without rebuild`);
    cityChange[label] = { cityId, networksRebuilt: [target], cityRebuilt: rebuiltCity, stitchedChanged: changedNets, connections: m.seam.stats.connections, edges: m.seam.edges.filter(e => e.a === target || e.b === target).map(e => ({ id: e.id, terrain: e.terrain, ...e.summary })), totalMs: b.totalMs };
    if (label === 'back') assert(m.seam.signature === main.seam.signature && same(sigs(m.summaries), mainSigs), 'switching back did not restore the joined world');
  }

  // 3. Reload: identical seam and layers.
  await openWorld('');
  const reload = await measure();
  assert(reload.seam.signature === main.seam.signature && same(sigs(reload.summaries), mainSigs), 'reload differs');
  const solids = [];
  for (const s of reload.summaries) solids.push({ chunkId: s.chunkId, ...(await lab(id => { const r = window.__worldGridLab.solid(id); return { watertight: r.watertight, euler: r.eulerCharacteristic, expected: r.expectedEuler }; }, s.chunkId)) });
  assert(solids.every(s => s.watertight && s.euler === s.expected), `solid not closed: ${JSON.stringify(solids)}`);

  // 4. Screenshots: whole world with the debug layer; Chicago | Manhattan pairs and the Manhattan | Manhattan stubs, before / after.
  const pairJoint = main.seam.connections.find(c => c.kind === 'pair')?.joint;
  const stubJoint = main.seam.connections.find(c => c.kind === 'stub')?.joint;
  await openWorld('seams=1');
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(shots, '06-3b-road-seam-overall-after.png') });
  const compare = async (joint, file, title) => {
    if (!joint) return null;
    const focus = `${Math.round(joint.x)},${Math.round(joint.z)},420`;
    const shotsHere = [];
    for (const [label, query] of [['before: independent roads (06.3a)', 'roads=independent&seams=1'], ['after: joined roads (06.3b)', 'seams=1']]) {
      await openWorld(`${query}&focus=${focus}`);
      await page.waitForTimeout(400);
      shotsHere.push({ label, png: (await page.locator('#worldCanvas').screenshot()).toString('base64') });
    }
    await page.setContent(`<html><head><link rel="icon" href="data:,"/></head><body style="margin:0;background:#101214;color:#e8e4dc;font:14px system-ui,sans-serif">
      <div style="padding:10px 14px;font-weight:600">06.3b · ${title} · focus x ${Math.round(joint.x)} m, z ${Math.round(joint.z)} m · world seed 6201 · transition 128 m</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px 8px">${shotsHere.map(c => `<figure style="margin:0"><img src="data:image/png;base64,${c.png}" style="width:100%;display:block"/><figcaption style="padding:6px 4px">${c.label}</figcaption></figure>`).join('')}</div></body></html>`);
    await page.setViewportSize({ width: 2000, height: 760 });
    await page.screenshot({ path: path.join(shots, file), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    return { file, focus };
  };
  const closeups = [
    await compare(pairJoint, '06-3b-road-pair-closeup-compare.png', 'paired ports re-routed inside both bands (chunk_-1_0 Chicago | chunk_0_0 Manhattan)'),
    await compare(stubJoint, '06-3b-road-stub-closeup-compare.png', 'stubs into the neighbour band (chunk_0_0 | chunk_0_1)'),
  ];

  // 5. Three world seeds: statistics + audit; each seed loaded twice (reproducibility).
  const seeds = [];
  for (const worldSeed of [6201, 6202, 6203]) {
    const ms = await openWorld(`worldSeed=${worldSeed}`);
    const m = await measure();
    check(m, `seed ${worldSeed}`);
    await openWorld(`worldSeed=${worldSeed}`);
    const again = await lab(() => ({ signature: window.__worldGridLab.roadSeam().signature, summaries: window.__worldGridLab.summaries() }));
    assert(again.signature === m.seam.signature && same(sigs(again.summaries), sigs(m.summaries)), `seed ${worldSeed}: not reproducible`);
    seeds.push({ worldSeed, loadMs: ms, roadSeamMs: m.seam.ms, signature: m.seam.signature, reproducible: true, stats: statsOf(m), edges: m.seam.edges.map(e => ({ id: e.id, terrain: e.terrain, ...e.summary })), connections: m.seam.connections.map(({ connectors, ...c }) => c), components: m.reach.components });
  }

  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify({
    task: '06.3b Road Network Seam', experiment: entry, testedAt: new Date().toISOString(),
    rules: main.seam.rules, maxPairOffset: main.seam.maxPairOffset,
    default: { worldSeed: 6201, transitionWidth: 128, loadMs, independentLoadMs: indepMs, roadSeamMs: main.seam.ms, stats: statsOf(main), edges: main.seam.edges, connections: main.seam.connections, ports: main.seam.ports, audit: main.audit, reach: main.reach, independentPorts: indep.seams, changedCounts },
    orderIndependent: order.identical, reloadIdentical: true, solids, cityChange, seeds,
    screenshots: ['06-3b-road-seam-overall-after.png', ...closeups.filter(Boolean).map(c => c.file)].map(f => `docs/assets/screenshots/procedural-mini-world/${f}`),
    browserErrors,
  }, null, 2)}\n`);
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  for (const s of seeds) {
    const t = s.stats;
    console.log(`seed ${s.worldSeed}: terrain-joined edges ${t.edgesJoinedTerrain}/12, edges with road joins ${t.edgesWithConnections}, ${t.connections} joins (${t.pairs} pairs, ${t.stubs} stubs); ports ${t.connected} connected / ${t.rejected} rejected / ${t.pending} pending; joint Δy max ${t.maxJointElevationDiff} m, new crossings ${t.newCrossings}, building conflicts ${t.buildingConflicts}; cross-chunk components ${JSON.stringify(t.crossChunkComponents)}`);
  }
  console.log(`changed chunks (6201): ${JSON.stringify(changedCounts)}`);
  console.log(`city change ${target}: ${JSON.stringify(cityChange.toAmsterdam.cityRebuilt)} city layers rebuilt; back → identical`);
  console.log('road seam verification passed');
} finally {
  await browser?.close();
  server.kill();
}
