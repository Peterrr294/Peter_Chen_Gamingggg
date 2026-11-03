// A City of Cities — VIS-01a verifier: the stage timeline of one real growth event in the World Viewer.
// Node reference: the same step generated without the page (seed 6202, 6 % ramp plan, step 1).
// Browser: the page grows the step, opens the timeline, and every stage is checked and captured with one fixed camera;
// pause / seek / play must not regenerate anything; a clicked continued road names its parent road.
// Usage: node --max-old-space-size=8192 scripts/verify-growth-observatory.mjs [seed=6202] [step=1]
import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { STAGES } = await mod('experiments/city-of-cities/GrowthReplay.js');
const SEED = Number(process.argv[2] ?? 6202); const STEP = Number(process.argv[3] ?? 1);
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world'); const recordFile = path.join(root, 'experiments/city-of-cities/evidence/growth-observatory.json');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const result = { task: 'VIS-01a single growth event timeline', testedAt: new Date().toISOString(), seed: SEED, step: STEP, gradeProfile: 'baseline', checks: [], stages: [] };
const check = (name, pass, detail = '') => { result.checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ·  ${detail}` : ''}`); assert(pass, name); };

// Node reference.
const w = new WorldContext({ worldSeed: SEED }); w.initialise(); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline' });
let ref = null; for (let i = 0; i < STEP; i += 1) ref = g.step();
const refEvent = ref.event; const refChunk = w.chunks.get(refEvent.newChunkId);

