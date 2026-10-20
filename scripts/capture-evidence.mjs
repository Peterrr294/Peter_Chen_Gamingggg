import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4173;
const baseUrl = `http://${host}:${port}`;

const projects = {
  'shader-basics': {
    page: '/experiments/shader-basics/',
    document: 'docs/learning/shaders/first-shader-experiments.md',
    output: 'docs/assets/screenshots',
    insertBefore: '## Relevant Files',
    captures: [
      { file: 'shader-fixed-color.png', title: 'Experiment A — Fixed Color', experiment: 0,
        values: { fixedColor: '#1748d4' }, alt: 'Shader Basics fixed-color experiment with its plane and uniform control visible',
        shows: 'A single plane rendered by the custom ShaderMaterial while JavaScript exposes the fixed-color uniform.',
        matters: 'This is the minimum visible proof that geometry, the vertex stage, the fragment stage, and the material are connected.',
        conditions: 'Experiment A; uFixedColor #1748d4; one PlaneGeometry; animation paused before capture.' },
      { file: 'shader-uv-gradient.png', title: 'Experiment B — UV Gradient', experiment: 1,
        values: { uvMode: '2' }, alt: 'Shader Basics UV experiment showing U and V mapped to red and green',
        shows: 'The plane maps interpolated U and V values to the red and green color channels.',
        matters: 'The corner colors make the direction and 0–1 range of geometry UV coordinates directly visible.',
        conditions: 'Experiment B; U + V mode; default plane and camera; animation paused before capture.' },
      { file: 'shader-repeat-grid.png', title: 'Experiment C — Repeated Grid', experiment: 2,
        values: { gridFocus: 'repeatX', repeatX: '12' }, alt: 'Shader Basics procedural grid with Repeat X set to twelve',
        shows: 'A procedural grid produced from repeated UV cells while the active Repeat X control remains visible.',
        matters: 'Changing one repeat value demonstrates that fract creates repetition without loading an image texture.',
        conditions: 'Experiment C; Repeat X 12; Repeat Y 6; line width 0.060; hard step edge; animation paused before capture.' },
      { file: 'shader-uniform-mix.png', title: 'Experiment D — Uniform Color Mix', experiment: 3,
        values: { colorA: '#1748d4', colorB: '#ff5a36', mixAmount: '0.35' }, alt: 'Shader Basics uniform experiment mixing blue and orange across the plane',
        shows: 'Two JavaScript colors and one mix amount control the fragment result without replacing the plane.',
        matters: 'Uniforms change shader input for existing geometry and can still combine with per-fragment UV values.',
        conditions: 'Experiment D; uColorA #1748d4; uColorB #ff5a36; uMixAmount 0.35; animation paused before capture.' },
      { file: 'shader-coordinate-uv.png', title: 'Experiment E1 — UV Coordinates', experiment: 4,
        values: { coordinateMode: '0', planeX: '0', cameraX: '0' }, alt: 'Shader Basics coordinate comparison in UV mode',
        shows: 'The coordinate experiment using the plane’s 0–1 UV values.',
        matters: 'This is the object-attached baseline for local, world, and screen-coordinate comparison.',
        conditions: 'Experiment E; UV coordinates; Plane X 0.00; Camera X 0.00; animation paused before capture.' },
      { file: 'shader-coordinate-local.png', title: 'Experiment E2 — Local Position', experiment: 4,
        values: { coordinateMode: '1', planeX: '1', cameraX: '0' }, alt: 'Shader Basics local-position mode with the plane moved right',
        shows: 'The local-position pattern remains attached to the plane after the object moves along world X.',
        matters: 'It separates coordinates stored on the geometry from the object’s later world transform.',
        conditions: 'Experiment E; Local position; Plane X 1.00; Camera X 0.00; animation paused before capture.' },
      { file: 'shader-coordinate-world.png', title: 'Experiment E3 — World Position', experiment: 4,
        values: { coordinateMode: '2', planeX: '1', cameraX: '0' }, alt: 'Shader Basics world-position mode with the plane moved right',
        shows: 'The world-position pattern is evaluated after the plane is translated in the scene.',
        matters: 'World space is relevant for patterns intended to continue across separate terrain chunks.',
        conditions: 'Experiment E; World position; Plane X 1.00; Camera X 0.00; animation paused before capture.' },
      { file: 'shader-coordinate-screen.png', title: 'Experiment E4 — Screen Coordinates', experiment: 4,
        values: { coordinateMode: '3', planeX: '0', cameraX: '1.25' }, alt: 'Shader Basics screen-coordinate mode with the camera moved right',
        shows: 'The fragment pattern is derived from gl_FragCoord while the camera is offset.',
        matters: 'It distinguishes viewport-relative pixels from coordinates belonging to geometry or world space.',
        conditions: 'Experiment E; Screen coordinates; Plane X 0.00; Camera X 1.25; animation paused before capture.' },
    ],
  },
};

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function serverReady(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
async function startVite(url) {
  if (await serverReady(url)) return null;
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', `${port}`, '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await serverReady(url)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}
async function chromePath() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome/Edge was not found. Set PLAYWRIGHT_CHROME_PATH to its full path.');
}
async function setControl(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function prepare(page, capture) {
  await page.locator('#resetButton').click();
  await page.locator(`[data-experiment="${capture.experiment}"]`).click();
  for (const [id, value] of Object.entries(capture.values)) await setControl(page, id, value);
  await page.waitForFunction(() => !document.querySelector('#frameReadout')?.textContent?.startsWith('FRAME 0000'));
  await page.locator('#pauseButton').click();
  await page.waitForFunction(() => document.querySelector('#runState')?.textContent === 'PAUSED');
  await page.waitForTimeout(150);
}
function captureId(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}-${String(date.getMilliseconds()).padStart(3, '0')}`;
}
function evidenceRun(project, capturedAt, runId) {
  const sections = project.captures.map(item => `**${item.title}**\n\n![${item.alt}](../../assets/screenshots/shader-basics/${runId}/${item.file})\n\n**What this shows:** ${item.shows}\n\n**Why it matters:** ${item.matters}\n\n**Parameters or conditions:** ${item.conditions}\n\n> Observation to complete after testing:\n>\n> Write what you personally noticed in this captured state.`).join('\n\n');
  return `### Capture Run — ${capturedAt}\n\n> Created by \`npm run evidence:shader\`. Archive ID: \`${runId}\`. This run is appended rather than replacing earlier evidence.\n\n${sections}`;
}
async function updateDocument(project, capturedAt, runId) {
  const file = path.join(root, project.document);
  const original = await readFile(file, 'utf8');
  const startMarker = '<!-- evidence-capture:shader-basics:start -->';
  const endMarker = '<!-- evidence-capture:shader-basics:end -->';
  const generated = evidenceRun(project, capturedAt, runId);
  let updated;
  if (original.includes(startMarker) && original.includes(endMarker)) {
    const end = original.indexOf(endMarker);
    updated = `${original.slice(0, end).trimEnd()}\n\n${generated}\n${original.slice(end)}`;
  } else {
    const point = original.indexOf(project.insertBefore);
    if (point < 0) throw new Error(`Missing insertion heading in ${project.document}`);
    const block = `${startMarker}\n${generated}\n${endMarker}`;
    updated = `${original.slice(0, point)}## Captured Evidence\n\n${block}\n\n${original.slice(point)}`;
  }
  await writeFile(file, updated, 'utf8');
}
async function run(key) {
  const project = projects[key];
  if (!project) throw new Error(`Unknown target "${key}". Choose: ${Object.keys(projects).join(', ')}`);
  const url = baseUrl + project.page;
  const output = path.join(root, project.output);
  const capturedDate = new Date();
  const runId = captureId(capturedDate);
  const runOutput = path.join(output, key, runId);
  await mkdir(runOutput, { recursive: true });
  const server = await startVite(url);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: await chromePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#shaderCanvas').waitFor({ state: 'visible' });
    for (const capture of project.captures) {
      await prepare(page, capture);
      await page.locator('.workspace').screenshot({ path: path.join(runOutput, capture.file), animations: 'disabled' });
      console.log(`Captured ${path.posix.join(project.output, key, runId, capture.file)}`);
    }
    if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
    const capturedAt = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/New_York' }).format(capturedDate);
    await updateDocument(project, capturedAt, runId);
    console.log(`Updated ${project.document}`);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
}
run(process.argv[2] ?? 'shader-basics').catch(error => { console.error(error.message); process.exitCode = 1; });