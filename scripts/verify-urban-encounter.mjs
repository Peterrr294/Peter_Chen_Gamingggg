// A City of Cities — G03b Urban Encounter & Morphological Negotiation verifier (Chicago × Fez test fixture).
// Part A (Node, world seed 6201, cores placed by hand — TEST ONLY):
//   1. three scenarios (compatible interface, incompatible street geometry, natural barrier) through the real chain
//      and the G02b road-first growth; encounter states, boundary contexts, decisions;
//   2. topology: cross-city joins, endpoint error, unique ids / nodes, unmatched entries, core ↔ core path (Dijkstra);
//   3. morphology: orientation difference across the edge, existing fabric unchanged (signatures), the newcomer's
//      character with vs. without negotiation, boundary blocks, abnormal parcels;
//   4. identity: grid / organic still recognisable (orientation concentration, resolved DNA);
//   5. stability: cores = independent generation, twin run identical, save mid-way → load → continue = uninterrupted,
//      save at the end → load → joins and encounters reproduced, re-running adds no duplicate decision or join.
// Part B (browser): the page reproduces Node, screenshots of every scenario, before / after comparison sheet.
// Thresholds marked (hypothesis) are working assumptions, not calibrated values.
// Usage: node --max-old-space-size=8192 scripts/verify-urban-encounter.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { verifyConnections } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const { UrbanEncounter, ENCOUNTER_RULES } = await mod('experiments/city-of-cities/UrbanEncounter.js');
const { MorphologicalGrowth } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const { ENCOUNTER_FIXTURES, createFixtureWorld, runFixture } = await mod('experiments/city-of-cities/encounterFixture.js');
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'urban-encounter.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const mod90 = x => ((x % 90) + 90) % 90;
const angleDiff = (a, b) => { const d = Math.abs(mod90(a) - mod90(b)); return +Math.min(d, 90 - d).toFixed(2); };
const HYP = { gridConcentrationMin: 0.8, organicConcentrationMax: 0.6, abnormalParcelM2: 30 }; // (hypothesis)

const signatures = w => Object.fromEntries([...w.chunks.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId)).map(c => [c.chunkId, c.outputs?.signatures ?? null]));
const regenerateAll = w => { for (const c of [...w.chunks.values()].sort((a, b) => a.growthStep - b.growthStep || a.chunkId.localeCompare(b.chunkId))) w.generateChunk(c.chunkId); };
const strip = w => ({ history: w.growth.history, decisions: w.growth.encounterDecisions ?? [], signatures: signatures(w) });

