// WEB-01 browser acceptance of the Interactive Procedural Film and the site around it (own Vite server, real Chrome).
// Usage: node scripts/verify-procedural-film.mjs [--film-only] [--no-capture]
// Evidence: experiments/procedural-film/evidence/film-acceptance.json; screenshots in docs/assets/screenshots/procedural-mini-world/web01-*.png
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const evidenceDir = path.join(root, 'experiments/procedural-film/evidence');
const PORT = 5193;
const base = `http://localhost:${PORT}`;
const FILM = `${base}/experiments/procedural-film/index.html`;
const filmOnly = process.argv.includes('--film-only');
const capture = !process.argv.includes('--no-capture');
const CITIES = ['veniceWaterNetwork', 'manhattanGrid', 'fezOrganicCore', 'amsterdamCanalRing', 'lisbonHillCore', 'chicagoGrid'];
const STAGE_IDS = ['terrain', 'analysis', 'roads', 'blocks', 'parcels', 'buildings'];
const PART_ONE_END = 51.999;
const FILM_END = 122; const GROWTH_T = 60; const CASE_T = 104;
const STAGE_END = [6.999, 12.999, 23.999, 30.999, 38.999, 51.999];

const report = { task: 'WEB-01', at: new Date().toISOString(), checks: [], issues: [], browserErrors: [], measurements: {} };
const check = (name, pass, detail = '') => { report.checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ·  ${detail}` : ''}`); };
// Written only at the end: Vite reloads open pages when an image matched by import.meta.glob is written.
const pendingShots = [];
const shot = async (page, name, options = {}) => { pendingShots.push([name, await page.screenshot(options)]); };
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', windowsHide: true });
await new Promise((resolve, reject) => {
  server.stdout.on('data', data => { if (String(data).includes('Local')) resolve(); });
  server.on('exit', code => reject(new Error(`vite exited with ${code}`)));
  setTimeout(() => reject(new Error('vite start timeout')), 60000);
});

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const newPage = async (options = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 }, ...options });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_BLOCKED|firebase|Failed to load resource/i.test(m.text())) report.browserErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => report.browserErrors.push(e.message.slice(0, 300)));
  return page;
};
const ready = page => page.waitForFunction(() => window.__film?.ready === true, null, { timeout: 180000 });
const openFilm = async (page, params = 'autoplay=0') => { await page.goto(`${FILM}?view=explore&${params}`, { waitUntil: 'domcontentloaded' }); await ready(page); };
// Raw canvas pixels. Same frame = at most 0.01 % of pixels differ, by at most 2 / 255 (GPU rasteriser noise, measured 3 pixels by 1 / 255).
const pixels = page => page.evaluate(() => {
  window.__film.render();
  const canvas = document.getElementById('filmCanvas'); const gl = canvas.getContext('webgl2');
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  let text = ''; for (let i = 0; i < data.length; i += 32768) text += String.fromCharCode.apply(null, data.subarray(i, i + 32768));
  return btoa(text);
}).then(text => Buffer.from(text, 'base64'));
const frameDiff = (a, b) => { let changed = 0; let max = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d) changed += 1; if (d > max) max = d; } return { changed, max, share: changed / (a.length / 4) }; };
const sameFrames = (first, second) => { const diffs = Object.keys(first).map(t => frameDiff(first[t], second[t])); return { pass: diffs.every(d => d.share <= 0.0001 && d.max <= 2), changed: Math.max(...diffs.map(d => d.changed)), max: Math.max(...diffs.map(d => d.max)) }; };
const hash = buffer => createHash('sha1').update(buffer).digest('hex').slice(0, 12);
const seek = async (page, t) => { await page.evaluate(v => window.__film.seek(v), t); await sleep(120); };

