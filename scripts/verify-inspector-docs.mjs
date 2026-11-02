// WEB-01d audit of the Algorithm Inspector against the code.
// Automatic: bound files and symbols exist; process names in the summaries are bound symbols; every parameter row of every stage and city has a real value;
// a changed source file marks its summary as needing review.
// Not automatic: whether an explanation is right. That is the checklist in experiments/procedural-film/algorithm-review.json.
// Usage: node scripts/verify-inspector-docs.mjs [--record-review "<who>"]   (records current file hashes after a real re-read of the summaries)
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = file => import(pathToFileURL(path.join(root, file)));
const { ALGORITHM_SOURCES } = await mod('experiments/procedural-film/algorithmSources.js');
const content = await mod('experiments/procedural-film/inspectorContent.js');
const { FILM_CITIES } = await mod('experiments/procedural-film/stageManifest.js');
const reviewFile = path.join(root, 'experiments/procedural-film/algorithm-review.json');
const failures = []; const warnings = [];
const fail = text => { failures.push(text); console.log(`FAIL  ${text}`); };
const hashOf = async file => createHash('sha256').update((await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

// 1. Files and symbols.
let symbols = 0;
const known = new Map();
for (const [stage, modules] of Object.entries(ALGORITHM_SOURCES)) {
  known.set(stage, new Set());
  for (const { file, symbols: names } of modules) {
    try { await access(path.join(root, file)); } catch { fail(`${stage}: ${file} does not exist`); continue; }
    const source = await readFile(path.join(root, file), 'utf8');
    for (const name of names) {
      symbols += 1;
      known.get(stage).add(name);
      if (!new RegExp(`\\b${name}\\b`).test(source)) fail(`${stage}: ${name} is not in ${file}`);
    }
  }
}
console.log(`files and symbols: ${symbols} symbols checked`);

// 2. Function names in the summaries must be bound to a source.
const callsIn = text => [...text.matchAll(/([A-Za-z_]+)(?:\.([A-Za-z_]+))?\(\)/g)].map(match => match[2] ?? match[1]);
for (const [stage, flow] of Object.entries({ ...content.STAGE_FLOW, ...content.WORLD_FLOW })) {
  for (const name of callsIn(flow.process)) if (!known.get(stage)?.has(name)) fail(`${stage}: the summary names ${name}() but no source binds it`);
}

// 3. Links of How it works point to files that exist.
const linkFile = href => href.split('file=./')[1];
for (const [stage, how] of Object.entries(content.WORLD_HOW)) {
  for (const href of [...how.files.map(item => item[1]), how.more]) { try { await access(path.join(root, linkFile(href))); } catch { fail(`${stage}: broken link ${href}`); } }
}

// 4. Every row has a real value, on real data of all six cities and the whole recorded run.
const bad = value => (value && value.na ? false : typeof value !== 'string' || /undefined|NaN|\[object|null/.test(value));
const checkRows = (label, rows) => { for (const [term, value] of rows) if (bad(value)) fail(`${label}: ${term} = ${JSON.stringify(value)}`); };
const seed = 'experiments/seed-terrain/';
const [{ createSeedTerrainConfig }, { generateChunk }, { applyNeighborConstraints, deriveFields }, { analyseTerrain }, { matchCity }, { generateNetwork }, { generateBlocks }, { generateParcels }, { generateBuildings }] = await Promise.all(['config', 'TerrainGenerator', 'TerrainFields', 'TerrainAnalysis', 'CityMatcher', 'NetworkGenerator', 'BlockGenerator', 'ParcelGenerator', 'BuildingGenerator'].map(name => mod(`${seed}${name}.js`)));
let rowsChecked = 0;
for (const [city, { landform, seed: terrainSeed }] of Object.entries(FILM_CITIES)) {
  const config = createSeedTerrainConfig({ landform, seed: terrainSeed });
  const fields = deriveFields(generateChunk(config), config);
  applyNeighborConstraints(fields);
  const analysis = analyseTerrain(fields, config);
  const cityMatch = matchCity(analysis, { override: city });
  const network = generateNetwork(fields, analysis, cityMatch, config, { loops: true });
  const blocks = generateBlocks(fields, analysis, network, cityMatch, config);
  const parcels = generateParcels(blocks, fields, network, cityMatch, config);
  const buildings = generateBuildings(parcels, fields, cityMatch, config);
  const snapshot = { config, fields, analysis, cityMatch, network, blocks, parcels, buildings };
  checkRows(`${city} identity`, content.identityRows(snapshot));
  for (const stage of Object.keys(content.STAGE_FLOW)) {
    const rows = content.paramRows(stage, snapshot);
    if (rows.length < 5) fail(`${city} ${stage}: only ${rows.length} rows`);
    checkRows(`${city} ${stage}`, rows);
    rowsChecked += rows.length;
    const how = content.howItWorks(stage, snapshot);
    if (!how.steps.length) fail(`${city} ${stage}: no steps`);
    for (const step of how.steps) if (/undefined|NaN/.test(step)) fail(`${city} ${stage} step: ${step}`);
    for (const [, href] of how.files) { try { await access(path.join(root, linkFile(href))); } catch { fail(`${stage}: broken link ${href}`); } }
    try { await access(path.join(root, linkFile(how.more))); } catch { fail(`${stage}: broken link ${how.more}`); }
  }
}
const world = JSON.parse(await readFile(path.join(root, 'experiments/procedural-film/world/world-6201-step30.json'), 'utf8'));
for (const city of world.cities) { const rows = content.originParamRows(world, city.cityId); checkRows(`origin ${city.cityId}`, rows); rowsChecked += rows.length; }
for (const event of world.history) { const rows = content.growthParamRows(world, event); checkRows(`growth step ${event.step}`, rows); rowsChecked += rows.length; }
const cases = JSON.parse(await readFile(path.join(root, 'experiments/procedural-film/world/encounter-case.json'), 'utf8')).cases;
for (const [name, item] of Object.entries(cases)) { const rows = content.encounterParamRows(item); checkRows(`case ${name}`, rows); rowsChecked += rows.length; }
console.log(`parameter rows: ${rowsChecked} checked on real data`);

// 4b. Each reviewed statement must still be shown, and its symbol must exist where the record says.
const shownSource = await readFile(path.join(root, 'experiments/procedural-film/inspectorContent.js'), 'utf8');
const preReview = JSON.parse(await readFile(reviewFile, 'utf8'));
const lineOf = (source, symbol) => source.split('\n').findIndex(line => new RegExp(`\\b${symbol}\\b`).test(line)) + 1;
const rows = [];
for (const [stage, entry] of Object.entries(preReview.stages)) {
  for (const item of entry.checklist) {
    if (!shownSource.includes(item.displayed)) fail(`${stage}: reviewed text is no longer shown: ${item.displayed}`);
    const source = await readFile(path.join(root, item.file), 'utf8').catch(() => '');
    const line = lineOf(source, item.symbol);
    if (!line) fail(`${stage}: ${item.symbol} is not in ${item.file}`);
    rows.push({ stage, ...item, line });
  }
}
console.log(`reviewed statements: ${rows.length}, each still shown and located`);
if (process.argv.includes('--write-report')) {
  const counts = rows.reduce((sum, row) => ({ ...sum, [row.assessment]: (sum[row.assessment] ?? 0) + 1 }), {});
  const cell = text => String(text).replace(/\|/g, '\\|');
  const out = [
    '# Algorithm Inspector Review',
    '',
    `Written for the author, to confirm each statement. Generated by \`node scripts/verify-inspector-docs.mjs --write-report\` from [algorithm-review.json](../../../experiments/procedural-film/algorithm-review.json). AI comparison with the code: ${preReview.reviewedAt}.`,
    '',
    `**Result:** ${Object.entries(counts).map(([name, value]) => `${name} ${value}`).join(' · ')}. **Human review: 0 of ${rows.length} signed.** "Accurate" is an AI reading of the code, not your approval. To sign a statement, tick its box and set \`humanReview\` in the JSON file.`,
    '',
    '| ✓ | Stage | Displayed explanation | Source | Parameters | AI assessment | Correction | Human review |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| [ ] | ${row.stage} | ${cell(row.displayed)} | [${row.file.split('/').pop()}:${row.line}](../../../${row.file}) \`${row.symbol}\` | ${cell(row.parameters)} | ${row.assessment} | ${cell(row.correction)} | ${row.humanReview} |`),
    '',
    'Parameters marked as assumptions or hypotheses are design choices, not measured facts. A passing audit proves that references exist. It does not prove that an explanation is right.',
    '',
  ];
  const { writeFile: write } = await import('node:fs/promises');
  await write(path.join(root, 'docs/procedural-mini-world/A-City-of-Cities/Algorithm-Review.md'), out.join('\n'));
  console.log('report written');
}

// 5. Changed source files send their summaries back to review.
const review = JSON.parse(await readFile(reviewFile, 'utf8'));
const record = process.argv.indexOf('--record-review');
for (const [stage, modules] of Object.entries(ALGORITHM_SOURCES)) {
  const entry = review.stages[stage];
  if (!entry) { fail(`${stage}: no review entry`); continue; }
  for (const { file } of modules) {
    const current = await hashOf(file);
    if (record !== -1) entry.files[file] = current;
    else if (entry.files[file] !== current) { warnings.push(`${stage}: ${file} changed since the review of ${review.reviewedAt}. Re-read this summary against the code.`); }
  }
  for (const item of entry.checklist) if (!item.basis) fail(`${stage}: checklist item without a basis: ${item.displayed}`);
}
if (record !== -1) {
  review.reviewedAt = new Date().toISOString().slice(0, 10);
  review.reviewedBy = process.argv[record + 1] ?? 'unknown';
  await writeFile(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  console.log(`review recorded by ${review.reviewedBy}`);
}
for (const text of warnings) { console.log(`NEEDS REVIEW  ${text}`); failures.push(text); }
const items = Object.values(review.stages).reduce((sum, stage) => sum + stage.checklist.length, 0);
console.log(`semantic checklist: ${items} statements, reviewed by ${review.reviewedBy} on ${review.reviewedAt}; human review: ${review.humanReview}`);
console.log(failures.length ? `${failures.length} problem(s)` : 'audit passed. This proves references, not that the explanations are right.');
process.exit(failures.length ? 1 : 0);