function scenario(name) {
  const t0 = Date.now();
  const w = createFixtureWorld(name);
  const { enc, steps } = runFixture(w, name);
  const f = ENCOUNTER_FIXTURES[name];
  const growthSteps = steps.filter(s => s.kind === 'step');
  // Abnormal parcels of every generated growth chunk (needs the layers; computed here, layers released after).
  const parcels = Object.fromEntries(growthSteps.filter(s => !s.result.failure).map(s => {
    const list = s.result.layers.city.parcels.parcels ?? [];
    return [s.result.chunk.chunkId, { parcels: list.length, abnormal: list.filter(p => (p.area ?? 0) < HYP.abnormalParcelM2 || !(p.frontages ?? []).length).length }];
  }));
  const encounters = enc.detect();
  const e = encounters[0] ?? null;
  const path_ = e?.crossCityConnections.length ? enc.path('chicagoGrid', 'fezOrganicCore') : null;
  const decisions = w.growth.encounterDecisions ?? [];
  const joins = decisions.flatMap(d => d.crossCityConnections ?? []);
  const chunkMetrics = Object.fromEntries([...w.chunks.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId)).map(c => [c.chunkId, { cityId: c.cityId, role: c.role, landform: c.terrainType, resolvedDNA: c.outputs.resolvedDNA, ...c.outputs.morph, boundaryBlocks: c.outputs.boundaryBlocks, counts: c.outputs.counts }]));
  const topology = {
    crossCityJoins: joins.length,
    maxEndpointErrorM: joins.length ? Math.max(...joins.map(j => j.positionErrorM)) : null,
    maxElevationStepM: joins.length ? Math.max(...joins.map(j => Math.abs(j.elevationStepM))) : null,
    uniqueConnectionIds: new Set(joins.map(j => j.connectionId)).size === joins.length,
    uniqueChildNodes: new Set(joins.map(j => `${j.child.chunkId}:${j.child.nodeId}`)).size === joins.length,
    uniqueParentNodes: new Set(joins.map(j => `${j.parent.chunkId}:${j.parent.nodeId}`)).size === joins.length,
    unmatchedAcceptedEntries: decisions.flatMap(d => d.unmatched ?? []).length,
    path: path_,
    invalidCrossings: 'not measured (no segment-intersection test); joins are identities of existing boundary nodes, no segment is generated across the edge',
  };
  return { name, title: f.title, worldSeed: f.worldSeed, row: f.row, ms: Date.now() - t0, world: w, enc, encounters, decisions, topology, chunkMetrics, parcels,
    steps: growthSteps.map(s => ({ cityId: s.cityId, target: `${s.target.gx},${s.target.gy}`, grown: !s.result.failure, newChunkId: s.result.event?.newChunkId ?? null, sameCityJoins: s.result.event?.connections.length ?? 0, crossCityJoins: s.result.event?.crossCityConnections?.length ?? 0, failure: s.result.failure?.reason ?? null, decisions: s.decisions.map(d => ({ outcome: d.outcome, reason: d.reason })) })) };
}