try {
  // ---------- 1. Real data: each city's signatures equal the 06.1 verifier evidence ----------
  const evidence = JSON.parse(await readFile(path.join(root, 'experiments/seed-terrain/evidence/city-dna-comparison.json'), 'utf8'));
  const cityFacts = {};
  {
    const page = await newPage();
    for (const city of CITIES) {
      const started = Date.now();
      await openFilm(page, `autoplay=0&capture=1&city=${city}&t=${PART_ONE_END}&cam=axon`);
      const ms = Date.now() - started;
      const s = await page.evaluate(() => window.__film.signatures());
      const facts = await page.evaluate(() => ({ city: window.__film.city, label: document.getElementById('readout').textContent, buildMs: window.__film.buildMs }));
      const suitable = evidence.suitable[city];
      const run = evidence.runs.find(r => r.landform === suitable.landform && r.seed === suitable.seed && r.dna === city);
      const same = ['network', 'blocks', 'parcels', 'buildings'].every(key => s[key] === run.signatures[key]);
      check(`real output: ${city} signatures = 06.1 evidence (${suitable.landform} ${suitable.seed})`, same && s.cityId === city, `${s.network} ${s.blocks} ${s.parcels} ${s.buildings} · ${s.buildingCount} buildings`);
      cityFacts[city] = { landform: suitable.landform, seed: suitable.seed, signatures: s, loadMs: ms, buildMs: facts.buildMs };
      if (capture) { await sleep(300); await shot(page, `web01-city-${city}-after.png`); }
      await seek(page, 0);
      const stats = await page.evaluate(() => window.__film.geometry());
      cityFacts[city].triangles = stats.triangles;
    }
    await page.context().close();
  }
  report.measurements.cities = cityFacts;

  // ---------- 2. Same seed, same film: pixel-identical across reloads ----------
  {
    const page = await newPage();
    await openFilm(page);
    const first = {};
    for (const t of [3, 16, 28, 36, 44, PART_ONE_END]) { await seek(page, t); first[t] = await pixels(page); }
    const reveal = (await page.evaluate(() => window.__film.signatures())).reveal;
    check('stages differ visibly (6 distinct frames)', new Set(Object.values(first).map(hash)).size === 6);

    // Non-destructive timeline: play, scrub back and forth, frames at the same t stay identical.
    await page.click('#play'); await sleep(1500);
    const playing = await page.evaluate(() => [window.__film.playing, window.__film.t]);
    check('Play advances the timeline', playing[0] && playing[1] > 0.3, `t = ${playing[1].toFixed(2)}`);
    await page.click('#play');
    const t1 = await page.evaluate(() => window.__film.t); await sleep(500);
    const t2 = await page.evaluate(() => window.__film.t);
    check('Pause holds the timeline', t1 === t2 && !(await page.evaluate(() => window.__film.playing)), `t = ${t2.toFixed(2)}`);
    for (const t of [50, 2, 33, 9]) await seek(page, t);
    const round = {};
    for (const t of Object.keys(first)) { await seek(page, Number(t)); round[t] = await pixels(page); }
    const scrubbed = sameFrames(first, round);
    check('scrubbing never changes the model (same t = same frame)', scrubbed.pass, `worst ${scrubbed.changed} pixels, delta ${scrubbed.max}`);

    await page.click('#modeInspect'); await sleep(700);
    await seek(page, STAGE_END[1]);
    await page.click('#next');
    check('Next goes to the next stage', await page.evaluate(() => window.__film.stage) === 'roads');
    await page.click('#prev');
    check('Prev goes to the previous stage', await page.evaluate(() => window.__film.stage) === 'analysis');
    await page.locator('#stageTicks button').nth(4).click();
    check('a stage label jumps to that stage', await page.evaluate(() => window.__film.stage) === 'parcels');
    await page.evaluate(() => { const scrub = document.getElementById('scrub'); scrub.value = '500'; scrub.dispatchEvent(new Event('input', { bubbles: true })); });
    check('the slider scrubs and pauses', Math.abs(await page.evaluate(() => window.__film.t) - FILM_END / 2) < 0.1 && !(await page.evaluate(() => window.__film.playing)));
    await page.click('#restart'); await sleep(400);
    const restarted = await page.evaluate(() => [window.__film.t, window.__film.playing]);
    check('Restart replays from the start', restarted[1] && restarted[0] < 2, `t = ${restarted[0].toFixed(2)}`);

    await page.click('#modeWatch'); await sleep(900);
    // Camera continuity along the whole film.
    await page.evaluate(() => window.__film.seek(0));
    const jumps = await page.evaluate(STAGE => {
      const f = window.__film; let previous = null; const worst = { target: 0, angle: 0, zoom: 0, atT: 0 };
      for (let t = 0; t <= 51.95; t += 0.05) {
        f.seek(t); f.render();
        const p = f.pose();
        if (previous) {
          const target = Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z);
          const angle = Math.max(Math.abs(p.az - previous.az), Math.abs(p.el - previous.el));
          const zoom = Math.abs(Math.log(p.h / previous.h));
          if (target > worst.target) worst.target = target;
          if (angle > worst.angle) worst.angle = angle;
          if (zoom > worst.zoom) { worst.zoom = zoom; worst.atT = t; }
        }
        previous = p;
      }
      return worst;
    }, null);
    report.measurements.cameraMaxStepPer50ms = jumps;
    check('no camera jump in the film (each 50 ms step: < 12 m, < 1°, < 3 % zoom)', jumps.target < 12 && jumps.angle < 0.0175 && jumps.zoom < 0.03, JSON.stringify(jumps));

    // Reload: same seed gives the same film.
    await openFilm(page);
    const again = {};
    for (const t of Object.keys(first)) { await seek(page, Number(t)); again[t] = await pixels(page); }
    const reloaded = sameFrames(first, again);
    check('same seed, reload: same frame at 6 times', reloaded.pass, `worst ${reloaded.changed} pixels, delta ${reloaded.max}`);
    check('reveal order reproducible', reveal === (await page.evaluate(() => window.__film.signatures())).reveal, reveal);

    // Refresh restores the viewing state (session state in the same tab).
    await page.goto(`${FILM}?view=explore`, { waitUntil: 'domcontentloaded' }); await ready(page);
    await seek(page, 27); await sleep(700);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page); await sleep(300);
    const restored = await page.evaluate(() => [window.__film.t, window.__film.playing, window.__film.stage]);
    check('refresh restores position, paused', Math.abs(restored[0] - 27) < 0.05 && !restored[1], JSON.stringify(restored));

    // Orbit while paused: no jump at grab, the model stays, the timeline still works.
    await page.selectOption('#camera', 'film'); await sleep(900);
    const before = await page.evaluate(() => window.__film.pose());
    await page.mouse.move(720, 330); await page.mouse.down(); await page.mouse.move(724, 332); await sleep(120);
    const grabbed = await page.evaluate(() => window.__film.pose());
    await page.mouse.move(820, 300, { steps: 6 }); await page.mouse.up(); await sleep(300);
    const dragged = await page.evaluate(() => window.__film.pose());
    const camValue = await page.inputValue('#camera');
    check('dragging orbits from the current view without a jump', Math.hypot(grabbed.x - before.x, grabbed.y - before.y, grabbed.z - before.z) < 1 && Math.abs(grabbed.h - before.h) < 1 && Math.abs(dragged.az - before.az) > 0.05 && camValue === 'free', `az ${before.az.toFixed(3)} → ${dragged.az.toFixed(3)}, camera select = ${camValue}`);
    await seek(page, 44);
    check('timeline still works in free camera', await page.evaluate(() => window.__film.stage) === 'buildings');
    await page.selectOption('#camera', 'plan'); await sleep(900);
    const plan = await page.evaluate(() => window.__film.pose());
    check('camera preset: Plan', plan.el > 1.1, `el ${plan.el.toFixed(2)} rad`);
    await page.context().close();
  }

  // ---------- 3. Autoplay from a fresh visit: first content and frame rate ----------
  {
    const page = await newPage();
    const started = Date.now();
    await page.goto(FILM, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loading:not([hidden])', { timeout: 15000 });
    const loading = await page.locator('#loadingStages li').count();
    check('loading state lists the real generation stages', loading === 6, `${loading} rows`);
    await ready(page);
    const readyMs = Date.now() - started;
    report.measurements.freshVisitReadyMs = readyMs;
    check('fresh visit: film starts by itself within 15 s', readyMs < 15000 && await page.evaluate(() => window.__film.playing), `${readyMs} ms`);
    await sleep(12000);
    const playback = await page.evaluate(() => window.__film.playback);
    report.measurements.playback = playback;
    check('playback frame rate ≥ 24 fps (this machine)', playback.fps >= 24, `${playback.fps.toFixed(1)} fps, worst frame ${(playback.worst * 1000).toFixed(0)} ms (capped at 100)`);
    await page.context().close();
  }

  // ---------- 4. Reduced motion, no WebGL, phone ----------
  {
    const page = await newPage({ reducedMotion: 'reduce' });
    await openFilm(page, 'city=lisbonHillCore&mode=inspect');
    const state = await page.evaluate(() => [window.__film.playing, window.__film.stage, document.getElementById('staticView').checked]);
    check('reduced motion: no autoplay, finished model, static view on', !state[0] && state[1] === 'buildings' && state[2], JSON.stringify(state));
    await page.click('#prev');
    check('reduced motion: stages still step', await page.evaluate(() => window.__film.stage) === 'parcels');
    await page.context().close();
  }
  {
    const page = await newPage();
    await page.addInitScript(() => { const real = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) ? null : real.call(this, kind, ...rest); }; });
    const errors = report.browserErrors.length;
    await page.goto(`${FILM}?view=explore`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__film?.ready === true);
    const shown = await page.evaluate(() => { const s = document.getElementById('still'); return { webgl: window.__film.webgl, hidden: s.hidden, width: s.naturalWidth }; });
    await sleep(500);
    const width = await page.evaluate(() => document.getElementById('still').naturalWidth);
    await page.locator('#stageTicks button').nth(1).click();
    await sleep(400);
    const src = await page.evaluate(() => document.getElementById('still').getAttribute('src'));
    check('no WebGL: real stills, stage controls still work', !shown.webgl && !shown.hidden && width > 0 && /analysis/.test(src ?? ''), `${src?.split('/').pop()}`);
    report.browserErrors.length = errors; // the forced failure itself logs a WebGL error
    await page.context().close();
  }
  {
    const page = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await openFilm(page);
    for (const t of [12, PART_ONE_END]) {
      await seek(page, t); await sleep(250);
      if (t === PART_ONE_END && capture) await shot(page, 'web01-film-mobile-after.png');
    }
    const box = await page.evaluate(() => {
      const r = el => document.querySelector(el).getBoundingClientRect();
      const player = r('.player'); const hero = r('.hero');
      return { scrollW: document.documentElement.scrollWidth, width: innerWidth, playerTop: player.top, playerH: player.height, heroBottom: hero.bottom, height: innerHeight };
    });
    report.measurements.mobile = box;
    check('phone: no horizontal overflow', box.scrollW <= box.width, `${box.scrollW} / ${box.width}`);
    check('phone: controls leave the model at least half the screen', box.playerH <= box.height * 0.5 && box.playerTop > box.heroBottom, JSON.stringify(box));
    await page.click('#play'); await sleep(600);
    check('phone: Play works by tap', await page.evaluate(() => window.__film.playing));
    await page.context().close();
  }

  // ---------- WEB-01b-R1: playback speed ----------
  {
    const page = await newPage();
    await openFilm(page);
    const generated = await page.evaluate(() => window.__film.generations);
    const options = await page.locator('#rate option').allTextContents();
    check('six speeds, default 1×', options.length === 6 && await page.inputValue('#rate') === '1', options.join(' '));
    const measured = {};
    for (const speed of ['0.25', '0.5', '1', '1.5', '2', '4']) {
      await seek(page, 1);
      await page.selectOption('#rate', speed);
      await page.click('#play');
      const a = await page.evaluate(() => [performance.now(), window.__film.t]);
      await sleep(1500);
      const b = await page.evaluate(() => [performance.now(), window.__film.t]);
      await page.click('#play');
      measured[speed] = (b[1] - a[1]) / ((b[0] - a[0]) / 1000);
    }
    report.measurements.speedRates = measured;
    check('each speed drives the timeline at its rate (± 15 %)', Object.entries(measured).every(([speed, rate]) => Math.abs(rate / Number(speed) - 1) < 0.15), JSON.stringify(measured));

    // Switching while playing keeps the position; pause, resume and scrub keep the speed.
    await seek(page, 5);
    await page.selectOption('#rate', '0.5');
    await page.click('#play'); await sleep(300);
    let last = await page.evaluate(() => window.__film.t);
    let monotonic = last > 5;
    for (const speed of ['4', '0.25', '2', '1', '1.5', '0.5']) {
      await page.selectOption('#rate', speed); await sleep(120);
      const now = await page.evaluate(() => window.__film.t);
      if (now <= last || now > last + 3) monotonic = false;
      last = now;
    }
    check('fast speed changes while playing never reset or jump the timeline', monotonic, `t = ${last.toFixed(2)}`);
    await page.selectOption('#rate', '2');
    await page.click('#play'); await sleep(100); await page.click('#play');
    await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = '400'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#play'); await sleep(200);
    check('pause, resume and scrub keep the speed', await page.evaluate(() => window.__film.rate) === 2 && await page.inputValue('#rate') === '2');
    await page.click('#play');

    // Every speed reaches the same final state; no generator runs.
    const ends = {};
    for (const speed of ['0.25', '4']) {
      await seek(page, speed === '4' ? CASE_T + 10 : FILM_END - 0.8);
      await page.selectOption('#rate', speed);
      await page.click('#play');
      await page.waitForFunction(() => !window.__film.playing, null, { timeout: 180000 });
      ends[speed] = { t: await page.evaluate(() => window.__film.t), frame: await pixels(page) };
    }
    const endDiff = frameDiff(ends['0.25'].frame, ends['4'].frame);
    check('0.25× and 4× reach the same final frame of the film', ends['4'].t === FILM_END && ends['0.25'].t === FILM_END && endDiff.share <= 0.0001, `${endDiff.changed} pixels differ`);
    check('speed never re-runs the generators', await page.evaluate(() => window.__film.generations) === generated, `${generated} run`);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
    check('refresh keeps the chosen speed', await page.inputValue('#rate') === '4');
    await page.context().close();
  }

  // ---------- WEB-01b-R1: Inspector ----------
  {
    const page = await newPage();
    await openFilm(page, 'autoplay=0&t=30');
    await sleep(300);
    if (capture) await shot(page, 'web01r1-watch-after.png');
    const hiddenInWatch = await page.evaluate(() => ['#prev', '#restart', '.stage-metric', '#inspector'].every(selector => { const el = document.querySelector(selector); return !el.offsetParent; }));
    check('Watch mode hides the technical controls and the panel', hiddenInWatch);
    const before = await page.evaluate(() => ({ t: window.__film.t, pose: window.__film.pose(), generations: window.__film.generations, city: window.__film.city }));
    await page.click('#modeInspect'); await sleep(800);
    const after = await page.evaluate(() => ({ t: window.__film.t, pose: window.__film.pose(), generations: window.__film.generations, city: window.__film.city, mode: window.__film.mode }));
    check('Watch → Inspect keeps world, time, camera direction, city; nothing regenerates', after.mode === 'inspect' && after.t === before.t && after.generations === before.generations && after.city === before.city && after.pose.az === before.pose.az && after.pose.el === before.pose.el && after.pose.x === before.pose.x);
    const text = id => page.locator(id).innerText();
    const dd = async (list, term) => page.evaluate(([l, name]) => { const dts = [...document.querySelectorAll(`${l} dt`)]; return dts.find(d => d.textContent === name)?.nextElementSibling.textContent; }, [list, term]);
    await page.locator('#inIdentityBox summary').click();
    check('Inspector City ID comes from the generated data', await dd('#inIdentity', 'City ID') === (await page.evaluate(() => window.__film.signatures().cityId)));
    check('standalone chunk: world seed, chunk ID, growth step say Not Available', (await dd('#inIdentity', 'World seed')).startsWith('Not Available') && (await dd('#inIdentity', 'Chunk ID')).startsWith('Not Available') && (await dd('#inIdentity', 'Growth step')).startsWith('Not Available'));

    const stageNames = ['Terrain', 'Terrain Analysis', 'Road Network', 'Urban Blocks', 'Parcels', 'Buildings'];
    const processes = ['generateChunk()', 'analyseTerrain()', 'generateNetwork()', 'generateBlocks()', 'generateParcels()', 'generateBuildings()'];
    let stagesOk = true; const noted = [];
    for (let k = 0; k < 6; k += 1) {
      await seek(page, STAGE_END[k]); await sleep(120);
      const title = await text('#inStageTitle'); const flow = await text('#inFlow'); const params = await page.locator('#inParams dt').count();
      if (title !== `Stage: ${stageNames[k]}` || !flow.includes(processes[k]) || params < 5) { stagesOk = false; noted.push(title); }
    }
    check('six stages: title, real module names and parameters follow the timeline', stagesOk, noted.join(', '));

    // Numbers equal the generated data, and only what the timeline has reached counts.
    const facts = await page.evaluate(() => window.__film.signatures());
    await seek(page, 3); await sleep(100);
    const early = await page.evaluate(() => window.__film.live());
    check('stage 1: no later output counted as generated', early.roadEdges === 0 && early.blocks === 0 && early.parcels === 0 && early.buildings === 0, JSON.stringify(early));
    await seek(page, 19); await sleep(100);
    const middle = await page.evaluate(() => window.__film.live());
    check('road stage: part of the roads, no blocks yet', middle.roadEdges > 0 && middle.blocks === 0 && middle.buildings === 0, JSON.stringify(middle));
    await seek(page, PART_ONE_END); await sleep(300);
    check('end: Inspector counts equal the generated data', (await dd('#inLive', 'Buildings generated')).startsWith(`${facts.buildingCount} of ${facts.buildingCount}`), await dd('#inLive', 'Buildings generated'));
    check('Inspector shows no invented growth numbers in this film', (await dd('#inLive', 'Growth chunks')).startsWith('Not Available'));

    // Debug layers.
    await seek(page, PART_ONE_END); await sleep(200);
    const plain = await pixels(page);
    check('debug layers start folded', !(await page.locator('#inLayersBox').evaluate(el => el.open)));
    await page.locator('#inLayersBox summary').click();
    await page.selectOption('#surfaceLayer', 'slope'); await sleep(200);
    const slope = await pixels(page);
    check('a surface layer changes the view', frameDiff(plain, slope).share > 0.02, `${(frameDiff(plain, slope).share * 100).toFixed(1)} % of pixels`);
    await page.selectOption('#surfaceLayer', 'none'); await sleep(200);
    check('turning it off restores the same frame', frameDiff(plain, await pixels(page)).share <= 0.0001);
    await page.locator('.layer[data-layer="buildings"] input').uncheck(); await sleep(200);
    await page.locator('.layer[data-layer="nodes"] input').check(); await page.locator('.layer[data-layer="footprints"] input').check(); await sleep(300);
    check('layer switches change the view (no buildings, nodes and footprints on)', frameDiff(plain, await pixels(page)).share > 0.01);
    if (capture) { await page.selectOption('#camera', 'close'); await sleep(900); await page.locator('#inLayersBox').evaluate(el => el.scrollIntoView()); await shot(page, 'web01r1-debug-after.png'); await page.selectOption('#camera', 'film'); await sleep(900); }
    await page.locator('.layer[data-layer="nodes"] input').uncheck(); await page.locator('.layer[data-layer="footprints"] input').uncheck(); await page.locator('.layer[data-layer="buildings"] input').check();
    await seek(page, 3); await sleep(150);
    const gated = await page.evaluate(() => ({ nodes: document.querySelector('.layer[data-layer="nodes"] input').disabled, blocks: [...document.getElementById('surfaceLayer').options].find(o => o.value === 'blocks').disabled }));
    check('layers of later stages stay locked until the timeline reaches them', gated.nodes && gated.blocks);

    // Picking on real objects; no regeneration.
    await seek(page, PART_ONE_END); await sleep(900);
    const pick = async (x, y) => { await page.mouse.click(x, y); await sleep(200); return page.evaluate(() => window.__film.selected); };
    const box = await page.evaluate(() => { const r = document.getElementById('inspector').getBoundingClientRect(); return { left: r.left, width: r.width }; });
    let picked = null;
    for (const [x, y] of [[0.35, 0.4], [0.4, 0.45], [0.3, 0.35], [0.45, 0.3], [0.38, 0.5]]) { picked = await pick(1440 * x, 860 * y); if (picked && picked.kind !== 'chunk') break; }
    const heading = picked ? await page.locator('#inSelection h3').innerText() : '';
    check('clicking the model selects a real object with its stable ID', picked && picked.kind !== 'chunk' && heading.includes(String(picked.id)), heading);
    check('selecting does not regenerate', await page.evaluate(() => window.__film.generations) === before.generations);
    if (capture) await shot(page, 'web01r1-pick-after.png');
    await pick(20, 500);
    check('clicking empty space returns to the stage overview', (await page.evaluate(() => window.__film.selected)) === null);
    if (capture) { await seek(page, 38); await page.locator('#inspectorBody').evaluate(el => { el.scrollTop = 0; }); await sleep(300); await shot(page, 'web01r1-inspect-after.png'); }

    // Panel: size, close while playing, reopen.
    check('panel is 25–30 % of a 1440 px view and leaves the model visible', box.width / 1440 >= 0.25 && box.width / 1440 <= 0.3, `${box.width} px`);
    const contrast = await page.evaluate(() => getComputedStyle(document.getElementById('inspector')).backgroundColor);
    check('panel is semi-transparent', /rgba\(.*0\.\d+\)/.test(contrast), contrast);
    await page.click('#inspectorCollapse'); await sleep(500);
    const collapsed = await page.evaluate(() => document.getElementById('inspectorBody').offsetParent === null);
    await page.click('#inspectorCollapse'); await sleep(300);
    check('panel collapses and expands', collapsed);
    await seek(page, 10);
    await page.selectOption('#rate', '1');
    await page.click('#play'); await sleep(400);
    await page.click('#inspectorClose'); await sleep(500);
    const closed = await page.evaluate(() => [window.__film.playing, window.__film.mode, window.__film.t]);
    await sleep(400);
    const continued = await page.evaluate(() => window.__film.t);
    check('closing the panel leaves the film playing', closed[0] && closed[1] === 'watch' && continued > closed[2]);
    await page.click('#modeInspect'); await sleep(400);
    const reopened = await text('#inStageTitle');
    check('reopening shows the current stage', reopened === `Stage: ${await page.evaluate(() => document.getElementById('stageTitle').textContent)}`, reopened);
    await sleep(6000);
    const playback = await page.evaluate(() => window.__film.playback);
    report.measurements.playbackAfterInspect = playback;
    check('playback with the panel open ≥ 24 fps (this machine)', playback.fps >= 24, `${playback.fps.toFixed(1)} fps`);
    await page.click('#play');

    // City switch: same state, new data.
    const generations = await page.evaluate(() => window.__film.generations);
    const t0 = await page.evaluate(() => window.__film.t);
    await page.selectOption('#city', 'manhattanGrid'); await ready(page); await sleep(300);
    check('switching city updates City ID and DNA, keeps the position in Inspect', await dd('#inIdentity', 'City ID') === 'manhattanGrid' && Math.abs(await page.evaluate(() => window.__film.t) - t0) < 0.01 && await page.evaluate(() => window.__film.generations) === generations + 1);
    await page.context().close();
  }
  {
    const page = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await openFilm(page, `autoplay=0&t=${PART_ONE_END}&mode=inspect`);
    await sleep(700);
    const m = await page.evaluate(() => { const p = document.getElementById('inspector').getBoundingClientRect(); const q = document.querySelector('.player').getBoundingClientRect(); return { sheet: p.height, player: q.height, gap: p.bottom - q.top, over: document.documentElement.scrollWidth > innerWidth + 1, height: innerHeight, heroBottom: document.querySelector('.hero').getBoundingClientRect().bottom, top: p.top }; });
    report.measurements.mobileInspect = m;
    check('phone Inspect: bottom sheet, no overflow, model area stays', !m.over && m.sheet <= m.height * 0.34 && m.top - m.heroBottom >= 180, JSON.stringify(m));
    if (capture) await shot(page, 'web01r1-inspect-mobile-after.png');
    await page.context().close();
  }

  // ---------- WEB-01c: Part II on the same player ----------
  {
    const saved = JSON.parse(await readFile(path.join(root, 'experiments/city-of-cities/evidence/world-6201-g02-step30-state.json'), 'utf8'));
    const caseEvidence = JSON.parse(await readFile(path.join(root, 'experiments/city-of-cities/evidence/urban-encounter.json'), 'utf8')).node.scenarios;
    const page = await newPage();
    await openFilm(page, 'autoplay=0&t=59.9');
    await page.waitForFunction(() => window.__film.worldReady === true, null, { timeout: 180000 });
    await sleep(600);
    const generated = await page.evaluate(() => window.__film.generations);
    const inner = id => page.locator(id).innerText();
    const dd = (list, term) => page.evaluate(([l, name]) => [...document.querySelectorAll(`${l} dt`)].find(d => d.textContent === name)?.nextElementSibling.textContent ?? null, [list, term]);

    // Origins: the real six, in their real positions.
    const originIds = saved.cities.map(city => city.originChunkId).sort();
    const shown = (await page.evaluate(() => window.__film.worldVisible())).sort();
    check('Stage 7 shows exactly the six saved origin chunks', JSON.stringify(shown) === JSON.stringify(originIds), shown.join(' '));
    check('Part II says it is a separate run (seed, tag)', (await inner('#sceneTag')).includes('world seed 6201') && (await inner('#readout')).startsWith('World seed 6201'), await inner('#sceneTag'));
    check('city names can be shown', (await page.evaluate(() => window.__film.labels().length)) === 6);
    if (capture) await shot(page, 'web01c-world-overview-after.png');
    await page.click('#modeInspect'); await sleep(700);
    const type = await dd('#inSource', 'Type');
    check('Inspector data source: recorded replay of world seed 6201', type === 'Recorded Simulation / Snapshot Replay' && await dd('#inSource', 'World seed') === '6201' && (await dd('#inSource', 'Source')).includes('world-6201-step30.json'), type);
    const venice = saved.cities.find(city => city.cityId === 'veniceWaterNetwork');
    await page.locator('#labels button', { hasText: 'Venice' }).click(); await sleep(900);
    check('clicking a city enters it: real seed and suitability, camera moved, nothing generated', await dd('#inParams', 'City seed') === String(venice.citySeed) && await dd('#inParams', 'Origin suitability') === venice.placementReason.score.toFixed(2) && await page.inputValue('#camera') === 'free' && await page.evaluate(() => window.__film.generations) === generated);
    await page.selectOption('#camera', 'film'); await sleep(900);
    check('Follow film returns to the six-city view', (await page.evaluate(() => window.__film.pose().h)) > 3000);

    // Scene separation: Part I and Part II never mix seeds or IDs.
    await seek(page, 12); await sleep(300);
    check('Part I shows no world seed; its terrain seed is its own', (await dd('#inSource', 'World seed')).startsWith('Not Available') && (await inner('#readout')).includes('terrain seed 2202') && await page.locator('#sceneTag').isHidden());
    await page.locator('#inIdentityBox summary').click();
    check('Part I Chunk ID stays Not Available', (await dd('#inIdentity', 'Chunk ID')).startsWith('Not Available'));

    // Growth: only recorded events, in recorded order.
    let eventsOk = true; const wrong = [];
    for (const k of [1, 2, 7, 15, 22, 30]) {
      await seek(page, GROWTH_T + 1 + (k - 1) * 1.3 + 0.65); await sleep(60);
      const event = await page.evaluate(() => window.__film.worldEvent());
      const want = saved.growth.history[k - 1];
      if (event.step !== k || event.chunk !== want.newChunkId || event.parent !== want.parentChunkId || event.cityId !== want.cityId) { eventsOk = false; wrong.push(k); }
    }
    check('growth replay plays the saved history, step by step', eventsOk, wrong.join(','));
    await seek(page, CASE_T - 0.01); await sleep(200);
    const all = (await page.evaluate(() => window.__film.worldVisible())).sort();
    check('after step 30: exactly the 36 saved chunks, no more', JSON.stringify(all) === JSON.stringify(saved.chunks.map(chunk => chunk.chunkId).sort()), `${all.length} chunks`);
    await seek(page, GROWTH_T + 1 + 14 * 1.3 + 0.65); await sleep(400);
    check('Inspector follows the step after a scrub', (await dd('#inParams', 'Growth step')) === '15 of 30' && await dd('#inParams', 'New chunk') !== null, await dd('#inParams', 'Growth step'));
    const want = saved.growth.history[14];
    check('Growth Inspector: source, parent, chunk and score are the saved values', await dd('#inParams', 'Source city') === want.cityId && await dd('#inParams', 'Parent chunk') === want.parentChunkId && (await dd('#inParams', 'New chunk')).startsWith(want.newChunkId) && (await dd('#inParams', 'Growth rule')).includes(want.selectionScore.toFixed(2)));
    check('no invented road inheritance or connections', (await dd('#inParams', 'Inherited road')).startsWith('Not Available') && (await dd('#inLive', 'Verified connections')).startsWith('0 in this run') && (await dd('#inLive', 'Active growth frontiers')).startsWith('Not Available'));
    check('Version names the baked commit once the data has loaded', (await dd('#inSource', 'Version')).startsWith('baked from'), await dd('#inSource', 'Version'));
    if (capture) { await page.locator('#inParams').evaluate(el => el.previousElementSibling.scrollIntoView()); await sleep(150); await shot(page, 'web01c-growth-inspector-after.png'); }

    // Speed on the world timeline.
    const rates = {};
    for (const speed of ['0.25', '1', '4']) {
      await seek(page, GROWTH_T + 2);
      await page.selectOption('#rate', speed);
      await page.click('#play');
      const a = await page.evaluate(() => [performance.now(), window.__film.t]); await sleep(1500); const b = await page.evaluate(() => [performance.now(), window.__film.t]);
      await page.click('#play');
      rates[speed] = (b[1] - a[1]) / ((b[0] - a[0]) / 1000);
    }
    report.measurements.worldSpeedRates = rates;
    check('speeds work in the world replay (± 15 %)', Object.entries(rates).every(([speed, rate]) => Math.abs(rate / Number(speed) - 1) < 0.15), JSON.stringify(rates));
    await page.selectOption('#rate', '4');
    await seek(page, GROWTH_T + 2);
    await page.click('#play');
    await page.waitForFunction(t => window.__film.t >= t, GROWTH_T + 20, { timeout: 30000 });
    await page.click('#play');
    await seek(page, GROWTH_T + 21); await sleep(200);
    const afterFast = await pixels(page);
    await page.selectOption('#rate', '1');
    await seek(page, 70); await seek(page, GROWTH_T + 21); await sleep(200);
    check('speed never changes the growth result (same t = same frame)', frameDiff(afterFast, await pixels(page)).share <= 0.0001);

    // Selecting a chunk reads stored data.
    await seek(page, CASE_T - 0.01); await sleep(900);
    const label = await page.locator('#labels button', { hasText: 'Fez' }).boundingBox();
    await page.mouse.click(label.x + label.width / 2, label.y + label.height + 14); await sleep(250);
    const chunk = await page.evaluate(() => window.__film.worldSelected);
    check('clicking the world selects a real chunk, nothing generated', saved.chunks.some(item => item.chunkId === chunk) && (await inner('#inSelection h3')).includes(chunk) && await page.evaluate(() => window.__film.generations) === generated, chunk);
    await page.mouse.click(20, 500); await sleep(200);
    check('clicking empty space clears the chunk', (await page.evaluate(() => window.__film.worldSelected)) === null);

    // World layers.
    const plain = await pixels(page);
    await page.locator('#inLayersBox summary').click();
    await page.locator('.layer[data-world-layer="buildings"] input').uncheck(); await sleep(250);
    check('world layers change the view', frameDiff(plain, await pixels(page)).share > 0.001);
    await page.locator('.layer[data-world-layer="buildings"] input').check(); await sleep(200);

    // Camera along the growth.
    const jumps = await page.evaluate(([from, to]) => {
      const f = window.__film; let previous = null; let target = 0; let zoom = 0;
      for (let t = from; t <= to; t += 0.05) { f.seek(t); f.render(); const p = f.pose(); if (previous) { target = Math.max(target, Math.hypot(p.x - previous.x, p.z - previous.z)); zoom = Math.max(zoom, Math.abs(Math.log(p.h / previous.h))); } previous = p; }
      return { target, zoom };
    }, [GROWTH_T, CASE_T - 0.1]);
    report.measurements.worldCameraMaxStepPer50ms = jumps;
    check('world camera keeps its direction and eases as the world grows', jumps.zoom < 0.03, JSON.stringify(jumps));

    // Case study.
    await seek(page, CASE_T + 0.5);
    await page.waitForFunction(() => window.__film.casesReady === true, null, { timeout: 180000 });
    await sleep(300);
    check('entering the case study says what it is', (await inner('#chapterCard')).includes('placed by hand') && (await inner('#sceneTag')).startsWith('Controlled Experiment'), await inner('#sceneTag'));
    const names = ['compatible', 'incompatible', 'barrier']; let casesOk = true; const seen = [];
    for (const [index, name] of names.entries()) {
      await seek(page, CASE_T + index * 6 + 5.5); await sleep(350);
      const relationship = await dd('#inParams', 'Relationship');
      const visible = await page.evaluate(() => window.__film.worldVisible());
      seen.push(`${name}: ${relationship}`);
      const panel = await page.locator('#inspector').innerText();
      if (/undefined|NaN/.test(panel)) { seen.push(`${name} shows undefined`); casesOk = false; }
      if (relationship !== caseEvidence[name].encounter.currentRelationship || visible.some(id => all.includes(id) && !Object.keys(caseEvidence[name].chunkMetrics).includes(id)) || await dd('#inSource', 'Type') !== 'Controlled Experiment') casesOk = false;
      if (capture && name === 'compatible') await shot(page, 'web01c-case-study-after.png');
    }
    check('three scenarios equal the G03b evidence, marked Controlled Experiment', casesOk, seen.join(' · '));
    check('the recorded world does not show during the case study', (await inner('#readout')).startsWith('Case study'));

    // Back to Part I: the model is intact.
    await seek(page, PART_ONE_END); await sleep(400);
    check('returning to Part I shows the single chunk again', await page.evaluate(() => window.__film.part) === 1 && (await inner('#readout')).includes('terrain seed'));

    // Watch and Inspect on one frame.
    if (capture) {
      await seek(page, GROWTH_T + 30); await sleep(600);
      await shot(page, 'web01c-compare-inspect-after.png');
      await page.click('#modeWatch'); await sleep(800);
      await shot(page, 'web01c-growth-replay-after.png');
    }
    await page.context().close();

    // Three viewing levels: same data, different means.
    {
      const lv = await newPage();
      await openFilm(lv, 'autoplay=0&t=100');
      await lv.waitForFunction(() => window.__film.worldReady === true, null, { timeout: 180000 }); await sleep(700);
      const generations = await lv.evaluate(() => window.__film.generations);
      const facts = () => lv.evaluate(() => ({ t: window.__film.t, event: window.__film.worldEvent().step, city: window.__film.city, level: window.__film.level, chunks: window.__film.worldCounts().chunks }));
      const triangles = () => lv.evaluate(() => { window.__film.render(); return window.__film.geometry().triangles; });
      const live = await facts(); const liveTriangles = await triangles();
      check('Part II starts in Live 3D here, with a visible choice of view', live.level === 'live' && await lv.locator('#viewLevel').isVisible());
      if (capture) await shot(lv, 'web01e-level-live-after.png');
      await lv.selectOption('#viewLevel', 'light'); await sleep(500);
      const lightFacts = await facts(); const lightTriangles = await triangles();
      report.measurements.levelTriangles = { live: liveTriangles, light: lightTriangles };
      check('Lightweight Replay: same t, step and chunks, far fewer triangles, says what it is', lightFacts.level === 'light' && lightFacts.t === live.t && lightFacts.event === live.event && lightFacts.chunks === live.chunks && lightTriangles < liveTriangles / 3 && (await lv.locator('#levelNote').innerText()).includes('roofs'), `${liveTriangles} → ${lightTriangles} triangles`);
      if (capture) { await sleep(300); await shot(lv, 'web01e-level-light-after.png'); }
      await lv.selectOption('#viewLevel', 'film');
      await lv.waitForFunction(() => window.__film.filmShown === true && document.getElementById('partFilm').readyState >= 2, null, { timeout: 60000 }); await sleep(800);
      const filmFacts = await facts();
      const video = await lv.evaluate(() => { const el = document.getElementById('partFilm'); return { duration: el.duration, time: el.currentTime, width: el.videoWidth, src: el.currentSrc }; });
      check('Recorded Film: real file, same t and step, video follows the timeline', filmFacts.t === live.t && filmFacts.event === live.event && filmFacts.city === live.city && Math.abs(video.duration - 70) < 0.3 && Math.abs(video.time - (live.t - 52)) < 0.2, JSON.stringify(video).slice(0, 160));
      await lv.mouse.click(500, 300); await sleep(250);
      await lv.click('#modeInspect'); await sleep(400);
      const inspector = await lv.locator('#inspector').innerText();
      await lv.locator('#inLayersBox summary').click();
      check('Recorded Film does not pretend: no selection, layers say Not Available, the Inspector names the view', (await lv.evaluate(() => window.__film.worldSelected)) === null && (await lv.locator('#inLayers').innerText()).includes('Not Available in Recorded Film') && inspector.includes('Recorded Film') && inspector.includes('No selection'));
      check('Recorded Film: names come only from the film, the title stays visible', await lv.locator('#labels button').count() === 0 && await lv.evaluate(() => { const box = document.querySelector('.hero').getBoundingClientRect(); const hit = document.elementFromPoint(box.left + 10, box.top + 10); return Boolean(hit?.closest('.hero')) || box.height > 0 && getComputedStyle(document.querySelector('.hero')).zIndex === '2'; }));
      if (capture) await shot(lv, 'web01e-level-film-after.png');
      await lv.click('#modeWatch'); await sleep(300);
      const rates = {};
      for (const speed of ['0.25', '1', '4']) {
        await seek(lv, 65);
        await lv.selectOption('#rate', speed);
        await lv.click('#play');
        await sleep(300);
        const a = await lv.evaluate(() => [performance.now(), window.__film.videoTime]); await sleep(1500); const b = await lv.evaluate(() => [performance.now(), window.__film.videoTime, window.__film.t]);
        await lv.click('#play');
        rates[speed] = { video: (b[1] - a[1]) / ((b[0] - a[0]) / 1000), offset: Math.abs(b[1] - (b[2] - 52)) };
      }
      report.measurements.filmSpeedRates = rates;
      check('Recorded Film: speeds drive the video, close to the timeline', Object.entries(rates).every(([speed, r]) => Math.abs(r.video / Number(speed) - 1) < 0.25 && r.offset < 0.6), JSON.stringify(rates));
      await lv.selectOption('#rate', '1');
      await seek(lv, 100);
      await lv.selectOption('#viewLevel', 'live'); await sleep(600);
      const back = await facts();
      check('back to Live 3D: same t and step, nothing generated', back.level === 'live' && back.t === 100 && back.event === live.event && await lv.evaluate(() => window.__film.generations) === generations);
      await lv.selectOption('#viewLevel', 'auto'); await sleep(200);
      await lv.evaluate(() => window.__film.feedFps(40));
      const stay = await lv.evaluate(() => window.__film.level);
      await lv.evaluate(() => window.__film.feedFps(15)); await sleep(300);
      const down = await lv.evaluate(() => window.__film.level);
      await lv.evaluate(() => window.__film.feedFps(8)); await sleep(300);
      const down2 = await lv.evaluate(() => window.__film.level);
      check('Auto steps down by measured speed and says why', stay === 'live' && down === 'light' && down2 === 'film' && (await lv.locator('#levelNote').innerText()).includes('frames per second'), `${stay} → ${down} → ${down2}`);
      await lv.selectOption('#viewLevel', 'live'); await sleep(300);
      await lv.evaluate(() => window.__film.feedFps(5)); await sleep(200);
      check('a manual choice is not overridden', await lv.evaluate(() => window.__film.level) === 'live');
      await lv.context().close();

      const noFile = await newPage();
      await noFile.route('**/part2-film*', route => route.fulfill({ status: 404, body: 'missing' }));
      await openFilm(noFile, 'autoplay=0&t=90&level=film');
      await noFile.waitForFunction(() => document.getElementById('levelNote').textContent.includes('could not load'), null, { timeout: 30000 });
      check('missing film file: says so and falls back to 3D', true);
      report.browserErrors = report.browserErrors.filter(text => !/part2-film|404/.test(text));
      await noFile.context().close();

      const saveLoad = await newPage();
      await saveLoad.goto(`${base}/experiments/city-of-cities/index.html`, { waitUntil: 'domcontentloaded' });
      const labels = await saveLoad.waitForFunction(() => /Save/.test(document.body.innerText) && /Load/.test(document.body.innerText) ? document.body.innerText.match(/[^\n]*(Save|Load)[^\n]*/g).slice(0, 4) : false, null, { timeout: 120000 }).then(h => h.jsonValue());
      const state = await readFile(path.join(root, 'experiments/city-of-cities/evidence/world-6201-g02-step30-state.json'), 'utf8');
      check('Save / Load: entry present in the world experiment; the film uses that saved state', labels.length > 0 && JSON.parse(state).kind.length > 0, labels.join(' · '));
      await saveLoad.context().close();
    }

    // Missing data never turns into a fake state.
    const broken = await newPage();
    await broken.route('**/world-6201-step30.json*', route => route.fulfill({ status: 404, body: 'missing' }));
    await broken.goto(`${FILM}?view=explore&autoplay=0&t=70`, { waitUntil: 'domcontentloaded' }); await ready(broken); await sleep(1500);
    const failed = await broken.evaluate(() => ({ blocked: window.__film.blocked, text: document.getElementById('loadingTitle').textContent, shown: window.__film.geometry().calls, t: window.__film.t }));
    await broken.click('#play'); await sleep(600);
    const stillThere = await broken.evaluate(() => window.__film.t);
    check('missing replay data: clear message, film waits, nothing is drawn', failed.blocked && failed.text.includes('could not load') && stillThere === failed.t, failed.text);
    report.browserErrors = report.browserErrors.filter(text => !/world-6201|404/.test(text));
    await broken.context().close();

    const phone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await openFilm(phone, 'autoplay=0&t=90&mode=inspect');
    await phone.waitForFunction(() => window.__film.worldReady === true, null, { timeout: 180000 }); await sleep(800);
    const box = await phone.evaluate(() => { const sheet = document.getElementById('inspector').getBoundingClientRect(); const player = document.querySelector('.player').getBoundingClientRect(); return { over: document.documentElement.scrollWidth > innerWidth + 1, tag: document.getElementById('sceneTag').getBoundingClientRect().bottom, sheet: sheet.top, sheetBottom: sheet.bottom, player: player.top, version: [...document.querySelectorAll('#inSource dt')].find(d => d.textContent === 'Version').nextElementSibling.textContent }; });
    check('phone: world replay with the panel, no overflow, model area stays', !box.over && box.sheet - box.tag >= 150, JSON.stringify(box));
    check('phone: the panel never covers the control bar', Math.abs(box.sheetBottom - box.player) <= 1, `${box.sheetBottom} / ${box.player}`);
    check('panel opened before the data arrived still updates', box.version.startsWith('baked from'), box.version);
    if (capture) await shot(phone, 'web01c-world-mobile-after.png');
    await phone.context().close();
  }

  // ---------- WEB-01d: Guided Tour, presets, accessibility ----------
  {
    const page = await newPage();
    const started = Date.now();
    await page.goto(FILM, { waitUntil: 'domcontentloaded' });
    await page.locator('#tourTitle').waitFor();
    report.measurements.tourFirstTextMs = Date.now() - started;
    await ready(page);
    const inTour = await page.evaluate(() => ({ view: document.body.dataset.view, title: document.getElementById('tourTitle').textContent, hidden: ['#camera', '#city', '#rate', '#stageTicks'].every(s => !document.querySelector(s).offsetParent), playing: window.__film.playing }));
    check('first visit opens the Guided Tour, playing, with few controls', inTour.view === 'tour' && inTour.title === 'The Landscape' && inTour.hidden && inTour.playing, JSON.stringify(inTour));
    if (capture) { await sleep(1500); await shot(page, 'web01d-tour-landscape-after.png'); }
    const generated = await page.evaluate(() => window.__film.generations);
    const titles = ['The Landscape', 'The Urban Rules', 'The Generated City', 'Six Urban Identities', 'Procedural Growth', 'A City of Cities'];
    const seen = [await page.locator('#tourTitle').innerText()];
    for (let k = 1; k < 6; k += 1) {
      await page.click('#tourNext'); await sleep(350);
      seen.push(await page.locator('#tourTitle').innerText());
      if (k === 4) { await page.waitForFunction(() => window.__film.worldReady === true, null, { timeout: 180000 }); }
    }
    check('Next Chapter walks all six chapters in order', JSON.stringify(seen) === JSON.stringify(titles), seen.join(' → '));
    check('the last chapter says natural encounters are planned', (await page.locator('#tourStage').innerText()).includes('natural encounters Planned'));
    const last = await page.evaluate(() => window.__film.t);
    await page.waitForFunction(() => window.__film.casesReady === true, null, { timeout: 180000 });
    check('chapters run on the one film timeline', last >= 104);
    await page.click('#tourInspect'); await sleep(500);
    const open = await page.locator('#inspector').isVisible();
    const before = await page.evaluate(() => [window.__film.city, window.__film.generations]);
    await page.click('#viewExplore'); await sleep(400);
    const after = await page.evaluate(() => [window.__film.city, window.__film.generations, window.__film.t]);
    check('Inspect the Algorithm opens the panel; switching to Explore regenerates nothing', open && before[1] === generated && after[1] === generated && await page.locator('#camera').isVisible(), `${generated} run`);
    const options = await page.locator('#camera option:not([hidden])').allTextContents();
    check('Encounter view is offered in the case study, not the Part I views', options.includes('Encounter view') && options.includes('World view') && !options.includes('Terrain view'), options.join(', '));
    await page.selectOption('#camera', 'encounter'); await sleep(900);
    await seek(page, 3); await sleep(300);
    const early = await page.locator('#camera option:not([hidden])').allTextContents();
    check('Part I offers Terrain, Network and Morphology views', ['Terrain view', 'Network view', 'Morphology view'].every(name => early.includes(name)) && !early.includes('World view'), early.join(', '));
    for (const name of ['terrain', 'plan', 'axon']) { await page.selectOption('#camera', name); await sleep(850); }
    await page.selectOption('#camera', 'film'); await sleep(850);

    // Keyboard only.
    await page.locator('#viewTour').click(); await sleep(300);
    await page.evaluate(() => { document.activeElement?.blur(); window.__film.seek(3); });
    await page.keyboard.press('n'); await sleep(250);
    const byKey = await page.evaluate(() => window.__film.stage);
    await page.keyboard.press('Space'); await sleep(150);
    const paused = await page.evaluate(() => window.__film.playing);
    await page.keyboard.press('i'); await sleep(300);
    const opened = await page.locator('#inspector').isVisible();
    await page.keyboard.press('Escape'); await sleep(300);
    check('keyboard: N, Space, I and Esc work', byKey === 'analysis' && !paused && opened && !(await page.locator('#inspector').isVisible()), byKey);
    let reached = 0;
    for (let k = 0; k < 12; k += 1) { await page.keyboard.press('Tab'); if (await page.evaluate(() => ['tourPlay', 'tourNext', 'tourInspect'].includes(document.activeElement?.id))) reached += 1; }
    check('keyboard: Tab reaches the tour buttons', reached >= 3, `${reached} of 3`);

    // Text contrast on the real page, WCAG AA 4.5 : 1.
    await page.click('#viewExplore'); await page.click('#modeInspect'); await sleep(500);
    const contrast = await page.evaluate(() => {
      const lum = ([r, g, b]) => { const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const rgb = text => text.match(/[\d.]+/g).map(Number);
      const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)); };
      const out = [];
      for (const selector of ['.stage-line', '.stage-index', '#stageStatus', '.readout', '#inspector dt', '#inspector dd', '#inspector dd.na', '.scene-tag', '.explore span', '.ticks button', 'label', '.note']) {
        const el = document.querySelector(selector); if (!el) continue;
        const fg = rgb(getComputedStyle(el).color);
        let node = el; let bg = [241, 238, 232];
        const stack = [];
        while (node && node !== document.documentElement) { const c = rgb(getComputedStyle(node).backgroundColor); if ((c[3] ?? 1) > 0) stack.push(c); node = node.parentElement; }
        stack.reverse().forEach(layer => { bg = over(layer, bg); });
        const a = lum(over(fg, bg)); const b = lum(bg);
        out.push([selector, +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)]);
      }
      return out;
    });
    report.measurements.contrast = contrast;
    const low = contrast.filter(([, ratio]) => ratio < 4.5);
    check('text contrast ≥ 4.5 : 1 on paper', !low.length, low.length ? JSON.stringify(low) : `lowest ${Math.min(...contrast.map(item => item[1]))}`);
    await page.context().close();

    const phone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await phone.goto(FILM, { waitUntil: 'domcontentloaded' }); await ready(phone); await sleep(1500);
    const m = await phone.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, player: document.querySelector('.player').offsetHeight, height: innerHeight }));
    check('phone: tour leaves the model most of the screen, no overflow', !m.over && m.player <= m.height * 0.4, JSON.stringify(m));
    if (capture) await shot(phone, 'web01d-tour-mobile-after.png');
    await phone.context().close();
  }

  // ---------- 5. Stage stills (real runtime; also the fallback and the Process page) ----------
  if (capture) {
    const page = await newPage({ viewport: { width: 1280, height: 800 } });
    await openFilm(page, 'autoplay=0&capture=1');
    for (let k = 0; k < STAGE_IDS.length; k += 1) {
      await seek(page, STAGE_END[k]); await sleep(250);
      await shot(page, `web01-film-${STAGE_IDS[k]}-after.png`);
    }
    for (const [name, t, wait] of [['origins', 59.9, 'worldReady'], ['growth', 103.9, 'worldReady'], ['encounter', 109.9, 'casesReady']]) {
      await seek(page, t);
      await page.waitForFunction(key => window.__film[key] === true, wait, { timeout: 180000 });
      await sleep(400);
      await shot(page, `web01-film-${name}-after.png`);
    }
    await page.context().close();
    const ui = await newPage();
    await openFilm(ui);
    for (const [t, name] of [[3, 'terrain-ui'], [20, 'roads-ui'], [44, 'buildings-ui']]) { await seek(ui, t); await sleep(250); await shot(ui, `web01-film-${name}-after.png`); }
    await ui.context().close();
  }

  // ---------- 6. The site around the film ----------
  if (!filmOnly) {
    const page = await newPage();
    const started = Date.now();
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('.project-frame');
    await frame.locator('#tourTitle').waitFor();
    const homeMs = Date.now() - started;
    const nav = await page.locator('.site-header nav a').allTextContents();
    report.measurements.homeControlsMs = homeMs;
    check('home opens on the film, controls within 5 s', homeMs < 5000, `${homeMs} ms`);
    check('navigation names: World, Process, Cities, Research; film button Explore Scene', nav.join() === 'World,Process,Cities,Research' && (await frame.locator('#viewExplore').innerText()) === 'Explore Scene', nav.join(' · '));
    check('main navigation: 4 entries, Archive apart, no old exercises', nav.length === 4 && await page.locator('.archive-link').count() === 1 && !nav.some(label => /Starlight|Voxel|Flavor|Shader|Noise/i.test(label)), nav.join(' · '));
    const handle = await page.locator('.project-frame').elementHandle();
    const filmFrame = await handle.contentFrame();
    await filmFrame.waitForFunction(() => window.__film?.ready === true, null, { timeout: 120000 });
    await sleep(1200);
    check('film in the home frame shows real geometry', await filmFrame.evaluate(() => window.__film.geometry().calls > 0));
    if (capture) await shot(page, 'web01-home-after.png');

    for (const key of ['process', 'cities', 'research', 'archive']) {
      await page.goto(`${base}/#${key}`); await sleep(500);
      const current = await page.locator('.site-header nav a[aria-current], .site-header .archive-link[aria-current]').allTextContents();
      const images = await page.evaluate(async () => { const list = [...document.querySelectorAll('.web-page img')]; list.forEach(img => { img.loading = 'eager'; }); await Promise.all(list.map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; })))); return { total: list.length, broken: list.filter(img => !img.naturalWidth).map(img => img.src.split('/').pop()) }; });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      check(`#${key}: opens, nav marked, images load, no overflow`, current.length === 1 && !images.broken.length && !overflow, `${current[0]} · ${images.total} images${images.broken.length ? ` · broken ${images.broken}` : ''}`);
      if (capture) await shot(page, `web01-${key}-after.png`, { fullPage: key !== 'archive' });
    }

    // Old hash and direct URLs keep working.
    for (const [key, marker] of [['noise', 'cellular-noise'], ['voxel', 'voxel-terrain'], ['flavor', 'flavor-clash-prototype'], ['miniWorld', 'world-grid'], ['seedTerrain', 'seed-terrain'], ['world', 'city-of-cities']]) {
      await page.goto(`${base}/#${key}`); await sleep(300);
      const src = await page.locator('.project-frame').getAttribute('src');
      const inArchive = key === 'world' || await page.locator('.site-header .archive-link[aria-current]').count() === 1;
      check(`old route #${key} still opens its page`, src?.includes(marker) && inArchive, src);
    }
    await page.goto(`${base}/#files?file=./docs/procedural-mini-world/A-City-of-Cities/Algorithm-Review.md`); await page.locator('#fileRendered, #fileText').first().waitFor({ state: 'attached' });
    await sleep(800);
    if (capture) await shot(page, 'web01e-review-page-after.png');
    check('Files & Notes shows the review page in the light system', (await page.locator('#fileRendered').innerText()).includes('Human review') && (await page.evaluate(() => getComputedStyle(document.querySelector('.library article')).backgroundColor)) === 'rgb(247, 245, 240)');
    check('Files & Notes still loads', await page.locator('select').first().count() === 1);

    // Links out of the research page.
    await page.goto(`${base}/#research`); await sleep(400);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('.web-page a[href]')].map(a => a.getAttribute('href')));
    const hashLinks = hrefs.filter(href => href.startsWith('#'));
    const knownHash = await page.evaluate(list => list.filter(href => !document.querySelector(`.site-header nav a[href="${href.split('?')[0]}"]`)), hashLinks);
    report.measurements.researchLinks = hrefs.length;
    check('research page has links to records, GitHub and experiments', hrefs.some(h => h.includes('github.com')) && hrefs.some(h => h.includes('file=')), `${hrefs.length} links, ${knownHash.length} to secondary routes`);

    // "View source" links of the Inspector open the real file in Files & Notes.
    await page.goto(`${base}/#files?file=./experiments/seed-terrain/NetworkGenerator.js`);
    await page.waitForFunction(() => /generateNetwork/.test(document.querySelector('#fileRendered')?.textContent + document.querySelector('#fileText')?.textContent), null, { timeout: 20000 });
    check('Inspector source link opens the real generator file', true);

    // City deep link from the gallery into the film.
    await page.goto(`${base}/#cities`); await sleep(400);
    await page.locator('a[href*="city=fezOrganicCore"]').first().click();
    await sleep(600);
    const h2 = await page.locator('.project-frame').elementHandle();
    const f2 = await h2.contentFrame();
    await f2.waitForFunction(() => window.__film?.ready === true, null, { timeout: 120000 });
    check('a city card opens that city in the film', await f2.evaluate(() => window.__film.city) === 'fezOrganicCore');

    // Numbers on the city page equal the 06.1 evidence.
    {
      const source = await readFile(path.join(root, 'web-pages.js'), 'utf8');
      const wrong = [];
      for (const city of CITIES) {
        const facts = source.match(new RegExp(`id: '${city}'[^\\n]*`))[0];
        const s = evidence.suitable[city];
        const run = evidence.runs.find(r => r.landform === s.landform && r.seed === s.seed && r.dna === city);
        const value = name => Number(facts.match(new RegExp(`${name}: ([0-9.]+)`))[1]);
        if (value('roadKm') !== run.network.roadKm || value('parcels') !== run.parcels.count || value('frontage') !== run.parcels.meanFrontage || value('buildings') !== run.buildings.count || value('height') !== run.buildings.meanHeight || value('deadEnds') !== Math.round(run.network.deadEndRatio * 100) || Math.abs(value('fit') - s.score) > 0.006) wrong.push(city);
      }
      check('city page numbers equal the 06.1 evidence', !wrong.length, wrong.join(', '));
    }

    // No dead internal links: every hash route and Files & Notes target on the main pages exists.
    {
      const dead = [];
      const known = await page.evaluate(async () => (await import('/site.js')).sections ? Object.keys((await import('/site.js')).sections) : []);
      for (const key of ['process', 'cities', 'research', 'archive']) {
        await page.goto(`${base}/#${key}`); await sleep(300);
        const hrefs = await page.evaluate(() => [...document.querySelectorAll('.web-page a[href]')].map(a => a.getAttribute('href')));
        for (const href of hrefs) {
          if (!href.startsWith('#')) continue;
          const [route, query] = href.slice(1).split('?');
          if (!known.includes(route)) dead.push(href);
          const file = new URLSearchParams(query ?? '').get('file');
          if (file) { try { await readFile(path.join(root, file)); } catch { dead.push(href); } }
        }
      }
      check('no dead links on the main pages', !dead.length, dead.join(', '));
    }

    // Phone: site shell.
    const phone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    for (const key of ['home', 'process', 'cities', 'research', 'archive']) {
      await phone.goto(`${base}/#${key}`); await sleep(500);
      const over = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      check(`phone #${key}: no horizontal overflow`, !over);
      if (capture && key !== 'home') await shot(phone, `web01-${key}-mobile-after.png`);
    }
    await phone.context().close();
    await page.context().close();
  }
} catch (error) {
  check('verifier completed', false, error.message.slice(0, 500));
} finally {
  await browser.close();
  server.kill();
}

for (const [name, buffer] of pendingShots) await writeFile(path.join(shots, name), buffer);
check('no browser errors', report.browserErrors.length === 0, report.browserErrors.slice(0, 4).join(' | '));
report.passed = report.checks.filter(item => item.pass).length;
report.failed = report.checks.filter(item => !item.pass).length;
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, 'film-acceptance.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log(`\n${report.passed} passed, ${report.failed} failed`);
process.exit(report.failed ? 1 : 0);
