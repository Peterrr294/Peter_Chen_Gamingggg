import { GROWTH_DNA } from './experiments/city-of-cities/growthDNA.js';

// WEB-01 site pages around the film: The Process, Urban Identities, Research. Every number is copied from a verifier's evidence or the
// compass log; every image is a real capture. Status words follow the compass: Verified is a data check, and no task is Accepted yet.
const shot = name => `./docs/assets/screenshots/procedural-mini-world/${name}.png`;
const record = file => `#files?file=./docs/procedural-mini-world/${file}`;
const GITHUB = 'https://github.com/Peterrr294/Peter_Chen_Gamingggg';

const STATUS_NOTE = {
  Implemented: 'The code exists and runs. Its results may not have been checked.',
  Verified: 'Its automated verifier passes. This checks the data, not the spatial design.',
  Prototype: 'Runs as a minimum experiment, on limited cases. Not in the main generation.',
  Historical: 'An earlier direction. Kept runnable and on record, no longer the research mainline.',
  Planned: 'Not implemented.',
};

export const PROCESS = [
  { title: 'Terrain', line: 'A city-neutral height field, water and slope.', image: 'web01-film-terrain-after', status: 'Verified', link: '#home?stage=1', action: 'Watch in the film' },
  { title: 'Terrain Analysis', line: 'The site is read before any city exists.', image: 'web01-film-analysis-after', status: 'Verified', link: '#home?stage=2', action: 'Watch in the film' },
  { title: 'Road Network', line: 'City DNA decides how streets grow on this site.', image: 'web01-film-roads-after', status: 'Verified', link: '#home?stage=3', action: 'Watch in the film' },
  { title: 'Urban Blocks', line: 'Land enclosed by the finished roads.', image: 'web01-film-blocks-after', status: 'Verified', link: '#home?stage=4', action: 'Watch in the film' },
  { title: 'Parcels', line: 'Blocks divide into lots that front a road.', image: 'web01-film-parcels-after', status: 'Verified', link: '#home?stage=5', action: 'Watch in the film' },
  { title: 'Buildings', line: 'Volumes extrude from real footprints.', image: 'web01-film-buildings-after', status: 'Verified', link: '#home?stage=6', action: 'Watch in the film' },
  { title: 'Six Urban Origins', line: 'Six cities placed by terrain suitability in one recorded world.', image: 'web01-film-origins-after', status: 'Verified', link: '#home?stage=7', action: 'Watch in the film' },
  { title: 'Procedural Urban Growth', line: 'Thirty recorded growth steps, world seed 6201.', image: 'web01-film-growth-after', status: 'Prototype', link: '#home?stage=8', action: 'Watch in the film' },
  { title: 'Urban Encounter', line: 'A controlled case study: Chicago and Fez, placed by hand.', image: 'web01-film-encounter-after', status: 'Prototype', link: '#home?stage=9', action: 'Watch in the film' },
];

// Values: experiments/seed-terrain/evidence/city-dna-comparison.json (`suitable` terrain of each DNA, 06.1 run). scripts/verify-procedural-film.mjs checks them.
export const CITIES = [
  { id: 'veniceWaterNetwork', name: 'Venice', dna: 'Water network and islands', site: 'Coast, seed 1101', fit: 0.23, roadKm: 5.21, deadEnds: 25, parcels: 535, frontage: 8.5, buildings: 438, height: 10.3, note: 'Weak terrain fit: no lagoon landform exists yet.' },
  { id: 'manhattanGrid', name: 'Manhattan', dna: 'Orthogonal grid with avenues and cross streets', site: 'Plain, seed 1101', fit: 0.8, roadKm: 18.43, deadEnds: 0, parcels: 1836, frontage: 16.6, buildings: 1679, height: 60.2, note: 'Spatial study exists. Measured values are still planned.' },
  { id: 'fezOrganicCore', name: 'Fez', dna: 'Organic historic core', site: 'Coast, seed 1101', fit: 0.43, roadKm: 6.12, deadEnds: 38, parcels: 717, frontage: 9.4, buildings: 589, height: 5.6, note: 'Prototype city of the research base. Thresholds are assumptions.' },
  { id: 'amsterdamCanalRing', name: 'Amsterdam', dna: 'Canal ring', site: 'Coast, seed 1101', fit: 0.31, roadKm: 5.68, deadEnds: 35, parcels: 564, frontage: 6.3, buildings: 513, height: 11.7, note: 'No research row. Never wins auto-match; some grown chunks stay empty.' },
  { id: 'lisbonHillCore', name: 'Lisbon', dna: 'Hills and valley axis', site: 'Coast, seed 2202', fit: 0.47, roadKm: 7.87, deadEnds: 35, parcels: 854, frontage: 7.4, buildings: 723, height: 11.6, note: 'No research row. Thresholds are assumptions.' },
  { id: 'chicagoGrid', name: 'Chicago', dna: 'Survey grid with river cut', site: 'Plain, seed 1101', fit: 0.62, roadKm: 15.36, deadEnds: 0, parcels: 2260, frontage: 6.8, buildings: 2013, height: 40.1, note: 'No research row. Road-first growth is refused on world seed 6201 (G02b).' },
];

