import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4188;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/03-1-network-overall.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/03-1-network-strategies-debug.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/road-network.json');
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
  const dnas = { manhattanGrid: 'grid', fezOrganicCore: 'organic', veniceWaterNetwork: 'canalStreet' };

  // Independent checks, computed in the page from exported fields + graph.
  const inspect = () => page.evaluate(async () => {
    const { STRATEGIES, NETWORK_COMMON, CONNECTIVITY } = await import('/experiments/seed-terrain/networkStrategies.js');
    const lab = window.__seedTerrainLab;
    const fields = lab.fields();
    const graph = lab.network();
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    const params = STRATEGIES[graph.strategy];
    const indexAt = (x, z) => Math.min(segments, Math.max(0, Math.round((z - originZ + half) / spacing))) * columns + Math.min(segments, Math.max(0, Math.round((x - originX + half) / spacing)));
    const finite = value => Number.isFinite(value);
    const issues = { mountainGrade: 0, badCoordinates: 0, endpointMismatch: 0, roadOnWater: 0, roadTooSteep: 0, canalOnLand: 0, bridgeBadEnds: 0, bridgeTooLong: 0, duplicateEdges: 0, crossings: 0, nodeOnEdgeInterior: 0, badPorts: 0 };
    const sampleEdge = (edge, visit) => {
      for (let i = 1; i < edge.points.length; i += 1) {
        const a = edge.points[i - 1]; const b = edge.points[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / NETWORK_COMMON.sampleStep));
        for (let s = i === 1 ? 0 : 1; s <= steps; s += 1) visit(indexAt(a.x + (b.x - a.x) * s / steps, a.z + (b.z - a.z) * s / steps), s === 0 && i === 1, s === steps && i === edge.points.length - 1);
      }
    };
    for (const node of graph.nodes) if (![node.x, node.y, node.z].every(finite) || Math.abs(node.x - originX) > half + 1e-6 || Math.abs(node.z - originZ) > half + 1e-6) issues.badCoordinates += 1;
    const seen = new Set();
    for (const edge of graph.edges) {
      if (!edge.points.every(point => [point.x, point.y, point.z].every(finite) && Math.abs(point.x - originX) <= half + 1e-6 && Math.abs(point.z - originZ) <= half + 1e-6)) issues.badCoordinates += 1;
      const from = graph.nodes[edge.from]; const to = graph.nodes[edge.to];
      if (Math.hypot(edge.points[0].x - from.x, edge.points[0].z - from.z) > 1e-6 || Math.hypot(edge.points.at(-1).x - to.x, edge.points.at(-1).z - to.z) > 1e-6) issues.endpointMismatch += 1;
      const signature = `${Math.min(edge.from, edge.to)}-${Math.max(edge.from, edge.to)}-${edge.kind}-${JSON.stringify(edge.from < edge.to ? edge.points : [...edge.points].reverse())}`;
      if (seen.has(signature)) issues.duplicateEdges += 1;
      seen.add(signature);
      // 03.2: mountain connectors use the mountain-road rule (terrain slope + per-step grade); tunnels are checked by verify-tunnels.
      const maxSlope = edge.rule === 'mountain' ? CONNECTIVITY.mountainRoad.maxTerrainSlopeDeg : params.maxSlopeDeg;
      if (edge.kind === 'road') sampleEdge(edge, index => { if (fields.waterMask[index]) issues.roadOnWater += 1; else if (fields.slope[index] > maxSlope) issues.roadTooSteep += 1; });
      if (edge.rule === 'mountain') for (let i = 1; i < edge.points.length; i += 1) {
        const run = Math.hypot(edge.points[i].x - edge.points[i - 1].x, edge.points[i].z - edge.points[i - 1].z);
        if (run >= 3 && Math.abs(edge.points[i].y - edge.points[i - 1].y) / run > CONNECTIVITY.mountainRoad.maxGrade + 1e-6) issues.mountainGrade += 1;
      }
      if (edge.kind === 'canal') sampleEdge(edge, index => { if (!fields.waterMask[index]) issues.canalOnLand += 1; });
      if (edge.kind === 'bridgeCandidate') {
        const ends = [indexAt(from.x, from.z), indexAt(to.x, to.z)];
        if (ends.some(index => fields.waterMask[index] || fields.slope[index] > params.maxSlopeDeg)) issues.bridgeBadEnds += 1;
        if (edge.length > params.maxBridgeSpan + 1e-6) issues.bridgeTooLong += 1;
      }
    }
    // Proper crossings (canal ↔ bridge is a legitimate grade separation).
    const segs = graph.edges.flatMap(edge => edge.points.slice(1).map((point, i) => ({ edge, a: edge.points[i], b: point })));
    const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      const sx0 = Math.min(s.a.x, s.b.x); const sx1 = Math.max(s.a.x, s.b.x); const sz0 = Math.min(s.a.z, s.b.z); const sz1 = Math.max(s.a.z, s.b.z);
      for (let j = i + 1; j < segs.length; j += 1) {
        const t = segs[j];
        if (s.edge === t.edge) continue;
        const kinds = [s.edge.kind, t.edge.kind].sort().join();
        if (kinds === 'bridgeCandidate,canal') continue;
        if ((s.edge.kind === 'tunnel') !== (t.edge.kind === 'tunnel')) continue; // underground vs surface: grade separated
        if (Math.max(t.a.x, t.b.x) < sx0 || Math.min(t.a.x, t.b.x) > sx1 || Math.max(t.a.z, t.b.z) < sz0 || Math.min(t.a.z, t.b.z) > sz1) continue;
        const d1 = orient(s.a, s.b, t.a); const d2 = orient(s.a, s.b, t.b); const d3 = orient(t.a, t.b, s.a); const d4 = orient(t.a, t.b, s.b);
        if (d1 * d2 < -1e-9 && d3 * d4 < -1e-9) issues.crossings += 1;
      }
    }
    // Unconnected junctions: a node lying on another edge's interior without being its endpoint.
    for (const node of graph.nodes) {
      for (const edge of graph.edges) {
        if (edge.from === node.id || edge.to === node.id || edge.kind === 'tunnel') continue;
        const nodeKinds = graph.edges.filter(item => item.from === node.id || item.to === node.id).map(item => item.kind);
        if ((edge.kind === 'canal') !== nodeKinds.every(kind => kind === 'canal')) continue;
        for (let i = 1; i < edge.points.length; i += 1) {
          const a = edge.points[i - 1]; const b = edge.points[i];
          const length2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1;
          const t = Math.max(0, Math.min(1, ((node.x - a.x) * (b.x - a.x) + (node.z - a.z) * (b.z - a.z)) / length2));
          if (Math.hypot(node.x - (a.x + (b.x - a.x) * t), node.z - (a.z + (b.z - a.z) * t)) < 0.5) { issues.nodeOnEdgeInterior += 1; break; }
        }
      }
    }
    // Edge ports.
    const adjacency = new Map(graph.nodes.map(node => [node.id, []]));
    graph.edges.forEach(edge => { adjacency.get(edge.from).push(edge); adjacency.get(edge.to).push(edge); });
    for (const port of graph.edgePorts) {
      const node = graph.nodes[port.nodeId];
      const edge = graph.edges[port.edgeId];
      const index = indexAt(node.x, node.z);
      const onSide = { minX: Math.abs(node.x - (originX - half)), maxX: Math.abs(node.x - (originX + half)), minZ: Math.abs(node.z - (originZ - half)), maxZ: Math.abs(node.z - (originZ + half)) }[port.side] < 1e-6;
      const incident = edge && (edge.from === node.id || edge.to === node.id);
      const expected = port.type === 'canal' ? (Number.isFinite(fields.waterSurface?.[index]) ? null : null) : fields.height[index];
      const portSlope = edge?.rule === 'mountain' ? CONNECTIVITY.mountainRoad.maxTerrainSlopeDeg : params.maxSlopeDeg;
      const legalSurface = port.type === 'canal' ? fields.waterMask[index] === 1 : !fields.waterMask[index] && fields.slope[index] <= portSlope;
      const elevationOk = finite(port.elevation) && Math.abs(port.elevation - node.y) < 1e-9 && (expected === null || Math.abs(port.elevation - expected) < 2);
      if (!onSide || !incident || !legalSurface || !elevationOk || port.outwardDot <= 0 || adjacency.get(node.id).length === 0) issues.badPorts += 1;
    }
    // Recomputed connectivity of the road graph (roads + bridges).
    const roadEdges = graph.edges.filter(edge => edge.kind !== 'canal');
    const roadNodes = new Set(roadEdges.flatMap(edge => [edge.from, edge.to]));
    const parent = new Map([...roadNodes].map(id => [id, id]));
    const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
    roadEdges.forEach(edge => parent.set(find(edge.from), find(edge.to)));
    const components = new Set([...roadNodes].map(find)).size;
    const degree = new Map();
    roadEdges.forEach(edge => { degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1); degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1); });
    const deadEnds = [...roadNodes].filter(id => degree.get(id) === 1 && !graph.nodes[id].onBoundary).length;
    return {
      signature: graph.signature, strategy: graph.strategy, dna: graph.dna, stats: graph.stats, warnings: graph.warnings,
      issues, recomputed: { components, deadEndRatio: roadNodes.size ? deadEnds / roadNodes.size : 0 },
      terrain: { height: JSON.stringify(fields.height).length + ':' + fields.height.slice(0, 4000).join(','), analysis: lab.analysis().signature },
      graphJson: JSON.stringify({ nodes: graph.nodes, edges: graph.edges, ports: graph.edgePorts }),
    };
  });

  const runs = [];
  for (const landform of landforms) {
    for (const seed of seeds) {
      for (const [dna, strategy] of Object.entries(dnas)) {
        const id = `${landform} ${seed} ${strategy}`;
        await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
        const first = await inspect();
        await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
        const repeat = await inspect();
        assert(first.strategy === strategy && first.dna === dna, `${id}: DNA → strategy mapping wrong.`);
        assert(first.signature === repeat.signature && first.graphJson === repeat.graphJson, `${id}: graph not deterministic.`);
        const bad = Object.entries(first.issues).filter(([, count]) => count > 0);
        assert(bad.length === 0, `${id}: ${bad.map(([name, count]) => `${name}=${count}`).join(', ')}`);
        assert(first.recomputed.components === first.stats.roadComponents && Math.abs(first.recomputed.deadEndRatio - first.stats.deadEndRatio) < 1e-9, `${id}: stats differ from recomputation.`);
        runs.push({ landform, seed, strategy, signature: first.signature, stats: first.stats, warnings: first.warnings, terrain: first.terrain });
      }
      // Changing the DNA (and so the network) must not change terrain or analysis.
      const terrains = runs.filter(run => run.landform === landform && run.seed === seed).map(run => JSON.stringify(run.terrain));
      assert(new Set(terrains).size === 1, `${landform} ${seed}: network generation changed terrain or analysis.`);
    }
  }

  // Structural differences between strategies on the same terrain.
  const pick = (landform, seed, strategy) => runs.find(run => run.landform === landform && run.seed === seed && run.strategy === strategy).stats;
  for (const seed of seeds) {
    const grid = pick('plain', seed, 'grid'); const organic = pick('plain', seed, 'organic');
    assert(grid.straightness > 0.999 && organic.straightness < grid.straightness, `plain ${seed}: grid is not straighter than organic.`);
    assert(grid.orientationEntropy < organic.orientationEntropy, `plain ${seed}: grid orientation is not more concentrated than organic.`);
    assert(grid.meanDegree > organic.meanDegree && grid.junctions > organic.junctions, `plain ${seed}: grid is not more connected than organic.`);
    const canal = pick('riverValley', seed, 'canalStreet');
    assert(canal.edgesByKind.canal > 0 && canal.bridges > 0, `riverValley ${seed}: canal-street lacks canals or bridge candidates.`);
  }
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: (1) overall — each strategy on terrain it fits; (2) debug — one terrain, three strategies, slope view.
  const capture = async query => {
    await open(query);
    await page.waitForTimeout(300);
    return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64');
  };
  const composite = async (tiles, file) => {
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(3,1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px;max-width:94%}</style>${tiles.map(tile => `<figure><img src="data:image/png;base64,${tile.image}"><figcaption>${tile.caption}</figcaption></figure>`).join('')}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const caption = (landform, seed, strategy) => {
    const stats = pick(landform, seed, strategy);
    return `${strategy} · ${landform} ${seed} · ${stats.edges} edges · ${(stats.roadLength / 1000).toFixed(1)} km · comp ${stats.roadComponents} · dead ${(stats.deadEndRatio * 100).toFixed(0)}% · ports ${stats.ports}${stats.bridges ? ` · bridges ${stats.bridges}` : ''}`;
  };
  const overall = [];
  for (const [landform, dna, strategy] of [['plain', 'manhattanGrid', 'grid'], ['coast', 'fezOrganicCore', 'organic'], ['riverValley', 'veniceWaterNetwork', 'canalStreet']]) {
    overall.push({ image: await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}`), caption: caption(landform, seeds[0], strategy) });
  }
  await composite(overall, overallShot);
  const debug = [];
  for (const [dna, strategy] of Object.entries(dnas)) {
    debug.push({ image: await capture(`landform=riverValley&seed=${seeds[0]}&dna=${dna}&view=slope`), caption: caption('riverValley', seeds[0], strategy) });
  }
  await composite(debug, debugShot);

  const evidence = { task: '03.1', experiment: entry, testedAt: new Date().toISOString(), runs: runs.map(({ terrain, ...rest }) => rest), browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.strategy}: N${run.stats.nodes} E${run.stats.edges} c${run.stats.edgesByKind.canal} b${run.stats.bridges} ${(run.stats.roadLength / 1000).toFixed(1)}km comp${run.stats.roadComponents} dead${(run.stats.deadEndRatio * 100).toFixed(0)}% deg${run.stats.meanDegree.toFixed(2)} ent${run.stats.orientationEntropy.toFixed(2)} str${run.stats.straightness.toFixed(2)} ports${run.stats.ports}${run.warnings.length ? ' ⚠' : ''}`),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
