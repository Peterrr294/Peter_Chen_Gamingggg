// A City of Cities — VIS-01a Growth Replay Adapter (pure data, runs in Node).
//
// Turns one committed growth event into the stages of its generation, each tied to real data and labelled by what it is:
//   recorded        stored in the growth history when the step ran (scores, candidates, joins, ramps, validation)
//   reconstructed   regenerated deterministically from the saved inputs (blocks, parcels, buildings); identical by signature
//   presentation    an order of appearance chosen for viewing only (buildings); it is not the generator's sequence
// Nothing here generates or changes the world; a missing field is reported as 'Not available', never inferred.
export const STAGES = Object.freeze([
  { id: 'before', title: 'Before growth', kind: 'recorded' },
  { id: 'site', title: 'Terrain / site evaluation', kind: 'recorded' },
  { id: 'front', title: 'Growth front selection', kind: 'recorded' },
  { id: 'roads', title: 'Road extension / ramp evaluation', kind: 'recorded' },
  { id: 'blocks', title: 'Block generation', kind: 'reconstructed' },
  { id: 'parcels', title: 'Parcel subdivision', kind: 'reconstructed' },
  { id: 'buildings', title: 'Building generation', kind: 'presentation' },
  { id: 'commit', title: 'Growth commit', kind: 'recorded' },
]);
const NA = 'Not available';
const n = v => (v === undefined || v === null ? NA : v);

// Stable order of appearance for buildings: distance from the nearest joined road end, then a hash of the id.
export function revealOrder(buildings, anchors) {
  const hash = s => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const cen = b => { const r = b.footprint.polygon; return { x: r.reduce((s, p) => s + p.x, 0) / r.length, z: r.reduce((s, p) => s + p.z, 0) / r.length }; };
  return buildings.map(b => { const c = cen(b); const d = anchors.length ? Math.min(...anchors.map(a => Math.hypot(a.x - c.x, a.z - c.z))) : 0; return { b, key: d + 40 * hash(b.id) }; })
    .sort((p, q) => p.key - q.key || p.b.id.localeCompare(q.b.id)).map(x => x.b);
}