export const RESEARCH = [
  { method: 'Landform rules over seeded noise, then derived slope and masks. Analysis reads the fields only.', title: 'Terrain-first', tasks: '02.2–02.5', status: 'Verified', question: 'Can a site be generated and read before any city exists?', output: 'A 1024 m chunk with four landform algorithms, and height, water, slope and buildability fields.', image: 'web01-film-analysis-after', parameters: 'Seed, landform, variation, transition width 32–256 m.', measured: '12 of 12 landform and seed pairs reproducible.', limits: 'Thresholds are design assumptions.', links: [['Record', record('03-generative-system/terrain-and-water.md')], ['Open', '#seedTerrain']] },
  { method: 'Weighted terrain conditions per DNA; score = fit × evidence coverage.', title: 'City DNA', tasks: '02.6, 06.1', status: 'Verified', question: 'Can cities be chosen to fit a site, and differ only by their rules?', output: 'Six DNAs ranked by terrain fit, with a manual override.', image: '06-1-six-cities-shared-terrain', parameters: 'Street spacing, lot size, floors, match weights.', measured: '72 of 72 runs valid. The original three DNAs stayed bit-identical.', limits: 'Every number is an assumption. Chicago and Amsterdam never win auto-match. Terrain fit is not identity.', links: [['Record', record('03-generative-system/city-dna-matching.md')]] },
  { method: 'Network strategy, availability field for blocks, frontage subdivision, per-parcel extrusion.', title: 'Independent City Generator', tasks: '03.1–05.1b', status: 'Verified', question: 'Does one chain turn a site and a DNA into streets, blocks, parcels and buildings?', output: 'The full single-chunk chain, watched in the film on this site.', image: '05-1-buildings-overall', parameters: 'City DNA rule tables, seed.', measured: '22 verifiers passed on 2026-10-19. Six film cities equal their 06.1 signatures.', limits: 'Heights are not measured. One tunnel defect is isolated, not fixed (mountain 7922, Chicago).', links: [['Record', record('03-generative-system/system-architecture.md')], ['Watch', '#home']] },
  { method: 'Fixed layout of nine chunks with layered rebuilds.', title: 'World Grid', tasks: '06.2', status: 'Historical', question: 'Can nine preset chunks share one world?', output: 'A 3 × 3 world with one City ID per slot and layered rebuilds.', image: '06-2-world-grid-overall', parameters: 'World seed, City ID per slot.', measured: '12 of 12 shared edges stepped at first (5.2–296 m). One City ID change rebuilds one chunk.', limits: 'World size and city borders are fixed before any rule runs. This led to the growth research.', links: [['Record', record('03-generative-system/world-grid-and-seam.md')], ['Open', '#miniWorld']] },
  { method: 'Correction inside a transition band; edges classified by geometry, landform, water and transport.', title: 'Terrain Seam', tasks: '06.3a–06.3c', status: 'Historical', question: 'Can shared edges join without hiding what cannot join?', output: 'Band-only terrain correction, a road seam, and four separate statuses for every edge.', image: '06-3c-seam-classes-overall', parameters: 'Transition width 128 m, maximum slope 35°.', measured: 'World 6201: 4 of 12 edges joined in 06.3a; 7 of 12 resolved and 4 of 4 corners shared in 06.3a-R.', limits: 'Mountain edges stay reported escarpment candidates. Not applied to grown chunks.', links: [['Record', record('03-generative-system/world-grid-and-seam.md')]] },
  { method: 'Network switch per edge; parcel and building rules blended by an influence field.', title: 'City Invasion & Fusion', tasks: '07.1, 07.1a', status: 'Historical', question: 'Can one city\'s rules invade a neighbour and form a mixed boundary?', output: 'One source, one target, blended by an influence weight.', image: '07-1a-original-vs-fused-compare', parameters: 'Strength, radius, id mode.', measured: 'Unexplained changes at weight 0: 46 parcels with legacy ids, 0 with spatial ids (seed 6201).', limits: 'One boundary only. Not on the public site yet.', links: [['Record', record('03-generative-system/city-influence.md')]] },
  { method: 'Suitability-based placement, then a seeded bid among cities and a weighted choice of cell.', title: 'Multi-Origin Growth', tasks: 'G01, G02', status: 'Verified', question: 'Can six cities grow into a world whose size and borders are outcomes?', output: 'Six origins and one chunk per step, reproducible with save and load.', image: 'g02-growth-seed-compare', parameters: '4 placement and 5 growth parameters, all design hypotheses.', measured: 'Seeds 6201, 6202, 6203: 30 steps, 36 chunks, equal in Node and the browser.', limits: 'City size is nearly fixed by the scheduler. Some Amsterdam chunks are empty. No continuous seams.', links: [['G01', record('A-City-of-Cities/G01-Multi-Origin-Initialization.md')], ['G02', record('A-City-of-Cities/G02-Procedural-Urban-Growth.md')], ['Open', '#world']] },
  { method: 'A read-only analysis of the growth record, recomputed after each step.', title: 'Urban Territory', tasks: 'G03a', status: 'Verified', question: 'Can growth be read as organised space without changing it?', output: 'Territories, non-urban land, boundary classes and a relationship graph.', image: 'g03a-territory-step30', parameters: 'Constraint rules (slope, buildable share, water share).', measured: 'At step 30: 1, 4 and 0 shared edges on the three seeds. Built footprint 14–19 % of coverage.', limits: 'Cities rarely meet. Only the steep-terrain rule fires. Barrier evidence is a straight line, not a route.', links: [['Record', record('A-City-of-Cities/G03a-Urban-Territory.md')]] },
  { method: 'New chunks inherit the grid anchor and height centre of their parent; roads join at ports.', title: 'Morphological Continuity', tasks: 'G02b', status: 'Prototype', question: 'Does a grown chunk continue its city\'s structure, or only carry its City ID?', output: 'Road-first growth for Manhattan and Fez on seed 6201.', image: 'g02b-manhattan-three-chunks', parameters: 'Inherited grid axis and phases, inherited height centre.', measured: 'Manhattan: 17 of 17 parent roads joined at 0 m position error, height steps up to 2.41 m. Regenerating the same cells independently aligned 0 of 18. Chicago refused, with measured reasons.', limits: 'Not used by the multi-city scheduler. Water cities not implemented. One Manhattan road end stays unjoined.', links: [['Record', record('A-City-of-Cities/G02b-Morphological-Growth.md')]] },
  { method: 'Both boundaries are read; the edge resolves by connection, a plan, or separation.', title: 'Urban Encounter', tasks: 'G03b', status: 'Prototype', question: 'When two cities meet, can the edge resolve by connection, separation or a plan?', output: 'A Chicago × Fez experiment on a hand-placed test fixture, in three scenarios.', image: 'g03b-before-after-compare', parameters: 'Fixture positions on seed 6201, join tolerance.', measured: '2 cross-city joins at 0.3 m. The connector plan of 39.7 m is pending, not generated.', limits: 'The fixture is placed by hand, not by growth. All thresholds are hypotheses.', links: [['Record', record('A-City-of-Cities/G03b-Urban-Encounter.md')]] },
];

