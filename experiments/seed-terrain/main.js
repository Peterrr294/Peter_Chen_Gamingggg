import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHUNK, createSeedTerrainConfig, DEFAULT_SELECTION, LANDFORMS, snapTransitionWidth, TRANSITION } from './config.js';
import { generateChunk } from './TerrainGenerator.js';
import { applyNeighborConstraints, deriveFields } from './TerrainFields.js';
import { ChunkView } from './ChunkView.js';
import { analyseTerrain } from './TerrainAnalysis.js';
import { matchCity } from './CityMatcher.js';
import { CITY_DNA } from './cityMatchRules.js';
import { createSampler, generateNetwork } from './NetworkGenerator.js';
import { NetworkView } from './NetworkView.js';
import { generateBlocks } from './BlockGenerator.js';
import { BlockView } from './BlockView.js';
import { BLOCK_RULES } from './blockRules.js';
import { generateParcels } from './ParcelGenerator.js';
import { ParcelView } from './ParcelView.js';
import { generateBuildings } from './BuildingGenerator.js';
import { BuildingView } from './BuildingView.js';

// URL (?landform=…&seed=…&variation=…&transitionWidth=…&view=…) reproduces any view.
const query = new URLSearchParams(location.search);
const selection = {
  landform: LANDFORMS[query.get('landform')] ? query.get('landform') : DEFAULT_SELECTION.landform,
  seed: THREE.MathUtils.clamp(Math.round(Number(query.get('seed')) || DEFAULT_SELECTION.seed), 1, 9999),
  variation: THREE.MathUtils.clamp(Number(query.get('variation') ?? DEFAULT_SELECTION.variation), 0, 1),
  transitionWidth: snapTransitionWidth(query.get('transitionWidth') ?? DEFAULT_SELECTION.transitionWidth),
  view: ['transition', 'slope', 'suitability', 'blocks', 'parcels', 'buildings'].includes(query.get('view')) ? query.get('view') : 'classes',
  dna: CITY_DNA[query.get('dna')] ? query.get('dna') : 'auto', // manual override never touches terrain
  network: query.get('network') !== 'off',
  loops: query.get('loops') !== 'off', // 03.3 loop closure; ?loops=off reproduces the 03.1 network (Before)
};

const canvas = document.querySelector('#terrainCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x081014);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 1, 6000);
camera.position.set(980, 900, 1100);
// ?focus=x,z,distance starts the camera close to a point (used for local debug captures).
const focus = (query.get('focus') ?? '').split(',').map(Number);
const focusOn = focus.length === 3 && focus.every(Number.isFinite) ? { x: focus[0], z: focus[1], distance: focus[2] } : null;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xcde7ef, 0x17231d, 2.2));
const sun = new THREE.DirectionalLight(0xffefd2, 3);
sun.position.set(-670, 1050, 540);
scene.add(sun);

const view = new ChunkView(scene);
let config = null;
let fields = null;
let analysis = null;
let cityMatch = null;
let network = null;
const networkView = new NetworkView(scene);
const blockView = new BlockView(scene);
let blocks = null;
const parcelView = new ParcelView(scene);
let parcels = null;
const buildingView = new BuildingView(scene);
let buildings = null;
let tunnelGeometry = null;

function regenerate() {
  config = createSeedTerrainConfig(selection);
  const chunk = generateChunk(config);
  fields = deriveFields(chunk, config);
  applyNeighborConstraints(fields); // no neighbours yet: identity
  analysis = analyseTerrain(fields, config);
  rematch();
  render();
}

// Matching reads terrainAnalysis only; changing the DNA choice re-runs this alone.
function rematch() {
  cityMatch = matchCity(analysis, { override: selection.dna === 'auto' ? null : selection.dna });
  // The network reads fields, analysis, and cityMatch only; it never writes to them.
  network = generateNetwork(fields, analysis, cityMatch, config, { loops: selection.loops });
  const sampler = createSampler(fields);
  networkView.update(network, sampler.height);
  networkView.setVisible(selection.network);
  // Blocks read fields, analysis, the network, and cityMatch only.
  blocks = generateBlocks(fields, analysis, network, cityMatch, config);
  blockView.update(blocks, sampler.height, fields.grid, BLOCK_RULES.labelMinArea, config.transitionWidth);
  // Parcels read the block result, the network, and cityMatch only.
  parcels = generateParcels(blocks, fields, network, cityMatch, config);
  parcelView.update(parcels, sampler.height);
  // Buildings read parcels and cityMatch only; their random stream is separate from terrain and network seeds.
  buildings = generateBuildings(parcels, fields, cityMatch, config);
  buildingView.update(buildings);
  // 05.1b-2: tunnel excavation from NetworkGraph tunnel edges (local rebuild; height field untouched).
  // Surface heights and the shell base must be current before the tunnels are cut.
  view.update(fields, config, selection.view === 'buildings' ? 'classes' : selection.view, analysis, blocks, parcels);
  tunnelGeometry = view.updateTunnels(network, fields, buildings);
  setLayerVisibility();
}

