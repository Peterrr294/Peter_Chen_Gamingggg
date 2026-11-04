// A City of Cities — P00a causal visualization of one real growth event (seed 6202, step 2, Manhattan c_-4_0 → c_-3_0;
// road mode, grade baseline, ramps through one junction). Real runtime captures only; no generator change.
//   A. VIS-01a replay page of the event: stages before / site / front / roads / commit (recorded or labelled).
//   B. Free growth of the same seed to step 2 (no replay forcing, so the frontier statuses are the real ones): candidate
//      cells with status, and the resulting road network by component.
// Usage: node scripts/capture-growth-causality.mjs   (do not edit source files while it runs: Vite reloads the page)
import { access, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const host = '127.0.0.1'; const port = 4229; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const ready = async u => { try { return (await fetch(u, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const out = { task: 'P00a causal visualization', testedAt: new Date().toISOString(), event: 'seed 6202, step 2, manhattanGrid c_-4_0 -> c_-3_0', screenshots: {}, captions: {}, data: {} };
let browser;
try {
  for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) await new Promise(r => setTimeout(r, 250));
  let exe = process.env.PLAYWRIGHT_CHROME_PATH; for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (!exe && await exists(c)) exe = c;
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(e.message));
  const lab = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name, caption, withPanel = true) => { await page.waitForTimeout(900); await page.evaluate(() => scrollTo(0, 0)); const v = await page.locator('#worldCanvas').boundingBox(); const sy = await lab(() => scrollY); const c = { ...v, y: v.y + sy }; const extra = withPanel ? await page.locator('.replay-panel').evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom + scrollY)) : []; const bottom = Math.max(c.y + c.height, ...extra); const f = path.join(shots, name); await page.screenshot({ path: f, fullPage: true, clip: { x: c.x, y: c.y, width: c.width, height: bottom - c.y } }); out.screenshots[name] = path.relative(root, f).replaceAll('\\', '/'); out.captions[name] = caption; console.log(`shot ${name}`); };

  // A. Replay of the event.
  await page.goto(`${base}${entry}?worldSeed=6202&growthMode=road&grade=baseline&junctions=1&replay=2`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window.__originLab?.ready === true && window.__originLab.replayState?.()) || window.__originLab?.error?.(), null, { timeout: 900000 });
  const ev = await lab(() => { const e = window.__originLab.replayEvent(); return { id: e.growthEventId, parent: e.parentChunkId, child: e.newChunkId, cityId: e.cityId, step: e.step }; });
  if (ev.child !== 'c_-3_0') throw new Error(`unexpected event ${JSON.stringify(ev)}`);
  out.data.event = ev;
  const label = `seed 6202, step 2, manhattanGrid c_-4_0 -> c_-3_0`;
  for (const [t, name, text] of [[0.999, 'p00a-2-existing-network-before.png', 'stage 1 before growth (recorded): the committed roads that exist before the step'], [1.999, 'p00a-1-environment-site.png', 'stage 2 terrain / site evaluation (recorded): the target cell terrain and the evaluation terms'], [2.999, 'p00a-3-growth-front.png', 'stage 3 growth front (recorded): parent road ends toward the cell, usable (orange) / refused (red)'], [3.999, 'p00a-4-generated-roads.png', 'stage 4 roads (recorded network; reveal order is presentation): the one network the generator built for the whole cell'], [8, 'p00a-7-committed-geometry.png', 'stage 8 commit (recorded): blocks, parcels and buildings generated from that network']]) {
    await lab(x => window.__originLab.replaySeek(x), t);
    await shot(name, `${label}; ${text}`);
    out.data[name] = await lab(() => window.__originLab.replayState());
  }
  // B. Free growth to step 2 (real frontier).
  await page.goto(`${base}${entry}?start=0&growthMode=road&grade=baseline&junctions=1`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__originLab?.ready === true);
  await lab(() => window.__originLab.setAutoFit(false));
  await lab(() => window.__originLab.generate(6202)); await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 900000 });
  await lab(() => window.__originLab.growSteps(2)); await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 900000 });
  const hist = await lab(() => window.__originLab.history().map(e => `${e.step} ${e.cityId} ${e.parentChunkId} -> ${e.newChunkId}`));
  if (hist[1] !== '2 manhattanGrid c_-4_0 -> c_-3_0') throw new Error(`free growth differs from the replay: ${hist.join(' | ')}`);
  out.data.freeHistory = hist;
  out.data.frontierStep2 = await lab(() => Object.fromEntries(Object.entries(window.__originLab.frontier()).map(([k, l]) => [k, l.map(c => ({ cell: `${c.gx},${c.gy}`, status: c.status, score: c.score ?? null, reason: c.rejectionReason ?? null, parent: c.parentChunkId ?? null }))])));
  const core = await lab(() => window.__originLab.chunks().find(c => c.chunkId === 'c_-4_0').worldOrigin);
  await lab(p => window.__originLab.focusPoint(p.x + 512, p.z, 3200), core);
  await lab(() => window.__originLab.setLayers({ growthFrontier: true, history: true }));
  await shot('p00a-5-6-candidates-decision.png', `${label}; free growth (no replay forcing); candidate cells of step 2 with status (accepted / rejected / selected) and the parent-child link; candidates are whole 1024 m cells`, false);
  await lab(() => window.__originLab.setLayers({ growthFrontier: false, history: false }));
  for (const label2 of ['Network integrity layer (debug)']) { const ctl = page.locator('#gui .lil-controller').filter({ hasText: label2 }).first(); await ctl.scrollIntoViewIfNeeded(); await ctl.locator('input[type=checkbox]').click(); }
  { const ctl = page.locator('#gui .lil-controller').filter({ hasText: 'Integrity colours' }).first(); await ctl.scrollIntoViewIfNeeded(); await ctl.locator('select').selectOption({ label: 'By component' }); }
  await page.waitForFunction(() => window.__originLab.ready === true && window.__originLab.integrityState?.(), null, { timeout: 300000 });
  await shot('p00a-8-resulting-network.png', `${label}; free growth after step 2; road network by city-level component (G02c-R1 debug layer); green = reached from the city root`, false);
  out.data.integrity = await lab(() => { const r = window.__originLab.integrityReport(); return Object.fromEntries(Object.entries(r).filter(([, x]) => x.chunks > 1).map(([k, { pieces, ...x }]) => [k, x])); });
  out.errors = errors;
} finally { await browser?.close(); server.kill(); }
await writeFile(path.join(root, 'experiments/city-of-cities/evidence/growth-causality-capture.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`captures ${Object.keys(out.screenshots).length}; browser errors ${out.errors?.length ?? 'n/a'}`);