const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const link = (href, text, className) => { const a = element('a', className, text); a.href = href; if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return a; };
const statusTag = status => { const tag = element('span', `tag tag-${status.toLowerCase()}`, status); tag.title = STATUS_NOTE[status] ?? ''; return tag; };
const heading = (title, lead) => { const head = element('header', 'page-head'); head.append(element('h1', '', title), element('p', 'lead', lead)); return head; };

const nextLink = (href, text) => { const p = element('p', 'next-link'); p.append(link(href, text, 'more')); return p; };

export function showProcess(content, images) {
  const page = element('section', 'web-page');
  page.append(heading('The Process', 'Part I generates one city live on this page. Part II replays a recorded world and one controlled case study. They are separate runs, with different terrain.'));
  const grid = element('ol', 'process-grid');
  PROCESS.forEach((stage, index) => {
    const item = element('li', 'process-item');
    const picture = element('a', 'figure-link');
    picture.href = stage.link;
    const image = element('img');
    image.src = images[shot(stage.image)];
    image.alt = `${stage.title}: real capture from the running generator`;
    image.loading = 'lazy';
    picture.append(image);
    const title = element('h2', '', `${index + 1}  ${stage.title} `);
    title.append(statusTag(stage.status));
    item.append(picture, title, element('p', '', stage.line), link(stage.link, stage.action, 'more'));
    grid.append(item);
  });
  page.append(grid, nextLink('#cities', 'Next: six urban identities →'));
  content.append(page);
}

