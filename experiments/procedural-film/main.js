import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHAPTERS, DEFAULT_CITY, DURATION, FILM_CITIES, PART_ONE_END, PART_ONE_LAST, STAGES, STAGE_START, TOUR, stageEnd } from './stageManifest.js';
import { CASE_ORDER, CASE_SECONDS, GROWTH_STEP_SECONDS, REVEAL_SECONDS, sceneOf } from './sceneManifest.js';
import { WorldScene } from './WorldScene.js';
import { SnapshotSource } from './SnapshotSource.js';
import { TimelineController } from './TimelineController.js';
import { FilmScene } from './FilmScene.js';
import { CameraRig } from './CameraRig.js';
import { STAGE_FLOW, WORLD_FLOW, WORLD_HOW, encounterParamRows, growthParamRows, howItWorks, identityRows, liveRows, objectRows, originParamRows, paramRows, sourceRows, worldChunkRows, worldLiveRows } from './inspectorContent.js';

// WEB-01b Interactive Procedural Film: one real chunk from terrain to buildings. This file holds the playback state and UI only;
// data comes from the unchanged generators through SnapshotSource, geometry from FilmScene.
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const STORAGE_KEY = 'procedural-film-state';
const LANDFORM_LABEL = { plain: 'Plain', coast: 'Coast', riverValley: 'River valley', mountain: 'Mountain' };
const stills = import.meta.glob('../../docs/assets/screenshots/procedural-mini-world/web01-*.png', { eager: true, query: '?url', import: 'default' });
const stillOf = name => stills[`../../docs/assets/screenshots/procedural-mini-world/web01-${name}-after.png`];

const readStored = () => { try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; } };
const store = value => { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode: the URL still holds the state */ } };

const stored = readStored();
const hasDeepLink = query.has('stage') || query.has('t') || query.has('city');
const requestedCity = query.get('city') ?? (hasDeepLink ? null : stored.city);
const state = {
  city: FILM_CITIES[requestedCity] ? requestedCity : DEFAULT_CITY,
  camera: ['film', 'terrain', 'axon', 'plan', 'close'].includes(query.get('cam')) ? query.get('cam') : 'film',
  // Guided Tour for a first visit; a deep link or an earlier choice opens the free player. Both use the same timeline and scene.
  view: query.get('view') === 'explore' || query.get('view') === 'tour' ? query.get('view') : hasDeepLink || stored.view === 'explore' ? 'explore' : 'tour',
  motionOff: matchMedia('(prefers-reduced-motion: reduce)').matches,
  ready: false,
  // One state for the player, the Inspector and the debug layers. Presentation time lives in the timeline; the snapshot is never changed.
  mode: (query.get('mode') ?? stored.mode) === 'inspect' ? 'inspect' : 'watch',
  inspectorCollapsed: false,
  selected: null,
  worldCity: null,
  worldLayers: { names: true },
  lightWorld: false, // on slow devices Part II drops building volumes and lots, and says so
  surface: 'none',
  layers: { roads: true, buildings: true, blockLines: true, parcelLines: true, nodes: false, footprints: false },
};
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
if (query.get('capture') === '1') document.body.classList.add('capture');

// ---------- Renderer (or no WebGL: real captured stills on the same timeline) ----------
function createRenderer() {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas: $('filmCanvas'), antialias: true, preserveDrawingBuffer: true }); // rendered on demand: a paused frame must stay on screen
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xf1eee8);
    return renderer;
  } catch { return null; }
}
const renderer = createRenderer();
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xf7f5f0, 0xa8a297, 1.55));
const sun = new THREE.DirectionalLight(0xfff6ea, 1.45);
sun.position.set(-1400, 2400, 900);
scene.add(sun);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 120000);
const controls = renderer ? new OrbitControls(camera, renderer.domElement) : null;
if (controls) { controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minZoom = 0.15; controls.maxZoom = 16; }
const rig = renderer ? new CameraRig(camera, controls) : null;
const film = renderer ? new FilmScene(scene) : null;
const world = renderer ? new WorldScene(scene) : null;
const ORIGIN_START = STAGE_START[6]; const GROWTH_START = STAGE_START[7]; const CASE_START = STAGE_START[8];
const WORLD_URLS = { world: new URL('./world/world-6201-step30.json', import.meta.url).href, cases: new URL('./world/encounter-case.json', import.meta.url).href };
const replay = { world: { status: 'idle', done: 0, total: 36, info: null }, cases: { status: 'idle', done: 0, total: 0, info: null } };
const inWorld = () => timeline.t >= PART_ONE_END;
const inCase = () => timeline.t >= CASE_START;
const source = new SnapshotSource();
let snapshot = null;
let dirty = true;

// ---------- UI ----------
const timeline = new TimelineController(() => { syncUI(); dirty = true; });
const storedRate = Number(query.get('speed') ?? stored.rate);
if (SPEEDS.includes(storedRate)) timeline.rate = storedRate;
$('rate').value = String(timeline.rate);
const showStill = name => { const url = stillOf(name); $('still').hidden = !url; if (url) $('still').src = url; };

for (const [id, city] of Object.entries(FILM_CITIES)) $('city').add(new Option(city.name, id, false, id === state.city));
$('camera').value = state.camera;
$('chapters').append(...CHAPTERS.map((chapter, index) => {
  const span = document.createElement('span');
  span.textContent = chapter.title;
  span.dataset.part = String(index);
  const seconds = STAGES.filter((stage, k) => (index === 0 ? k <= PART_ONE_LAST : k > PART_ONE_LAST)).reduce((sum, stage) => sum + stage.duration, 0);
  span.style.flex = `${seconds} 1 0`;
  return span;
}));
STAGES.forEach((stage, index) => {
  const li = document.createElement('li');
  li.style.flex = `${stage.duration} 1 0`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = stage.title;
  button.setAttribute('aria-label', `Go to stage ${index + 1}: ${stage.title}`);
  button.addEventListener('click', () => timeline.goToStage(index));
  li.append(button);
  $('stageTicks').append(li);
  if (index > PART_ONE_LAST) return;
  const item = document.createElement('li');
  item.textContent = stage.title;
  item.dataset.stage = stage.id;
  $('loadingStages').append(item);
});

