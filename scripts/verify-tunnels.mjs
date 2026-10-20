import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4189;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/03-2-mountain-tunnels-overall.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/03-2-tunnel-xray-profile.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/tunnels.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };

async function browserPath() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found.');
}

async function startServer() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready(`${base}${entry}`)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  const open = async query => {
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true);
  };
  const inspect = () => page.evaluate(async () => {
    const { CONNECTIVITY } = await import('/experiments/seed-terrain/networkStrategies.js');
    const lab = window.__seedTerrainLab;
    const fields = lab.fields();
    const graph = lab.network();
    const rules = CONNECTIVITY.tunnel;
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    // Independent bilinear terrain height and nearest-sample water lookup.
    const heightAt = (x, z) => {
      const gx = Math.min(segments, Math.max(0, (x - originX + half) / spacing));
      const gz = Math.min(segments, Math.max(0, (z - originZ + half) / spacing));
      const x0 = Math.min(segments - 1, Math.floor(gx)); const z0 = Math.min(segments - 1, Math.floor(gz));
      const tx = gx - x0; const tz = gz - z0;
      const h = (r, c) => fields.height[r * columns + c];
      return (h(z0, x0) * (1 - tx) + h(z0, x0 + 1) * tx) * (1 - tz) + (h(z0 + 1, x0) * (1 - tx) + h(z0 + 1, x0 + 1) * tx) * tz;
    };
    const water = (x, z) => fields.waterMask[Math.round((z - originZ + half) / spacing) * columns + Math.round((x - originX + half) / spacing)] === 1;
    const toBoundary = p => Math.min(p.x - (originX - half), originX + half - p.x, p.z - (originZ - half), originZ + half - p.z);
    const roadEdges = graph.edges.filter(edge => edge.kind !== 'canal');
    const components = skip => {
      const parent = new Map();
      const find = id => { if (!parent.has(id)) parent.set(id, id); while (parent.get(id) !== id) id = parent.get(id); return id; };
      roadEdges.filter(edge => edge !== skip).forEach(edge => parent.set(find(edge.from), find(edge.to)));
      return find;
    };
    const tunnels = graph.edges.filter(edge => edge.kind === 'tunnel').map(edge => {
      const [p, q] = edge.tunnel.portals;
      const plan = Math.hypot(q.x - p.x, q.z - p.z);
      const grade = (q.y - p.y) / plan;
      let minCover = Infinity; let daylight = 0; let wet = 0; let inTransition = 0;
      const steps = Math.ceil(plan / 4);
      for (let s = 0; s <= steps; s += 1) {
        const d = plan * s / steps;
        const x = p.x + (q.x - p.x) * s / steps; const z = p.z + (q.z - p.z) * s / steps;
        const roadY = p.y + grade * d;
        const terrain = heightAt(x, z);
        if (water(x, z)) wet += 1;
        if (toBoundary({ x, z }) < lab.stats().transitionWidth) inTransition += 1;
        if (d < rules.portalZone || plan - d < rules.portalZone) { if (terrain < roadY - 0.25) daylight += 1; }
        else minCover = Math.min(minCover, terrain - roadY - rules.clearance);
      }
      const portalNodes = [graph.nodes[edge.from], graph.nodes[edge.to]];
      const surfaceAtPortals = portalNodes.map(node => roadEdges.some(other => other !== edge && other.kind === 'road' && (other.from === node.id || other.to === node.id)));
      const without = components(edge);
      return {
        id: edge.id, plan, grade, minCover, daylight, wet, inTransition,
        portalOffset: Math.max(...[p, q].map(portal => Math.abs(portal.y - heightAt(portal.x, portal.z)))),
        surfaceAtPortals, necessary: without(edge.from) !== without(edge.to),
        recordedMinCover: edge.tunnel.minCover, profile: edge.tunnel.profile, demand: edge.tunnel.demand, alternative: edge.tunnel.alternativeSurface, cost: edge.tunnel.cost, candidates: edge.tunnel.candidates,
        ends: [p, q],
      };
    });
    return { signature: graph.signature, strategy: graph.strategy, stats: graph.stats, decisions: graph.connectivity.decisions, tunnels, analysis: lab.analysis().signature, rules, json: JSON.stringify(graph.edges) };
  });

  const runs = [];
  for (const seed of seeds) {
    for (const dna of ['manhattanGrid', 'fezOrganicCore', 'veniceWaterNetwork']) {
      const id = `mountain ${seed} ${dna}`;
      await open(`landform=mountain&seed=${seed}&dna=${dna}`);
      const first = await inspect();
      await open(`landform=mountain&seed=${seed}&dna=${dna}`);
      const repeat = await inspect();
      const rules = first.rules;
      assert(first.signature === repeat.signature && first.json === repeat.json, `${id}: not reproducible.`);
      assert(first.tunnels.length <= rules.maxPerChunk, `${id}: more than ${rules.maxPerChunk} tunnels.`);
      for (const tunnel of first.tunnels) {
        const tag = `${id} tunnel ${tunnel.id}`;
        assert(tunnel.plan >= rules.minLength - 1e-6 && tunnel.plan <= rules.maxLength + 1e-6, `${tag}: length ${tunnel.plan}.`);
        assert(Math.abs(tunnel.grade) <= rules.maxGrade + 1e-9, `${tag}: grade ${tunnel.grade}.`);
        assert(tunnel.minCover >= rules.minCover - 1e-6, `${tag}: cover ${tunnel.minCover}.`);
        assert(tunnel.daylight === 0 && tunnel.wet === 0 && tunnel.inTransition === 0, `${tag}: daylight/water/transition violation.`);
        assert(tunnel.portalOffset < 0.5, `${tag}: portal not at ground level (${tunnel.portalOffset}).`);
        assert(tunnel.surfaceAtPortals.every(Boolean), `${tag}: a portal is not joined to a surface road.`);
        assert(tunnel.necessary, `${tag}: removing the tunnel does not disconnect anything (meaningless tunnel).`);
        const justified = !tunnel.alternative.feasible || (tunnel.alternative.detourRatio > rules.maxDetourRatio && tunnel.cost < rules.advantage * tunnel.alternative.cost);
        assert(justified, `${tag}: a reasonable surface route existed.`);
      }
      for (let i = 0; i < first.tunnels.length; i += 1) for (let j = i + 1; j < first.tunnels.length; j += 1) {
        const [a, b] = [first.tunnels[i], first.tunnels[j]];
        const near = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) < 50;
        assert(!((near(a.ends[0], b.ends[0]) && near(a.ends[1], b.ends[1])) || (near(a.ends[0], b.ends[1]) && near(a.ends[1], b.ends[0]))), `${id}: duplicate tunnels.`);
      }
      runs.push({ seed, dna, minCoverRule: rules.minCover, strategy: first.strategy, analysis: first.analysis, stats: { roadComponents: first.stats.roadComponents, roadLength: first.stats.roadLength, tunnels: first.stats.tunnels, tunnelLength: first.stats.tunnelLength, mountainConnectors: first.stats.mountainConnectors, ports: first.stats.ports },
        decisions: first.decisions.map(d => ({ demand: d.demand, decision: d.decision, reason: d.reason, surface: d.surface, tunnel: d.tunnel })), tunnels: first.tunnels.map(({ profile, ...rest }) => rest), profile: first.tunnels[0]?.profile ?? null });
    }
    assert(new Set(runs.filter(run => run.seed === seed).map(run => run.analysis)).size === 1, `mountain ${seed}: network changed the terrain analysis.`);
  }
  // Scenario coverage: 0 tunnels, 1 tunnel, and a demand with several feasible tunnel candidates.
  assert(runs.some(run => run.stats.tunnels === 0), 'No run with 0 tunnels.');
  assert(runs.some(run => run.stats.tunnels === 1), 'No run with 1 tunnel.');
  assert(runs.some(run => run.decisions.some(d => (d.tunnel?.feasible ?? 0) > 1)), 'No demand with multiple feasible tunnel candidates.');
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence 1: overall — three mountain seeds. Evidence 2: x-ray slope view + recorded tunnel profile.
  const capture = async query => {
    await open(query);
    await page.waitForTimeout(300);
    return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64');
  };
  const caption = run => `mountain ${run.seed} · ${run.strategy} · tunnels ${run.stats.tunnels} · mountain roads ${run.stats.mountainConnectors} · comp ${run.stats.roadComponents} · ${(run.stats.roadLength / 1000).toFixed(1)} km`;
  const pickRun = (seed, dna) => runs.find(run => run.seed === seed && run.dna === dna);
  const composite = async (html, file, columns) => {
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;color:#edf5f2;font:12px Consolas,monospace;display:grid;grid-template-columns:repeat(${columns},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;background:#081014cc;padding:4px 6px}svg{width:100%;height:auto;background:#0d171b}</style>${html}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const overallRuns = [pickRun(seeds[1], 'manhattanGrid'), pickRun(seeds[0], 'fezOrganicCore'), pickRun(seeds[2], 'manhattanGrid')];
  const overall = [];
  for (const run of overallRuns) overall.push(`<figure><img src="data:image/png;base64,${await capture(`landform=mountain&seed=${run.seed}&dna=${run.dna}`)}"><figcaption>${caption(run)}</figcaption></figure>`);
  await composite(overall.join(''), overallShot, 3);

  const tunnelRun = overallRuns[2].stats.tunnels ? overallRuns[2] : runs.find(run => run.stats.tunnels);
  const xray = await capture(`landform=mountain&seed=${tunnelRun.seed}&dna=${tunnelRun.dna}&view=slope`);
  const profile = tunnelRun.profile;
  const tunnel = tunnelRun.tunnels[0];
  const maxD = profile.at(-1).d;
  const ys = profile.flatMap(point => [point.roadY, point.terrainY]);
  const minY = Math.min(...ys) - 10; const maxY = Math.max(...ys) + 10;
  const sx = d => 40 + (d / maxD) * 640; const sy = y => 300 - ((y - minY) / (maxY - minY)) * 260;
  const line = (key, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${profile.map(point => `${sx(point.d)},${sy(point[key])}`).join(' ')}"/>`;
  const svg = `<svg viewBox="0 0 720 340"><text x="40" y="22" fill="#edf5f2" font-size="13">Recorded tunnel profile · mountain ${tunnelRun.seed} · plan ${tunnel.plan.toFixed(0)} m · grade ${(tunnel.grade * 100).toFixed(2)}% · min cover ${tunnel.minCover.toFixed(1)} m (rule ≥ ${tunnelRun.minCoverRule} m)</text>${line('terrainY', '#c4a26b')}${line('crownY', '#b388ff')}${line('roadY', '#ffe14d')}<text x="40" y="330" fill="#91a2a5" font-size="11">x: distance along tunnel (m) 0–${maxD.toFixed(0)} · y: ${minY.toFixed(0)}–${maxY.toFixed(0)} m · sand terrain · violet crown · yellow road level</text></svg>`;
  await composite(`<figure><img src="data:image/png;base64,${xray}"><figcaption>${caption(tunnelRun)} · slope view · violet dashed x-ray tunnel, yellow portals</figcaption></figure><figure>${svg}</figure>`, debugShot, 2);

  const evidence = { task: '03.2', experiment: entry, testedAt: new Date().toISOString(), runs, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `mountain ${run.seed} ${run.strategy}: tunnels ${run.stats.tunnels} (${run.stats.tunnelLength.toFixed(0)} m) · roads ${run.stats.mountainConnectors} · comp ${run.stats.roadComponents} · ports ${run.stats.ports} · ${run.decisions.map(d => `${d.demand.type}${d.demand.side ? ':' + d.demand.side : ''}=${d.decision}${d.tunnel?.considered ? `(${d.tunnel.feasible}/${d.tunnel.evaluated})` : ''}`).join(' ')}`),
    tunnels: runs.flatMap(run => run.tunnels.map(t => `mountain ${run.seed} ${run.strategy}: plan ${t.plan.toFixed(0)} m, grade ${(t.grade * 100).toFixed(2)}%, min cover ${t.minCover.toFixed(1)} m, necessary ${t.necessary}, alt surface ${t.alternative.feasible ? `detour ${t.alternative.detourRatio.toFixed(2)}` : 'none'}`)),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
