import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4195;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/04-1-blocks-strategies.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/04-1-blocks-grid-debug.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/blocks.json');
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
    const lab = window.__seedTerrainLab;
    const fields = lab.fields();
    const graph = lab.network();
    const result = lab.blocks();
    const { BLOCK_RULES } = await import('/experiments/seed-terrain/blockRules.js');
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;
    const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    const issues = { shortRing: 0, selfIntersection: 0, badOrientation: 0, holeOutside: 0, smallOrNegative: 0, outOfChunk: 0, overlapSamples: 0, waterSamples: 0, roadSamples: 0, badRefs: 0, tunnelFrontage: 0 };
    const inside = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    for (const block of result.blocks) {
      const rings = [block.polygon, ...block.holes];
      if (rings.some(ring => ring.length < 3)) issues.shortRing += 1;
      if (area(block.polygon) <= 0 || block.holes.some(ring => area(ring) >= 0)) issues.badOrientation += 1;
      if (block.holes.some(ring => !inside(block.polygon, ring[0].x, ring[0].z))) issues.holeOutside += 1;
      if (!(block.area >= BLOCK_RULES.minBlockArea)) issues.smallOrNegative += 1;
      if (rings.some(ring => ring.some(p => Math.abs(p.x - originX) > half + 1e-6 || Math.abs(p.z - originZ) > half + 1e-6))) issues.outOfChunk += 1;
      const segs = rings.flatMap((ring, r) => ring.map((p, i) => ({ r, i, n: ring.length, a: p, b: ring[(i + 1) % ring.length] })));
      let crossing = false;
      for (let x = 0; x < segs.length && !crossing; x += 1) {
        const s = segs[x];
        for (let y = x + 1; y < segs.length; y += 1) {
          const t = segs[y];
          if (s.r === t.r && (Math.abs(s.i - t.i) <= 1 || Math.abs(s.i - t.i) === s.n - 1)) continue;
          if (Math.max(t.a.x, t.b.x) < Math.min(s.a.x, s.b.x) || Math.min(t.a.x, t.b.x) > Math.max(s.a.x, s.b.x) || Math.max(t.a.z, t.b.z) < Math.min(s.a.z, s.b.z) || Math.min(t.a.z, t.b.z) > Math.max(s.a.z, s.b.z)) continue;
          const d1 = orient(s.a, s.b, t.a); const d2 = orient(s.a, s.b, t.b); const d3 = orient(t.a, t.b, s.a); const d4 = orient(t.a, t.b, s.b);
          if (d1 * d2 < 0 && d3 * d4 < 0) { crossing = true; break; }
        }
      }
      if (crossing) issues.selfIntersection += 1;
      const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
      for (const road of block.adjacentRoads) {
        const edge = edges.get(road.edgeId);
        if (!edge || !['road', 'bridgeCandidate'].includes(edge.kind) || edge.from !== road.nodes[0] || edge.to !== road.nodes[1]) issues.badRefs += 1;
      }
      if (block.boundaryEdges.roads.some(item => edges.get(item.edgeId)?.kind === 'tunnel')) issues.tunnelFrontage += 1;
    }
    // Sample test on a 2 m lattice offset by 1 m: ownership, water, and road corridors.
    const cutting = graph.edges.filter(edge => ['road', 'bridgeCandidate'].includes(edge.kind));
    const buckets = new Map();
    const bucketSize = 32;
    cutting.forEach(edge => edge.points.slice(1).forEach((b, i) => {
      const a = edge.points[i]; const r = edge.width / 2 + 1;
      for (let gx = Math.floor((Math.min(a.x, b.x) - r) / bucketSize); gx <= Math.floor((Math.max(a.x, b.x) + r) / bucketSize); gx += 1) {
        for (let gz = Math.floor((Math.min(a.z, b.z) - r) / bucketSize); gz <= Math.floor((Math.max(a.z, b.z) + r) / bucketSize); gz += 1) {
          const key = `${gx},${gz}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push({ a, b, w: edge.width / 2 });
        }
      }
    }));
    const waterTerm = (x, z) => {
      const gx = Math.min(segments, Math.max(0, (x - originX + half) / spacing)); const gz = Math.min(segments, Math.max(0, (z - originZ + half) / spacing));
      const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz)); const tx = gx - c0; const tz = gz - r0;
      const at = (r, c) => { const s = fields.waterSurface[r * columns + c]; return Number.isFinite(s) ? Math.max(-3, Math.min(3, fields.height[r * columns + c] - s)) : 3; };
      return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
    };
    let claimedArea = 0;
    const bounds = result.blocks.map(block => ({ block, minX: Math.min(...block.polygon.map(p => p.x)), maxX: Math.max(...block.polygon.map(p => p.x)), minZ: Math.min(...block.polygon.map(p => p.z)), maxZ: Math.max(...block.polygon.map(p => p.z)) }));
    for (let z = originZ - half + 1; z < originZ + half; z += 2) {
      for (let x = originX - half + 1; x < originX + half; x += 2) {
        let owners = 0;
        for (const item of bounds) {
          if (x < item.minX || x > item.maxX || z < item.minZ || z > item.maxZ) continue;
          if (inside(item.block.polygon, x, z) && !item.block.holes.some(hole => inside(hole, x, z))) owners += 1;
        }
        if (!owners) continue;
        claimedArea += 4;
        if (owners > 1) issues.overlapSamples += 1;
        if (waterTerm(x, z) < -0.3) issues.waterSamples += 1;
        for (const seg of buckets.get(`${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`) ?? []) {
          const dx = seg.b.x - seg.a.x; const dz = seg.b.z - seg.a.z; const l2 = dx * dx + dz * dz || 1e-12;
          const t = Math.max(0, Math.min(1, ((x - seg.a.x) * dx + (z - seg.a.z) * dz) / l2));
          if (Math.hypot(x - seg.a.x - dx * t, z - seg.a.z - dz * t) - seg.w < -0.6) { issues.roadSamples += 1; break; }
        }
      }
    }
    // Tunnels must not cut blocks: recompute with tunnel edges removed and compare.
    let tunnelInvariant = null;
    if (graph.edges.some(edge => edge.kind === 'tunnel')) {
      const { generateBlocks } = await import('/experiments/seed-terrain/BlockGenerator.js');
      const analysis = lab.analysis();
      const withoutTunnels = { ...graph, edges: graph.edges.filter(edge => edge.kind !== 'tunnel') };
      const typedFields = { ...fields, height: Float32Array.from(fields.height), slope: Float32Array.from(fields.slope), waterMask: Uint8Array.from(fields.waterMask), buildableMask: Uint8Array.from(fields.buildableMask), waterSurface: Float32Array.from(fields.waterSurface ?? [], v => (v === null ? NaN : v)) };
      const again = generateBlocks(typedFields, analysis, withoutTunnels, lab.cityMatch(), { landform: result.source.landform, seed: result.source.seed });
      tunnelInvariant = again.signature === result.signature;
    }
    return { signature: result.signature, stats: result.stats, issues, claimedArea, tunnelInvariant, tunnels: graph.stats.tunnels, strategy: graph.strategy, json: JSON.stringify(result.blocks) };
  });

  const plan = [['plain', 'manhattanGrid'], ['coast', 'fezOrganicCore'], ['riverValley', 'veniceWaterNetwork'], ['mountain', 'manhattanGrid'], ['mountain', 'fezOrganicCore']];
  const runs = [];
  for (const [landform, dna] of plan) {
    for (const seed of seeds) {
      const id = `${landform} ${seed} ${dna}`;
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const first = await inspect();
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const repeat = await inspect();
      assert(first.signature === repeat.signature && first.json === repeat.json, `${id}: blocks not reproducible.`);
      const bad = Object.entries(first.issues).filter(([, count]) => count > 0);
      assert(bad.length === 0, `${id}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      assert(first.stats.invalid === 0, `${id}: generator reported invalid blocks.`);
      const area = first.stats.area;
      assert(Math.abs(area.residual) < 1, `${id}: area accounting residual ${area.residual}.`);
      assert(Math.abs(first.claimedArea - area.blocks) / Math.max(1, area.blocks) < 0.01, `${id}: lattice area ${first.claimedArea} vs polygons ${area.blocks}.`);
      if (first.tunnels > 0) assert(first.tunnelInvariant === true, `${id}: tunnel edges change the blocks.`);
      runs.push({ landform, seed, dna, strategy: first.strategy, tunnels: first.tunnels, tunnelInvariant: first.tunnelInvariant, signature: first.signature, stats: first.stats, claimedArea: first.claimedArea });
    }
  }
  assert(runs.some(run => run.tunnels > 0 && run.tunnelInvariant === true), 'No tunnel case was checked.');
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: (1) block debug view for each strategy (seed 1101); (2) full workspace, grid blocks with labels.
  const capture = async (query, selector = '#terrainCanvas') => {
    await open(query);
    await page.waitForTimeout(300);
    return (await page.locator(selector).screenshot({ animations: 'disabled' })).toString('base64');
  };
  const tiles = [];
  for (const [landform, dna] of plan.slice(0, 3)) {
    const run = runs.find(item => item.landform === landform && item.dna === dna && item.seed === seeds[0]);
    const s = run.stats;
    tiles.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&view=blocks`)}"><figcaption>${run.strategy} · ${landform} ${seeds[0]} · ${s.blocks} blocks · enclosed ${s.byEnclosure.roads + s.byEnclosure.roadsAndWater + s.byEnclosure.waterOnly} · clipped ${s.byEnclosure.clipped} · invalid ${s.invalid}</figcaption></figure>`);
  }
  const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
  await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(3,1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
  await mkdir(path.dirname(overallShot), { recursive: true });
  await compositePage.screenshot({ path: overallShot, fullPage: true });
  await compositePage.close();
  await open(`landform=plain&seed=${seeds[0]}&dna=manhattanGrid&view=blocks`);
  await page.waitForTimeout(300);
  await page.locator('.workspace').screenshot({ path: debugShot, animations: 'disabled' });

  const evidence = { task: '04.1', experiment: entry, testedAt: new Date().toISOString(), runs, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const ha = value => (value / 1e4).toFixed(1);
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.strategy}: ${run.stats.blocks} blocks (roads ${run.stats.byEnclosure.roads}, roads+water ${run.stats.byEnclosure.roadsAndWater}, clipped ${run.stats.byEnclosure.clipped}) status ${run.stats.byStatus.buildable}/${run.stats.byStatus.partial}/${run.stats.byStatus.unbuildable} remnants ${run.stats.remnants} · ha blocks ${ha(run.stats.area.blocks)} roads ${ha(run.stats.area.roads)} water ${ha(run.stats.area.water)} remnant ${ha(run.stats.area.remnants)} buildable-in-blocks ${ha(run.stats.area.buildableInBlocks)}${run.tunnels ? ` · tunnels ${run.tunnels} invariant ${run.tunnelInvariant}` : ''}`),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
