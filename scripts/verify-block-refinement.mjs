import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4197;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/04-1b-buildable-strategies.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/04-1b-canal-refinement-debug.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/block-refinement.json');
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
    const { CHUNK } = await import('/experiments/seed-terrain/config.js');
    const { ringsIntersect } = await import('/experiments/seed-terrain/BlockGenerator.js');
    const lab = window.__seedTerrainLab;
    const fields = lab.fields();
    const graph = lab.network();
    const result = lab.blocks();
    const W = lab.stats().transitionWidth;
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;
    const inside = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    const inPoly = (poly, x, z) => inside(poly.polygon, x, z) && !poly.holes.some(hole => inside(hole, x, z));
    const bilinear = map => (x, z) => {
      const gx = Math.min(segments, Math.max(0, (x - originX + half) / spacing)); const gz = Math.min(segments, Math.max(0, (z - originZ + half) / spacing));
      const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz)); const tx = gx - c0; const tz = gz - r0;
      const at = (r, c) => map(r * columns + c);
      return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
    };
    const slopeAt = bilinear(i => fields.slope[i]);
    const freeboardAt = bilinear(i => (Number.isFinite(fields.waterSurface[i]) ? Math.max(-3, Math.min(3, fields.height[i] - fields.waterSurface[i] - CHUNK.shoreFreeboard)) : 3));
    const segs = graph.edges.filter(edge => ['road', 'bridgeCandidate'].includes(edge.kind)).flatMap(edge => edge.points.slice(1).map((b, i) => ({ a: edge.points[i], b, w: edge.width / 2 })));
    const buckets = new Map();
    segs.forEach(seg => {
      for (let gx = Math.floor((Math.min(seg.a.x, seg.b.x) - seg.w - 1) / 32); gx <= Math.floor((Math.max(seg.a.x, seg.b.x) + seg.w + 1) / 32); gx += 1) {
        for (let gz = Math.floor((Math.min(seg.a.z, seg.b.z) - seg.w - 1) / 32); gz <= Math.floor((Math.max(seg.a.z, seg.b.z) + seg.w + 1) / 32); gz += 1) {
          const key = `${gx},${gz}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(seg);
        }
      }
    });
    const onRoad = (x, z) => (buckets.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []).some(seg => {
      const dx = seg.b.x - seg.a.x; const dz = seg.b.z - seg.a.z; const l2 = dx * dx + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - seg.a.x) * dx + (z - seg.a.z) * dz) / l2));
      return Math.hypot(x - seg.a.x - dx * t, z - seg.a.z - dz * t) - seg.w < -0.6;
    });
    const issues = { invalidRings: 0, badOrientation: 0, holeOutside: 0, buildableOutsideBlock: 0, buildableInOtherBlock: 0, buildableSteep: 0, buildableWet: 0, buildableOnRoad: 0, buildableOutsideChunk: 0, areaRelation: 0, fragmentInBlock: 0, unclassified: 0, deleted: 0 };
    const bbox = poly => ({ minX: Math.min(...poly.polygon.map(p => p.x)), maxX: Math.max(...poly.polygon.map(p => p.x)), minZ: Math.min(...poly.polygon.map(p => p.z)), maxZ: Math.max(...poly.polygon.map(p => p.z)) });
    const blocks = result.blocks.map((block, index) => ({ block, index, box: bbox(block), pieces: block.buildablePolygons.map(piece => ({ piece, box: bbox(piece) })) }));
    for (const { block } of blocks) {
      for (const piece of block.buildablePolygons) {
        const rings = [piece.polygon, ...piece.holes];
        if (rings.some(ring => ring.length < 3) || ringsIntersect(rings)) issues.invalidRings += 1;
        if (area(piece.polygon) <= 0 || piece.holes.some(hole => area(hole) >= 0)) issues.badOrientation += 1;
        if (piece.holes.some(hole => !inside(piece.polygon, hole[0].x, hole[0].z))) issues.holeOutside += 1;
        if (rings.some(ring => ring.some(p => Math.abs(p.x - originX) > half + 1e-6 || Math.abs(p.z - originZ) > half + 1e-6))) issues.buildableOutsideChunk += 1;
      }
      if (block.buildableArea > block.area + 1 || Math.abs(block.buildableArea + block.unbuildableArea - block.area) > 1e-6) issues.areaRelation += 1;
      if (block.fragmentClassification && !['waterfrontReserve', 'publicSpaceCandidate', 'unbuildable', 'buildableFragment'].includes(block.fragmentClassification.class)) issues.unclassified += 1;
    }
    for (const fragment of result.fragments) if (!fragment.fragmentClassification?.class) issues.unclassified += 1;
    if (result.fragments.length !== result.stats.remnants || result.refinement.fragmentsAfter.deleted !== 0) issues.deleted += 1;
    // 2 m lattice: containment, deduction, areas, transition.
    const perBlock = blocks.map(() => ({ buildable: 0, transition: 0, buildableTransition: 0, outsideBuildable: 0, outsideButBuildable: 0 }));
    // Stratified jitter: one deterministic random point per 2 m cell. A regular lattice aliases against
    // the regular grid blocks (same phase in every block) and biases areas by ~2%.
    let seedState = 12345;
    const random = () => { seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0; return seedState / 4294967296; };
    for (let cz = originZ - half; cz < originZ + half; cz += 2) {
      for (let cx = originX - half; cx < originX + half; cx += 2) {
        const x = cx + random() * 2; const z = cz + random() * 2;
        const inBand = Math.min(x - (originX - half), originX + half - x, z - (originZ - half), originZ + half - z) < W;
        let owner = -1;
        for (const item of blocks) {
          if (x < item.box.minX || x > item.box.maxX || z < item.box.minZ || z > item.box.maxZ) continue;
          if (inPoly(item.block, x, z)) { owner = item.index; break; }
        }
        let buildableOwner = -1;
        for (const item of blocks) for (const { piece, box } of item.pieces) {
          if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
          if (inPoly(piece, x, z)) buildableOwner = item.index;
        }
        if (owner >= 0) {
          if (inBand) perBlock[owner].transition += 4;
          if (buildableOwner < 0) {
            perBlock[owner].outsideBuildable += 4;
            if (slopeAt(x, z) <= CHUNK.maxBuildableSlope - 0.5 && freeboardAt(x, z) > 0.3) perBlock[owner].outsideButBuildable += 4;
          }
        }
        if (buildableOwner < 0) {
          if (result.fragments.some(fragment => inPoly(fragment, x, z)) && owner >= 0) issues.fragmentInBlock += 1;
          continue;
        }
        perBlock[buildableOwner].buildable += 4;
        if (inBand) perBlock[buildableOwner].buildableTransition += 4;
        if (owner < 0) issues.buildableOutsideBlock += 1;
        else if (owner !== buildableOwner) issues.buildableInOtherBlock += 1;
        if (slopeAt(x, z) > CHUNK.maxBuildableSlope + 0.75) issues.buildableSteep += 1;
        if (freeboardAt(x, z) < -0.3) issues.buildableWet += 1;
        if (onRoad(x, z)) issues.buildableOnRoad += 1;
      }
    }
    const big = blocks.filter(item => item.block.buildableArea >= 2000);
    const relative = (a, b) => Math.abs(a - b) / Math.max(1, b);
    const totals = perBlock.reduce((sum, item) => ({ buildable: sum.buildable + item.buildable, transition: sum.transition + item.transition, outsideBuildable: sum.outsideBuildable + item.outsideBuildable, outsideButBuildable: sum.outsideButBuildable + item.outsideButBuildable }), { buildable: 0, transition: 0, outsideBuildable: 0, outsideButBuildable: 0 });
    return {
      // Geometry only: port anchors and inTransition flags legitimately depend on the width.
      networkSignature: JSON.stringify(graph.edges.map(edge => [edge.kind, edge.points.map(p => [p.x, p.z])])), signature: result.signature, json: JSON.stringify({ b: result.blocks, f: result.fragments, r: result.refinement }),
      transitionWidth: W, refinement: result.refinement, issues,
      areaError: {
        buildableTotalRel: relative(result.refinement.buildable.buildableArea, totals.buildable),
        buildableMaxRelBig: Math.max(0, ...big.map(item => relative(item.block.buildableArea, perBlock[item.index].buildable))),
        // Mean boundary offset (m): |polygon − lattice area| / block perimeter; a 2 m lattice errs ≈ perimeter × 1 m.
        buildableMaxOffset: Math.max(0, ...blocks.map(item => Math.abs(item.block.buildableArea - perBlock[item.index].buildable) / Math.max(1, item.block.metrics.perimeter))),
        transitionMaxOffset: Math.max(0, ...blocks.map(item => Math.abs(item.block.transitionArea - perBlock[item.index].transition) / Math.max(1, item.block.metrics.perimeter))),
        transitionTotalRel: relative(result.refinement.transition.blocksArea, totals.transition),
        transitionMaxRelBig: Math.max(0, ...blocks.filter(item => item.block.transitionArea >= 2000).map(item => relative(item.block.transitionArea, perBlock[item.index].transition))),
        missedBuildableShare: totals.outsideBuildable ? totals.outsideButBuildable / totals.outsideBuildable : 0,
      },
    };
  });

  const plan = [['plain', 'manhattanGrid'], ['coast', 'fezOrganicCore'], ['riverValley', 'veniceWaterNetwork'], ['coast', 'veniceWaterNetwork']];
  const runs = [];
  for (const [landform, dna] of plan) {
    for (const seed of seeds) {
      const id = `${landform} ${seed} ${dna}`;
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const first = await inspect();
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const repeat = await inspect();
      assert(first.json === repeat.json, `${id}: refinement not reproducible.`);
      const bad = Object.entries(first.issues).filter(([, count]) => count > 0);
      assert(bad.length === 0, `${id}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      const e = first.areaError;
      assert(e.buildableTotalRel < 0.01 && e.buildableMaxOffset < 1, `${id}: buildable area error ${JSON.stringify(e)}.`);
      assert(e.transitionTotalRel < 0.01 && e.transitionMaxOffset < 1, `${id}: transition area error ${JSON.stringify(e)}.`);
      assert(first.refinement.merge.legal === 0, `${id}: unexpected merge.`);
      assert(first.refinement.transition.blocksArea <= first.refinement.transition.bandArea + 1, `${id}: transition area exceeds band (double counting).`);
      runs.push({ landform, seed, dna, refinement: first.refinement, areaError: e });
    }
  }
  // Transition width changes: block polygons fixed, shares grow with width.
  const widthRuns = [];
  for (const [landform, dna] of [['plain', 'manhattanGrid'], ['riverValley', 'veniceWaterNetwork']]) {
    const series = [];
    for (const width of [32, 128, 256]) {
      await open(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&transitionWidth=${width}`);
      const data = await inspect();
      assert(Object.values(data.issues).every(count => count === 0) && data.areaError.transitionTotalRel < 0.01, `${landform} width ${width}: checks failed.`);
      series.push({ width, networkSignature: data.networkSignature, signature: data.signature, blocksTransition: data.refinement.transition.blocksArea, buildableTransition: data.refinement.transition.buildableArea, band: data.refinement.transition.bandArea, rel: data.areaError.transitionTotalRel });
    }
    // Block polygons may only change if the network changed (03.3 loop closure avoids the transition band).
    const networkFixed = new Set(series.map(item => item.networkSignature)).size === 1;
    if (networkFixed) assert(new Set(series.map(item => item.signature)).size === 1, `${landform}: block polygons changed with transition width although the network did not.`);
    assert(series[0].blocksTransition < series[1].blocksTransition && series[1].blocksTransition < series[2].blocksTransition, `${landform}: transition area does not grow with width.`);
    widthRuns.push({ landform, dna, networkFixed, series });
  }
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: blocks view for the three strategies (seed 1101) + full workspace of canal-street.
  const capture = async query => { await open(query); await page.waitForTimeout(300); return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64'); };
  const tiles = [];
  for (const [landform, dna] of plan.slice(0, 3)) {
    const run = runs.find(item => item.landform === landform && item.dna === dna && item.seed === seeds[0]);
    const r = run.refinement;
    tiles.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&view=blocks`)}"><figcaption>${dna} · ${landform} ${seeds[0]} · buildable ${(r.buildable.buildableArea / 1e4).toFixed(1)} of ${(r.buildable.blocksArea / 1e4).toFixed(1)} ha · in band ${(100 * r.transition.blocksArea / r.buildable.blocksArea).toFixed(0)}% · fragments ${r.fragmentsAfter.classified}</figcaption></figure>`);
  }
  const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
  await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(3,1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
  await mkdir(path.dirname(overallShot), { recursive: true });
  await compositePage.screenshot({ path: overallShot, fullPage: true });
  await compositePage.close();
  await open(`landform=riverValley&seed=${seeds[0]}&dna=veniceWaterNetwork&view=blocks`);
  await page.waitForTimeout(300);
  await page.locator('.workspace').screenshot({ path: debugShot, animations: 'disabled' });

  const evidence = { task: '04.1b', experiment: entry, testedAt: new Date().toISOString(), runs, widthRuns, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const ha = value => (value / 1e4).toFixed(1);
  console.log(JSON.stringify({
    runs: runs.map(run => { const r = run.refinement; return `${run.landform} ${run.seed} ${run.dna.replace(/[A-Z].*/, '')}: blocks ${ha(r.buildable.blocksArea)} ha → buildable ${ha(r.buildable.buildableArea)} / unbuildable ${ha(r.buildable.unbuildableArea)} ha (${r.buildable.pieces} pieces, dropped ${r.buildable.droppedPieces} = ${r.buildable.droppedArea.toFixed(0)} m²) · err total ${(run.areaError.buildableTotalRel * 100).toFixed(2)}% max offset ${run.areaError.buildableMaxOffset.toFixed(2)} m (max rel ${(run.areaError.buildableMaxRelBig * 100).toFixed(1)}%) · missed-buildable ${(run.areaError.missedBuildableShare * 100).toFixed(1)}% of deducted · band ${ha(r.transition.blocksArea)} ha (${(100 * r.transition.blocksArea / r.buildable.blocksArea).toFixed(0)}%), buildable in band ${(100 * r.transition.buildableArea / Math.max(1, r.buildable.buildableArea)).toFixed(0)}% · fragments ${r.fragmentsBefore.remnants}+${r.fragmentsBefore.thinWaterfrontBlocks} → ${JSON.stringify(Object.fromEntries(Object.entries(r.fragmentsAfter.byClass).map(([k, v]) => [k, `${v.count}/${v.area.toFixed(0)}m²`])))} · merge candidates ${r.merge.candidates} legal ${r.merge.legal} ${JSON.stringify(r.merge.rejectedBy)}`; }),
    widths: widthRuns.map(run => `${run.landform} (network ${run.networkFixed ? 'unchanged' : 'changes with width'}): ${run.series.map(item => `${item.width} m → blocks ${ha(item.blocksTransition)} ha, buildable ${ha(item.buildableTransition)} ha (band ${ha(item.band)} ha, err ${(item.rel * 100).toFixed(2)}%)`).join(' | ')}`),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
