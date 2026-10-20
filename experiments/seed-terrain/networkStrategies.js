// 03.1 network strategy configuration. All spacings, widths, and limits live here.
// Evidence: every value is a design assumption (A) — research rules give the
// topology (M1 grid, F1–F2 node-driven branching lanes, V1–V2 canals + scarce
// bridges) but no measured spacing, width, or slope (research TBD).

export const DNA_STRATEGY = Object.freeze({
  manhattanGrid: 'grid',
  fezOrganicCore: 'organic',
  veniceWaterNetwork: 'canalStreet',
  // 06.1: new DNAs reuse the three strategies; their identity is the override set below.
  chicagoGrid: 'grid',
  amsterdamCanalRing: 'canalStreet',
  lisbonHillCore: 'organic',
});

// 06.1 per-DNA overrides on a shared strategy (configuration only, no new generator).
// Values are design assumptions (A); "src TBD" marks commonly cited figures with no registered source yet.
export const DNA_NETWORK_OVERRIDES = Object.freeze({
  chicagoGrid: {
    primarySpacing: 200, // m; major-street interval ≈ 1/8 mile (A, src TBD)
    secondarySpacing: 100, // m; ≈ 1/16 mile cross streets → ≈ 2:1 blocks (A, src TBD); Manhattan uses 200 / 80
    widths: { primary: 30, secondary: 20, bridge: 30 }, // 100 ft arterials / 66 ft streets (A, src TBD)
    fixedAxisDeg: 0, // cardinal survey grid, independent of terrain direction (I, src TBD)
    bridgePrimaryOnly: false, // river cut by the grid: every street may bridge (row 10 "河流切割", I)
    maxBridgeSpan: 120,
  },
  amsterdamCanalRing: {
    maxSlopeDeg: 10, // flat delta city: lanes stay on buildable land (A)
    widths: { canal: 20, primary: 8, lane: 5, bridge: 8 },
    bridgeInterval: 120, // m; dense bridge crossings (A) — Venice 260
    laneTargets: 24, // radial connections between canal-side streets (row 02 "放射连接", I)
    loops: { closeShare: 0.85, minPerimeter: 120, maxPerimeter: 600, maxLinkLength: 120 },
  },
  lisbonHillCore: {
    widths: { primary: 10, lane: 4 }, // wider valley axis (row 35 "谷地轴线", A)
    slopePenalty: 1.5, // paths may run across sloped land …
    climbPenalty: 2, // … but avoid height change → contour-following lanes (row 35, I)
    secondaryCentres: 5, // several hill centres (row 35 "多山丘", I; hill count TBD)
    secondaryCentreMinArea: 5000,
    laneTargets: 32,
  },
});

// Strategy defaults merged with the DNA overrides (one level deep for widths / loops).
export function strategyParams(dna) {
  const params = STRATEGIES[DNA_STRATEGY[dna]];
  const overrides = DNA_NETWORK_OVERRIDES[dna];
  if (!overrides) return params;
  const merged = { ...params, ...overrides };
  for (const key of ['widths', 'loops']) if (overrides[key]) merged[key] = { ...params[key], ...overrides[key] };
  return merged;
}

export const NETWORK_COMMON = Object.freeze({
  sampleStep: 2, // m; validation sampling along every edge
  minComponentLength: 150, // m; smaller road fragments are removed and counted
  simplifyTolerance: 3, // m; least-cost paths are simplified only if the chord stays valid
});

// 03.2 connectivity: surface mountain roads first, tunnels only when justified.
// Engineering values are test assumptions (A), not design-code values.
export const CONNECTIVITY = Object.freeze({
  minLinkComponentLength: 200, // m; smaller components are not worth a link
  gateMinRun: 40, // m of legal boundary land for an edge-port demand
  maxSurfaceConnectors: 6,
  mountainRoad: {
    roadClass: 'secondary',
    width: 6,
    maxTerrainSlopeDeg: 30, // cross-slope limit for a contour road (cut-and-fill assumed)
    maxGrade: 0.15, // rise / run per step; 16-direction moves let the road follow contours
    slopePenalty: 2,
    climbPenalty: 1, // cost per metre of height change
    maxSearchCost: 12000,
  },
  tunnel: {
    maxPerChunk: 2,
    roadClass: 'primary',
    width: 9,
    minLength: 80, // m
    maxLength: 700, // m
    maxGrade: 0.06, // longitudinal grade
    clearance: 7, // m from road level to crown
    minCover: 10, // m of ground above the crown outside the portal zones
    portalZone: 30, // m at each end where cover may ramp from 0 (ground must stay ≥ road level)
    portalMaxSlopeDeg: 35,
    approachMaxCost: 1500, // surface cost budget for an approach road from a network (or gate) to a portal
    portalStride: 3, // candidate portal cells every 3rd sample (12 m) in each direction
    maxPortalsPerSide: 150,
    costPerMetre: 8, // relative to surface cost units (≈ metres on flat ground)
    maxDetourRatio: 3, // surface length / straight distance above which a tunnel is considered
    advantage: 0.6, // tunnel total cost must be < advantage × surface cost when a surface route exists
    secondTunnelMinComponent: 500, // m; a second tunnel only links a component at least this long
  },
});

