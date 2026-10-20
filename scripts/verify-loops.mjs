import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4196;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/03-3-loops-network-before-after.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/03-3-loops-blocks-before-after.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/loops.json');
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
    const { STRATEGIES, NETWORK_COMMON } = await import('/experiments/seed-terrain/networkStrategies.js');
    const lab = window.__seedTerrainLab;
    const graph = lab.network();
    const blocks = lab.blocks();
    const fields = lab.fields();
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    const params = STRATEGIES[graph.strategy];
    const roadEdges = graph.edges.filter(edge => edge.kind !== 'canal');
    const nodes = new Set(roadEdges.flatMap(edge => [edge.from, edge.to]));
    const cycles = roadEdges.length - nodes.size + graph.stats.roadComponents;
    const indexAt = (x, z) => Math.round((z - originZ + half) / spacing) * columns + Math.round((x - originX + half) / spacing);
    const toBoundary = p => Math.min(p.x - (originX - half), originX + half - p.x, p.z - (originZ - half), originZ + half - p.z);
    const transitionWidth = lab.stats().transitionWidth;
    const linkIssues = { inTransition: 0, water: 0, steep: 0, tooLong: 0, perimeter: 0, goalOffNetwork: 0 };
    let endpointLinks = 0;
    const nodeAt = new Map(graph.nodes.map(node => [`${Math.round(node.x * 100)}:${Math.round(node.z * 100)}`, node]));
    for (const link of graph.loops?.links ?? []) {
      const interior = link.points.slice(1, -1);
      if (interior.some(p => toBoundary(p) < transitionWidth)) linkIssues.inTransition += 1;
      if (link.points.some(p => fields.waterMask[indexAt(p.x, p.z)])) linkIssues.water += 1;
      if (link.points.some(p => fields.slope[indexAt(p.x, p.z)] > params.maxSlopeDeg)) linkIssues.steep += 1;
      if (link.length > params.loops.maxLinkLength) linkIssues.tooLong += 1;
      if (link.perimeter < params.loops.minPerimeter || link.perimeter > params.loops.maxPerimeter) linkIssues.perimeter += 1;
      // The goal must lie on the network: a junction node, or (when two dead ends were joined) a point on an edge.
      const goal = link.points.at(-1);
      const node = nodeAt.get(`${Math.round(goal.x * 100)}:${Math.round(goal.z * 100)}`);
      const onEdge = roadEdges.some(edge => edge.points.some((b, i) => {
        if (!i) return false;
        const a = edge.points[i - 1]; const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12;
        const t = Math.max(0, Math.min(1, ((goal.x - a.x) * dx + (goal.z - a.z) * dz) / l2));
        // Degree-2 goals sit inside a chain that may be simplified by up to simplifyTolerance.
        return Math.hypot(goal.x - a.x - dx * t, goal.z - a.z - dz * t) <= NETWORK_COMMON.simplifyTolerance + 1e-3;
      }));
      if (!(node && node.degree >= 3) && !onEdge) linkIssues.goalOffNetwork += 1;
      if (!(node && node.degree >= 3)) endpointLinks += 1;
    }
    const s = blocks.stats;
    return {
      strategy: graph.strategy, signature: graph.signature, blocksSignature: blocks.signature,
      cycles, deadEndRatio: graph.stats.deadEndRatio, roadLength: graph.stats.roadLength, entropy: graph.stats.orientationEntropy, straightness: graph.stats.straightness,
      ports: graph.edgePorts.map(port => `${port.side}:${port.position.toFixed(2)}:${port.type}`).sort(),
      loops: graph.loops ? { added: graph.loops.added, deadEndsBefore: graph.loops.deadEndsBefore, deadEndsAfter: graph.loops.deadEndsAfter, links: graph.loops.links.length } : null,
      linkIssues,
      endpointLinks,
      blocks: { count: s.blocks, enclosed: s.byEnclosure.roads + s.byEnclosure.roadsAndWater + s.byEnclosure.waterOnly, clipped: s.byEnclosure.clipped, invalid: s.invalid, remnants: s.remnants, enclosedArea: s.area.enclosedBlocks, blocksArea: s.area.blocks, roadArea: s.area.roads },
    };
  });

  const plan = [['coast', 'fezOrganicCore'], ['plain', 'fezOrganicCore'], ['riverValley', 'veniceWaterNetwork'], ['coast', 'veniceWaterNetwork']];
  const runs = [];
  for (const [landform, dna] of plan) {
    for (const seed of seeds) {
      const id = `${landform} ${seed} ${dna}`;
      await open(`landform=${landform}&seed=${seed}&dna=${dna}&loops=off`);
      const before = await inspect();
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const after = await inspect();
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const repeat = await inspect();
      assert(after.signature === repeat.signature && after.blocksSignature === repeat.blocksSignature, `${id}: not reproducible.`);
      const bad = Object.entries(after.linkIssues).filter(([, count]) => count > 0);
      assert(bad.length === 0, `${id}: loop link issues ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      assert(after.blocks.invalid === 0, `${id}: invalid blocks after loop closure.`);
      assert(after.cycles >= before.cycles && after.blocks.enclosed >= before.blocks.enclosed, `${id}: loop closure reduced cycles or enclosed blocks.`);
      assert(after.cycles - before.cycles === after.loops.links, `${id}: each accepted link should add exactly one cycle.`);
      assert(before.ports.every(port => after.ports.includes(port)), `${id}: an EdgePort was lost.`);
      assert(after.deadEndRatio > 0.15, `${id}: dead ends almost eliminated (${after.deadEndRatio}).`);
      assert(after.straightness < 0.99, `${id}: network became straight-line / grid-like.`);
      runs.push({ landform, seed, dna, strategy: after.strategy, before, after });
    }
  }
  assert(runs.some(run => run.after.blocks.enclosed > run.before.blocks.enclosed), 'Loop closure never added an enclosed block.');
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: Before / After for organic (coast 3303) and canal-street (river valley 3303),
  // (1) network in terrain classes view, (2) blocks view.
  const capture = async query => {
    await open(query);
    await page.waitForTimeout(300);
    return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64');
  };
  const shots = async (view, file) => {
    const tiles = [];
    for (const [landform, dna] of [['coast', 'fezOrganicCore'], ['riverValley', 'veniceWaterNetwork']]) {
      const run = runs.find(item => item.landform === landform && item.dna === dna && item.seed === seeds[2]);
      for (const loops of ['off', 'on']) {
        const data = loops === 'off' ? run.before : run.after;
        const image = await capture(`landform=${landform}&seed=${seeds[2]}&dna=${dna}&view=${view}${loops === 'off' ? '&loops=off' : ''}`);
        tiles.push(`<figure><img src="data:image/png;base64,${image}"><figcaption>${loops === 'off' ? 'BEFORE' : 'AFTER'} · ${run.strategy} · ${landform} ${seeds[2]} · cycles ${data.cycles} · dead ends ${(data.deadEndRatio * 100).toFixed(0)}% · enclosed blocks ${data.blocks.enclosed} (${(data.blocks.enclosedArea / 1e4).toFixed(1)} ha)</figcaption></figure>`);
      }
    }
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(2,1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  await shots('classes', overallShot);
  await shots('blocks', debugShot);

  const evidence = { task: '03.3', experiment: entry, testedAt: new Date().toISOString(), runs, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const ha = value => (value / 1e4).toFixed(1);
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.strategy}: cycles ${run.before.cycles}→${run.after.cycles} · dead ${(run.before.deadEndRatio * 100).toFixed(0)}→${(run.after.deadEndRatio * 100).toFixed(0)}% · road ${(run.before.roadLength / 1000).toFixed(1)}→${(run.after.roadLength / 1000).toFixed(1)} km · blocks ${run.before.blocks.count}→${run.after.blocks.count} · enclosed ${run.before.blocks.enclosed}→${run.after.blocks.enclosed} (${ha(run.before.blocks.enclosedArea)}→${ha(run.after.blocks.enclosedArea)} ha) · remnants ${run.before.blocks.remnants}→${run.after.blocks.remnants} · invalid ${run.before.blocks.invalid}→${run.after.blocks.invalid} · links ${JSON.stringify(run.after.loops.added)} (endpoint joins ${run.after.endpointLinks})`),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