const number = value => Math.round(value).toLocaleString('en-US');
function stageMetric(stage) {
  if (stage.chapter === 2) {
    if (!worldReady(stage.id === 'encounter' ? 'cases' : 'world')) return 'Loading the recorded run';
    if (stage.id === 'encounter') { const item = currentCase(); return item ? `${item.title} · ${item.encounter.currentRelationship}` : ''; }
    const c = world.counts(timeline.t);
    return `${c.chunks} chunks · ${c.steps} of ${replay.world.info.history.length} growth steps · ${c.buildings.toLocaleString('en-US')} buildings`;
  }
  if (!snapshot) return '';
  const { fields, analysis, network, blocks, parcels, buildings } = snapshot;
  const live = film?.liveCount(stage.id) ?? null;
  switch (stage.id) {
    case 'terrain': return `Height ${fields.stats.minHeight.toFixed(0)}–${fields.stats.maxHeight.toFixed(0)} m · water ${(fields.stats.waterRatio * 100).toFixed(1)} % · buildable ${(fields.stats.buildableRatio * 100).toFixed(1)} %`;
    case 'analysis': return `${analysis.buildableRegions.significantCount} buildable region(s) · ${analysis.waterRegions.count} water region(s)`;
    case 'roads': return `${((live ?? 0) / 1000).toFixed(1)} of ${(network.stats.roadLength / 1000).toFixed(1)} km · ${network.stats.edges} edges · ${network.strategy}`;
    case 'blocks': return `${number(live ?? 0)} of ${number(blocks.stats.blocks)} blocks`;
    case 'parcels': return `${number(live ?? 0)} of ${number(parcels.stats.parcels)} parcels · mean frontage ${parcels.stats.meanFrontage.toFixed(1)} m`;
    case 'buildings': return `${number(live ?? 0)} of ${number(buildings.stats.buildings)} buildings · mean height ${buildings.stats.meanHeight.toFixed(1)} m (design assumption)`;
    default: return '';
  }
}

