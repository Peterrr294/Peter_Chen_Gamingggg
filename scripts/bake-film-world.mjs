// WEB-01c: bakes the replay data of Part II of the film by running the REAL generators in Node, once, offline.
// A 36-chunk world takes minutes to generate, too long for a page. Each baked chunk must equal the signatures in the saved
// verifier state (world-6201-g02-step30-state.json), otherwise the bake stops: the replay can never drift from the verified run.
// Usage: node scripts/bake-film-world.mjs [--world-only | --case-only]
// Output: experiments/procedural-film/world/world-6201-step30.json, encounter-case.json
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = file => import(pathToFileURL(path.join(root, file)));
const outDir = path.join(root, 'experiments/procedural-film/world');
const DECI = 10; // coordinates are stored in decimetres, relative to the chunk origin
const STEP = 4; // terrain and water keep every 4th sample (16 m); the replay is viewed at world scale

const flat = (points, ox, oz) => points.flatMap(p => [Math.round((p.x - ox) * DECI), Math.round((p.z - oz) * DECI)]);
const base64 = typed => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

function bakeChunk(chunk, layers) {
  const { terrain, city } = layers;
  const { fields, config } = terrain;
  const { columns, spacing } = fields.grid;
  const ox = chunk.worldOrigin.x; const oz = chunk.worldOrigin.z;
  const side = Math.floor((columns - 1) / STEP) + 1;
  const height = new Int16Array(side * side); const water = new Int16Array(side * side); const kind = new Uint8Array(side * side);
  for (let r = 0; r < side; r += 1) {
    for (let c = 0; c < side; c += 1) {
      const i = r * STEP * columns + c * STEP; const o = r * side + c;
      height[o] = Math.round(fields.height[i] * DECI);
      water[o] = Number.isFinite(fields.waterSurface[i]) ? Math.round(fields.waterSurface[i] * DECI) : -32768;
      kind[o] = fields.waterMask[i] ? 0 : fields.buildableMask[i] ? 1 : fields.height[i] < fields.waterSurface[i] + config.shoreFreeboard ? 2 : 3;
    }
  }
  const out = chunk.outputs;
  return {
    id: chunk.chunkId, cityId: chunk.cityId, role: chunk.role, parent: chunk.parentChunkId, core: chunk.coreChunkId, step: chunk.growthStep, generation: chunk.generation,
    gx: chunk.worldCoordinate.gx, gy: chunk.worldCoordinate.gy, x: ox, z: oz, terrainSeed: chunk.terrainSeed, terrainType: chunk.terrainType, variation: chunk.generationParameters.variation, urbanSeed: chunk.generationParameters.urbanSeed,
    signatures: out.signatures, counts: out.counts, fitScore: out.fitScore, strategy: city.network.strategy, spacing,
    side, height: base64(height), water: base64(water), kind: base64(kind), baseY: terrain.fields.stats.minHeight,
    roads: city.network.edges.filter(e => e.kind !== 'tunnel').map(e => ({ id: e.id, c: e.roadClass, w: e.width, l: Math.round(e.length), p: flat(e.points, ox, oz) })),
    blocks: city.blocks.blocks.map(b => flat(b.polygon, ox, oz)),
    parcels: city.parcels.parcels.map(p => flat(p.polygon, ox, oz)),
    buildings: city.buildings.buildings.map(b => ({ p: flat(b.footprint.polygon, ox, oz), h: b.footprint.holes.map(hole => flat(hole, ox, oz)), b: Math.round(b.bottomElevation * DECI), t: Math.round((b.baseElevation + b.height) * DECI), a: b.height })),
  };
}

const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { return null; } })();
await mkdir(outDir, { recursive: true });

