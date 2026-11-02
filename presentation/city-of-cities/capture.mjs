// A City of Cities — film capture (PRESENTATION-01).
// Starts Vite, opens presentation/city-of-cities/, builds the real seed-6201 world (G01 origins + 30 verified G02
// growth steps), checks the growth history against the G02 verifier record, renders every frame deterministically
// and encodes H.264 MP4 in Chrome (WebCodecs + mp4-muxer). Then the saved MP4 is decoded by Chrome to verify it and
// to extract the storyboard stills. Usage: node presentation/city-of-cities/capture.mjs [--stills-only]
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const host = '127.0.0.1'; const port = 4221; const base = `http://${host}:${port}`; const entry = '/presentation/city-of-cities/';
const out = { mp4: path.join(here, 'A-City-of-Cities.mp4'), poster: path.join(here, 'poster.png'), stills: path.join(here, 'storyboard'), config: path.join(here, 'capture-config.json') };
const stillsOnly = process.argv.includes('--stills-only');
const assert = (c, m) => { if (!c) throw new Error(m); };
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
const savePng = async (file, dataUrl) => writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
let browser;
try {
  for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) { if (server.exitCode !== null) throw new Error(`Vite stopped\n${log}`); await new Promise(r => setTimeout(r, 250)); }
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
  let executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  for (const c of chrome) if (!executablePath && await exists(c)) executablePath = c;
  browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-precise-memory-info'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}${entry}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__film?.ready === true, null, { timeout: 120000 });
  const gpu = await page.evaluate(() => window.__film.gpu());
  console.log(`renderer: ${gpu}`);

  // 1. Build the real world.
  const prep = await page.evaluate(() => window.__film.prepare());
  console.log(`prepared ${prep.chunks} chunks in ${prep.ms} ms (focus ${prep.focusChunk}, close-up ${prep.closeChunk})`);

  // 2. The film's growth must be the verified G02 history (seed 6201, Node + browser verifier record).
  const record = JSON.parse(await readFile(path.join(root, 'experiments/city-of-cities/evidence/city-growth.json'), 'utf8'));
  const verified = record.node['6201'].steps.map(s => `${s.step}:${s.chunkId}:${s.cityId}<${s.parent}:${s.score}:${s.buildings}`);
  const filmed = prep.history.map(s => `${s.step}:${s.chunkId}:${s.cityId}<${s.parent}:${s.score}:${s.buildings}`);
  assert(JSON.stringify(filmed) === JSON.stringify(verified), 'film growth history differs from the verified G02 record');
  console.log('growth history = verified G02 record (30 / 30 steps)');

  // 3. Frame cost and storyboard stills (rendered frames).
  const t0 = Date.now(); await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__film.renderFrame(55 + i / 30); }); const frameMs = (Date.now() - t0) / 10;
  console.log(`render ≈ ${frameMs.toFixed(0)} ms per frame`);
  await mkdir(out.stills, { recursive: true });
  const STILLS = [[2.4, 'title'], [9, 's01-landscape'], [13.5, 's02-terrain'], [16, 's02-analysis'], [18.6, 's02-roads'], [21.2, 's02-blocks'], [23.8, 's02-parcels'], [27, 's02-buildings'], [32.8, 's03-origins'], [38, 's03-six-cities'], [43, 's04-step00'], [46.2, 's04-step03'], [51.5, 's04-step10'], [61, 's04-step30'], [64, 's05-close'], [73, 's05-final']];
  for (const [t, name] of STILLS) await savePng(path.join(out.stills, `${String(t).padStart(4, '0')}-${name}.png`), await page.evaluate(x => window.__film.still(x), t));
  await savePng(out.poster, await page.evaluate(() => window.__film.still(73)));
  console.log(`${STILLS.length} storyboard stills + poster saved`);

  let encodeInfo = null; let verify = null;
  if (!stillsOnly) {
    // 4. Encode in the page; the MP4 arrives as a download.
    const download = page.waitForEvent('download', { timeout: 3600000 });
    encodeInfo = await page.evaluate(() => window.__film.encode());
    await (await download).saveAs(out.mp4);
    console.log(`encoded ${encodeInfo.frames} frames in ${(encodeInfo.ms / 1000).toFixed(0)} s → ${out.mp4}`);

    // 5. Verify the saved file: container boxes, then decode + play it in Chrome and grab decoded frames.
    const bytes = await readFile(out.mp4);
    const has = s => bytes.includes(Buffer.from(s));
    assert(bytes.subarray(4, 8).toString() === 'ftyp' && has('avc1') && has('avcC') && has('moov') && has('mdat'), 'MP4 container boxes missing');
    const v = await page.evaluate(async src => {
      const video = document.createElement('video'); video.muted = true; video.src = src; document.body.append(video);
      await new Promise((ok, fail) => { video.onloadedmetadata = ok; video.onerror = () => fail(new Error(`decode error ${video.error?.code}`)); });
      const meta = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      await video.play(); await new Promise(r => setTimeout(r, 1500)); meta.playedTo = video.currentTime; video.pause();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d');
      const grabs = [];
      for (const t of [3, 10, 20, 27, 32, 38, 47, 60, 66, 73]) {
        video.currentTime = t; await new Promise(r => { video.onseeked = r; });
        g.drawImage(video, 0, 0); const px = g.getImageData(960, 540, 1, 1).data;
        grabs.push({ t, url: c.toDataURL('image/jpeg', 0.85), centre: [...px.slice(0, 3)] });
      }
      return { ...meta, grabs };
    }, `${entry}A-City-of-Cities.mp4`); // no query string: Vite reserves ?v= for its dependency cache
    await mkdir(path.join(out.stills, 'decoded-from-mp4'), { recursive: true });
    for (const g of v.grabs) await writeFile(path.join(out.stills, 'decoded-from-mp4', `mp4-${String(g.t).padStart(2, '0')}s.jpg`), Buffer.from(g.url.split(',')[1], 'base64'));
    verify = { duration: +v.duration.toFixed(3), width: v.width, height: v.height, aspect: +(v.width / v.height).toFixed(4), playedTo: +v.playedTo.toFixed(2), fileMB: +((await stat(out.mp4)).size / 1048576).toFixed(1), decodedFrames: v.grabs.map(g => g.t) };
    assert(v.width === 1920 && v.height === 1080 && v.duration >= 60 && v.duration <= 80 && v.playedTo > 0.5, `MP4 check failed ${JSON.stringify(verify)}`);
    console.log(`MP4 verified: ${JSON.stringify(verify)}`);
  }

  const config = {
    task: 'PRESENTATION-01', title: 'A CITY OF CITIES', subtitle: 'The Emergence of a Plural Urban World through Procedural Growth',
    createdAt: new Date().toISOString(), source: { branch: 'experiment/procedural-growing-world', commit: '91efb1e', page: entry, generators: 'unchanged experiments/seed-terrain chain via experiments/city-of-cities WorldContext + WorldGrowthController (G01 placement v2, G02)' },
    ...(await page.evaluate(() => ({ film: window.__film.config, timeline: window.__film.timeline(), cameras: window.__film.cameraInfo() }))),
    world: { worldSeed: 6201, origins: 6, growthSteps: 30, chunks: prep.chunks, focusChunk: prep.focusChunk, closeUpChunk: prep.closeChunk, historyMatchesVerifiedG02: true, history: prep.history },
    renderer: gpu, renderMsPerFrame: Math.round(frameMs), prepareMs: prep.ms, encode: encodeInfo, verification: verify,
    stills: STILLS.map(([t, n]) => `storyboard/${String(t).padStart(4, '0')}-${n}.png`), browserErrors: errors,
  };
  await writeFile(out.config, `${JSON.stringify(config, null, 2)}\n`);
  assert(!errors.length, `browser errors: ${errors.join('; ')}`);
  console.log('done');
} finally {
  await browser?.close();
  server.kill();
}
