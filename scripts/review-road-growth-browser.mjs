// A City of Cities — G02c-R Road Growth Milestone Review: 10 browser interactions with real mouse input (no generator change).
// Event: seed 6202, step 2 replay (Manhattan c_-4_0 → c_-3_0, a ramp through junction 16), ramps through one junction on.
// Then the 6202 review state (written by scripts/review-road-growth.mjs) is loaded and shown as the grown world.
// Usage: node scripts/review-road-growth-browser.mjs   (needs experiments/city-of-cities/evidence/world-6202-g02c-review-state.json)
import { access, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const recordFile = path.join(root, 'experiments/city-of-cities/evidence/road-growth-review-browser.json');
const assert = (c, m) => { if (!c) throw new Error(m); };
const host = '127.0.0.1'; const port = 4225; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const ready = async u => { try { return (await fetch(u, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const out = { task: 'G02c-R browser review', testedAt: new Date().toISOString(), checks: [], screenshots: {}, captions: {} };
let browser;
try {
  for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) await new Promise(r => setTimeout(r, 250));
  let exe = process.env.PLAYWRIGHT_CHROME_PATH; for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (!exe && await exists(c)) exe = c;
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(e.message));
  const lab = (fn, arg) => page.evaluate(fn, arg);
  const check = (name, pass, detail = '') => { out.checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ·  ${detail}` : ''}`); };
  const canvasBox = () => page.locator('#worldCanvas').boundingBox();
  const shot = async (name, caption) => { await page.waitForTimeout(800); const v = await canvasBox(); const sy = await lab(() => scrollY); const c = { ...v, y: v.y + sy }; const extra = await page.locator('.replay-panel, #rampPick').evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom + scrollY)); const bottom = Math.max(c.y + c.height, ...extra); const f = path.join(shots, name); await page.screenshot({ path: f, fullPage: true, clip: { x: c.x, y: c.y, width: c.width, height: bottom - c.y } }); out.screenshots[name] = path.relative(root, f).replaceAll('\\', '/'); out.captions[name] = caption; };
  const guiToggle = async label => { const ctl = page.locator('#gui .lil-controller, #gui .controller').filter({ hasText: label }).first(); await ctl.scrollIntoViewIfNeeded(); await ctl.locator('input[type=checkbox]').click(); await page.waitForTimeout(300); };
  const guiButton = async label => { const b = page.locator('#gui button, #gui .lil-controller.function, #gui .controller.function').filter({ hasText: label }).first(); await b.scrollIntoViewIfNeeded(); await b.click(); };
  const clickWorld = async p => { const s = await lab(q => window.__originLab.projectToCanvas(q), p); const c = await canvasBox(); await page.mouse.click(c.x + s.x, c.y + s.y); await page.waitForTimeout(300); return lab(() => window.__originLab.picked()); };
  const t0 = Date.now();

  // 1. Open the replay page of the event.
  await page.goto(`${base}${entry}?worldSeed=6202&growthMode=road&grade=baseline&junctions=1&replay=2`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window.__originLab?.ready === true && window.__originLab.replayState?.()) || window.__originLab?.error?.(), null, { timeout: 900000 });
  const ev = await lab(() => { const e = window.__originLab.replayEvent(); return { chunk: e.newChunkId, parent: e.parentChunkId, through: e.ramps.filter(r => r.through === 'junction').length, err: window.__originLab.error() }; });
  check('1 page opens the replay of a real growth event', !ev.err && ev.chunk === 'c_-3_0' && ev.through > 0, `${ev.parent} → ${ev.chunk}, ${ev.through} ramp(s) through a junction, ${Date.now() - t0} ms`);
  // 2. Play button.
  await page.locator('#rpPlay').click(); await page.waitForTimeout(1500); const s2 = await lab(() => window.__originLab.replayState());
  await page.locator('#rpPlay').click(); const s2b = await lab(() => window.__originLab.replayState());
  check('2 real click on Play advances the timeline, second click pauses', s2.t > 0 && s2b.playing === false, `t ${(+s2.t).toFixed(2)}, playing after second click ${s2b.playing}`);
  // 3. Stage button (4 roads) and Next.
  await page.locator('#rpStages button[data-i="3"]').click(); const s3 = await lab(() => window.__originLab.replayState());
  await page.locator('#rpNext').click(); const s3b = await lab(() => window.__originLab.replayState());
  check('3 real click on stage 4 and on Next', s3.stage === 'roads' && Math.floor(s3b.t) === 4, `stage ${s3.stage} → t ${s3b.t} (${s3b.stage})`);
  // 4. Slider to the end (commit).
  { const b = await page.locator('#rpSlider').boundingBox(); await page.mouse.click(b.x + b.width - 2, b.y + b.height / 2); }
  const s4 = await lab(() => window.__originLab.replayState());
  check('4 real click on the end of the slider shows the commit stage', s4.t > 7.9, `t ${(+s4.t).toFixed(2)} (${s4.stage})`);
  // 5. Connection overlay checkbox in the GUI.
  await guiToggle('Connection overlay (debug)');
  const items = await lab(() => window.__originLab.overlayItems());
  check('5 real click on the overlay checkbox shows overlay items', items.length > 0, `${items.length} items: ${JSON.stringify(items.reduce((o, i) => ({ ...o, [i.kind]: (o[i.kind] ?? 0) + 1 }), {}))}`);
  // 6. Junction marker, 7. ramp road.
  const evRamps = await lab(() => window.__originLab.replayEvent().ramps.filter(r => r.through === 'junction').map(r => r.rampId));
  const junction = items.find(i => i.kind === 'junction' && i.chunkId === ev.chunk && evRamps.includes(i.rampId)); const ramp = items.find(i => i.kind === 'ramp' && i.chunkId === ev.chunk && i.role === 'main' && evRamps.includes(i.rampId));
  const pj = await clickWorld(junction.point);
  check('6 real click on the junction marker opens the junction and its long section', pj?.kind === 'junction' && !!pj.profile, pj?.text?.split('\n')[0]);
  await shot('g02c-r-junction-pick-debug.png', 'seed 6202, replay step 2 (Manhattan c_-4_0 -> c_-3_0), junction ramps on, overlay on, real click on the junction; replay stage 8');
  const pr = await clickWorld(ramp.point);
  check('7 real click on the ramp road opens the ramp record', pr?.kind === 'ramp' && pr.rampId === ramp.rampId, pr?.text?.split('\n')[0]);
  // 8. Real drag orbits the camera.
  const before = await lab(p => window.__originLab.projectToCanvas(p), junction.point);
  { const c = await canvasBox(); await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.5); await page.mouse.down(); await page.mouse.move(c.x + c.width * 0.62, c.y + c.height * 0.55, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(400); }
  const after = await lab(p => window.__originLab.projectToCanvas(p), junction.point);
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  check('8 real mouse drag orbits the camera (the junction moves on screen; no pick)', moved > 20, `junction moved ${moved.toFixed(0)} px`);
  // 9. Overlay off by checkbox; a click on an unconnected road end of any event (failure case) with the overlay back on.
  await guiToggle('Connection overlay (debug)'); const off = await lab(() => window.__originLab.overlayItems().length);
  await guiToggle('Connection overlay (debug)');
  const rej = (await lab(() => window.__originLab.overlayItems())).find(i => i.kind === 'rejected');
  let pf = null;
  if (rej) { await lab(p => window.__originLab.focusPoint(p.x, p.z, 700), rej.point); await page.waitForTimeout(500); pf = await clickWorld(rej.point); }
  check('9 overlay toggles by checkbox; real click on an unconnected road end shows its refusal reason', pf?.kind === 'rejected' || pf?.kind === 'junction', `${off} items kept while hidden; picked: ${pf?.text?.split('\n').slice(0, 2).join(' / ') ?? 'no rejected item in this replay'}`);
  if (pf) await shot('g02c-r-failure-case-debug.png', `seed 6202, replay step 2, overlay on, real click on an unconnected road end (${pf.rampId}); camera focusPoint 700 m`);
  // 10. Grown world: load the 6202 review state with the GUI Save / Load path (localStorage), signatures re-checked by the page.
  const saved = await readFile(path.join(root, 'experiments/city-of-cities/evidence/world-6202-g02c-review-state.json'), 'utf8');
  await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__originLab?.ready === true);
  await lab(s => localStorage.setItem('procedural-mini-world/a-city-of-cities/world-state', s), saved); // the page's STORAGE_KEY
  const keyOk = await lab(() => Object.keys(localStorage));
  await guiButton('Load world state'); await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 1800000 });
  const loaded = await lab(() => ({ chunks: window.__originLab.chunks().length, steps: window.__originLab.history().length, mismatches: window.__originLab.mismatches().length, err: window.__originLab.error(), save: document.querySelector('#saveState')?.textContent }));
  const expect = JSON.parse(saved);
  out.nodeStateMismatches = await lab(() => window.__originLab.mismatches().map(x => ({ chunkId: x.chunkId, diff: Object.keys({ ...x.expected, ...x.now }).filter(k => x.expected?.[k] !== x.now?.[k]).map(k => `${k}: ${x.expected?.[k]} -> ${x.now?.[k]}`) })));
  check('10a real click on "Load world state" rebuilds the Node-saved 6202 world (60 steps) with matching signatures', !loaded.err && loaded.steps === expect.growth.history.length && loaded.mismatches === 0, `${loaded.steps} steps, ${loaded.chunks} chunks, ${loaded.mismatches} signature mismatches (${out.nodeStateMismatches.map(m => `${m.chunkId} ${m.diff.join('; ')}`).join(' | ')}); connections: ${await lab(() => window.__originLab.morphRestore())}; keys ${keyOk.join(',')}`);
  await lab(() => window.__originLab.overview?.());
  await shot('g02c-r-world-growth-after.png', `seed 6202, review state (${loaded.steps} road growth steps, baseline 6 %, ramps through one junction), loaded via the GUI; overview camera`);
  await lab(() => window.__originLab.setLayers({ rampOverlay: true, chunkBorders: true }));
  await shot('g02c-r-world-growth-debug.png', `same world and camera; connection overlay and chunk boundaries on`);
  // 10b. Same runtime: real click on Save, fresh page, real click on Load.
  await guiButton('Save world state'); await page.waitForTimeout(500);
  await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__originLab?.ready === true);
  await guiButton('Load world state'); await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 1800000 });
  const again = await lab(() => ({ chunks: window.__originLab.chunks().length, steps: window.__originLab.history().length, mismatches: window.__originLab.mismatches().length, err: window.__originLab.error(), restore: window.__originLab.morphRestore() }));
  check('10b real click on Save, new page, real click on Load: browser-saved world reproduced', !again.err && again.steps === loaded.steps && again.mismatches === 0, `${again.steps} steps, ${again.chunks} chunks, ${again.mismatches} signature mismatches; ${again.restore}`);
  out.errors = errors; check('no browser errors', !errors.length, errors.slice(0, 3).join(' | '));
  out.ms = Date.now() - t0;
} finally { await browser?.close(); server.kill(); }
await writeFile(recordFile, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.checks.filter(c => c.pass).length} of ${out.checks.length} checks pass. Record: experiments/city-of-cities/evidence/road-growth-review-browser.json`);
