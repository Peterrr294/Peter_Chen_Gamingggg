// M01 release check against a deployed (or `vite preview`) site: HTML entries, JS assets,
// hub → Mini World iframe, 3 × 3 World Grid ready, City ID switch, world seed, single chunk.
// Usage: node scripts/verify-live-release.mjs [baseUrl] [outDir]
// Default base: the public Firebase site. Output (JSON + 2 screenshots) goes to outDir,
// default <os tmp>/verify-live-release, so a run never overwrites logged evidence.
import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? 'https://gameeeee-zc626.web.app').replace(/\/$/, '');
const outDir = process.argv[3] ?? path.join(os.tmpdir(), 'verify-live-release');
const exists = async file => { try { await access(file); return true; } catch { return false; } };

async function browserPath() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found.');
}

const report = { base, at: new Date().toISOString(), checks: {}, errors: [], requests: { total: 0, byStatus: {} } };
const check = (name, pass, detail) => { report.checks[name] = { pass: !!pass, detail }; };
const watch = (page, label) => {
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', e => report.errors.push(`${label} page: ${e.message}`));
  page.on('response', r => {
    report.requests.total += 1;
    report.requests.byStatus[r.status()] = (report.requests.byStatus[r.status()] ?? 0) + 1;
    if (r.status() >= 400) report.errors.push(`${label} http ${r.status()}: ${r.url()}`);
  });
};
await mkdir(outDir, { recursive: true });

// 1. Raw HTTP: each HTML entry has its own entry script, served as JavaScript.
for (const route of ['/', '/experiments/world-grid/', '/experiments/seed-terrain/']) {
  const res = await fetch(base + route, { cache: 'no-store' });
  const html = await res.text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  const assets = [];
  for (const s of scripts) { const r = await fetch(base + s); assets.push({ s, status: r.status, type: r.headers.get('content-type') }); }
  check(`http ${route}`, res.status === 200 && scripts.length > 0 && assets.every(a => a.status === 200 && /javascript/.test(a.type ?? '')),
    { status: res.status, title: html.match(/<title>([^<]*)/)?.[1], assets, hasMiniWorldNav: html.includes('#miniWorld') });
}

const browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
try {
  // 2. Hub → Mini World iframe → 3 × 3 World Grid ready.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(page, 'hub');
  const started = Date.now();
  await page.goto(`${base}/#miniWorld`, { waitUntil: 'load' });
  const hub = await page.evaluate(() => ({ navCurrent: document.querySelector('nav a[aria-current]')?.textContent, frameSrc: document.querySelector('iframe.project-frame')?.getAttribute('src') }));
  check('hub routes #miniWorld to the world-grid iframe', hub.frameSrc === './experiments/world-grid/index.html' && hub.navCurrent === 'Mini World', hub);
  const frame = await (await page.waitForSelector('iframe.project-frame')).contentFrame();
  await frame.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 300000, polling: 1000 });
  const loadMs = Date.now() - started;
  const sums = await frame.evaluate(() => window.__worldGridLab.summaries());
  const world = await frame.evaluate(() => window.__worldGridLab.serialise());
  const panel = await frame.evaluate(() => ({ status: document.querySelector('#statusText').textContent, worldInfo: document.querySelector('#worldInfo').textContent }));
  const dnas = [...new Set(sums.map(s => s.resolvedDNA).filter(Boolean))];
  check('world grid 3 × 3 ready', sums.length === 9 && sums.every(s => s.status.startsWith('ready')) && panel.status === 'READY' && /\d+ \/ 12 edges joined/.test(panel.worldInfo),
    { loadMs, worldSeed: world.worldSeed, panel, chunks: sums.map(s => ({ id: s.chunkId, landform: s.landform, seed: s.terrainSeed, dna: s.resolvedDNA, buildings: s.counts?.buildings ?? 0 })) });
  check('cities generated', dnas.length >= 4 && sums.filter(s => (s.counts?.buildings ?? 0) > 0).length >= 6, { dnas });
  await page.screenshot({ path: path.join(outDir, 'live-world-grid.png') });

  // 3. City ID switch on one slot: only its city layer changes.
  const target = 'chunk_1_0';
  const before = sums.find(s => s.chunkId === target);
  const next = before.resolvedDNA === 'amsterdamCanalRing' ? 'chicagoGrid' : 'amsterdamCanalRing';
  await frame.evaluate(id => window.__worldGridLab.select(id), target);
  const after = await frame.evaluate(([id, city]) => window.__worldGridLab.setCity(id, city), [target, next]);
  const cityPanel = await frame.evaluate(() => document.querySelector('#cityInfo').textContent);
  check('city switch rebuilds one chunk', after.resolvedDNA === next && after.signatures.height === before.signatures.height && after.signatures.buildings !== before.signatures.buildings && cityPanel.includes(next),
    { from: before.resolvedDNA, to: after.resolvedDNA, cityPanel, buildings: after.counts?.buildings });
  await page.screenshot({ path: path.join(outDir, 'live-city-switch.png') });
  await page.close();

  // 4. World seed: another seed gives different terrain seeds.
  const seedPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  watch(seedPage, 'seed');
  await seedPage.goto(`${base}/experiments/world-grid/?worldSeed=6202`, { waitUntil: 'load' });
  await seedPage.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 300000, polling: 1000 });
  const world2 = await seedPage.evaluate(() => window.__worldGridLab.serialise());
  check('world seed changes terrain seeds', world2.worldSeed === 6202 && world2.slots.some((s, i) => s.terrainSeed !== world.slots[i].terrainSeed),
    { seeds6201: world.slots.map(s => s.terrainSeed), seeds6202: world2.slots.map(s => s.terrainSeed) });
  await seedPage.close();

  // 5. Single chunk with a manual City DNA.
  const chunkPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  watch(chunkPage, 'chunk');
  await chunkPage.goto(`${base}/experiments/seed-terrain/?landform=plain&seed=2085&dna=manhattanGrid`, { waitUntil: 'load' });
  await chunkPage.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 120000, polling: 500 });
  const single = await chunkPage.evaluate(() => ({ dna: window.__seedTerrainLab.cityMatch().selectedDNA?.id, buildings: window.__seedTerrainLab.buildings().stats.buildings }));
  check('single chunk generates', single.dna === 'manhattanGrid' && single.buildings > 0, single);
  await chunkPage.close();
} finally {
  await browser.close();
}

check('no browser errors or 4xx / 5xx responses', report.errors.length === 0, report.errors);
report.failed = Object.entries(report.checks).filter(([, c]) => !c.pass).map(([name]) => name);
await writeFile(path.join(outDir, 'live-release.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ base, outDir, failed: report.failed, requests: report.requests, checks: Object.fromEntries(Object.entries(report.checks).map(([k, c]) => [k, c.pass])) }, null, 2));
process.exit(report.failed.length ? 1 : 0);