export function showCities(content, images) {
  const page = element('section', 'web-page');
  page.append(heading('Urban Identities', 'Six rule sets, shown at one scale and one camera angle on the terrain each fits best. The same generator runs in every case; only the rules and the site differ.'));
  const grid = element('div', 'city-grid');
  for (const city of CITIES) {
    const card = element('article', 'city-card');
    const picture = element('a', 'figure-link');
    picture.href = `#home?city=${city.id}&t=51.99&cam=axon`;
    const image = element('img');
    image.src = images[shot(`web01-city-${city.id}-after`)];
    image.alt = `${city.name}: generated chunk, axonometric view`;
    image.loading = 'lazy';
    picture.append(image);
    const facts = element('dl', 'facts');
    for (const [term, value] of [
      ['Streets', `${city.roadKm.toFixed(1)} km · ${city.deadEnds} % dead ends`],
      ['Parcels', `${city.parcels.toLocaleString('en-US')} · ${city.frontage.toFixed(1)} m frontage`],
      ['Buildings', `${city.buildings.toLocaleString('en-US')} · ${city.height.toFixed(1)} m mean height`],
      ['Terrain fit', `${city.fit.toFixed(2)} on ${city.site}`],
    ]) facts.append(element('dt', '', term), element('dd', '', value));
    const growth = element('p', 'hypothesis');
    growth.append(element('strong', '', 'Growth behaviour, hypothesis: '), `${GROWTH_DNA[city.id].hypothesis}.`);
    card.append(picture, element('h2', '', city.name), element('p', 'dna', city.dna), facts, growth, element('p', 'note', city.note), link(picture.href, 'Watch this city generate', 'more'));
    grid.append(card);
  }
  page.append(grid);
  page.append(element('p', 'note page-note', 'Measured from the 06.1 verifier. Heights and spacing are uncalibrated design assumptions, and growth behaviours are hypotheses in the growth rules. Whether a chunk reads as its city is an open review question.'), nextLink('#home?stage=8', 'Next: watch them grow →'), nextLink('#research', 'Or read the research and evidence →'));
  content.append(page);
}

export function showResearch(content, images) {
  const page = element('section', 'web-page');
  page.append(heading('Research', 'How can distinct urban identities emerge, expand, and collectively form a world through procedural growth?'));
  const legend = element('ul', 'legend');
  for (const [status, note] of Object.entries(STATUS_NOTE)) {
    const item = element('li');
    item.append(statusTag(status), ` ${note}`);
    legend.append(item);
  }
  const accepted = element('li');
  accepted.append(element('span', 'tag tag-accepted', 'Accepted'), ' A recorded human review decision. No task has one yet.');
  legend.append(accepted);
  page.append(legend);
  const archive = element('details', 'research-archive');
  archive.append(element('summary', '', 'Research Archive: World Grid, Terrain Seam, City Invasion & Fusion'));
  for (const item of RESEARCH) {
    const row = element('article', 'research-item');
    const text = element('div');
    const title = element('h2', '', `${item.title} `);
    title.append(statusTag(item.status));
    text.append(title, element('p', 'tasks', `Tasks ${item.tasks}`), element('p', 'question', item.question));
    const facts = element('dl', 'facts');
    for (const [term, value] of [['Output', item.output], ['Method', item.method], ['Parameters', item.parameters], ['Measured', item.measured], ['Limits', item.limits]]) facts.append(element('dt', '', term), element('dd', '', value));
    const links = element('p', 'links');
    item.links.forEach(([label, href]) => links.append(link(href, label, 'more')));
    text.append(facts, links);
    const image = element('img');
    image.src = images[shot(item.image)];
    image.alt = `${item.title}: real capture`;
    image.loading = 'lazy';
    row.append(text, image);
    (item.status === 'Historical' ? archive : page).append(row);
  }
  page.append(archive);
  const more = element('p', 'links page-note');
  more.append(link(record('README.md'), 'Knowledge base', 'more'), link(record('FINAL-EXPERIMENT-LOG.md'), 'Compass and full log', 'more'), link(record('PROJECT-FEEDBACK.md'), 'AI feedback', 'more'), link(GITHUB, 'GitHub', 'more'));
  page.append(more);
  content.append(page);
}

export function showArchive(content, sections) {
  const page = element('section', 'web-page');
  page.append(heading('Archive', 'Earlier course exercises and experiments. All of them still run, and their old links still work.'));
  const grid = element('div', 'archive-grid');
  for (const [key, section] of Object.entries(sections)) {
    if (section.main || section.parent) continue;
    const card = link(`#${key}`, '', 'archive-card');
    card.append(element('h2', '', section.title.split(' / ')[0]), element('p', '', section.description));
    grid.append(card);
  }
  page.append(grid);
  const more = element('p', 'links page-note');
  more.append(link(GITHUB, 'GitHub repository', 'more'));
  page.append(more);
  content.append(page);
}