const result = { task: 'G03b', testedAt: new Date().toISOString(), fixture: 'TEST ONLY: Chicago and Fez cores placed by hand in one row (Chicago x, Fez x + 3); real terrain, DNA, generators and G02b growth', rules: ENCOUNTER_RULES, hypotheses: HYP };
if (!browserOnly) {
  const S = {};
  for (const name of Object.keys(ENCOUNTER_FIXTURES)) { S[name] = scenario(name); console.log(`${name}: ${S[name].ms} ms · ${json(S[name].steps.map(s => [s.cityId, s.target, s.grown, s.decisions.map(d => d.outcome)]))}`); }
  const c = S.compatible; const i = S.incompatible; const b = S.barrier;
  const row = ENCOUNTER_FIXTURES.compatible.row;
  const chi1 = `c_${row.gx + 1}_${row.gy}`; const fez2 = `c_${row.gx + 2}_${row.gy}`;

  // --- Scenario expectations (what the experiment claims; each is checked, not assumed).
  const e1 = c.encounters[0]; const e2 = i.encounters[0]; const e3 = b.encounters[0];
  assert(c.decisions.length === 1 && c.decisions[0].outcome === 'connection', 'S1: expected one connection decision');
  assert(e1.states.adjacent && e1.states.connected && !e1.states.constrained, `S1 states ${json(e1.states)}`);
  assert(c.topology.crossCityJoins >= 1 && c.topology.maxEndpointErrorM <= 0.5 && c.topology.uniqueConnectionIds && c.topology.uniqueChildNodes && c.topology.uniqueParentNodes && !c.topology.unmatchedAcceptedEntries, `S1 topology ${json(c.topology)}`);
  assert(c.topology.path?.reachable, 'S1: no core ↔ core path');
  assert(i.decisions.length === 1 && ['plan', 'separation'].includes(i.decisions[0].outcome), 'S2: expected a plan or a separation');
  assert(!e2.states.connected && e2.states.adjacent, `S2 states ${json(e2.states)}`);
  assert(b.decisions.length >= 1 && b.decisions.every(d => d.outcome === 'separation'), 'S3: expected separation only');
  assert(e3.states.constrained && !e3.states.adjacent && !e3.states.connected, `S3 states ${json(e3.states)}`);
  const barrierCell = `${ENCOUNTER_FIXTURES.barrier.row.gx + 2},${ENCOUNTER_FIXTURES.barrier.row.gy}`;
  assert(!b.world.chunks.has(`c_${barrierCell.replace(',', '_')}`), 'S3: the barrier cell was urbanised');

  // --- Encounter records: required fields, no duplicates.
  for (const s of [c, i, b]) {
    const ids = s.encounters.map(e => e.encounterId);
    assert(new Set(ids).size === ids.length && ids.length === 1, `${s.name}: duplicate or missing encounters ${json(ids)}`);
    for (const k of ['encounterId', 'cityA', 'cityB', 'participatingChunkIds', 'boundaryLocation', 'relevantGrowthFrontIds', 'terrainConditions', 'roadInterfaceConditions', 'currentRelationship', 'decisionReason', 'validationStatus']) assert(s.encounters[0][k] !== undefined, `${s.name}: encounter field ${k} missing`);
    for (const d of s.decisions) for (const k of ['encounterId', 'step', 'worldSeed', 'version', 'newcomer', 'other', 'constraintParams', 'boundaryContext', 'acceptedInterfaces', 'rejectedInterfaces', 'outcome', 'reason', 'generatedObjects', 'modifiedObjects']) assert(d[k] !== undefined, `${s.name}: decision field ${k} missing`);
  }

  // --- Morphology: existing fabric unchanged, newcomer adapts locally.
  const sigC = signatures(c.world); const sigI = signatures(i.world);
  const existingUnchanged = {
    chicagoCore: json(sigC[`c_${row.gx}_${row.gy}`]) === json(sigI[`c_${row.gx}_${row.gy}`]),
    fezCore: json(sigC[`c_${row.gx + 3}_${row.gy}`]) === json(sigI[`c_${row.gx + 3}_${row.gy}`]),
    chicagoGrowthChunk: json(sigC[chi1]) === json(sigI[chi1]), // S1: grown before Fez arrives; S2: grown next to Fez
    chicagoModifiedObjects: c.decisions.flatMap(d => d.modifiedObjects).length + i.decisions.flatMap(d => d.modifiedObjects).length,
  };
  assert(existingUnchanged.chicagoCore && existingUnchanged.fezCore && existingUnchanged.chicagoGrowthChunk && !existingUnchanged.chicagoModifiedObjects, `existing fabric changed ${json(existingUnchanged)}`);
  const m = id => c.chunkMetrics[id]; const mi = id => i.chunkMetrics[id];
  const newcomer = { // Fez chunk next to Chicago: with negotiation (S1) vs. without (S2, Fez arrived first)
    keys: ['dominantOrientationDeg', 'orientationConcentration', 'roadDensityKmPerKm2', 'primaryKm', 'blockAreaMedianM2', 'blockAspectMedian', 'parcelFrontageMedianM', 'buildingCoverage', 'heightMeanM', 'deadEnds'],
    withNegotiation: m(fez2), withoutNegotiation: mi(fez2),
    signaturesDiffer: json(sigC[fez2]) !== json(sigI[fez2]),
    parcels: { withNegotiation: c.parcels[fez2], withoutNegotiation: i.parcels[fez2] },
  };
  const morphology = {
    orientationDiffAcrossEdgeDeg: { compatible: angleDiff(m(chi1).dominantOrientationDeg, m(fez2).dominantOrientationDeg), incompatible: angleDiff(mi(chi1).dominantOrientationDeg, mi(fez2).dominantOrientationDeg) },
    boundaryBlocks: { compatible: { chicago: m(chi1).boundaryBlocks.maxX, fez: m(fez2).boundaryBlocks.minX }, incompatible: { chicago: mi(chi1).boundaryBlocks.maxX, fez: mi(fez2).boundaryBlocks.minX } },
    existingUnchanged, newcomer,
    abnormalParcels: { compatible: c.parcels, incompatible: i.parcels, barrier: b.parcels },
  };

  // --- Identity: grid / organic still recognisable (hypothesis thresholds).
  const identity = Object.fromEntries([c, i, b].map(s => [s.name, Object.fromEntries(Object.entries(s.chunkMetrics).map(([id, x]) => [id, { cityId: x.cityId, resolvedDNA: x.resolvedDNA, orientationConcentration: x.orientationConcentration, recognisable: x.resolvedDNA === x.cityId && (x.cityId === 'chicagoGrid' ? x.orientationConcentration >= HYP.gridConcentrationMin : x.orientationConcentration <= HYP.organicConcentrationMax) }]))]));

  // --- Stability.
  const independent = {};
  for (const [cityId, dx] of [['chicagoGrid', 0], ['fezOrganicCore', 3]]) {
    const w = new WorldContext({ worldSeed: 6201 }); w.registerOrigin({ cityId, gx: row.gx + dx, gy: row.gy, reason: { order: 0 } });
    const id = `c_${row.gx + dx}_${row.gy}`; w.generateChunk(id); independent[cityId] = json(w.chunks.get(id).outputs.signatures) === json(sigC[id]);
  }
  const twin = createFixtureWorld('compatible'); runFixture(twin, 'compatible');
  const twinIdentical = json(strip(twin)) === json(strip(c.world));
  const twinEncounters = json(new UrbanEncounter(twin, new MorphologicalGrowth(twin)).detect()) === json(c.encounters);
  // Save after step 1 → restore → continue = uninterrupted.
  const half = createFixtureWorld('compatible'); runFixture(half, 'compatible', 1);
  const savedHalf = JSON.parse(json(half.serialise()));
  const resumed = WorldContext.restore(savedHalf); resumed.fixture = 'compatible'; regenerateAll(resumed);
  const resumedSigs = json(signatures(resumed)) === json(Object.fromEntries(Object.entries(signatures(half))));
  runFixture(resumed, 'compatible');
  const continueIdentical = json(strip(resumed)) === json(strip(c.world));
  // Save at the end → restore → joins and encounters reproduced; re-run adds nothing.
  const saved = JSON.parse(json(c.world.serialise()));
  const restored = WorldContext.restore(saved); restored.fixture = 'compatible'; regenerateAll(restored);
  const checks = verifyConnections(restored);
  const restoredEnc = new UrbanEncounter(restored, new MorphologicalGrowth(restored));
  const encountersReproduced = json(restoredEnc.detect()) === json(c.encounters);
  const before = { decisions: restored.growth.encounterDecisions.length, chunks: restored.chunks.size, joins: restored.growth.history.flatMap(e => e.crossCityConnections ?? []).length };
  runFixture(restored, 'compatible');
  const after = { decisions: restored.growth.encounterDecisions.length, chunks: restored.chunks.size, joins: restored.growth.history.flatMap(e => e.crossCityConnections ?? []).length };
  const stability = {
    coresEqualIndependentGeneration: independent, twinIdentical, twinEncounters,
    saveMidwayLoadContinue: { signaturesAfterLoad: resumedSigs, uninterrupted: continueIdentical },
    saveEndLoad: { connectionsReproduced: checks.length > 0 && checks.every(x => x.same), events: checks.length, encountersReproduced, rerunAddsNothing: json(before) === json(after), before, after },
    scope: 'no City Invasion, no six-city world, no 3×3, no new DNA, no terrain edits (the fixture world has two cities and ≤ 4 chunks)',
  };
  assert(Object.values(independent).every(Boolean) && twinIdentical && twinEncounters && resumedSigs && continueIdentical && stability.saveEndLoad.connectionsReproduced && encountersReproduced && stability.saveEndLoad.rerunAddsNothing, `stability ${json(stability)}`);

  const pack = s => ({ title: s.title, worldSeed: s.worldSeed, row: s.row, ms: s.ms, steps: s.steps, encounter: s.encounters[0], decisions: s.decisions, topology: s.topology, chunkMetrics: s.chunkMetrics });
  result.node = { scenarios: { compatible: pack(c), incompatible: pack(i), barrier: pack(b) }, morphology, identity, stability };
  for (const s of [c, i, b]) { s.world = null; s.enc = null; }
  console.log(`Part A passed. S1 joins ${c.topology.crossCityJoins} (max error ${c.topology.maxEndpointErrorM} m), path ${c.topology.path.lengthM} m; S2 ${i.decisions[0].outcome}; S3 ${b.decisions.map(d => d.outcome).join(', ')}`);
} else {
  result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4219; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const shot = async name => { await page.waitForTimeout(900); const f = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: f }); return path.relative(root, f).replaceAll('\\', '/'); };
    const OFF = { encounterZones: false, candidateConnections: false, interfaces: false, encounterConnectivity: false, morphDifference: false, morphFronts: false, inheritedRoads: false, connectivity: false, morphology: false, chunkBorders: true, ownership: true };
    const layers = l => lab(x => window.__originLab.setLayers(x), { ...OFF, ...l });
    const N = result.node.scenarios; const row = N.compatible.row;
    const edge = { x: (row.gx + 1.5) * 1024, z: row.gy * 1024 };
    const b = { screenshots: {} };
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    // 1. Before the meeting: Chicago has grown one step east, Fez is still at its core (approaching).
    await call(() => window.__originLab.fixture('compatible', 1));
    await layers({ encounterZones: true }); await lab(r => window.__originLab.fitRegion(r.gx, r.gy, r.gx + 3, r.gy), row);
    b.screenshots.before = await shot('g03b-before-meeting.png');
    // 2. Growth fronts and road interfaces (Fez fronts toward the free cell).
    await layers({ encounterZones: true, morphFronts: true, morphCity: 'fezOrganicCore' });
    await lab(() => window.__originLab.select('fezOrganicCore')); // select() refreshes the overlays (fronts of the selected morph city)
    b.screenshots.fronts = await shot('g03b-growth-fronts-interfaces.png');
    // 3. Continue → compatible meeting; Node equality.
    await call(() => window.__originLab.continueFixture());
    const decisions = await lab(() => window.__originLab.encounterDecisions());
    const encs = await lab(() => window.__originLab.encounters());
    assert(json(decisions) === json(N.compatible.decisions), 'browser decisions differ from Node (compatible)');
    assert(json(encs[0]) === json(N.compatible.encounter), 'browser encounter differs from Node (compatible)');
    await layers({ encounterZones: true, candidateConnections: true }); await lab(e => window.__originLab.focusPoint(e.x, e.z, 1500), edge);
    b.screenshots.candidates = await shot('g03b-candidate-analysis.png');
    await layers({ interfaces: true, candidateConnections: true }); await lab(e => window.__originLab.focusPoint(e.x, e.z, 900), edge);
    b.screenshots.connection = await shot('g03b-connection-closeup.png');
    await layers({ encounterZones: true, encounterConnectivity: true, morphDifference: true }); await lab(r => window.__originLab.fitRegion(r.gx, r.gy - 1, r.gx + 3, r.gy + 1), row);
    b.screenshots.states = await shot('g03b-encounter-state-topology.png');
    await layers({ chunkBorders: false, ownership: false }); await lab(r => window.__originLab.fitRegion(r.gx, r.gy, r.gx + 3, r.gy), row);
    b.screenshots.noBorders = await shot('g03b-compatible-no-borders.png');
    await layers({ chunkBorders: false, ownership: false }); await lab(e => window.__originLab.focusPoint(e.x + 300, e.z, 1300), edge);
    b.screenshots.afterFez = await shot('g03b-fez-edge-after.png');
    // Save → reload → load: joins reproduced, encounters identical.
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(() => window.__originLab.loadLocal());
    assert(/reproduced/.test(await lab(() => window.__originLab.morphRestore())), 'browser: joins not reproduced after load');
    assert(json((await lab(() => window.__originLab.encounters()))[0]) === json(N.compatible.encounter), 'browser: encounter differs after load');
    await call(() => window.__originLab.continueFixture());
    assert((await lab(() => window.__originLab.encounterDecisions())).length === N.compatible.decisions.length, 'browser: continue after load added a decision');
    // 4. Incompatible: pending plan close-up; the Fez edge without negotiation (before).
    await call(() => window.__originLab.fixture('incompatible'));
    assert(json(await lab(() => window.__originLab.encounterDecisions())) === json(N.incompatible.decisions), 'browser decisions differ from Node (incompatible)');
    await layers({ interfaces: true, candidateConnections: true, encounterZones: true }); await lab(e => window.__originLab.focusPoint(e.x, e.z, 1100), edge);
    b.screenshots.plan = await shot('g03b-incompatible-plan-closeup.png');
    await layers({ chunkBorders: false, ownership: false }); await lab(e => window.__originLab.focusPoint(e.x + 300, e.z, 1300), edge);
    b.screenshots.beforeFez = await shot('g03b-fez-edge-before.png');
    // 5. Barrier: separation.
    await call(() => window.__originLab.fixture('barrier'));
    assert(json(await lab(() => window.__originLab.encounterDecisions())) === json(N.barrier.decisions), 'browser decisions differ from Node (barrier)');
    const br = N.barrier.row;
    await layers({ encounterZones: true, candidateConnections: true }); await lab(r => window.__originLab.fitRegion(r.gx, r.gy, r.gx + 3, r.gy), br);
    b.screenshots.barrier = await shot('g03b-barrier-separation.png');
    // Before / after sheet (two real captures side by side + real metrics).
    const nw = result.node.morphology.newcomer;
    const img = async f => `data:image/png;base64,${(await readFile(path.join(root, f))).toString('base64')}`;
    const keys = nw.keys; const td = v => `<td style="padding:5px 10px;border-bottom:1px solid #22292d">${v ?? '—'}</td>`;
    const sheet = await context.newPage(); await sheet.setViewportSize({ width: 1800, height: 1100 });
    await sheet.setContent(`<body style="margin:0;padding:24px;background:#0f1215;color:#e8ecee;font:17px 'Segoe UI',Arial"><h2 style="font-weight:400;margin:0 0 4px">G03b · Fez chunk next to Chicago: before / after negotiation (world seed 6201, TEST FIXTURE)</h2><p style="color:#9aa3a8;margin:0 0 12px">Left: Fez arrived first (no negotiation, Scenario 2). Right: Fez arrived second and took ${N.compatible.decisions[0].acceptedInterfaces.length} accepted Chicago roads as entry gates (Scenario 1). Chicago's chunks are identical in both (signatures).</p><div style="display:flex;gap:12px"><img style="width:50%" src="${await img(b.screenshots.beforeFez)}"><img style="width:50%" src="${await img(b.screenshots.afterFez)}"></div><table style="border-collapse:collapse;width:100%;margin-top:14px"><tr style="color:#9aa3a8;text-align:left"><th style="padding:5px 10px">metric (Fez chunk at the edge)</th><th>before (S2)</th><th>after (S1)</th></tr>${keys.map(k => `<tr>${td(k)}${td(nw.withoutNegotiation[k])}${td(nw.withNegotiation[k])}</tr>`).join('')}<tr>${td('parcels / abnormal')}${td(`${nw.parcels.withoutNegotiation.parcels} / ${nw.parcels.withoutNegotiation.abnormal}`)}${td(`${nw.parcels.withNegotiation.parcels} / ${nw.parcels.withNegotiation.abnormal}`)}</tr></table></body>`);
    b.screenshots.compare = path.relative(root, path.join(shots, 'g03b-before-after-compare.png')).replaceAll('\\', '/');
    await sheet.screenshot({ path: path.join(root, b.screenshots.compare), fullPage: true });
    b.errors = errors; assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await mkdir(evidence, { recursive: true });
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G03b verification passed. Record: experiments/city-of-cities/evidence/urban-encounter.json');