function renderMatch() {
  const selected = cityMatch.selectedDNA;
  const candidate = cityMatch.rankedCandidates.find(item => item.id === selected.id);
  document.querySelector('#cityMatch').textContent = `${selected.label} · ${selected.mode} · rank ${selected.rank} · score ${selected.score.toFixed(2)} (fit ${selected.fitScore.toFixed(2)} × coverage ${selected.evidenceCoverage.toFixed(2)}) · ${selected.confidence} confidence${selected.weakFit ? ' · WEAK FIT' : ''}`;
  document.querySelector('#cityReasons').innerHTML = candidate.topReasons.map(reason => `<li>${reason}</li>`).join('');
  const stats = network.stats;
  const b = blocks.stats;
  document.querySelector('#blocks').textContent = `${b.blocks} blocks · enclosed ${b.byEnclosure.roads + b.byEnclosure.roadsAndWater + b.byEnclosure.waterOnly} · clipped ${b.byEnclosure.clipped} · buildable ${b.byStatus.buildable} / partial ${b.byStatus.partial} / unbuildable ${b.byStatus.unbuildable} · invalid ${b.invalid} · area blocks ${(b.area.blocks / 1e4).toFixed(1)} ha · roads ${(b.area.roads / 1e4).toFixed(1)} ha · water ${(b.area.water / 1e4).toFixed(1)} ha · buildable polygons ${(blocks.refinement.buildable.buildableArea / 1e4).toFixed(1)} ha · in transition ${(100 * blocks.refinement.transition.blocksArea / Math.max(1, b.area.blocks)).toFixed(0)}% · fragments ${blocks.refinement.fragmentsAfter.classified} (${Object.entries(blocks.refinement.fragmentsAfter.byClass).map(([kind, value]) => `${kind} ${value.count}`).join(', ') || 'none'})`;
  const bs = buildings.stats;
  document.querySelector('#buildings').textContent = `${bs.buildings} buildings on ${bs.parcels} parcels (${(bs.occupancy * 100).toFixed(0)}%) · height mean ${bs.meanHeight.toFixed(1)} m (p10 ${bs.heightP10.toFixed(0)} · p50 ${bs.heightP50.toFixed(0)} · p90 ${bs.heightP90.toFixed(0)}) · coverage ${(bs.coverageOfBuiltParcels * 100).toFixed(0)}% of built parcels · ${bs.courtyards} courtyard · ${bs.withPlinth} on plinths`;
  const ps = parcels.stats;
  document.querySelector('#parcels').textContent = `${ps.parcels} parcels (${ps.corner} corner, ${ps.withCanalFrontage} canal-facing) · mean frontage ${ps.meanFrontage.toFixed(1)} m · mean ${ps.meanArea.toFixed(0)} m² · uses ${(ps.utilisation * 100).toFixed(0)}% of buildable · reserve ${(ps.reserveArea / 1e4).toFixed(1)} ha · ${ps.inTransition} in transition band`;
  document.querySelector('#network').textContent = `${network.strategy} · ${stats.nodes} nodes · ${stats.edges} edges (${stats.edgesByKind.canal} canal, ${stats.bridges} bridge, ${stats.tunnels} tunnel, ${stats.mountainConnectors} mountain road) · ${(stats.roadLength / 1000).toFixed(1)} km · ${stats.roadComponents} component(s) · dead ends ${(stats.deadEndRatio * 100).toFixed(0)}% · ${stats.ports} ports${network.warnings.length ? ` · ⚠ ${network.warnings.join('; ')}` : ''}`;
}

function setLayerVisibility() {
  blockView.setVisible(selection.view === 'blocks' || selection.view === 'parcels');
  parcelView.setVisible(selection.view === 'parcels' || selection.view === 'buildings');
  buildingView.setVisible(selection.view === 'buildings');
}

function render() {
  view.update(fields, config, selection.view === 'buildings' ? 'classes' : selection.view, analysis, blocks, parcels);
  setLayerVisibility();
  const { stats } = fields;
  document.querySelector('#heightSignature').textContent = `${stats.heightSignature} · ${stats.waterSignature}`;
  document.querySelector('#ratios').textContent = `${(stats.waterRatio * 100).toFixed(1)}% / ${(stats.buildableRatio * 100).toFixed(1)}%`;
  document.querySelector('#transition').textContent = `${config.transitionWidth} m · ${config.transitionWidth / CHUNK.size * CHUNK.segments} samples · weight ${stats.weightSignature}`;
  document.querySelector('#range').textContent = `${stats.minHeight.toFixed(1)} – ${stats.maxHeight.toFixed(1)} m · ${stats.meanLandSlope.toFixed(1)}° (p95 ${stats.slopeP95.toFixed(0)}°)`;
  const direction = analysis.dominantDirection.selected;
  document.querySelector('#analysis').textContent = `${analysis.waterRegions.count} water · ${analysis.buildableRegions.significantCount} buildable regions · ${direction ? `${direction.type} ${direction.axisDeg ?? direction.downslopeDeg}°` : 'direction unknown'}`;
  renderMatch();
  document.querySelector('#statusText').textContent = 'READY';
  document.body.dataset.terrainSignature = stats.heightSignature;
}