let shownStage = -1;
let lastStored = 0;
function syncUI() {
  const k = timeline.stage;
  const stage = STAGES[k];
  film?.setTime(timeline.t);
  syncWorld();
  if (k !== shownStage) {
    shownStage = k;
    $('stageIndex').textContent = `${k <= PART_ONE_LAST ? 'Part I' : 'Part II'} · ${k + 1} / ${STAGES.length}`;
    $('chapters').querySelectorAll('span').forEach(span => { span.dataset.on = String(Number(span.dataset.part) === (k <= PART_ONE_LAST ? 0 : 1)); });
    $('stageTitle').textContent = stage.title;
    $('stageStatus').textContent = `${stage.status} · not yet accepted · task ${stage.task}`;
    $('stageStatus').dataset.status = stage.status;
    $('stageLine').textContent = stage.line;
    [...$('stageTicks').querySelectorAll('button')].forEach((button, index) => {
      if (index === k) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    if (!renderer) showStill(`film-${stage.id}`);
    renderInspectorStage();
  }
  $('stageMetric').textContent = stageMetric(stage);
  renderInspectorLive();
  $('scrub').value = String(Math.round((timeline.t / DURATION) * 1000));
  $('scrub').setAttribute('aria-valuetext', `${stage.title}, ${Math.round(timeline.t)} of ${DURATION} seconds`);
  $('play').textContent = timeline.playing ? 'Pause' : timeline.t >= DURATION ? 'Replay' : 'Play';
  document.body.classList.toggle('film-underway', timeline.t > STAGE_START[1]);
  const now = performance.now();
  if (now - lastStored > 500 || !timeline.playing) {
    lastStored = now;
    store({ city: state.city, t: +timeline.t.toFixed(2), camera: state.camera, rate: timeline.rate, mode: state.mode, view: state.view });
  }
  renderTour();
}

// ---------- Guided Tour ----------
const STAGE_POS = id => STAGES.findIndex(stage => stage.id === id);
const chapterStart = index => STAGE_START[STAGE_POS(TOUR[index].from)];
const chapterEnd = index => stageEnd(STAGE_POS(TOUR[index].to));
const chapterAt = t => { let found = 0; TOUR.forEach((_, index) => { if (t >= chapterStart(index)) found = index; }); return found; };
let shownTour = '';
function renderTour() {
  $('tourPlay').textContent = timeline.playing ? 'Pause' : timeline.t >= DURATION ? 'Replay' : 'Play';
  const k = chapterAt(timeline.t);
  const stage = STAGES[timeline.stage];
  const key = `${k}|${stage.id}`;
  if (key === shownTour) return;
  shownTour = key;
  const chapter = TOUR[k];
  $('tourIndex').textContent = `Chapter ${k + 1} of ${TOUR.length} · ${k <= 2 ? 'Part I, live' : k === 5 ? 'Part II, controlled experiment' : 'Part II, recorded'}`;
  $('tourTitle').textContent = chapter.title;
  $('tourLine').textContent = chapter.line;
  $('tourStage').textContent = `Stage: ${stage.title} · ${chapter.status} · not yet accepted`;
  $('tourPrev').disabled = k === 0;
  $('tourNext').textContent = k === TOUR.length - 1 ? 'Explore freely' : 'Next Chapter';
}
function goToChapter(index) {
  if (index >= TOUR.length) { setView('explore'); return; }
  const k = Math.max(0, index);
  if (state.motionOff) { timeline.seek(chapterEnd(k)); return; }
  timeline.seek(chapterStart(k));
  timeline.play();
}
function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  $('viewTour').setAttribute('aria-pressed', String(view === 'tour'));
  $('viewExplore').setAttribute('aria-pressed', String(view === 'explore'));
  store({ city: state.city, t: +timeline.t.toFixed(2), camera: state.camera, rate: timeline.rate, mode: state.mode, view });
  if (view === 'tour' && state.mode === 'inspect') setMode('watch');
  if (renderer) resize();
}

function syncCityInfo() {
  const city = FILM_CITIES[state.city];
  const label = inCase() ? 'Case study · not the recorded world' : inWorld() ? `World seed 6201${worldReady('world') ? ` · step ${world.counts(timeline.t).steps} of 30 · ${world.counts(timeline.t).chunks} chunks` : ''}` : `${city.name} · ${LANDFORM_LABEL[city.landform]} · terrain seed ${city.seed}`;
  if ($('readout').textContent !== label) $('readout').textContent = label;
  $('rawLink').href = `../../experiments/seed-terrain/index.html?landform=${city.landform}&seed=${city.seed}&dna=${state.city}&view=buildings`;
  if (!snapshot) return;
  const { network, blocks, parcels, buildings, timings } = snapshot;
  $('details').replaceChildren(...[
    ['Signatures', `${network.signature} ${blocks.signature} ${parcels.signature} ${buildings.signature}`],
    ['Generation', `${Object.values(timings).reduce((a, b) => a + b, 0)} ms`],
    ['DNA', network.strategy],
  ].flatMap(([term, value]) => { const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = value; return [dt, dd]; }));
}

// ---------- Algorithm Inspector: reads the snapshot and the timeline, writes nothing back ----------
const fillRows = (list, rows) => list.replaceChildren(...rows.flatMap(([term, value]) => {
  const dt = document.createElement('dt'); dt.textContent = term;
  const dd = document.createElement('dd');
  if (value && value.na) { dd.className = 'na'; dd.textContent = `Not Available: ${value.reason}`; } else dd.textContent = value;
  return [dt, dd];
}));
const inspecting = () => state.mode === 'inspect' && snapshot;

// ---------- Part II: world replay, loaded when needed. The timeline waits for its data instead of playing an empty scene ----------
const worldReady = kind => replay[kind].status === 'ready';
const neededReplay = t => (t >= CASE_START ? 'cases' : t >= PART_ONE_END ? 'world' : null);

function requestReplay(kind) {
  if (!world || replay[kind].status !== 'idle') return; // a failure stays visible until the viewer retries
  replay[kind].status = 'loading';
  replay[kind].done = 0;
  const worker = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
  worker.onerror = event => { replay[kind].status = 'failed'; replay[kind].error = event.message; worker.terminate(); syncUI(); };
  worker.onmessage = ({ data }) => {
    if (data.type === 'chunk') {
      world.addChunk(data.group, data.meta, data.geometry);
      replay[kind].done = data.done; replay[kind].total = data.total;
    } else if (data.type === 'error') {
      replay[kind].status = 'failed'; replay[kind].error = data.message; worker.terminate();
    } else {
      worker.terminate();
      replay[kind].info = data.info;
      if (kind === 'world') {
        if (query.get('light') === '1') state.lightWorld = false;
        world.scheduleWorld(data.info, ORIGIN_START + 2, GROWTH_START, GROWTH_START + 1);
      } else world.scheduleCases(data.info, CASE_START);
      replay[kind].status = 'ready';
      if (world.groups.has('world') && worldReady('world')) configureWorldCamera();
      if (query.get('light') === '1') setLightWorld();
      shownWorldKey = '';
      renderInspector(); // the panel may have opened before the data arrived
      dirty = true;
    }
    syncUI();
  };
  worker.postMessage({ kind, url: WORLD_URLS[kind] });
}

function configureWorldCamera() {
  const records = world.groups.get('world');
  const cores = records.filter(record => record.meta.role === 'core');
  const keys = [{ t: GROWTH_START + 0.5, box: world.boxOf(cores) }];
  const sorted = records.filter(record => record.meta.role !== 'core').sort((a, b) => a.meta.step - b.meta.step);
  sorted.forEach((record, index) => keys.push({ t: record.start + GROWTH_STEP_SECONDS, box: world.boxOf([...cores, ...sorted.slice(0, index + 1)]) }));
  const cases = worldReady('cases') ? CASE_ORDER.map((name, index) => ({ t: CASE_START + index * CASE_SECONDS, span: CASE_SECONDS, box: world.boxOf(world.groups.get(name)) })) : null;
  rig.worldKeys = { keys, cases };
  rig.scenePreset = name => {
    const box = world.boxOf(world.visibleRecords()) ?? keys[0].box;
    if (name === 'plan') return rig.fit(0.66, 1.22, 1.06, box);
    if (name === 'encounter') {
      const place = currentCase()?.encounter.boundaryLocation;
      const point = place?.edges?.[0]?.point ?? place?.point; // a shared edge, or the gap of the barrier scenario
      if (!point) return rig.fit(0.78, 0.6, 1.1, box);
      return rig.fit(0.56, 0.86, 1.05, { minX: point.x - 512, maxX: point.x + 512, minZ: point.z - 512, maxZ: point.z + 512, minY: box.minY, maxY: box.maxY });
    }
    if (name === 'close') { const focus = state.worldCity ? world.recordsOf(state.worldCity) : world.visibleRecords().slice(0, 1); return rig.fit(0.78, 0.6, 1.1, world.boxOf(focus) ?? box); }
    return rig.fit(0.78, 0.6, 1.08, box);
  };
}

let wasWorld = false;
function syncWorld() {
  if (!film) return;
  const here = inWorld();
  if (here !== wasWorld) {
    wasWorld = here;
    film.setVisible(!here);
    world.root.visible = here;
    if (state.selected) select(null);
    state.worldCity = null;
    if (!here) rig.scenePreset = null;
    else if (worldReady('world')) configureWorldCamera();
    // The two parts have different coordinates: leave a free camera behind and follow the film.
    if (state.camera !== 'film') { state.camera = 'film'; $('camera').value = 'film'; }
    syncCameraOptions();
    rig.mode = 'film'; rig.tween = null;
    $('inLayers').replaceChildren();
    renderInspectorStage();
  }
  syncCameraOptions();
  const need = neededReplay(timeline.t);
  timeline.blocked = Boolean(need && !worldReady(need));
  if (need && !worldReady(need)) requestReplay(need);
  else if (timeline.t > 30 && worldReady('world') === false && replay.world.status === 'idle') requestReplay('world');
  if (timeline.t > GROWTH_START + 20) requestReplay('cases');
  if (here && (worldReady('world') || worldReady('cases'))) world.setTime(timeline.t);
  if (state.ready) {
    const waiting = timeline.blocked;
    if (waiting) {
      const info = replay[need];
      $('loading').hidden = false;
      $('loadingTitle').textContent = info.status === 'failed' ? `The recorded run could not load: ${info.error}` : `Loading the recorded run: ${info.done} of ${info.total || '…'} chunks`;
      $('loadingStages').hidden = true;
      $('retry').hidden = info.status !== 'failed';
    } else if (document.body.dataset.waiting === 'true') { $('loading').hidden = true; $('loadingStages').hidden = false; }
    document.body.dataset.waiting = String(waiting);
  }
  const card = chapterCard(timeline.t);
  $('chapterCard').hidden = !card;
  if (card) { $('chapterTitle').textContent = card.title; $('chapterNote').textContent = card.note; $('chapterCard').style.opacity = card.opacity; }
  $('city').disabled = inCase(); // the case study holds only Chicago and Fez
  const tag = sceneTag();
  $('sceneTag').hidden = !tag;
  if (tag) { $('sceneTag').textContent = tag.text; $('sceneTag').dataset.kind = tag.kind; }
  syncCityInfo();
  rig.mode === 'film' && here && (dirty = true);
}

// Presets follow the scale of the current part.
function syncCameraOptions() {
  const here = inWorld();
  for (const option of $('camera').options) {
    if (['terrain', 'axon'].includes(option.value)) option.hidden = here;
    if (option.value === 'world') option.hidden = !here;
    if (option.value === 'encounter') option.hidden = !inCase();
  }
}

function currentCase() {
  const info = replay.cases.info;
  if (!info || !inCase()) return null;
  return info.cases[CASE_ORDER[Math.min(CASE_ORDER.length - 1, Math.floor((timeline.t - CASE_START) / CASE_SECONDS))]];
}

// Cards are a function of t, so they behave the same when scrubbing and at any speed.
function chapterCard(t) {
  const fade = (from, to) => Math.min(1, Math.min((t - from) / 0.25 + 1, (to - t) / 0.5));
  if (t >= PART_ONE_END && t < ORIGIN_START + 1.8) return { title: 'Part II · How cities form a world', note: 'A separate recorded run with its own terrain: world seed 6201. It does not continue the city you just watched.', opacity: state.motionOff ? 1 : fade(PART_ONE_END, ORIGIN_START + 1.8) };
  if (t >= CASE_START && t < CASE_START + 1.4) return { title: 'Controlled experiment', note: 'Chicago and Fez are placed by hand so that they meet. This did not happen in the world above.', opacity: state.motionOff ? 1 : fade(CASE_START, CASE_START + 1.4) };
  return null;
}

function sceneTag() {
  const light = state.lightWorld ? ' · Light view: building volumes and lots hidden for this device (Debug layers)' : '';
  if (inCase()) return { kind: 'case', text: `Controlled Case Study · hand-placed test row${currentCase() ? ` · ${currentCase().title}` : ''}${light}` };
  if (inWorld()) return { kind: 'replay', text: `Recorded replay · world seed 6201 · not the chunk of Part I${light}` };
  return null;
}

// Display only: the recorded data and the timeline are untouched.
function setLightWorld() {
  if (state.lightWorld) return;
  state.lightWorld = true;
  world.layers.buildings = false;
  world.layers.lots = false;
  world.setTime(timeline.t);
  $('inLayers').replaceChildren();
  renderInspectorStage();
  syncUI();
}
let slowSince = null;
function watchWorldSpeed(dt, now) {
  if (state.lightWorld || !inWorld() || !timeline.playing || timeline.blocked || !worldReady('world')) { slowSince = null; return; }
  if (dt > 1 / 12) { slowSince ??= now; if (now - slowSince > 2500) setLightWorld(); } else slowSince = null;
}

function currentEvent() {
  const info = replay.world.info;
  if (!info) return null;
  const elapsed = (timeline.t - (GROWTH_START + 1)) / GROWTH_STEP_SECONDS;
  if (elapsed < 0) return null;
  return info.history[Math.min(info.history.length - 1, Math.floor(elapsed))];
}

function renderWorldLabels() {
  const box = $('labels');
  const here = inWorld() && state.worldLayers.names && world;
  const records = here ? world.visibleRecords().filter(record => record.meta.role === 'core') : [];
  while (box.children.length > records.length) box.lastChild.remove();
  while (box.children.length < records.length) {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => focusWorldCity(button.dataset.city));
    box.append(button);
  }
  records.forEach((record, index) => {
    const p = new THREE.Vector3(record.meta.x, record.maxY + 40, record.meta.z).project(camera);
    const button = box.children[index];
    button.dataset.city = record.meta.cityId;
    button.textContent = FILM_CITIES[record.meta.cityId]?.name ?? record.meta.cityId;
    button.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    button.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  });
}

