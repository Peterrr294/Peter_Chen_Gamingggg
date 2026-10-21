// M06 World State checkpoint check against a deployed (or `vite preview`) site:
//   1. ?checkpoint=default loads the bundled checkpoint and reproduces every signature and seam class;
//   2. the GUI "Load world checkpoint" file entry loads the same JSON; "Export world checkpoint" downloads an equal one;
//   3. a tampered checkpoint (one City ID changed) is reported as mismatching, not silently accepted;
//   4. the existing localStorage Save / Restore survives a page reload;
//   5. the default page (no checkpoint) still builds the same world; 3 × 3 terrain, roads and buildings present.
// Usage: node scripts/verify-world-checkpoint.mjs [baseUrl] [outDir]
// Default base: the public Firebase site. Output (JSON + screenshots) goes to outDir, default <os tmp>/verify-world-checkpoint.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] ?? 'https://gameeeee-zc626.web.app').replace(/\/$/, '');
const outDir = process.argv[3] ?? path.join(os.tmpdir(), 'verify-world-checkpoint');
const checkpointFile = path.join(root, 'experiments/world-grid/checkpoints/world-6201-checkpoint-v1.json');
const entry = `${base}/experiments/world-grid/`;
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
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

await mkdir(outDir, { recursive: true });
const saved = JSON.parse(await readFile(checkpointFile, 'utf8'));
const report = { base, at: new Date().toISOString(), checkpoint: path.relative(root, checkpointFile).replaceAll('\\', '/'), checks: {}, errors: [] };
const browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => report.errors.push(`page: ${e.message}`));
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`http ${r.status()}: ${r.url()}`); });
  const lab = (fn, arg) => page.evaluate(fn, arg);
  const ready = () => page.waitForFunction(() => window.__worldGridLab?.ready === true, null, { timeout: 600000 });
  const waitResult = () => page.waitForFunction(() => window.__worldGridLab?.checkpointResult() !== null && window.__worldGridLab?.ready === true, null, { timeout: 600000 });
  const clickGui = name => page.locator('#gui .lil-gui button', { hasText: name }).click();
  const world = () => lab(() => ({ summaries: window.__worldGridLab.summaries(), classes: window.__worldGridLab.seamClasses().map(c => [c.id, c.overall]), road: window.__worldGridLab.roadSeam().stats.connections, panel: document.querySelector('#saveState').textContent }));

  // 1. Bundled checkpoint via URL.
  let started = Date.now();
  await page.goto(`${entry}?checkpoint=default`, { waitUntil: 'networkidle' });
  await waitResult();
  const viaUrl = await lab(() => window.__worldGridLab.checkpointResult());
  const w1 = await world();
  report.checks.urlCheckpoint = { pass: viaUrl.reproduced, mismatches: viaUrl.mismatches, loadMs: Date.now() - started, panel: w1.panel };
  report.checks.content = {
    pass: w1.summaries.length === 9 && w1.summaries.every(s => s.status.startsWith('ready')) && w1.summaries.filter(s => s.counts).every(s => s.counts.buildings > 0 || s.counts.roadKm === 0) && w1.road > 0,
    chunks: w1.summaries.map(s => ({ chunkId: s.chunkId, landform: s.landform, cityId: s.cityId, resolvedDNA: s.resolvedDNA, counts: s.counts })), roadJoins: w1.road, seamClasses: w1.classes,
  };
  await page.waitForTimeout(400);
  await page.locator('#worldCanvas').screenshot({ path: path.join(outDir, 'world-checkpoint-overall.png') });

  // 2. Export (download) equals the saved checkpoint in world + expected; GUI file load reproduces it.
  const [download] = await Promise.all([page.waitForEvent('download'), clickGui('Export world checkpoint')]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  report.checks.export = { pass: same(exported.world, saved.world) && same(exported.expected, saved.expected) && same(exported.layout, saved.layout), file: download.suggestedFilename() };
  await page.goto(entry, { waitUntil: 'networkidle' });
  await ready();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickGui('Load world checkpoint')]);
  await chooser.setFiles(checkpointFile);
  await waitResult();
  const viaFile = await lab(() => window.__worldGridLab.checkpointResult());
  report.checks.fileCheckpoint = { pass: viaFile.reproduced, mismatches: viaFile.mismatches };

  // 3. Tampered checkpoint: one City ID changed → reported mismatch (the world is rebuilt from the tampered config).
  const tampered = JSON.parse(JSON.stringify(saved));
  tampered.world.slots.find(s => s.gridX === 1 && s.gridY === 0).cityId = 'amsterdamCanalRing';
  const tamperResult = await lab(data => window.__worldGridLab.loadCheckpoint(data), tampered);
  report.checks.tampered = { pass: !tamperResult.reproduced && tamperResult.mismatches.some(m => m.chunkId === 'chunk_1_0'), mismatches: tamperResult.mismatches.length };

  // 4. localStorage Save → reload → Restore (existing mechanism).
  await page.goto(entry, { waitUntil: 'networkidle' });
  await ready();
  await lab(() => window.__worldGridLab.setCity('chunk_1_0', 'amsterdamCanalRing'));
  const before = await lab(() => window.__worldGridLab.summaries().find(s => s.chunkId === 'chunk_1_0').signatures);
  await clickGui('Save city config');
  await page.reload({ waitUntil: 'networkidle' });
  await ready();
  await clickGui('Restore city config');
  await page.waitForFunction(() => window.__worldGridLab.ready === true && window.__worldGridLab.summaries().find(s => s.chunkId === 'chunk_1_0').cityId === 'amsterdamCanalRing', null, { timeout: 600000 });
  const after = await lab(() => window.__worldGridLab.summaries().find(s => s.chunkId === 'chunk_1_0').signatures);
  report.checks.localStorage = { pass: same(before, after) };

  // 5. Default page (no checkpoint) builds the same world as the checkpoint (it is the default configuration).
  await lab(() => localStorage.clear());
  started = Date.now();
  await page.goto(entry, { waitUntil: 'networkidle' });
  await ready();
  const w5 = await world();
  report.checks.defaultWorld = { pass: w5.summaries.every(s => same(s.signatures, saved.expected.signatures[s.chunkId])), loadMs: Date.now() - started };
  await page.goto(`${entry}?seams=1&focus=0,-512,900`, { waitUntil: 'networkidle' });
  await ready();
  await page.waitForTimeout(400);
  await page.locator('.workspace').screenshot({ path: path.join(outDir, 'world-checkpoint-seam-debug.png') });
} finally {
  await browser.close();
}
report.pass = Object.values(report.checks).every(c => c.pass) && !report.errors.length;
await writeFile(path.join(outDir, 'verify-world-checkpoint.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const [name, c] of Object.entries(report.checks)) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${name}${c.mismatches?.length ? ` (${c.mismatches.length} mismatches)` : ''}${c.loadMs ? ` ${c.loadMs} ms` : ''}`);
if (report.errors.length) console.log(`errors: ${report.errors.join(' | ')}`);
console.log(report.pass ? `world checkpoint verification passed (${base})` : `world checkpoint verification FAILED (${base})`);
process.exitCode = report.pass ? 0 : 1;