let pending = false;
function scheduleRegenerate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; regenerate(); });
}

const gui = new GUI({ title: 'Seed Terrain', container: document.querySelector('#gui') });
const landformOptions = Object.fromEntries(Object.entries(LANDFORMS).map(([key, preset]) => [preset.label, key]));
gui.add(selection, 'landform', landformOptions).name('Landform').onChange(scheduleRegenerate);
const seedController = gui.add(selection, 'seed', 1, 9999, 1).name('Seed').onFinishChange(scheduleRegenerate);
gui.add({ random: () => {
  selection.seed = 1 + Math.floor(Math.random() * 9999);
  seedController.updateDisplay();
  scheduleRegenerate();
} }, 'random').name('Random seed');
gui.add(selection, 'variation', 0, 1, 0.01).name('Variation intensity').onFinishChange(scheduleRegenerate);
gui.add(selection, 'transitionWidth', TRANSITION.min, TRANSITION.max, TRANSITION.step).name('Transition width (m)').onFinishChange(scheduleRegenerate);
const dnaOptions = { 'Auto (top match)': 'auto', ...Object.fromEntries(Object.entries(CITY_DNA).map(([key, dna]) => [dna.label, key])) };
gui.add(selection, 'dna', dnaOptions).name('City DNA').onChange(() => { rematch(); renderMatch(); });
gui.add(selection, 'network').name('Road network layer').onChange(value => networkView.setVisible(value));
gui.add(selection, 'view', { 'Terrain classes': 'classes', 'Transition weight': 'transition', 'Slope bands': 'slope', 'Suitability': 'suitability', 'Blocks': 'blocks', 'Parcels': 'parcels', 'Buildings': 'buildings' }).name('Debug view').onChange(render);

// Plain arrays for downstream steps (city matching, roads, parcels).
function fieldData() {
  const toArray = (values, digits) => Array.from(values, value => (digits === undefined ? value : Number(value.toFixed(digits))));
  return {
    config: { landform: config.landform, seed: config.seed, variation: config.variation, transitionWidth: config.transitionWidth, chunk: CHUNK },
    grid: fields.grid,
    stats: fields.stats,
    height: toArray(fields.height, 3),
    slope: toArray(fields.slope, 2),
    waterMask: toArray(fields.waterMask),
    buildableMask: toArray(fields.buildableMask),
    transitionWeight: toArray(fields.transitionWeight, 4),
    waterSurface: toArray(fields.waterSurface, 3),
    boundarySamples: fields.boundarySamples,
  };
}

regenerate();
// ?camera=side: horizontal view of the chunk side to inspect terrain thickness and the base.
if (query.get('xray') === '1') view.setXray(true);
if (query.get('camera') === 'side') {
  controls.target.set(0, 60, 0);
  camera.position.set(260, 80, 1500);
}
if (focusOn) {
  const y = createSampler(fields).height(focusOn.x, focusOn.z);
  controls.target.set(focusOn.x, y, focusOn.z);
  camera.position.set(focusOn.x + focusOn.distance * 0.45, y + focusOn.distance * 0.8, focusOn.z + focusOn.distance * 0.55);
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

renderer.setAnimationLoop(() => {
  resize();
  controls.update();
  renderer.render(scene, camera);
});

// Debug handle for geometry verifiers (render objects, not part of the data API).
window.__seedTerrainScene = { view };

window.__seedTerrainLab = {
  ready: true,
  stats: () => ({ ...fields.stats }),
  boundary: () => fields.boundarySamples,
  fields: fieldData,
  network: () => network,
  blocks: () => ({ ...blocks, terrainBlockIndex: Array.from(blocks.terrainBlockIndex) }),
  parcels: () => ({ ...parcels, terrainParcelIndex: Array.from(parcels.terrainParcelIndex) }),
  buildings: () => buildings,
  solid: () => view.solidReport(fields),
  tunnels: () => ({ accepted: tunnelGeometry.accepted, records: tunnelGeometry.records, volumes: tunnelGeometry.volumes, errors: tunnelGeometry.errors, rules: tunnelGeometry.rules }),
  cityMatch: () => JSON.parse(JSON.stringify({ ...cityMatch, metrics: { ...cityMatch.metrics } })),
  selectDNA: id => { selection.dna = id; gui.controllersRecursive().forEach(item => item.updateDisplay()); rematch(); renderMatch(); return cityMatch.selectedDNA; },
  // Serialisable terrainAnalysis (typed arrays → plain arrays).
  analysis: () => ({
    ...analysis,
    suitabilityMask: Array.from(analysis.suitabilityMask),
    waterRegions: { ...analysis.waterRegions, labels: Array.from(analysis.waterRegions.labels) },
    buildableRegions: { ...analysis.buildableRegions, labels: Array.from(analysis.buildableRegions.labels) },
  }),
  neighbors: next => applyNeighborConstraints(fields, next),
};