// Entering a city moves the camera only. The way back is the Follow film camera.
function focusWorldCity(cityId) {
  state.worldCity = cityId;
  const records = world.recordsOf(cityId);
  if (!records.length) return;
  state.camera = 'free';
  $('camera').querySelector('[value="free"]').hidden = false;
  $('camera').value = 'free';
  rig.moveTo('free', () => rig.fit(0.78, 0.6, 1.2, world.boxOf(records)), state.motionOff);
  $('city').value = cityId;
  renderInspectorStage();
  dirty = true;
}

function renderSourceSection(stage) {
  const scene = sceneOf(stage.id);
  const info = stage.id === 'encounter' ? replay.cases.info : stage.chapter === 2 ? replay.world.info : null;
  fillRows($('inSource'), sourceRows(scene, info));
  $('inLimits').replaceChildren(...scene.knownLimitations.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}

function fillHow(how) {
  const steps = document.createElement('ol');
  steps.append(...how.steps.map(step => { const li = document.createElement('li'); li.textContent = step; return li; }));
  const notes = document.createElement('p'); notes.textContent = how.constraints;
  const links = document.createElement('p');
  for (const [label, href] of [...how.files.map(([file, url]) => [`View source: ${file}`, url]), ['Read more', how.more]]) {
    const a = document.createElement('a'); a.href = href; a.target = '_top'; a.textContent = label; links.append(a, document.createElement('br'));
  }
  $('inHow').replaceChildren(steps, notes, links);
}

function renderInspectorStage() {
  if (!inspecting()) return;
  const stage = STAGES[timeline.stage];
  renderSourceSection(stage);
  if (stage.chapter === 2) { renderWorldInspector(stage); return; }
  $('inSummary').textContent = `${snapshot.cityMatch.selectedDNA.id} · ${snapshot.config.landform} · terrain seed ${snapshot.config.seed}`;
  fillRows($('inIdentity'), identityRows(snapshot));
  const flow = STAGE_FLOW[stage.id];
  $('inStageTitle').textContent = `Stage: ${stage.title}`;
  const flowList = document.createElement('dl');
  fillRows(flowList, [['Input', flow.input], ['Process', flow.process], ['Output', flow.output], ['What', flow.what], ['Rules', flow.rules], ['Next', flow.next], ['Status', `${stage.status}, not yet accepted · task ${stage.task}`]]);
  $('inFlow').replaceChildren(flowList);
  fillRows($('inParams'), paramRows(stage.id, snapshot));
  fillHow(howItWorks(stage.id, snapshot));
  renderLayers();
}

let shownWorldKey = '';
function renderWorldInspector(stage) {
  const flow = WORLD_FLOW[stage.id];
  $('inStageTitle').textContent = `Stage: ${stage.title}`;
  const flowList = document.createElement('dl');
  fillRows(flowList, [['Input', flow.input], ['Process', flow.process], ['Output', flow.output], ['What', flow.what], ['Rules', flow.rules], ['Next', flow.next], ['Status', `${stage.status} · not yet accepted · task ${stage.task}`]]);
  $('inFlow').replaceChildren(flowList);
  fillHow(WORLD_HOW[stage.id]);
  renderWorldParams(stage);
  renderLayers();
}

function renderWorldParams(stage) {
  const info = replay.world.info;
  if (stage.id === 'encounter') {
    const item = currentCase();
    $('inSummary').textContent = item ? `Case study · ${item.encounter.cityA} × ${item.encounter.cityB} · world seed ${item.worldSeed}` : 'Case study';
    fillRows($('inParams'), encounterParamRows(item));
    fillRows($('inIdentity'), [['Scene', 'Controlled experiment on a hand-placed row. Not the recorded world.'], ['Cities', item ? `${item.encounter.cityA}, ${item.encounter.cityB}` : 'Not loaded'], ['Chunks', item ? item.encounter.participatingChunkIds.join(', ') : 'Not loaded']]);
    return;
  }
  if (!info) { fillRows($('inParams'), [['Status', 'Loading the recorded run']]); return; }
  const event = stage.id === 'growth' ? currentEvent() : null;
  const cityId = stage.id === 'growth' ? event?.cityId ?? state.worldCity : state.worldCity ?? info.cities[0].cityId;
  $('inSummary').textContent = stage.id === 'growth' ? `World seed ${info.worldSeed}${event ? ` · step ${event.step} · ${event.cityId}` : ''}` : `World seed ${info.worldSeed} · ${cityId}`;
  fillRows($('inParams'), stage.id === 'origins' ? originParamRows(info, cityId) : growthParamRows(info, event));
  fillRows($('inIdentity'), [['Scene', 'Recorded replay of the verified run. Unrelated to the chunk of Part I.'], ['World seed', String(info.worldSeed)], ['Placement parameters', `minimum distance ${info.params.minOriginDistance}, search radius ${info.params.searchRadius}, sharpness ${info.params.selectionSharpness}`], ['Growth parameters', Object.entries(info.growthParams).map(([key, value]) => `${key} ${value}`).join(' · ')]]);
}

let lastLive = 0;
function renderInspectorLive(force = false) {
  if (!inspecting()) return;
  const now = performance.now();
  if (!force && timeline.playing && now - lastLive < 250) return; // a few updates per second are enough; counters use binary search
  lastLive = now;
  const stage = STAGES[timeline.stage];
  if (stage.chapter === 2) {
    if (worldReady('world')) {
      if (stage.id === 'encounter') fillRows($('inLive'), [['Scope', 'This case study only; the counts of the recorded world do not apply here.']]);
      else fillRows($('inLive'), worldLiveRows(world.counts(timeline.t), replay.world.total));
    }
    const key = `${stage.id}|${stage.id === 'encounter' ? currentCase()?.title : currentEvent()?.step}|${state.worldCity}`;
    if (key !== shownWorldKey) { shownWorldKey = key; renderWorldParams(stage); }
    if (state.selected && state.selected.progress.value <= 0) select(null);
    return;
  }
  fillRows($('inLive'), liveRows(film, snapshot));
  if (state.selected && !film.isRevealed(state.selected)) select(null);
  syncLayerAvailability();
}

function renderSelection() {
  const box = $('inSelection');
  box.hidden = !state.selected;
  if (!state.selected) { box.replaceChildren(); return; }
  const worldPick = inWorld();
  const { title, rows } = worldPick ? worldChunkRows(state.selected.meta, replay.world.info?.history.find(event => event.chunk === state.selected.meta.id && state.selected.group === 'world')) : objectRows(state.selected, snapshot);
  const heading = document.createElement('h3'); heading.textContent = `Selected: ${title}`;
  const list = document.createElement('dl'); fillRows(list, rows);
  const clear = document.createElement('p');
  clear.innerHTML = '<a href="#" id="clearSelection">Back to stage overview</a>';
  clear.firstChild.addEventListener('click', event => { event.preventDefault(); select(null); });
  box.replaceChildren(heading, list, clear);
}

function select(picked) {
  state.selected = picked;
  if (inWorld() || (picked === null && world?.highlight)) world.setHighlight(picked); else film.setHighlight(picked);
  renderSelection();
  if (picked) $('inspectorBody').scrollTop = 0;
  dirty = true;
}

// A layer becomes available when the timeline reaches its stage, so a debug view never shows output that is "not generated yet".
const STAGE_INDEX = Object.fromEntries(STAGES.map((stage, index) => [stage.id, index]));
const SURFACES = [
  ['none', 'Film colours', 'terrain'], ['classes', 'Terrain and water classes', 'terrain'], ['transition', 'Transition weight', 'terrain'],
  ['slope', 'Slope analysis', 'analysis'], ['suitability', 'Suitability', 'analysis'], ['blocks', 'Urban blocks, by status', 'blocks'], ['parcels', 'Parcels, one colour each', 'parcels'],
];
const LAYERS = [
  ['roads', 'Road network', 'roads'], ['nodes', 'Road nodes and edge ports', 'roads'], ['blockLines', 'Block outlines', 'blocks'], ['parcelLines', 'Parcels and frontage lines', 'parcels'],
  ['buildings', 'Building volumes', 'buildings'], ['footprints', 'Building footprints', 'buildings'],
];
const reached = stageId => timeline.t >= STAGE_START[STAGE_INDEX[stageId]];

const WORLD_LAYER_LIST = [['territory', 'City ID territory'], ['roads', 'Road network'], ['lots', 'Blocks and parcels'], ['buildings', 'Building volumes'], ['links', 'Parent–child growth links'], ['names', 'City names']];
function renderWorldLayers() {
  const rows = WORLD_LAYER_LIST.map(([id, label]) => {
    const row = document.createElement('label'); row.className = 'layer'; row.dataset.worldLayer = id;
    const box = document.createElement('input'); box.type = 'checkbox';
    box.checked = id === 'names' ? state.worldLayers.names : world.layers[id];
    box.addEventListener('change', () => {
      if (id === 'names') state.worldLayers.names = box.checked; else { world.layers[id] = box.checked; world.setTime(timeline.t); }
      dirty = true;
    });
    row.append(box, label);
    return row;
  });
  const missing = document.createElement('p'); missing.className = 'note';
  missing.textContent = 'Not Available here: active growth frontiers (not saved per step) and object-level selection (chunks can be selected).';
  $('inLayers').replaceChildren(...rows, missing);
}

function renderLayers() {
  if (inWorld()) { if (!$('inLayers').childElementCount) renderWorldLayers(); return; }
  if ($('inLayers').childElementCount) { syncLayerAvailability(); return; }
  const select = document.createElement('select');
  select.id = 'surfaceLayer'; select.className = 'layer-select'; select.setAttribute('aria-label', 'Terrain surface colouring');
  SURFACES.forEach(([id, label]) => select.add(new Option(label, id)));
  select.value = state.surface;
  select.addEventListener('change', () => { state.surface = select.value; applyLayers(); });
  const nodes = LAYERS.map(([id, label, stageId]) => {
    const row = document.createElement('label'); row.className = 'layer'; row.dataset.layer = id;
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = state.layers[id];
    box.addEventListener('change', () => { state.layers[id] = box.checked; applyLayers(); });
    const hint = document.createElement('small'); hint.dataset.from = STAGES[STAGE_INDEX[stageId]].title;
    row.append(box, label, hint);
    return row;
  });
  const missing = document.createElement('p'); missing.className = 'note';
  missing.textContent = 'Not Available in this film: contours, City ID territory, growth frontiers, parent–child links, encounter candidates. The last four run in the world experiment.';
  $('inLayers').replaceChildren(select, ...nodes, missing);
  syncLayerAvailability();
}

function applyLayers() {
  if (!film?.view || inWorld()) return;
  const surface = SURFACES.find(([id]) => id === state.surface);
  const surfaceId = surface && reached(surface[2]) ? state.surface : 'none';
  if (film.surface !== surfaceId) film.setSurface(surfaceId);
  for (const [id, , stageId] of LAYERS) {
    const on = state.layers[id] && (id === 'nodes' || id === 'footprints' ? reached(stageId) : true); // the film's own layers are already timed by their shaders
    film.setLayerVisible(id, on);
  }
  dirty = true;
}

function syncLayerAvailability() {
  if (inWorld()) return;
  applyLayers();
  const select = $('surfaceLayer');
  if (select) [...select.options].forEach((option, index) => { option.disabled = !reached(SURFACES[index][2]); });
  for (const row of $('inLayers').querySelectorAll('.layer')) {
    const stageId = LAYERS.find(([id]) => id === row.dataset.layer)[2];
    const open = reached(stageId);
    row.dataset.off = String(!open);
    row.querySelector('input').disabled = !open;
    const hint = row.querySelector('small');
    hint.textContent = open ? '' : `from ${hint.dataset.from}`;
  }
}

function renderInspector() {
  if (!inspecting()) return;
  renderInspectorStage();
  renderInspectorLive(true);
  renderSelection();
}

// Switching mode shows or hides an overlay. It never touches the snapshot, the timeline or the camera pose.
function setMode(mode) {
  state.mode = renderer ? mode : 'watch';
  document.body.dataset.mode = state.mode;
  $('modeWatch').setAttribute('aria-pressed', String(state.mode === 'watch'));
  $('modeInspect').setAttribute('aria-pressed', String(state.mode === 'inspect'));
  $('inspector').hidden = state.mode !== 'inspect';
  $('tourInspect').textContent = state.mode === 'inspect' ? 'Close the Inspector' : 'Inspect the Algorithm';
  if (state.mode === 'watch' && film?.view && state.selected) select(null);
  renderInspector();
  resize();
}

function setCollapsed(collapsed) {
  state.inspectorCollapsed = collapsed;
  $('inspector').dataset.collapsed = String(collapsed);
  $('inspectorCollapse').textContent = collapsed ? 'Expand' : 'Collapse';
  $('inspectorCollapse').setAttribute('aria-expanded', String(!collapsed));
  resize();
}

function setBusy(busy, title = 'Generating the city') {
  $('loading').hidden = !busy;
  $('loadingTitle').textContent = title;
  $('retry').hidden = true;
  document.body.classList.toggle('film-loading', busy);
  for (const id of ['play', 'prev', 'next', 'restart']) $(id).disabled = busy;
  $('scrub').disabled = busy;
}

function resize() {
  if (!renderer) return;
  const width = innerWidth; const height = innerHeight;
  renderer.setSize(width, height, false);
  const hidden = document.body.classList.contains('capture');
  const playerHeight = document.querySelector('.player').offsetHeight;
  document.body.style.setProperty('--player-height', `${playerHeight}px`);
  const panel = state.mode === 'inspect' && !hidden ? $('inspector') : null;
  const sheet = width <= 720;
  view.width = width; view.height = height;
  // The view makes room for the open Inspector. Only the framing moves, smoothly, in frame().
  view.target = {
    bottom: hidden ? 0 : Math.min(0.75, (playerHeight + (panel && sheet ? panel.offsetHeight : 0)) / height),
    right: panel && !sheet && !state.inspectorCollapsed ? (panel.offsetWidth + 16) / width : 0,
  };
  if (view.current === null || state.motionOff) view.current = { ...view.target };
  rig.setViewport(width / height, view.current.bottom, view.current.right);
  dirty = true;
}
const view = { width: 1, height: 1, target: { bottom: 0, right: 0 }, current: null };
addEventListener('resize', resize);
// The control bar's height follows its text (stage title, status); the panel and the framing must follow it.
new ResizeObserver(() => { if (renderer) resize(); }).observe(document.querySelector('.player'));

// Everything the stage needs comes from one finished snapshot; a newer request cancels an older one.
let loadToken = 0;
async function loadCity(city, initialT = null) {
  const token = ++loadToken;
  state.city = city;
  state.ready = false;
  timeline.pause();
  syncCityInfo();
  if (!renderer) {
    setBusy(false);
    $('loading').hidden = true;
    return;
  }
  const poster = stillOf(`city-${city}`);
  if (poster && !snapshot) { $('still').src = poster; $('still').hidden = false; }
  setBusy(true);
  $('loadingStages').querySelectorAll('li').forEach((li, index) => { li.dataset.state = index ? '' : 'active'; });
  try {
    const result = await source.request(city, FILM_CITIES[city], stageId => {
      const items = [...$('loadingStages').querySelectorAll('li')];
      const at = items.findIndex(li => li.dataset.stage === stageId);
      items.forEach((li, index) => { li.dataset.state = index <= at ? 'done' : index === at + 1 ? 'active' : ''; });
    });
    if (token !== loadToken) return;
    snapshot = result;
    const built = performance.now();
    film.build(snapshot);
    rig.configure(film.box, film.focus);
    state.buildMs = Math.round(performance.now() - built);
    state.generations = source.generations;
    state.selected = null;
    state.ready = true;
    $('inLayers').replaceChildren();
    $('still').hidden = true;
    setBusy(false);
    syncCityInfo();
    resize();
    shownStage = -1;
    renderInspector();
    applyLayers();
    timeline.stepped = state.motionOff;
    const start = initialT ?? (state.motionOff ? stageEnd(PART_ONE_LAST) : 0);
    timeline.seek(start);
    rig.mode = state.camera === 'film' ? 'film' : 'free';
    applyCameraChoice(true);
    if (!state.motionOff && query.get('autoplay') !== '0' && initialT === null) timeline.play();
    dirty = true;
  } catch (error) {
    if (token !== loadToken) return;
    console.error('Film generation failed:', error);
    setBusy(true, `Generation failed: ${error.message}`);
    $('loadingStages').replaceChildren();
    $('retry').hidden = false;
    showStill(`city-${city}`);
  }
}

function applyCameraChoice(instant = false) {
  const choice = state.camera;
  if (choice === 'free' || !rig.box) return;
  const quick = instant || state.motionOff;
  if (choice === 'film') rig.moveTo('film', () => rig.filmPose(timeline.t), quick);
  else rig.moveTo('free', () => rig.preset(choice), quick);
  dirty = true;
}

// ---------- Input ----------
$('play').addEventListener('click', () => timeline.toggle());
$('tourPlay').addEventListener('click', () => timeline.toggle());
$('tourPrev').addEventListener('click', () => goToChapter(chapterAt(timeline.t) - 1));
$('tourNext').addEventListener('click', () => goToChapter(chapterAt(timeline.t) + 1));
$('tourInspect').addEventListener('click', () => setMode(state.mode === 'inspect' ? 'watch' : 'inspect'));
$('viewTour').addEventListener('click', () => setView('tour'));
$('viewExplore').addEventListener('click', () => setView('explore'));
$('prev').addEventListener('click', () => timeline.goToStage(timeline.stage - 1));
$('next').addEventListener('click', () => timeline.goToStage(timeline.stage + 1));
$('restart').addEventListener('click', () => { timeline.restart(); if (!timeline.playing && !timeline.stepped) timeline.play(); });
$('scrub').addEventListener('input', event => {
  const target = (Number(event.target.value) / 1000) * DURATION; // read first: pause() re-syncs the slider to the old t
  timeline.pause();
  timeline.seek(target);
});
$('city').addEventListener('change', event => {
  // Part II: choosing a city moves the view inside the recorded world. Nothing is generated.
  if (inWorld()) { focusWorldCity(event.target.value); return; }
  loadCity(event.target.value, state.mode === 'inspect' ? timeline.t : null);
});
$('camera').addEventListener('change', event => { state.camera = event.target.value; applyCameraChoice(); syncUI(); });
$('rate').addEventListener('change', event => { timeline.rate = Number(event.target.value); store({ city: state.city, t: +timeline.t.toFixed(2), camera: state.camera, rate: timeline.rate, mode: state.mode }); });
$('modeWatch').addEventListener('click', () => setMode('watch'));
$('modeInspect').addEventListener('click', () => setMode('inspect'));
$('inspectorClose').addEventListener('click', () => { setMode('watch'); $('modeInspect').focus(); });
$('inspectorCollapse').addEventListener('click', () => setCollapsed(!state.inspectorCollapsed));

$('retry').addEventListener('click', () => {
  const need = neededReplay(timeline.t);
  if (need && replay[need].status === 'failed') { replay[need].status = 'idle'; syncUI(); return; }
  loadCity(state.city);
});
$('staticView').checked = state.motionOff;
$('staticView').addEventListener('change', event => {
  state.motionOff = event.target.checked;
  timeline.stepped = state.motionOff;
  if (state.motionOff) timeline.goToStage(timeline.stage);
});
addEventListener('keydown', event => {
  if (event.target.closest?.('input, select, summary, a, button')) return;
  if (event.key === ' ') { event.preventDefault(); timeline.toggle(); }
  else if (event.key === 'ArrowRight') timeline.goToStage(timeline.stage + 1);
  else if (event.key === 'ArrowLeft') timeline.goToStage(timeline.stage - 1);
  else if (event.key === 'n' || event.key === 'N') goToChapter(chapterAt(timeline.t) + 1);
  else if (event.key === 'i' || event.key === 'I') setMode(state.mode === 'inspect' ? 'watch' : 'inspect');
  else if (event.key === 'Escape' && state.mode === 'inspect') setMode('watch');
});
// A drag or wheel takes the camera from the film; a press without movement is a click, which picks in Inspect mode.
const toFreeCamera = () => {
  rig.release();
  state.camera = 'free';
  $('camera').querySelector('[value="free"]').hidden = false;
  $('camera').value = 'free';
};
if (renderer) {
  const canvas = renderer.domElement;
  let press = null;
  canvas.addEventListener('pointerdown', event => { press = { x: event.clientX, y: event.clientY, moved: false }; });
  addEventListener('pointermove', event => {
    if (press && !press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) { press.moved = true; toFreeCamera(); }
  });
  addEventListener('pointerup', event => {
    if (press && !press.moved && event.target === canvas && inspecting() && state.ready) {
      const box = canvas.getBoundingClientRect();
      const ndc = { x: ((event.clientX - box.left) / box.width) * 2 - 1, y: -((event.clientY - box.top) / box.height) * 2 + 1 };
      select(inWorld() ? (worldReady('world') ? world.pick(ndc, camera) : null) : film.pick(ndc, camera));
    }
    press = null;
  });
  canvas.addEventListener('wheel', toFreeCamera, { passive: true });
}
controls?.addEventListener('change', () => { dirty = true; });

// ---------- Frame loop: renders only when something changed ----------
let previous = performance.now();
const stats = { frames: 0, worst: 0, sum: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.5, (now - previous) / 1000); // real elapsed time, so a slow device shows fewer frames, not a slower film
  previous = now;
  if (!renderer || !state.ready) return;
  timeline.tick(dt);
  watchWorldSpeed(dt, now);
  if (view.current && (Math.abs(view.current.bottom - view.target.bottom) > 0.0005 || Math.abs(view.current.right - view.target.right) > 0.0005)) {
    const k = Math.min(1, dt * 7);
    view.current.bottom += (view.target.bottom - view.current.bottom) * k;
    view.current.right += (view.target.right - view.current.right) * k;
    rig.setViewport(view.width / view.height, view.current.bottom, view.current.right);
    dirty = true;
  } else if (view.current) view.current = { ...view.target };
  const moving = rig.update(timeline.t, now);
  if (rig.mode === 'free' && !rig.tween) controls.update();
  if (dirty || (moving && timeline.playing) || rig.tween) {
    renderer.render(scene, camera);
    renderWorldLabels();
    dirty = false;
    if (timeline.playing) { stats.frames += 1; stats.sum += dt; stats.worst = Math.max(stats.worst, dt); }
  }
}

