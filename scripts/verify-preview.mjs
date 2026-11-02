// WEB-01e: checks a deployed copy of the site in real Chrome at its public address.
// Usage: node scripts/verify-preview.mjs <url> [--low-end]   Evidence: experiments/procedural-film/evidence/preview-verification.json
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2].replace(/\/$/, '');
const FILM = `${base}/experiments/procedural-film/index.html`;
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const report = { base, at: new Date().toISOString(), checks: [], errors: [], timings: {} };
const check = (name, pass, detail = '') => { report.checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ·  ${detail}` : ''}`); };
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const open = async options => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) report.errors.push(m.text().slice(0, 200)); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) report.errors.push(`${r.status()} ${r.url()}`); });
  return page;
};
const ready = page => page.waitForFunction(() => window.__film?.ready === true, null, { timeout: 180000 });

try {
  // Home: fresh visitor.
  const page = await open();
  let started = Date.now();
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const handle = await page.locator('.project-frame').elementHandle({ timeout: 30000 });
  const frame = await handle.contentFrame();
  await frame.locator('#tourTitle').waitFor();
  report.timings.tourTextMs = Date.now() - started;
  await frame.waitForFunction(() => window.__film?.ready === true, null, { timeout: 180000 });
  report.timings.firstModelMs = Date.now() - started;
  const nav = await page.locator('.site-header nav a').allTextContents();
  check('home: Guided Tour with real geometry', await frame.evaluate(() => window.__film.geometry().calls > 0 && document.body.dataset.view === 'tour'), `${report.timings.firstModelMs} ms to the model`);
  check('navigation names', nav.join() === 'World,Process,Cities,Research', nav.join(' · '));
  await sleep(2500);
  await page.screenshot({ path: path.join(shots, 'web01e-preview-home-after.png') });

  // Part I, speeds.
  const film = await open();
  await film.goto(`${FILM}?view=explore&autoplay=0&t=20`, { waitUntil: 'domcontentloaded' }); await ready(film);
  const signature = await film.evaluate(() => window.__film.signatures());
  const evidence = JSON.parse(await readFile(path.join(root, 'experiments/seed-terrain/evidence/city-dna-comparison.json'), 'utf8')).runs.find(r => r.landform === 'coast' && r.seed === 2202 && r.dna === 'lisbonHillCore');
  check('Part I: generated on the public site, equal to the verified signatures', ['network', 'blocks', 'parcels', 'buildings'].every(key => signature[key] === evidence.signatures[key]), `${signature.network} ${signature.buildings}`);
  const rates = {};
  for (const speed of ['0.25', '0.5', '1', '1.5', '2', '4']) {
    await film.evaluate(() => window.__film.seek(5));
    await film.selectOption('#rate', speed); await film.click('#play');
    const a = await film.evaluate(() => [performance.now(), window.__film.t]); await sleep(1200); const b = await film.evaluate(() => [performance.now(), window.__film.t]);
    await film.click('#play');
    rates[speed] = +((b[1] - a[1]) / ((b[0] - a[0]) / 1000)).toFixed(3);
  }
  check('six speeds work', Object.entries(rates).every(([speed, rate]) => Math.abs(rate / Number(speed) - 1) < 0.15), JSON.stringify(rates));
  await film.selectOption('#rate', '1');

  // Part II, all levels, timing of the large files over the network.
  started = Date.now();
  await film.evaluate(() => window.__film.seek(100));
  await film.waitForFunction(() => window.__film.worldReady === true, null, { timeout: 300000 });
  report.timings.worldReplayLoadMs = Date.now() - started;
  await sleep(800);
  const saved = JSON.parse(await readFile(path.join(root, 'experiments/city-of-cities/evidence/world-6201-g02-step30-state.json'), 'utf8'));
  const event = await film.evaluate(() => window.__film.worldEvent());
  check('Part II: replay loads, event equals the saved history', event.chunk === saved.growth.history[event.step - 1].newChunkId, `step ${event.step}, ${report.timings.worldReplayLoadMs} ms to load`);
  await film.click('#modeInspect'); await sleep(500);
  check('Inspector: data source and values load', (await film.locator('#inSource').innerText()).includes('Recorded Simulation') && (await film.locator('#inParams').innerText()).includes(event.chunk));
  await film.selectOption('#viewLevel', 'light'); await sleep(500);
  check('Lightweight Replay available', await film.evaluate(() => window.__film.level) === 'light');
  started = Date.now();
  await film.selectOption('#viewLevel', 'film');
  await film.waitForFunction(() => document.getElementById('partFilm').readyState >= 2, null, { timeout: 120000 });
  report.timings.filmFirstFrameMs = Date.now() - started;
  const video = await film.evaluate(() => { const el = document.getElementById('partFilm'); return { duration: el.duration, width: el.videoWidth }; });
  check('Recorded Film: the deployed file plays', Math.abs(video.duration - 70) < 0.3 && video.width === 1280, `${report.timings.filmFirstFrameMs} ms to the first frame`);
  await sleep(600);
  await film.screenshot({ path: path.join(shots, 'web01e-preview-film-after.png') });
  await film.selectOption('#viewLevel', 'live');

  // Case study.
  await film.evaluate(() => window.__film.seek(109.9));
  await film.waitForFunction(() => window.__film.casesReady === true, null, { timeout: 300000 }); await sleep(600);
  check('Encounter marked Controlled Experiment', (await film.locator('#sceneTag').innerText()).startsWith('Controlled Experiment') && (await film.locator('#inSource').innerText()).includes('Controlled Experiment'));
  await film.screenshot({ path: path.join(shots, 'web01e-preview-case-after.png') });

  // Site pages and links.
  for (const key of ['process', 'cities', 'research', 'archive']) {
    await page.goto(`${base}/#${key}`); await sleep(600);
    const images = await page.evaluate(async () => { const list = [...document.querySelectorAll('.web-page img')]; list.forEach(img => { img.loading = 'eager'; }); await Promise.all(list.map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; })))); return { total: list.length, broken: list.filter(img => !img.naturalWidth).length }; });
    check(`#${key} loads`, !images.broken, `${images.total} images`);
  }
  for (const [key, marker] of [['noise', 'cellular-noise'], ['voxel', 'voxel-terrain'], ['flavor', 'flavor-clash-prototype'], ['miniWorld', 'world-grid'], ['world', 'city-of-cities']]) {
    await page.goto(`${base}/#${key}`); await sleep(250);
    check(`old route #${key}`, (await page.locator('.project-frame').getAttribute('src')).includes(marker));
  }
  await page.goto(`${base}/#files?file=./docs/procedural-mini-world/A-City-of-Cities/Algorithm-Review.md`);
  await page.waitForFunction(() => /Human review/.test(document.querySelector('#fileRendered')?.textContent ?? ''), null, { timeout: 30000 });
  check('review page and Files & Notes load', true);

  // Phone.
  const phone = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await phone.goto(`${FILM}?autoplay=0`, { waitUntil: 'domcontentloaded' }); await ready(phone); await sleep(800);
  check('phone layout: no overflow', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phone.screenshot({ path: path.join(shots, 'web01e-preview-mobile-after.png') });

  // Nothing local-only is served. The host answers unknown paths with the site (rewrite), so a file counts as exposed only if its real content comes back.
  const exposed = [];
  for (const file of ['.env', '.firebaserc', 'firebase-debug.log', 'website-submission.zip', 'AGENTS.md', 'presentation/city-of-cities/A-City-of-Cities.mp4']) {
    const response = await fetch(`${base}/${file}`);
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && !type.includes('text/html')) exposed.push(file);
  }
  check('local-only files are not served', !exposed.length, exposed.join(', '));
} catch (error) {
  check('verification completed', false, error.message.slice(0, 400));
} finally { await browser.close(); }
check('no browser errors or failed requests', !report.errors.length, report.errors.slice(0, 5).join(' | '));
report.passed = report.checks.filter(c => c.pass).length; report.failed = report.checks.length - report.passed;
await writeFile(path.join(root, 'experiments/procedural-film/evidence/preview-verification.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log(`${report.passed} passed, ${report.failed} failed`, JSON.stringify(report.timings));
process.exit(report.failed ? 1 : 0);
