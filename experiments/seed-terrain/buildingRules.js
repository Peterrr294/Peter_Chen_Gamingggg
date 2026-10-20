// 05.1 building footprint + extrusion rules per City DNA. Units: metres, floors, ratios.
// Every number is a prototype assumption (A): research has the topology (M3 coverage–height
// field on lots, V3 continuous low-rise waterfront fabric, F3 dense low-rise courtyards) but
// no measured heights, coverage, or setbacks yet (TBD).
export const BUILDING_RULES = Object.freeze({
  resolution: 1, // m; local footprint field grid (exact distances are interpolated; containment is verified)
  simplifyTolerance: 0.15, // m
  minFootprintArea: 25, // m²
  minFootprintWidth: 3, // m; 2·area / perimeter
  maxPlinth: 4, // m; height difference under a footprint the base may absorb
  plinthBelow: 0.5, // m; mesh bottom sits this far below the lowest ground point (no floating)
  byDNA: {
    manhattanGrid: {
      type: 'streetFrontage', occupancy: 0.92, sideSetback: 0.4, frontSetback: 0, maxDepth: 26,
      floors: [3, 32], floorHeight: 3.6, weights: { centre: 0.65, road: 0.2, area: 0.15 }, jitter: 0.25, centreRadius: 380,
      courtyard: null,
    },
    fezOrganicCore: {
      type: 'streetFrontage', occupancy: 0.85, sideSetback: 0.4, frontSetback: 0, maxDepth: 16,
      floors: [1, 4], floorHeight: 3.2, weights: { centre: 0.3, road: 0.2, area: 0.2 }, jitter: 0.3, centreRadius: 300,
      // Simplified inner void: building is a ring band; used only if the void is large enough.
      courtyard: { minParcelArea: 140, ringWidth: 4.5, minVoidArea: 12 },
    },
    veniceWaterNetwork: {
      type: 'streetFrontage', occupancy: 0.85, sideSetback: 0.4, frontSetback: 0, maxDepth: 14,
      floors: [2, 6], floorHeight: 3.3, weights: { centre: 0.35, road: 0.25, area: 0.15 }, jitter: 0.25, centreRadius: 320,
      courtyard: null,
    },
    // 06.1 (A). Chicago: towers concentrated in one tight core, low-rise elsewhere (row 10 "高层集中");
    // the core is the seeded centre, NOT a transit node (node-driven gradient unsupported).
    chicagoGrid: {
      type: 'streetFrontage', occupancy: 0.9, sideSetback: 0.9, frontSetback: 0, maxDepth: 30,
      floors: [2, 45], floorHeight: 3.8, weights: { centre: 0.9, road: 0.08, area: 0.02 }, jitter: 0.15, centreRadius: 220,
      courtyard: null,
    },
    // Amsterdam: uniform 3–5 storey canal houses on almost every lot; buildings shallower than lots (gardens behind).
    amsterdamCanalRing: {
      type: 'streetFrontage', occupancy: 0.95, sideSetback: 0.1, frontSetback: 0, maxDepth: 18,
      floors: [3, 5], floorHeight: 3.4, weights: { centre: 0.15, road: 0.3, area: 0.1 }, jitter: 0.2, centreRadius: 400,
      courtyard: null,
    },
    // Lisbon: 3–6 storey hillside fabric, height follows streets more than one centre (several hill centres).
    lisbonHillCore: {
      type: 'streetFrontage', occupancy: 0.9, sideSetback: 0.3, frontSetback: 0, maxDepth: 14,
      floors: [3, 6], floorHeight: 3.2, weights: { centre: 0.25, road: 0.35, area: 0.1 }, jitter: 0.3, centreRadius: 300,
      courtyard: null,
    },
  },
  roadClassWeight: { primary: 1, secondary: 0.55, lane: 0.2, bridge: 0 },
});