async function bakeWorld() {
  const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
  const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
  const saved = JSON.parse(await readFile(path.join(root, 'experiments/city-of-cities/evidence/world-6201-g02-step30-state.json'), 'utf8'));
  const expected = new Map(saved.chunks.map(chunk => [chunk.chunkId, chunk.expectedSignatures]));
  const world = new WorldContext({ worldSeed: saved.worldSeed });
  const report = world.initialise();
  if (report.failures.length) throw new Error(`placement failed: ${JSON.stringify(report.failures)}`);
  const chunks = [];
  const add = (chunk, layers) => {
    const want = expected.get(chunk.chunkId);
    if (!want) throw new Error(`${chunk.chunkId} is not in the saved verified state`);
    for (const key of ['height', 'water', 'network', 'blocks', 'parcels', 'buildings']) if (chunk.outputs.signatures[key] !== want[key]) throw new Error(`${chunk.chunkId}: ${key} ${chunk.outputs.signatures[key]} differs from verified ${want[key]}`);
    chunks.push(bakeChunk(chunk, layers));
    console.log(`${chunks.length} / ${saved.chunks.length} ${chunk.chunkId} ${chunk.cityId}: signatures equal the verified state`);
  };
  for (const id of [...world.chunks.keys()].sort()) { const { chunk, layers } = world.generateChunk(id); add(chunk, layers); }
  const growth = new WorldGrowthController(world);
  for (let k = 1; k <= saved.growth.step; k += 1) {
    const r = growth.step();
    if (r.stalled) throw new Error(`stalled at step ${k}`);
    if (r.chunk.chunkId !== saved.growth.history[k - 1].newChunkId) throw new Error(`step ${k}: ${r.chunk.chunkId} differs from verified ${saved.growth.history[k - 1].newChunkId}`);
    add(r.chunk, r.layers);
  }
  const history = saved.growth.history.map(e => ({ step: e.step, cityId: e.cityId, parent: e.parentChunkId, chunk: e.newChunkId, target: e.targetCoordinate, generation: e.generation, score: e.selectionScore, weight: e.selectionWeight, reason: e.growthReason, conflicts: e.conflicts, counts: e.outputs.counts }));
  const data = {
    kind: 'film-world-replay', sourceFile: 'experiments/city-of-cities/evidence/world-6201-g02-step30-state.json', bakedAtCommit: commit, worldSeed: saved.worldSeed, params: saved.params, growthParams: saved.growthParams,
    cities: saved.cities.map(c => ({ cityId: c.cityId, origin: c.originChunkId, citySeed: c.citySeed, gx: c.worldCoordinate.gx, gy: c.worldCoordinate.gy, reason: c.placementReason })), history, chunks,
  };
  const file = path.join(outDir, `world-${saved.worldSeed}-step${saved.growth.step}.json`);
  await writeFile(file, JSON.stringify(data));
  console.log(`world: ${chunks.length} chunks, ${(JSON.stringify(data).length / 1e6).toFixed(1)} MB`);
}

async function bakeCases() {
  const { createFixtureWorld, runFixtureSteps, ENCOUNTER_FIXTURES } = await mod('experiments/city-of-cities/encounterFixture.js');
  const evidence = JSON.parse(await readFile(path.join(root, 'experiments/city-of-cities/evidence/urban-encounter.json'), 'utf8')).node.scenarios;
  const cases = {};
  for (const name of Object.keys(ENCOUNTER_FIXTURES)) {
    const world = createFixtureWorld(name);
    const chunks = []; const steps = [];
    const it = runFixtureSteps(world, name);
    for (let r = it.next(); !r.done; r = it.next()) {
      const v = r.value;
      if (v.kind === 'core') chunks.push({ ...bakeChunk(v.chunk, v.layers), order: 0 });
      else {
        const failure = v.result.failure ?? null;
        steps.push({ cityId: v.cityId, target: v.target, grown: !failure, failure: failure?.reason ?? null, chunk: failure ? null : v.result.chunk.chunkId, decisions: v.decisions.map(d => ({ outcome: d.outcome, reason: d.reason })) });
        if (!failure) chunks.push({ ...bakeChunk(v.result.chunk, v.result.layers), order: steps.length });
      }
    }
    const saved = evidence[name];
    const same = saved.steps.length === steps.length && saved.steps.every((step, i) => step.grown === steps[i].grown && (step.newChunkId ?? null) === steps[i].chunk);
    if (!same) throw new Error(`${name}: steps differ from the verified evidence`);
    cases[name] = { title: saved.title, worldSeed: saved.worldSeed, steps, encounter: saved.encounter, chunks };
    console.log(`${name}: ${chunks.length} chunks, steps equal the verified evidence`);
  }
  const data = { kind: 'film-encounter-case', sourceFile: 'experiments/city-of-cities/evidence/urban-encounter.json', bakedAtCommit: commit, fixture: 'TEST ONLY: Chicago and Fez cores placed by hand in one row. Not a placement rule.', cases };
  await writeFile(path.join(outDir, 'encounter-case.json'), JSON.stringify(data));
  console.log(`cases: ${(JSON.stringify(data).length / 1e6).toFixed(1)} MB`);
}

// Metadata only (history, chunk records, encounter records): what Recorded Film and the Inspector read. It derives from the two baked files.
async function bakeMeta() {
  const world = JSON.parse(await readFile(path.join(outDir, 'world-6201-step30.json'), 'utf8'));
  const cases = JSON.parse(await readFile(path.join(outDir, 'encounter-case.json'), 'utf8'));
  const strip = ({ height, water, kind, roads, blocks, parcels, buildings, ...rest }) => rest;
  const meta = { ...world, chunks: world.chunks.map(strip), cases: Object.fromEntries(Object.entries(cases.cases).map(([name, { chunks, ...rest }]) => [name, rest])) };
  await writeFile(path.join(outDir, 'world-meta.json'), JSON.stringify(meta));
  console.log(`meta: ${(JSON.stringify(meta).length / 1e3).toFixed(0)} kB`);
}

if (!process.argv.includes('--meta-only')) {
  if (!process.argv.includes('--case-only')) await bakeWorld();
  if (!process.argv.includes('--world-only')) await bakeCases();
}
await bakeMeta();
console.log('done');
