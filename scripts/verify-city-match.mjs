import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4187;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const screenshot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/02-6-city-match-auto-vs-manual.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/city-match.json');
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

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  const open = async query => {
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true);
  };
  const snapshot = () => page.evaluate(() => {
    const lab = window.__seedTerrainLab;
    const stats = lab.stats();
    return { cityMatch: lab.cityMatch(), terrain: `${stats.heightSignature}/${stats.waterSignature}`, analysis: lab.analysis().signature };
  });
  const requiredKeys = ['rankedCandidates', 'selectedDNA', 'terrainConstraints', 'networkHints', 'parcelHints', 'buildingHints', 'unresolvedEvidence'];
  const dnaIds = ['manhattanGrid', 'veniceWaterNetwork', 'fezOrganicCore', 'chicagoGrid', 'amsterdamCanalRing', 'lisbonHillCore']; // 06.1: six DNAs

  const runs = [];
  for (const landform of landforms) {
    for (const seed of seeds) {
      const id = `${landform} ${seed}`;
      await open(`landform=${landform}&seed=${seed}`);
      const first = await snapshot();
      await open(`landform=${landform}&seed=${seed}`);
      const repeat = await snapshot();
      const match = first.cityMatch;
      assert(JSON.stringify(match) === JSON.stringify(repeat.cityMatch), `${id}: cityMatch not deterministic.`);
      assert(requiredKeys.every(key => key in match), `${id}: cityMatch is missing a required key.`);
      assert(!/"(vertices|positions|polyline|polygon|geometry)"/.test(JSON.stringify(match)), `${id}: hints contain geometry.`);

      // Ranking and score arithmetic.
      const ranked = match.rankedCandidates;
      assert(ranked.length === dnaIds.length && ranked.every((candidate, index) => candidate.rank === index + 1), `${id}: ranks malformed.`);
      assert(ranked.every((candidate, index) => index === 0 || ranked[index - 1].score >= candidate.score), `${id}: not sorted by score.`);
      assert(ranked.every(candidate => Math.abs(candidate.score - candidate.fitScore * candidate.evidenceCoverage) < 1e-3), `${id}: score ≠ fit × coverage.`);
      assert(ranked.every(candidate => candidate.weakFit === candidate.score < 0.4), `${id}: weakFit flag inconsistent.`);
      assert(ranked.every(candidate => candidate.conditions.filter(condition => condition.status === 'tbd').every(condition => condition.score === undefined)), `${id}: a TBD condition was scored.`);
      assert(match.selectedDNA.mode === 'auto' && match.selectedDNA.id === ranked[0].id, `${id}: auto selection is not the top candidate.`);
      assert(match.unresolvedEvidence.some(item => item.condition === 'researchRows'), `${id}: research gap not reported.`);

      // Plausibility rules (terrain logic, not visual impression).
      const venice = ranked.find(candidate => candidate.id === 'veniceWaterNetwork');
      if (match.metrics.waterFraction === 0) assert(venice.score === 0 && venice.conflicts.find(conflict => conflict.id === 'noWater').triggered, `${id}: Venice scored without water.`);
      const amsterdam = ranked.find(candidate => candidate.id === 'amsterdamCanalRing');
      if (match.metrics.waterFraction === 0) assert(amsterdam.score === 0, `${id}: Amsterdam scored without water.`);
      if (landform === 'plain') assert(ranked[0].id === 'manhattanGrid' && !ranked[0].weakFit, `${id}: plain should favour the grid DNA.`);
      if (landform === 'mountain') assert(ranked.every(candidate => candidate.weakFit), `${id}: mountain should be a weak fit for all prototypes.`);
      const direction = match.terrainConstraints.dominantDirection;
      assert((match.networkHints.orientation.axisDeg === null) === (direction === 'unknown' || direction === 'regionalSlope'), `${id}: orientation hint invented or dropped.`);

      // Manual override: changes only the selection.
      for (const dna of dnaIds) {
        const selected = await page.evaluate(choice => window.__seedTerrainLab.selectDNA(choice), dna);
        const after = await snapshot();
        assert(selected.id === dna && selected.mode === 'manual' && selected.autoTopId === ranked[0].id, `${id}: override to ${dna} failed.`);
        assert(after.terrain === first.terrain && after.analysis === first.analysis, `${id}: override changed terrain or analysis.`);
        assert(JSON.stringify(after.cityMatch.rankedCandidates) === JSON.stringify(ranked), `${id}: override changed the ranking.`);
      }
      runs.push({
        landform, seed,
        ranking: ranked.map(candidate => ({ id: candidate.id, score: candidate.score, fit: candidate.fitScore, coverage: candidate.evidenceCoverage, weak: candidate.weakFit })),
        selected: match.selectedDNA.id,
        topReasons: ranked[0].topReasons,
        metrics: { ...match.metrics },
        orientation: match.networkHints.orientation,
      });
    }
  }

  // Missing-data safety: call the matcher directly with empty and partial analysis.
  const missing = await page.evaluate(async () => {
    const { matchCity } = await import('/experiments/seed-terrain/CityMatcher.js');
    const empty = matchCity({});
    const partial = matchCity({ waterCoverage: { fraction: 0.2, landArea: 800000, buildableFraction: 0.5 } });
    const pick = result => result.rankedCandidates.map(candidate => ({ id: candidate.id, score: candidate.score, statuses: candidate.conditions.map(condition => condition.status) }));
    return { empty: pick(empty), partial: pick(partial), emptySelected: empty.selectedDNA.id };
  });
  assert(missing.empty.every(candidate => candidate.score === 0 && !candidate.statuses.includes('scored')), 'Empty analysis produced scores.');
  assert(missing.partial.every(candidate => Number.isFinite(candidate.score)) && missing.partial.some(candidate => candidate.statuses.includes('missing')), 'Partial analysis not handled safely.');
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: same coast terrain, auto selection vs manual Venice override.
  const shots = [];
  for (const dna of ['auto', 'veniceWaterNetwork']) {
    await open(`landform=coast&seed=${seeds[0]}&view=suitability${dna === 'auto' ? '' : `&dna=${dna}`}`);
    await page.waitForTimeout(250);
    shots.push((await page.locator('.workspace').screenshot({ animations: 'disabled' })).toString('base64'));
  }
  const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
  await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;gap:6px}img{width:100%;display:block}</style>${shots.map(image => `<img src="data:image/png;base64,${image}">`).join('')}`);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await compositePage.screenshot({ path: screenshot, fullPage: true });
  await compositePage.close();

  const evidence = { task: '02.6', experiment: entry, testedAt: new Date().toISOString(), runs, missing, browserErrors, screenshot: path.relative(root, screenshot).replaceAll('\\', '/') };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} → ${run.ranking.map(item => `${item.id.replace(/[A-Z].*/, '')} ${item.score.toFixed(2)}${item.weak ? 'w' : ''}`).join(' > ')}`),
    missing: { empty: missing.empty.map(item => item.score), emptySelected: missing.emptySelected },
    screenshot: evidence.screenshot,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
