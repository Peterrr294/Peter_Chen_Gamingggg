// A City of Cities — G02c-R1 Network Integrity: browser evidence with real mouse input (World Viewer, debug layer).
// Before: the G02c-R 6202 state (60 steps, no gate). After: the G02c-R1 6202 state (gate on, same budget), written by
// `node scripts/verify-network-integrity.mjs --long6202`. Both are grade baseline with ramps through one junction.
// Usage: node scripts/verify-network-integrity-browser.mjs
import { access, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'experiments/city-of-cities/evidence');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const host = '127.0.0.1'; const port = 4228; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const ready = async u => { try { return (await fetch(u, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
const out = { task: 'G02c-R1 browser evidence', testedAt: new Date().toISOString(), checks: [], screenshots: {}, captions: {} };
// Do not edit source files while this runs: Vite reloads the page on change and the run is lost.
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
  const shot = async (name, caption) => { await page.waitForTimeout(900); const v = await canvasBox(); const sy = await lab(() => scrollY); const c = { ...v, y: v.y + sy }; const extra = await page.locator('#rampPick').evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom + scrollY)); const bottom = Math.max(c.y + c.height, ...extra); const f = path.join(shots, name); await page.screenshot({ path: f, fullPage: true, clip: { x: c.x, y: c.y, width: c.width, height: bottom - c.y } }); out.screenshots[name] = path.relative(root, f).replaceAll('\\', '/'); out.captions[name] = caption; console.log(`shot ${name}`); };
  const guiToggle = async label => { const ctl = page.locator('#gui .lil-controller').filter({ hasText: label }).first(); await ctl.scrollIntoViewIfNeeded(); await ctl.locator('input[type=checkbox]').click(); await page.waitForTimeout(400); };
  const guiSelect = async (label, value) => { const ctl = page.locator('#gui .lil-controller').filter({ hasText: label }).first(); await ctl.scrollIntoViewIfNeeded(); await ctl.locator('select').selectOption({ label: value }); await page.waitForTimeout(400); };
  const clickWorld = async p => { await page.evaluate(() => scrollTo(0, 0)); const s = await lab(q => window.__originLab.projectToCanvas(q), p); const c = await canvasBox(); await page.mouse.click(c.x + s.x, c.y + s.y); await page.waitForTimeout(300); return lab(() => window.__originLab.picked()); };
  const loadState = async file => {
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__originLab?.ready === true);
    const saved = await readFile(path.join(evidence, file), 'utf8');
    await lab(s => window.__originLab.load(JSON.parse(s)), saved);
    await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 1800000 });
    return lab(() => ({ steps: window.__originLab.history().length, chunks: window.__originLab.chunks().length, mismatches: window.__originLab.mismatches().map(m => m.chunkId), err: window.__originLab.error() }));
  };
  const items = () => lab(() => window.__originLab.integrityItems());
  const centre = id => lab(i => window.__originLab.chunks().find(c => c.chunkId === i).worldOrigin, id);
  const t0 = Date.now();

  // Before.
  const before = await loadState('world-6202-g02c-review-state.json');
  check('1 before state (6202, 60 steps, no gate) loads', !before.err && before.steps === 60, `${before.steps} steps, ${before.chunks} chunks; signature mismatches ${before.mismatches.join(', ') || 'none'} (known cross-runtime network difference, G02c-R)`);
  await guiToggle('Network integrity layer (debug)');
  await page.waitForFunction(() => window.__originLab.ready === true && window.__originLab.integrityState?.(), null, { timeout: 600000 });
  const bItems = await items(); const bClasses = bItems.filter(i => i.kind === 'component' && !i.reached).reduce((o, i) => ({ ...o, [i.class]: (o[i.class] ?? 0) + 1 }), {});
  check('2 real click on the layer checkbox classifies every unreachable piece', bClasses.orphan > 0 && (bClasses.geographicWater ?? 0) + (bClasses.geographicSlope ?? 0) > 0 && !bClasses.unclassified, JSON.stringify(bClasses));
  out.before = { load: before, classes: bClasses, report: await lab(() => { const r = window.__originLab.integrityReport(); return Object.fromEntries(Object.entries(r).filter(([, x]) => x.chunks > 1).map(([k, { pieces, ...x }]) => [k, x])); }) };
  const o43 = await centre('c_-4_-3'); const o31 = await centre('c_-3_-1');
  await lab(() => window.__originLab.overview('top')); await page.waitForTimeout(500);
  await shot('g02c-r1-network-top-before.png', 'seed 6202, G02c-R state (60 steps, no gate), integrity layer by class; whole world top view');
  await lab(p => window.__originLab.focusPoint((p[0].x + p[1].x) / 2, (p[0].z + p[1].z) / 2, 2200), [o43, o31]);
  await guiSelect('Integrity colours', 'By component');
  await shot('g02c-r1-component-map-before.png', 'seed 6202, no gate, 60 steps; Manhattan c_-4_-3 (step 45) and c_-3_-1 (step 43); one colour per city-level road component (green: reached from the city root)');
  await guiSelect('Integrity colours', 'By class');
  // Orphan detail in c_-4_-3.
  const orphan = (await items()).filter(i => i.kind === 'component' && i.class === 'orphan' && i.chunkId === 'c_-4_-3').sort((a, b) => b.lengthM - a.lengthM)[0];
  await lab(p => window.__originLab.focusPoint(p.x, p.z, 1300), o43);
  const po = await clickWorld(orphan.point);
  check('3 real click on an orphan piece in c_-4_-3 shows its record', po?.kind === 'component' && po.class === 'orphan', po?.text?.split('\n').slice(0, 2).join(' / '));
  await shot('g02c-r1-orphan-pick-debug.png', `seed 6202, no gate; Manhattan c_-4_-3 (growth step 45, committed without the gate); real click on orphan ${orphan.componentId} (${orphan.lengthM} m)`);
  // Terrain / water evidence in c_-3_-1: a riverside piece that is NOT isolated (land runs to a connected edge), and the
  // one piece that is (slope).
  await lab(p => window.__originLab.focusPoint(p.x, p.z, 1300), o31);
  const bank = (await items()).find(i => i.kind === 'component' && i.componentId === 'c_-3_-1:n0');
  const pb = bank ? await clickWorld(bank.point) : null;
  check('4 real click on the riverside piece c_-3_-1:n0: orphan, land continues to a root-connected chunk', pb?.class === 'orphan' && /edge, shared with root-connected/.test(pb.text), pb?.text?.split('\n').slice(2, 4).join(' / '));
  await shot('g02c-r1-water-evidence-debug.png', 'seed 6202, no gate; Manhattan c_-3_-1 (growth step 43, river valley); tint: blue water, orange land steeper than 10°; real click on c_-3_-1:n0 (riverside, orphan: land runs to an edge shared with a root-connected chunk)');
  const steep = (await items()).filter(i => i.kind === 'component' && /^geographic/.test(i.class) && i.chunkId === 'c_-3_-1')[0];
  const ps = steep ? await clickWorld(steep.point) : null;
  check('4b real click on a geographically separated piece in c_-3_-1 shows the terrain reason', /^geographic/.test(ps?.class ?? ''), ps?.text?.split('\n').slice(2, 4).join(' / '));
  if (ps) await shot('g02c-r1-geographic-pick-debug.png', `seed 6202, no gate; Manhattan c_-3_-1 (growth step 43); real click on ${steep.componentId} (${steep.lengthM} m, ${steep.class}); tint as above`);
  // After.
  const after = await loadState('world-6202-g02c-r1-long-state.json');
  check('5 after state (6202, gate on) loads', !after.err && after.steps > 0, `${after.steps} steps, ${after.chunks} chunks; mismatches ${after.mismatches.join(', ') || 'none'}`);
  await guiToggle('Network integrity layer (debug)');
  await page.waitForFunction(() => window.__originLab.ready === true && window.__originLab.integrityState?.(), null, { timeout: 600000 });
  const aItems = await items(); const aClasses = aItems.filter(i => i.kind === 'component' && !i.reached).reduce((o, i) => ({ ...o, [i.class]: (o[i.class] ?? 0) + 1 }), {});
  const refused = aItems.filter(i => i.kind === 'refused');
  check('6 after: no orphan piece is committed; refused candidates are drawn', !aClasses.orphan && !aClasses.unclassified, `${JSON.stringify(aClasses)}; ${refused.length} refused cell(s)`);
  out.after = { load: after, classes: aClasses, refused: refused.length, report: await lab(() => { const r = window.__originLab.integrityReport(); return Object.fromEntries(Object.entries(r).filter(([, x]) => x.chunks > 1).map(([k, { pieces, ...x }]) => [k, x])); }) };
  await lab(() => window.__originLab.overview('top')); await page.waitForTimeout(500);
  await shot('g02c-r1-network-top-after.png', `seed 6202, G02c-R1 state (${after.steps} steps, gate on), integrity layer by class; whole world top view; red squares: cells the gate refused`);
  await lab(p => window.__originLab.focusPoint((p[0].x + p[1].x) / 2, (p[0].z + p[1].z) / 2, 2200), [o43, o31]);
  await guiSelect('Integrity colours', 'By component');
  await shot('g02c-r1-component-map-after.png', 'seed 6202, gate on, same camera as the before map; one colour per city-level road component');
  await guiSelect('Integrity colours', 'By class');
  if (refused.length) {
    const r = refused.find(x => x.candidateId.endsWith(':-4:-3')) ?? refused[0];
    await lab(p => window.__originLab.focusPoint(p.x, p.z, 1800), r.point);
    const pr = await clickWorld(r.point);
    check('7 real click on a refused candidate cell shows the gate reason and its pieces', pr?.kind === 'refused', pr?.text?.split('\n').slice(0, 2).join(' / '));
    await shot('g02c-r1-refused-candidate-debug.png', `seed 6202, gate on; refused candidate ${r.candidateId} at step ${r.step}; real click`);
  } else check('7 refused candidate shown', false, 'no refusal in the after state');
  out.errors = errors; check('no browser errors', !errors.length, errors.slice(0, 3).join(' | '));
  out.ms = Date.now() - t0;
} finally { await browser?.close(); server.kill(); }
await writeFile(path.join(evidence, 'network-integrity-browser.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.checks.filter(c => c.pass).length} of ${out.checks.length} checks pass. Record: experiments/city-of-cities/evidence/network-integrity-browser.json`);
