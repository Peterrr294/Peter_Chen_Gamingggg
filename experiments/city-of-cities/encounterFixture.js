// A City of Cities — G03b test fixture (TEST ONLY; not a placement rule).
//
// Two cores are placed by hand in one row of cells (Chicago at x, Fez at x + 3) so that they meet after one or two
// road-first growth steps. Everything else is the real chain: world terrain, City DNA, generators, G02b growth.
// The rows were chosen from a landform search (all four cells plain; or plain, plain, barrier, plain) and a probe of
// the real road ports; they are recorded in the G03b note.
import { WorldContext } from './WorldContext.js';
import { MorphologicalGrowth } from './MorphologicalGrowth.js';
import { UrbanEncounter } from './UrbanEncounter.js';

export const ENCOUNTER_FIXTURES = Object.freeze({
  // Scenario 1 — Compatible road interface: Chicago grows east, then Fez grows west into the cell next to Chicago.
  compatible: { title: 'Compatible road interface', worldSeed: 6201, row: { gx: -7, gy: -10 }, steps: [['chicagoGrid', 1], ['fezOrganicCore', 2]] },
  // Scenario 2 — Incompatible street geometry: Fez arrives first; then Chicago's inherited grid meets Fez's lanes.
  incompatible: { title: 'Incompatible street geometry', worldSeed: 6201, row: { gx: -7, gy: -10 }, steps: [['fezOrganicCore', 2], ['chicagoGrid', 1]] },
  // Scenario 3 — Natural barrier: a river valley lies between the two cities (x + 2).
  barrier: { title: 'Natural barrier', worldSeed: 6201, row: { gx: 1, gy: -7 }, steps: [['chicagoGrid', 1], ['fezOrganicCore', 2], ['chicagoGrid', 2]] },
});

export function createFixtureWorld(name) {
  const f = ENCOUNTER_FIXTURES[name];
  if (!f) throw new Error(`Unknown encounter fixture ${name}`);
  const world = new WorldContext({ worldSeed: f.worldSeed });
  const reason = (order, dx) => ({ order, fixture: `g03b:${name}`, text: `TEST FIXTURE: placed by hand at row ${f.row.gx + dx},${f.row.gy} (not a placement rule)`, constrainedBy: [] });
  world.registerOrigin({ cityId: 'chicagoGrid', gx: f.row.gx, gy: f.row.gy, reason: reason(0, 0) });
  world.registerOrigin({ cityId: 'fezOrganicCore', gx: f.row.gx + 3, gy: f.row.gy, reason: reason(1, 3) });
  world.fixture = name;
  return world;
}

// Runs the fixture's growth steps through the negotiation. Yields after every generation step (page responsiveness).
export function* runFixtureSteps(world, name, upTo = Infinity) {
  const f = ENCOUNTER_FIXTURES[name];
  const morph = new MorphologicalGrowth(world); const enc = new UrbanEncounter(world, morph);
  for (const id of [...world.chunks.keys()]) if (!world.chunks.get(id).outputs) { const r = world.generateChunk(id); yield { kind: 'core', chunk: r.chunk, layers: r.layers }; }
  const done = world.growth.step;
  for (const [i, [cityId, dx]] of f.steps.entries()) {
    if (i < done) continue; // continuing a restored world: steps already in the history are not repeated
    if (i >= upTo) break;
    const target = { gx: f.row.gx + dx, gy: f.row.gy };
    const before = world.growth.step;
    const r = enc.growWithNegotiation(cityId, target);
    // A refused step still counts as a fixture step (history keeps the failure + the decision, never a duplicate).
    if (r.result.failure) world.growth.step = before + 1;
    yield { kind: 'step', cityId, target, ...r };
  }
  return { morph, enc };
}
export function runFixture(world, name, upTo = Infinity) { const it = runFixtureSteps(world, name, upTo); let r = it.next(); const steps = []; while (!r.done) { steps.push(r.value); r = it.next(); } return { ...r.value, steps }; }
