// WEB-01d performance measurements of the film (own Vite server). Two profiles: the local GPU, and a low-end proxy: software WebGL (SwiftShader), CPU slowed 4 ×, 1366 × 768.
// The proxy is not a real device; it shows how the film behaves without a discrete GPU. Evidence: experiments/procedural-film/evidence/film-performance.json
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5195; const FILM = `http://localhost:${PORT}/experiments/procedural-film/index.html`;
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', windowsHide: true });
await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes('Local')) resolve(); }); setTimeout(() => reject(new Error('vite timeout')), 60000); });

const fps = (page, ms) => page.evaluate(duration => new Promise(resolve => {
  let frames = 0; let worst = 0; const start = performance.now(); let last = start;
  const tick = now => { frames += 1; worst = Math.max(worst, now - last); last = now; if (now - start < duration) requestAnimationFrame(tick); else resolve({ fps: +(frames / ((now - start) / 1000)).toFixed(1), worstFrameMs: Math.round(worst) }); };
  requestAnimationFrame(tick);
}), ms);
const heap = page => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));

async function profile(name, args, viewport, cpu) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const out = { name, viewport, cpuSlowdown: cpu };
  const started = Date.now();
  await page.goto(`${FILM}?view=explore&autoplay=0`, { waitUntil: 'domcontentloaded' });
  await page.locator('#stageTitle').waitFor();
  out.controlsVisibleMs = Date.now() - started;
  await page.waitForFunction(() => window.__film?.ready === true, null, { timeout: 300000 });
  out.firstModelMs = Date.now() - started;
  out.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const info = gl?.getExtension('WEBGL_debug_renderer_info'); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  await page.evaluate(() => window.__film.seek(20)); await page.click('#play');
  out.partOneRoads = await fps(page, 4000);
  await page.click('#play');
  await page.evaluate(() => window.__film.seek(40)); await page.click('#play');
  out.partOneBuildings = await fps(page, 4000);
  await page.click('#modeInspect'); await sleep(600);
  out.partOneBuildingsInspect = await fps(page, 4000);
  await page.click('#play');
  await page.click('#modeWatch');
  out.heapPartOneMB = await heap(page);

  // Switching cities: time, and whether GPU objects pile up.
  const geometries = async () => (await page.evaluate(() => window.__film.geometry())).geometries;
  await page.evaluate(() => window.__film.seek(51.9)); await sleep(500);
  const g0 = await geometries();
  const switchFresh = Date.now();
  await page.selectOption('#city', 'chicagoGrid');
  await page.waitForFunction(() => window.__film.city === 'chicagoGrid' && window.__film.ready === true, null, { timeout: 300000 });
  out.citySwitchFreshMs = Date.now() - switchFresh;
  await page.evaluate(() => window.__film.seek(51.9)); await sleep(500);
  const switchCached = Date.now();
  await page.selectOption('#city', 'lisbonHillCore');
  await page.waitForFunction(() => window.__film.city === 'lisbonHillCore' && window.__film.ready === true, null, { timeout: 300000 });
  out.citySwitchCachedMs = Date.now() - switchCached;
  await page.evaluate(() => window.__film.pause?.());
  await page.evaluate(() => window.__film.seek(51.9)); await sleep(500);
  for (let k = 0; k < 3; k += 1) {
    for (const city of ['chicagoGrid', 'lisbonHillCore']) {
      await page.selectOption('#city', city);
      await page.waitForFunction(id => window.__film.city === id && window.__film.ready === true, city, { timeout: 300000 });
      await page.evaluate(() => window.__film.seek(51.9)); await sleep(250);
    }
  }
  out.geometriesAfterSixSwitches = { before: g0, after: await geometries() };

  // Part II, on demand.
  const worldStart = Date.now();
  await page.evaluate(() => window.__film.seek(70));
  await page.waitForFunction(() => window.__film.worldReady === true, null, { timeout: 300000 });
  out.worldWaitAfterSeekMs = Date.now() - worldStart; // the replay starts loading at t = 30, so little is left to wait for here
  await page.selectOption('#rate', '0.25'); // stays inside the growth stage while measuring
  out.worldBreakdown = await page.evaluate(() => window.__film.worldBreakdown());
  for (const level of ['live', 'light', 'film']) {
    await page.selectOption('#viewLevel', level);
    await page.evaluate(() => window.__film.seek(100)); await sleep(1500);
    if (level === 'film') await page.waitForFunction(() => document.getElementById('partFilm').readyState >= 2, null, { timeout: 120000 });
    const triangles = level === 'film' ? 0 : (await page.evaluate(() => { window.__film.render(); return window.__film.geometry(); }));
    await page.click('#play');
    const watch = await fps(page, 3500);
    await page.click('#play');
    await page.click('#modeInspect'); await sleep(500);
    await page.evaluate(() => window.__film.seek(100));
    await page.click('#play');
    const inspect = await fps(page, 3500);
    await page.click('#play');
    await page.click('#modeWatch'); await sleep(300);
    out[`world_${level}`] = { watch, inspect, triangles: triangles.triangles ?? 0, calls: triangles.calls ?? 0 };
  }
  out.heapWorldMB = await heap(page);
  await browser.close();
  console.log(JSON.stringify(out));
  return out;
}

const results = [];
try {
  results.push(await profile('local GPU (RTX 4060, headless)', ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'], { width: 1440, height: 860 }, 1));
  results.push(await profile('low-end proxy (SwiftShader software WebGL, CPU ÷ 4)', ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], { width: 1366, height: 768 }, 4));
} finally { server.kill(); }
await writeFile(path.join(root, 'experiments/procedural-film/evidence/film-performance.json'), `${JSON.stringify({ at: new Date().toISOString(), note: 'Automated headless runs. The second profile is a proxy, not a real device.', results }, null, 1)}\n`);
process.exit(0);