// ---------- Start ----------
const startT = () => {
  if (query.has('t')) return Math.min(DURATION, Math.max(0, Number(query.get('t')) || 0));
  if (query.has('stage')) return stageEnd(Math.min(STAGES.length - 1, Math.max(0, (Number(query.get('stage')) || 1) - 1)));
  // A refresh in the same tab comes back where the viewer left off, paused.
  if (!hasDeepLink && stored.t > 0 && stored.t < DURATION) return stored.t;
  return null;
};
document.body.dataset.mode = state.mode;
document.body.dataset.view = state.view;
$('viewTour').setAttribute('aria-pressed', String(state.view === 'tour'));
$('viewExplore').setAttribute('aria-pressed', String(state.view === 'explore'));
$('inspector').hidden = state.mode !== 'inspect';
$('modeWatch').setAttribute('aria-pressed', String(state.mode === 'watch'));
$('modeInspect').setAttribute('aria-pressed', String(state.mode === 'inspect'));
if (!renderer) $('modeInspect').disabled = true;
syncUI();
if (!renderer) {
  document.body.classList.add('no-webgl');
  $('camera').disabled = true; $('city').disabled = true; $('filmCanvas').hidden = true;
  $('stageMetric').textContent = 'WebGL is not available: showing captured stills of the real model.';
  syncCityInfo();
  showStill(`film-${STAGES[0].id}`);
  shownStage = -1;
  timeline.stepped = true;
  timeline.seek(stageEnd(0));
  state.ready = true;
  setInterval(() => timeline.tick(0.25), 250);
} else {
  resize();
  requestAnimationFrame(frame);
  loadCity(state.city, startT());
}