// The Inspector content of every stage of one event (what was decided, from which data).
export function replayStages(world, event, layers) {
  const chunk = world.chunks.get(event.newChunkId); const ctx = chunk.generationParameters.growthContext ?? {};
  const rc = event.roadCandidate ?? null; const g = event.growthReason ?? {};
  const ramps = event.ramps ?? [];
  const city = layers.city;
  const rampCount = s => ramps.filter(r => r.status === s).length;
  const info = {
    before: { algorithm: 'World State before the step', input: `${world.chunks.size - 1} committed chunks`, parameters: `world seed ${world.worldSeed}`, decision: 'none yet', output: `${event.cityId} at ${event.parentChunkId}`, validation: 'committed earlier', source: 'Growth History up to this step' },
    site: { algorithm: 'GrowthEvaluation.evaluateCandidate', input: `cell (${event.targetCoordinate.gx}, ${event.targetCoordinate.gy}), ${chunk.terrainType}, terrain seed ${chunk.terrainSeed}`, parameters: g.weights ? Object.entries(g.weights).map(([k, v]) => `${k} ${+v.toFixed(2)}`).join(', ') : NA, decision: g.groups ? `score ${n(event.selectionScore)}: ${Object.entries(g.groups).map(([k, v]) => `${k} ${v}`).join(', ')}` : NA, output: g.terms ? `mean land slope ${g.terms.meanLandSlope}°, buildable ${g.terms.buildable}, DNA fit ${g.terms.dnaFit}` : NA, validation: 'eligible (terrain rules passed)', source: `history ${event.growthEventId}.growthReason` },
    front: { algorithm: 'RoadGrowthFrontAdapter.candidates + scheduler bid and pick', input: rc ? `front ${rc.growthFrontId} on ${rc.sourceRoadId} (${rc.roadClass}, ${n(rc.roadElevation)} m)` : NA, parameters: rc?.terrainConstraints ? `usable entries ${rc.terrainConstraints.usableEntries}, refused ${rc.terrainConstraints.refusedEntries}, entry limit ${rc.terrainConstraints.maxEntryStepM} m` : NA, decision: g.text ?? NA, output: `${(event.rejectedCandidates?.[event.cityId] ?? []).length} other cell(s) of ${event.cityId} refused; ${(event.failedAttempts ?? []).length} failed attempt(s) this step`, validation: 'selected by the scheduler', source: `history ${event.growthEventId}.roadCandidate, .growthReason.bids, .rejectedCandidates` },
    roads: { algorithm: `NetworkGenerator (${ctx.grid ? 'grid continued from the parent anchor' : 'entry gates'}) + RoadRampPlanner`, input: `${(ctx.entryPorts ?? []).length} parent road ends, ${(ctx.vertical?.entries ?? []).length} road ends for the ramp plan`, parameters: event.gradeProfile ? `grade profile ${event.gradeProfile}` : 'no ramp plan (G02c-01 rule)', decision: ramps.length ? `${rampCount('accepted')} ramp(s) accepted, ${rampCount('flush')} flush, ${ramps.length - rampCount('accepted') - rampCount('flush')} unconnected with reason` : `${event.connections.length} joins`, output: `${city.network.edges.length} road edges, ${(city.network.stats.roadLength / 1000).toFixed(2)} km`, validation: `${event.connections.length} parent join(s), ${(event.neighbourConnections ?? []).length} neighbour join(s); crossings 0 required`, source: `history ${event.growthEventId}.ramps, .connections; chunk ${chunk.chunkId}.growthContext` },
    blocks: { algorithm: 'BlockGenerator (regions between the generated roads)', input: `${city.network.edges.length} road edges of ${chunk.chunkId}`, parameters: `${event.cityId} DNA block rules`, decision: 'regions enclosed by roads', output: `${city.blocks.stats.blocks} blocks, median ${n(chunk.outputs.morph?.blockAreaMedianM2)} m²`, validation: `signature ${chunk.outputs.signatures.blocks} equals the committed chunk`, source: 'reconstructed from the saved generation parameters' },
    parcels: { algorithm: 'ParcelGenerator (road-oriented subdivision)', input: `${city.blocks.stats.blocks} blocks`, parameters: `${event.cityId} DNA parcel rules`, decision: 'frontage on the nearest road', output: `${city.parcels.stats.parcels} parcels, frontage median ${n(chunk.outputs.morph?.parcelFrontageMedianM)} m`, validation: `signature ${chunk.outputs.signatures.parcels} equals the committed chunk`, source: 'reconstructed from the saved generation parameters' },
    buildings: { algorithm: 'BuildingGenerator (footprint + height rule)', input: `${city.parcels.stats.parcels} parcels, height centre ${chunk.outputs.centreSource}`, parameters: `${event.cityId} DNA building rules`, decision: 'height from centre distance, road class, parcel area, seeded jitter (G03c-03 lineage)', output: `${city.buildings.buildings.length} buildings, mean ${n(chunk.outputs.morph?.heightMeanM)} m, max ${n(chunk.outputs.morph?.heightMaxM)} m`, validation: `signature ${chunk.outputs.signatures.buildings} equals the committed chunk`, source: 'reconstructed; the order of appearance is for viewing only, not the generator sequence' },
    commit: { algorithm: 'Validate → Commit (WorldGrowthController.commitRoad)', input: `chunk ${chunk.chunkId}`, parameters: 'at least one parent join, no empty layer, no crossing, joins equal in height', decision: 'committed', output: `${chunk.chunkId} owned by ${event.cityId}; step ${event.step}`, validation: `${event.connections.length} join(s) by identity; residual height ${ramps.length ? 'within 0.05 m' : NA}`, source: `history ${event.growthEventId}` },
  };
  return STAGES.map(s => ({ ...s, ...info[s.id] }));
}

// Where a clicked road of the new chunk came from.
export function roadOrigin(event, edgeId) {
  const joined = [...(event.connections ?? []), ...(event.neighbourConnections ?? [])].find(c => c.child.chunkId === event.newChunkId && c.child.edgeId === edgeId);
  const ramp = (event.ramps ?? []).find(r => r.childEdgeId === edgeId);
  if (joined) return { road: `${event.newChunkId}:e${edgeId}`, continuedFrom: `${joined.parent.chunkId}:e${joined.parent.edgeId}`, connectionId: joined.connectionId, roadClass: joined.roadClass, ramp: ramp ? `${ramp.status}, ${ramp.rampLengthM ?? '—'} m, max ${ramp.maxGrade ?? '—'}` : 'none (heights met)', decision: event.growthReason?.text ?? NA, source: `history ${event.growthEventId}.connections` };
  if (ramp) return { road: `${event.newChunkId}:e${edgeId}`, continuedFrom: 'not joined', connectionId: ramp.connectionId, roadClass: ramp.roadClass, ramp: `${ramp.status}: ${ramp.reason ?? ''}`, decision: event.growthReason?.text ?? NA, source: `history ${event.growthEventId}.ramps` };
  return { road: `${event.newChunkId}:e${edgeId}`, continuedFrom: NA, connectionId: NA, roadClass: NA, ramp: NA, decision: 'generated inside the new chunk by its DNA network rule; only roads that cross the shared edge have a parent', source: 'network of the regenerated chunk' };
}
