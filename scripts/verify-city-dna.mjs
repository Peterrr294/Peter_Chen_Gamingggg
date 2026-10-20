// 06.1 City DNA 3 → 6: six-city comparison, config consistency, seed reproducibility, regression.
// `node scripts/verify-city-dna.mjs baseline` records the current DNAs (run before the change);
// `node scripts/verify-city-dna.mjs` runs the full comparison and diffs old DNAs against the baseline.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4203;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const baselineMode = process.argv[2] === 'baseline';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const shared = { landform: 'coast', seed: 1101 }; // common test terrain for all six cities
const oldDNA = ['manhattanGrid', 'veniceWaterNetwork', 'fezOrganicCore'];
const siblings = { chicagoGrid: 'manhattanGrid', amsterdamCanalRing: 'veniceWaterNetwork', lisbonHillCore: 'fezOrganicCore' };
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const evidence = path.join(root, 'experiments/seed-terrain/evidence');
const baselineFile = path.join(evidence, 'city-dna-baseline.json');
const record = path.join(evidence, 'city-dna-comparison.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };

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
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
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

// One compact summary of the current page state (all downstream layers + upstream signatures).
const summarise = () => window.__seedTerrainLab && (async () => {
  const lab = window.__seedTerrainLab;
  const match = lab.cityMatch();
  const network = lab.network();
  const blocks = lab.blocks();
  const parcels = lab.parcels();
  const buildings = lab.buildings();
  const ring = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.z - q.x * p.z; }, 0) / 2);
  const gfa = buildings.buildings.reduce((s, b) => s + (ring(b.footprint.polygon) - b.footprint.holes.reduce((h, r) => h + ring(r), 0)) * b.floorsEstimate, 0);
  const n = network.stats; const bk = blocks.stats; const p = parcels.stats; const b = buildings.stats;
  const select = [...document.querySelectorAll('#gui select')].find(s => [...s.options].some(o => o.textContent === 'Auto (top match)'));
  return {
    heightSignature: lab.stats().heightSignature, waterSignature: lab.stats().waterSignature,
    selected: match.selectedDNA.id, mode: match.selectedDNA.mode, autoTop: match.selectedDNA.autoTopId,
    guiLabel: select ? select.options[select.selectedIndex].textContent : null,
    ranking: match.rankedCandidates.map(c => ({ id: c.id, score: c.score, fit: c.fitScore, coverage: c.evidenceCoverage, weak: c.weakFit })),
    strategy: network.strategy, networkParams: network.params, parcelRule: parcels.rules.target, buildingRule: buildings.rules.rule,
    signatures: { network: network.signature, blocks: blocks.signature, parcels: parcels.signature, buildings: buildings.signature },
    network: {
      roadKm: +(n.roadLength / 1000).toFixed(2), edges: n.edges, junctions: n.junctions, deadEndRatio: +n.deadEndRatio.toFixed(3),
      canals: n.edgesByKind.canal, bridges: n.bridges, tunnels: n.tunnels, mountainRoads: n.mountainConnectors,
      orientationEntropy: +n.orientationEntropy.toFixed(3), straightness: +n.straightness.toFixed(3), components: n.roadComponents,
      gridAxisDeg: network.orientation?.axisDeg ?? null,
    },
    blocks: { count: bk.blocks, invalid: bk.invalid, meanAreaM2: bk.blocks ? Math.round(bk.area.blocks / bk.blocks) : 0, roadHa: +(bk.area.roads / 1e4).toFixed(1) },
    parcels: { count: p.parcels, meanFrontage: +p.meanFrontage.toFixed(1), meanArea: Math.round(p.meanArea), meanDepth: +p.meanDepth.toFixed(1), utilisation: +p.utilisation.toFixed(3), canalFacing: p.withCanalFrontage },
    buildings: {
      count: b.buildings, meanHeight: +b.meanHeight.toFixed(1), p10: +b.heightP10.toFixed(1), p50: +b.heightP50.toFixed(1), p90: +b.heightP90.toFixed(1), max: +b.heightMax.toFixed(1),
      coverage: +b.coverageOfBuiltParcels.toFixed(3), footprintHa: +(b.footprintArea / 1e4).toFixed(2), gfaHa: +(gfa / 1e4).toFixed(1),
      far: p.buildableArea ? +(gfa / p.buildableArea).toFixed(3) : 0, courtyards: b.courtyards, distinctFloors: b.distinctFloors,
    },
  };
})();

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) browserErrors.push(`http ${response.status()}: ${response.url()}`); });
  const open = async query => {
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 180000 });
  };
  const state = () => page.evaluate(summarise);
  const config = () => page.evaluate(async () => {
    const rules = await import('/experiments/seed-terrain/cityMatchRules.js');
    const net = await import('/experiments/seed-terrain/networkStrategies.js');
    const { PARCEL_RULES } = await import('/experiments/seed-terrain/parcelRules.js');
    const { BUILDING_RULES } = await import('/experiments/seed-terrain/buildingRules.js');
    const order = rules.MATCH_SETTINGS.order;
    return {
      order,
      dna: Object.fromEntries(order.map(id => [id, {
        label: rules.CITY_DNA[id].label, family: rules.CITY_DNA[id].family, strategy: net.DNA_STRATEGY[id],
        params: net.strategyParams ? net.strategyParams(id) : net.STRATEGIES[net.DNA_STRATEGY[id]],
        parcel: PARCEL_RULES.byDNA[id] ?? null, building: BUILDING_RULES.byDNA[id] ?? null,
        unsupported: rules.CITY_DNA[id].unsupported ?? [],
      }])),
      cityKeys: Object.keys(rules.CITY_DNA),
    };
  });

  await open(`landform=${shared.landform}&seed=${shared.seed}&view=buildings`);
  const cfg = await config();
  const ids = cfg.order;
  // Config validity: every DNA in the candidate set has a strategy, params, parcel and building rule.
  const configChecks = ids.map(id => {
    const d = cfg.dna[id];
    const problems = [];
    if (!['grid', 'organic', 'canalStreet'].includes(d.strategy)) problems.push('strategy');
    if (!d.params) problems.push('params');
    if (!d.parcel) problems.push('parcel rule');
    if (!d.building) problems.push('building rule');
    if (d.building && !(d.building.floors[0] >= 1 && d.building.floors[1] >= d.building.floors[0])) problems.push('floors');
    if (d.parcel && !(d.parcel.minFrontage <= d.parcel.targetFrontage && d.parcel.maxDepth > 0)) problems.push('parcel ranges');
    return { id, problems };
  });
  assert(configChecks.every(c => !c.problems.length), `invalid DNA config: ${JSON.stringify(configChecks.filter(c => c.problems.length))}`);
  assert(cfg.cityKeys.length === ids.length && cfg.cityKeys.every(id => ids.includes(id)), 'CITY_DNA keys and MATCH_SETTINGS.order differ.');

  const runs = [];
  const timings = [];
  for (const landform of landforms) {
    for (const seed of seeds) {
      await open(`landform=${landform}&seed=${seed}&view=buildings`);
      const auto = await state();
      for (const id of ids) {
        const started = Date.now();
        let result;
        try {
          await page.evaluate(choice => window.__seedTerrainLab.selectDNA(choice), id);
          result = await state();
          const problems = [];
          if (result.selected !== id || result.mode !== 'manual') problems.push('selection');
          if (result.guiLabel !== cfg.dna[id].label) problems.push(`gui label ${result.guiLabel}`);
          if (result.heightSignature !== auto.heightSignature || result.waterSignature !== auto.waterSignature) problems.push('terrain changed');
          if (result.strategy !== cfg.dna[id].strategy) problems.push('strategy');
          if (JSON.stringify(result.networkParams) !== JSON.stringify(cfg.dna[id].params)) problems.push('network params differ from config');
          if (JSON.stringify(result.parcelRule) !== JSON.stringify(cfg.dna[id].parcel)) problems.push('parcel rule differs');
          if (JSON.stringify(result.buildingRule) !== JSON.stringify(cfg.dna[id].building)) problems.push('building rule differs');
          if (JSON.stringify(result.ranking) !== JSON.stringify(auto.ranking)) problems.push('manual switch changed ranking');
          result.problems = problems;
          result.ok = problems.length === 0 && result.blocks.invalid === 0;
          result.empty = result.buildings.count === 0;
        } catch (error) {
          result = { ok: false, error: error.message };
        }
        const ms = Date.now() - started;
        timings.push(ms);
        delete result.networkParams; delete result.parcelRule; delete result.buildingRule;
        runs.push({ landform, seed, dna: id, autoTop: auto.selected, ms, ...result });
        console.log(`${landform} ${seed} ${id}: ${result.ok ? 'ok' : 'FAIL ' + (result.error ?? result.problems.join(','))} · ${result.buildings?.count ?? '-'} bldg · ${ms} ms`);
      }
    }
  }
  const failures = runs.filter(run => !run.ok);
  assert(!failures.length, `failed runs: ${failures.map(r => `${r.landform}/${r.seed}/${r.dna}: ${r.error ?? r.problems.join(',')}`).join('; ')}`);

  // Seed reproducibility: a fresh load with ?dna= reproduces the selectDNA path exactly; switching back is stable.
  const reproducibility = [];
  for (const id of ids) {
    await open(`landform=${shared.landform}&seed=${shared.seed}&view=buildings&dna=${id}`);
    const fresh = await state();
    const viaSwitch = runs.find(run => run.landform === shared.landform && run.seed === shared.seed && run.dna === id);
    reproducibility.push({ dna: id, identical: JSON.stringify(fresh.signatures) === JSON.stringify(viaSwitch.signatures), signatures: fresh.signatures });
  }
  await page.evaluate(choice => window.__seedTerrainLab.selectDNA(choice), ids[0]);
  const back = await state();
  const firstRun = runs.find(run => run.landform === shared.landform && run.seed === shared.seed && run.dna === ids[0]);
  const switchBackStable = JSON.stringify(back.signatures) === JSON.stringify(firstRun.signatures);
  assert(reproducibility.every(r => r.identical), `fresh load differs from manual switch: ${reproducibility.filter(r => !r.identical).map(r => r.dna)}`);
  assert(switchBackStable, 'switching back to the first DNA did not reproduce its result');

  if (baselineMode) {
    await mkdir(evidence, { recursive: true });
    await writeFile(baselineFile, `${JSON.stringify({ task: '06.1 baseline (before DNA expansion)', testedAt: new Date().toISOString(), ids, runs: runs.map(({ landform, seed, dna, autoTop, signatures, ranking }) => ({ landform, seed, dna, autoTop, signatures, ranking })) }, null, 2)}\n`);
    console.log(`baseline: ${runs.length} runs, ${ids.length} DNAs, errors ${browserErrors.length}`);
  } else {
    // Regression: unchanged configs must reproduce the baseline bit for bit.
    const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
    const regression = baseline.runs.map(old => {
      const now = runs.find(run => run.landform === old.landform && run.seed === old.seed && run.dna === old.dna);
      return { landform: old.landform, seed: old.seed, dna: old.dna, identical: JSON.stringify(now.signatures) === JSON.stringify(old.signatures) };
    });
    const autoChanges = landforms.flatMap(landform => seeds.map(seed => {
      const before = baseline.runs.find(run => run.landform === landform && run.seed === seed).autoTop;
      const after = runs.find(run => run.landform === landform && run.seed === seed).autoTop;
      return { landform, seed, before, after, changed: before !== after };
    }));
    assert(regression.every(r => r.identical), `regression in original DNAs: ${regression.filter(r => !r.identical).map(r => `${r.landform}/${r.seed}/${r.dna}`).join(', ')}`);

    // Suitable terrain per DNA = the test terrain where its rankScore is highest (data, not chosen by hand).
    const suitable = Object.fromEntries(ids.map(id => {
      const best = runs.filter(run => run.dna === id).map(run => ({ landform: run.landform, seed: run.seed, score: run.ranking.find(c => c.id === id).score }))
        .sort((a, b) => b.score - a.score)[0];
      return [id, best];
    }));

    // Similarity between each new DNA and its sibling (same strategy): relative difference per metric.
    const keys = [['network', 'roadKm'], ['network', 'junctions'], ['network', 'deadEndRatio'], ['network', 'bridges'], ['blocks', 'count'], ['blocks', 'meanAreaM2'],
      ['parcels', 'count'], ['parcels', 'meanFrontage'], ['parcels', 'meanArea'], ['buildings', 'count'], ['buildings', 'meanHeight'], ['buildings', 'p90'], ['buildings', 'far']];
    const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
    const similarity = Object.entries(siblings).filter(([id]) => ids.includes(id)).flatMap(([id, sib]) => landforms.flatMap(landform => seeds.map(seed => {
      const a = runs.find(run => run.landform === landform && run.seed === seed && run.dna === id);
      const b = runs.find(run => run.landform === landform && run.seed === seed && run.dna === sib);
      const diffs = Object.fromEntries(keys.map(([layer, key]) => [`${layer}.${key}`, +rel(a[layer][key], b[layer][key]).toFixed(3)]));
      const sorted = Object.values(diffs).sort((x, y) => x - y);
      const median = sorted[Math.floor(sorted.length / 2)];
      const sameNetwork = a.signatures.network === b.signatures.network;
      return { dna: id, sibling: sib, landform, seed, sameNetwork, medianRelDiff: median, lowDifference: sameNetwork || median < 0.1 || (a.buildings.count === 0 && b.buildings.count === 0), diffs };
    })));

    // Screenshots: six cities on the shared terrain, and each on its suitable terrain.
    const tile = async (landform, seed, id) => {
      await open(`landform=${landform}&seed=${seed}&view=buildings&dna=${id}`);
      await page.waitForTimeout(400);
      const png = await page.locator('#terrainCanvas').screenshot();
      const s = await state();
      return { id, landform, seed, label: cfg.dna[id].label, strategy: s.strategy, png: png.toString('base64'), line: `${s.network.roadKm} km road · ${s.blocks.count} blocks · ${s.parcels.count} parcels · ${s.buildings.count} bldg · mean ${s.buildings.meanHeight} m · p90 ${s.buildings.p90} m` };
    };
    const compose = async (tiles, title, file) => {
      const html = `<html><head><link rel="icon" href="data:,"/></head><body style="margin:0;background:#101214;color:#e8e4dc;font:13px/1.35 system-ui,sans-serif">
        <div style="padding:10px 14px;font-size:16px;font-weight:600">${title}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 8px 8px">${tiles.map(t => `<figure style="margin:0;background:#1b1e22">
          <img src="data:image/png;base64,${t.png}" style="width:100%;display:block"/>
          <figcaption style="padding:6px 8px"><b>${t.label}</b> · ${t.strategy} · ${t.landform} ${t.seed}<br/>${t.line}</figcaption></figure>`).join('')}</div></body></html>`;
      await page.setContent(html, { waitUntil: 'load' });
      await page.setViewportSize({ width: 1800, height: 1000 });
      await page.screenshot({ path: file, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    };
    await mkdir(shots, { recursive: true });
    const sharedTiles = [];
    for (const id of ids) sharedTiles.push(await tile(shared.landform, shared.seed, id));
    await compose(sharedTiles, `06.1 · six City DNAs on the same terrain (${shared.landform}, seed ${shared.seed}) — upstream terrain identical`, path.join(shots, '06-1-six-cities-shared-terrain.png'));
    const suitableTiles = [];
    for (const id of ids) suitableTiles.push(await tile(suitable[id].landform, suitable[id].seed, id));
    await compose(suitableTiles, '06.1 · each City DNA on its best-scoring test terrain (highest rankScore of 12)', path.join(shots, '06-1-six-cities-suitable-terrain.png'));

    const strip = run => { const { ranking, ...rest } = run; return rest; };
    await mkdir(evidence, { recursive: true });
    await writeFile(record, `${JSON.stringify({
      task: '06.1 City DNA 3 → 6',
      experiment: '/experiments/seed-terrain/',
      testedAt: new Date().toISOString(),
      parameters: { landforms, seeds, variation: 'default', transitionWidth: 'default (128 m)', shared, chunk: '1024 m, 257² samples' },
      configs: cfg.dna, configChecks,
      successRate: { runs: runs.length, ok: runs.filter(r => r.ok).length, nonEmpty: runs.filter(r => !r.empty).length, byDNA: Object.fromEntries(ids.map(id => [id, { ok: runs.filter(r => r.dna === id && r.ok).length, nonEmpty: runs.filter(r => r.dna === id && !r.empty).length, of: runs.filter(r => r.dna === id).length }])) },
      timingMs: { mean: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length), max: Math.max(...timings) },
      reproducibility, switchBackStable, regression: { identical: regression.filter(r => r.identical).length, of: regression.length }, autoChanges,
      autoRanking: landforms.flatMap(landform => seeds.map(seed => ({ landform, seed, ranking: runs.find(r => r.landform === landform && r.seed === seed).ranking }))),
      suitable, similarity, runs: runs.map(strip),
      screenshots: ['docs/assets/screenshots/procedural-mini-world/06-1-six-cities-shared-terrain.png', 'docs/assets/screenshots/procedural-mini-world/06-1-six-cities-suitable-terrain.png'],
      browserErrors,
    }, null, 2)}\n`);
    console.log(`regression ${regression.filter(r => r.identical).length}/${regression.length} identical · auto changes ${autoChanges.filter(c => c.changed).length} · low-difference pairs ${similarity.filter(s => s.lowDifference).length}/${similarity.length}`);
  }
  assert(!browserErrors.length, `browser errors: ${browserErrors.join(' | ')}`);
  console.log('city DNA verification passed');
} finally {
  await browser?.close();
  server.kill();
}