// Read-only handle for scripts/verify-procedural-film.mjs.
window.__film = {
  get ready() { return state.ready; },
  get t() { return timeline.t; },
  get playing() { return timeline.playing; },
  get stage() { return STAGES[timeline.stage].id; },
  get city() { return state.city; },
  get webgl() { return Boolean(renderer); },
  get buildMs() { return state.buildMs; },
  get rate() { return timeline.rate; },
  get mode() { return state.mode; },
  get generations() { return source.generations; },
  get blocked() { return timeline.blocked; },
  get lightWorld() { return state.lightWorld; },
  get part() { return inWorld() ? 2 : 1; },
  get worldReady() { return worldReady('world'); },
  get casesReady() { return worldReady('cases'); },
  get worldSelected() { return state.selected?.meta?.id ?? null; },
  worldCounts: () => world.counts(timeline.t),
  worldEvent: () => currentEvent(),
  worldVisible: () => world.visibleRecords().map(record => record.meta.id),
  labels: () => [...$('labels').children].map(button => button.dataset.city),
  get selected() { return state.selected ? { kind: state.selected.kind, id: state.selected.id } : null; },
  get debug() { return { surface: film?.surface, layers: { ...state.layers } }; },
  live: () => film.liveCounts(),
  get playback() { return { ...stats, fps: stats.sum ? stats.frames / stats.sum : 0 }; },
  signatures: () => (snapshot ? { network: snapshot.network.signature, blocks: snapshot.blocks.signature, parcels: snapshot.parcels.signature, buildings: snapshot.buildings.signature, reveal: film.signature, buildingCount: snapshot.buildings.stats.buildings, cityId: snapshot.cityMatch.selectedDNA.id, timings: snapshot.timings } : null),
  geometry: () => ({ triangles: renderer?.info.render.triangles, calls: renderer?.info.render.calls, geometries: renderer?.info.memory.geometries }),
  pose: () => { const p = rig.current(); return { x: p.target.x, y: p.target.y, z: p.target.z, az: p.az, el: p.el, h: p.h }; },
  seek: t => { timeline.pause(); timeline.seek(t); },
  render: () => { rig.update(timeline.t, performance.now()); renderer.render(scene, camera); },
};