export const STRATEGIES = Object.freeze({
  // M1: two orthogonal street families with two roles (avenue / cross street).
  grid: {
    label: 'Grid',
    primarySpacing: 200, // m between avenues (A; Manhattan value TBD)
    secondarySpacing: 80, // m between cross streets (A)
    widths: { primary: 20, secondary: 12, bridge: 20 },
    maxSlopeDeg: 10, // = absolute buildable slope
    minStubLength: 16, // m; truncated pieces shorter than this are dropped
    bridgePrimaryOnly: true,
    maxBridgeSpan: 80, // m of continuous water a primary street may span as a bridgeCandidate
  },
  // F1–F2: main paths from boundary gates and terrain centres, then branching lanes (dead ends allowed).
  organic: {
    label: 'Organic',
    maxSlopeDeg: 20, // = low-suitability limit; lanes may climb where a grid cannot
    widths: { primary: 8, lane: 4 },
    slopePenalty: 3, // cost × (1 + p·(slope/max)²)
    climbPenalty: 0.5, // cost per metre of height change
    reuseDiscount: 0.35, // cost multiplier on existing network cells (paths merge into trunks)
    gateMinRun: 40, // m of buildable boundary needed for a gate
    secondaryCentres: 3,
    secondaryCentreMinArea: 10000, // m²
    laneTargets: 26,
    laneAttempts: 220,
    laneMinLength: 40,
    laneMaxLength: 320,
    // 03.3 loop closure (A). cityMatch has no numeric Fez block scale (research TBD), so the
    // loop perimeter range is a design assumption for irregular blocks of ≈ 0.2–5 ha.
    loops: {
      maxLinkLength: 200, // m of new road per link (organic lanes are ≈ 180 m apart on average)
      maxExtension: 120, // m for a straight dead-end extension
      minPerimeter: 180, maxPerimeter: 1000, // m; new loop = network distance + new path (≈ 0.2–6 ha blocks)
      minDetourRatio: 2.5, // network distance ≥ ratio × new path (a real shortcut, not a parallel road)
      closeShare: 0.5, // at most this share of dead ends is closed (cul-de-sacs remain)
      branchLinks: 6, branchSampleSpacing: 40,
      clearanceCells: 2, // new path keeps ≥ 2 cells (8 m) from other roads except at its ends
      minBuildableShare: 0.5,
    },
  },
  // V1–V2: canals on generated water, quays along shores, scarce bridges, inland lanes.
  canalStreet: {
    label: 'Canal-Street',
    maxSlopeDeg: 15,
    widths: { canal: 10, primary: 6, lane: 4, bridge: 6 },
    canalRegionMinArea: 10000, // m²
    canalCentrePull: 6, // water cost × (1 + pull / (1 + cells to land)) keeps canals central
    quayOffsetCells: 2, // quay runs this many 4 m cells inland from water
    quayOffPenalty: 4, // cost multiplier for land cells off the quay line
    bridgeInterval: 260, // m along a canal between bridge candidates
    maxBridgeSpan: 70, // m
    slopePenalty: 3,
    climbPenalty: 0.5,
    reuseDiscount: 0.35,
    laneTargets: 14,
    laneAttempts: 160,
    laneMinLength: 40,
    laneMaxLength: 260,
    // 03.3 loop closure on land only; water stays a block boundary, bridges never close loops (A).
    loops: {
      maxLinkLength: 140,
      maxExtension: 100,
      minPerimeter: 140, maxPerimeter: 700,
      minDetourRatio: 2.5,
      closeShare: 0.6,
      branchLinks: 6, branchSampleSpacing: 40,
      clearanceCells: 2,
      minBuildableShare: 0.5,
    },
    gateMinRun: 40,
    secondaryCentres: 2,
    secondaryCentreMinArea: 10000,
  },
});