const host = '127.0.0.1'; const port = 4223; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const ready = async u => { try { return (await fetch(u, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const { chromium } = await import('playwright-core');
let browser;
try {
  for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) await new Promise(r => setTimeout(r, 250));
  let exe = process.env.PLAYWRIGHT_CHROME_PATH; for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (!exe && await exists(c)) exe = c;
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(e.message));
  const lab = (fn, arg) => page.evaluate(fn, arg);
  await page.goto(`${base}${entry}?worldSeed=${SEED}&growthMode=road&grade=baseline&replay=${STEP}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__originLab?.ready === true && window.__originLab.replayState?.(), null, { timeout: 900000 });
  assert(!(await lab(() => window.__originLab.error())), 'page error');
  // The page's event is the real one: equal to the Node reference.
  const ev = await lab(() => { const e = window.__originLab.replayEvent(); return { newChunkId: e.newChunkId, parent: e.parentChunkId, joins: e.connections.map(c => c.connectionId), ramps: e.ramps.map(r => [r.rampId, r.status]) }; });
  const pageSig = await lab(id => window.__originLab.chunks().find(c => c.chunkId === id).outputs.signatures, refEvent.newChunkId);
  check('page event equals the Node reference', json(ev) === json({ newChunkId: refEvent.newChunkId, parent: refEvent.parentChunkId, joins: refEvent.connections.map(c => c.connectionId), ramps: refEvent.ramps.map(r => [r.rampId, r.status]) }) && json(pageSig) === json(refChunk.outputs.signatures), `${ev.parent} → ${ev.newChunkId}, ${ev.joins.length} joins`);
  const builds0 = await lab(id => window.__originLab.builds()[id], refEvent.newChunkId);

  // Stages, one fixed camera.
  const expect = [
    s => !s.terrainVisible && !s.networkVisible && s.visibleBuildings === 0,
    s => s.terrainVisible && !s.networkVisible && s.terrainMode === 'suitability' && s.visibleBuildings === 0,
    s => s.terrainVisible && !s.networkVisible && s.visibleBuildings === 0,
    s => s.networkVisible && s.visibleBuildings === 0,
    s => s.networkVisible && s.terrainMode === 'blocks' && s.visibleBuildings === 0,
    s => s.networkVisible && s.terrainMode === 'parcels' && s.visibleBuildings === 0,
    s => s.visibleBuildings > 0 && s.visibleBuildings < s.totalBuildings,
    s => s.visibleBuildings === s.totalBuildings,
  ];
  for (let i = 0; i < STAGES.length; i += 1) {
    await lab(t => window.__originLab.replaySeek(t), i === 6 ? 6.5 : i);
    await page.waitForTimeout(700);
    const s = await lab(() => window.__originLab.replayState());
    const file = `vis-01a-stage${i + 1}-${STAGES[i].id}.png`;
    const c = await page.locator('#worldCanvas').boundingBox(); const p = await page.locator('.replay-panel').boundingBox();
    await page.screenshot({ path: path.join(shots, file), fullPage: true, clip: { x: Math.min(c.x, p.x), y: c.y, width: Math.max(c.x + c.width, p.x + p.width) - Math.min(c.x, p.x), height: p.y + p.height - c.y } }); // the 3D view and its timeline
    result.stages.push({ stage: i + 1, id: s.stage, kind: s.kind, terrainMode: s.terrainMode, networkVisible: s.networkVisible, visibleBuildings: s.visibleBuildings, totalBuildings: s.totalBuildings, screenshot: `docs/assets/screenshots/procedural-mini-world/${file}` });
    check(`stage ${i + 1} ${STAGES[i].title} (${s.kind})`, s.stage === STAGES[i].id && expect[i](s), `buildings ${s.visibleBuildings} of ${s.totalBuildings}, terrain ${s.terrainMode ?? 'hidden'}, roads ${s.networkVisible ? 'shown' : 'hidden'}`);
  }
  // Seeking is a function of t: same t, same state; play advances at the chosen speed; nothing regenerates.
  await lab(() => window.__originLab.replaySeek(6.3)); const a1 = await lab(() => window.__originLab.replayState());
  await lab(() => window.__originLab.replaySeek(2)); await lab(() => window.__originLab.replaySeek(6.3)); const a2 = await lab(() => window.__originLab.replayState());
  check('same t gives the same state after seeking away and back', a1.visibleBuildings === a2.visibleBuildings && a1.stage === a2.stage);
  await page.selectOption('.replay-panel #rpSpeed', '4'); await lab(() => window.__originLab.replaySeek(0)); await lab(() => window.__originLab.replayPlay(true));
  const t0 = Date.now(); await page.waitForTimeout(3000); await lab(() => window.__originLab.replayPlay(false)); const dt = (Date.now() - t0) / 1000;
  const tp = (await lab(() => window.__originLab.replayState())).t;
  check('play at 4× advances about 4 / 2.5 stages per second', Math.abs(tp - (4 * dt) / 2.5) < 0.8, `t ${tp.toFixed(2)} after ${dt.toFixed(1)} s`);
  const builds1 = await lab(id => window.__originLab.builds()[id], refEvent.newChunkId);
  check('pause, seek and play regenerate nothing', builds0 === 1 && builds1 === 1, `chunk built ${builds1} time(s)`);
  // Road origin.
  const joined = refEvent.connections[0];
  const o1 = await lab(id => window.__originLab.replayPickEdge(id), joined.child.edgeId);
  check('a continued road names its parent road', o1.continuedFrom === `${joined.parent.chunkId}:e${joined.parent.edgeId}` && o1.connectionId === joined.connectionId, `${o1.road} ← ${o1.continuedFrom}`);
  const inner = refChunk.outputs.roadGraph.length; const internal = (await lab(id => window.__originLab.chunks().find(c => c.chunkId === id).outputs.roadGraph.map((e, k) => k), refEvent.newChunkId)).find(k => !refEvent.connections.some(c => c.child.edgeId === k) && !refEvent.ramps.some(r => r.childEdgeId === k));
  const o2 = await lab(id => window.__originLab.replayPickEdge(id), internal);
  check('a road made inside the chunk says its parent is Not available', o2.continuedFrom === 'Not available', `${o2.road} of ${inner} roads`);
  await lab(() => window.__originLab.replaySeek(8)); await page.waitForTimeout(500);
  const insp = (await lab(() => window.__originLab.replayState())).inspector;
  check('Inspector shows the event id as source', insp.includes(refEvent.growthEventId));
  result.errors = errors; check('no browser errors', !errors.length, errors.slice(0, 3).join(' | '));
} finally { await browser?.close(); server.kill(); }
result.passed = result.checks.filter(c => c.pass).length;
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(`VIS-01a: ${result.passed} of ${result.checks.length} checks passed. Record: experiments/city-of-cities/evidence/growth-observatory.json`);
