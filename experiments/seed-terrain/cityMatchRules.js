// 02.6 City DNA terrain-fit rules. ALL weights, thresholds, and evidence tags live here.
//
// Evidence tags follow the city research template (research/city-research-template.md):
//   V   — fact supported by a registered source (concept only; no numeric value is sourced yet)
//   I   — analytical inference from a sourced fact or family definition
//   A   — design assumption for the generator; NOT a research finding; uncalibrated
//   TBD — required evidence that does not exist yet; never scored, always reported
//
// Sources: research/prototype-city-selection.md (00.3, rules M1–M3, V1–V3, F1–F3),
// research/city-longlist-60.md (families F1, F2, F4, F6; rows 02 Amsterdam, 10 Chicago, 35 Lisbon — all "待验证"),
// research/manhattan-spatial-study.md (01.1). The 06.1 cities have no study, no source anchor, and no research row:
// their identity rules are the longlist's candidate features (I at best), every number is A.
// No research row in city-research-template.csv has terrain values yet, so every numeric
// threshold below is tagged A and must be recalibrated once measurements exist.
//
// Scoring: each evaluated condition maps one terrainAnalysis metric to 0–1 with a linear ramp
// [from → to] (or a lookup). fitScore = Σ weight·value / Σ weight over evaluated conditions;
// a triggered conflict caps fitScore at conflict.cap. evidenceCoverage = evaluated weight / total
// weight (TBD and missing conditions count in the total). Ranking uses
// rankScore = fitScore × evidenceCoverage, so unknown evidence earns no credit and a DNA
// with fewer measurable conditions cannot outrank one with more on lenient assumptions alone.

export const MATCH_SETTINGS = Object.freeze({
  weakFitBelow: 0.4, // rankScore below this is reported as a weak fit
  confidence: {
    // Confidence describes terrain-fit evidence only, never city identity.
    mediumMinCoverage: 0.8, // evaluated weight / total weight
    mediumMinVerifiedShare: 0.5, // share of evaluated weight tagged V
    note: 'High confidence is unreachable until research thresholds are measured (all numeric thresholds are A).',
  },
  // DNA order is the deterministic tie-break.
  order: ['manhattanGrid', 'veniceWaterNetwork', 'fezOrganicCore', 'chicagoGrid', 'amsterdamCanalRing', 'lisbonHillCore'],
});

export const CITY_DNA = Object.freeze({
  manhattanGrid: {
    label: 'Manhattan — orthogonal grid',
    family: 'F2 Strong orthogonal grid',
    prototype: 'Manhattan (New York), 1811 grid area',
    identityRules: [
      { id: 'M1', rule: 'Shoreline-clipped orthogonal grid with avenue / cross-street hierarchy', status: 'concept V (S1–S3); direction, spacing, widths TBD' },
      { id: 'M2', rule: 'Road loop → block → frontage lots', status: 'lot geometry source V (S6–S7); algorithm I; sizes TBD' },
      { id: 'M3', rule: 'Coverage–height field constrained by lots', status: 'footprint/height fields V (S8); gradients TBD' },
    ],
    conditions: [
      {
        id: 'continuousLand', weight: 3, evidence: 'I+A', metric: 'largestBuildableShare', ramp: [0.2, 0.6],
        description: 'One continuous buildable area large enough to carry a single-direction grid',
        rationale: 'M1 / F2: one continuous grid controls the whole; ramp values are assumptions.',
      },
      {
        id: 'lowSlopeLand', weight: 2, evidence: 'A', metric: 'highSuitabilityShareOfLand', ramp: [0.3, 0.8],
        description: 'Most land ≤ 5° so straight streets need little grading',
        rationale: 'Generator assumption for a uniform grid. Manhattan relief itself is TBD (01.1 §6: do not call it flat yet).',
      },
      {
        id: 'waterAsEdge', weight: 1, evidence: 'V+I', metric: 'waterEdgeRole',
        lookup: { boundaryOnly: 1, none: 0.6, splitsLand: 0.3 },
        description: 'Water, if present, bounds the grid instead of crossing it',
        rationale: '01.1 §2.2: Hudson and East River bound the study area (V); water as edge, not network (I).',
      },
      {
        id: 'measuredRelief', weight: 1, evidence: 'TBD', metric: null,
        description: 'Measured elevation range and slope of the study area',
        rationale: '01.1 §6: USGS 3DEP DEM not yet clipped.',
      },
    ],
    conflicts: [
      { id: 'noContinuousLand', metric: 'largestBuildableShare', below: 0.1, cap: 0.1, evidence: 'A', description: 'No buildable area large enough for any grid' },
    ],
    hints: {
      network: {
        skeleton: 'two orthogonal street families with two roles (avenue / cross street) — M1',
        orientation: 'align to dominantDirection axis when one is known; otherwise TBD (no direction is invented)',
        spacingAndWidths: 'TBD (01.1: not measured)',
        clipping: 'clip streets at water and at unbuildable land; incomplete blocks allowed at the edge (01.1 §2.2, I)',
      },
      parcel: { subdivision: 'repeat frontage lots along the main street direction inside each block — M2', sizes: 'TBD', exceptions: 'irregular lots only at water or special sites (I)' },
      building: { massing: 'coverage and height from an explicit density field, never from the seed — M3', coverageHeight: 'TBD' },
    },
  },

  veniceWaterNetwork: {
    label: 'Venice — water network and islands',
    family: 'F1 Water network — island fabric',
    prototype: 'Venice, historic city and central lagoon islands',
    identityRules: [
      { id: 'V1', rule: 'Lagoon, canals, and islands before land content', status: 'concept V (UNESCO 394); channel hierarchy and island scale TBD' },
      { id: 'V2', rule: 'Bridges are scarce links that set the cross-island hierarchy', status: 'partly TBD' },
      { id: 'V3', rule: 'Lots follow shorelines; continuous irregular waterfront fabric', status: 'TBD' },
    ],
    conditions: [
      {
        id: 'waterStructuresCity', weight: 3, evidence: 'V+A', metric: 'waterFraction', ramp: [0.05, 0.35],
        description: 'Enough water to act as the main network, not only an edge',
        rationale: 'F1 / V1: water decides access, boundaries, and land (V concept); ramp values are assumptions.',
      },
      {
        id: 'landDividedByWater', weight: 2, evidence: 'I', metric: 'landDivision',
        lookup: { islands: 1, split: 0.6, single: 0.2 },
        description: 'Water divides land into islands or separate land bodies',
        rationale: 'V1: islands linked by canals and bridges (I).',
      },
      {
        id: 'enclosedWater', weight: 1, evidence: 'I', metric: 'largestWaterEnclosed',
        lookup: { enclosed: 1, open: 0.3, none: 0 },
        description: 'Sheltered (lagoon-like) water body inside the chunk',
        rationale: 'UNESCO 394: city within a lagoon (V); enclosed water as a lagoon proxy is I.',
      },
      { id: 'channelHierarchy', weight: 1, evidence: 'TBD', metric: null, description: 'Canal hierarchy and widths', rationale: '00.3 V1: TBD.' },
      { id: 'islandScale', weight: 1, evidence: 'TBD', metric: null, description: 'Island size distribution', rationale: '00.3 V1: TBD; terrainAnalysis has no island-size distribution yet.' },
    ],
    conflicts: [
      { id: 'noWater', metric: 'waterFraction', below: 0.001, cap: 0, evidence: 'V', description: 'No water: the water-network DNA cannot exist' },
    ],
    hints: {
      network: {
        skeleton: 'water regions are the primary network; land paths follow shorelines — V1',
        bridges: 'scarce links between land regions; count and placement TBD — V2',
        waterRegions: 'use terrainAnalysis.waterRegions ids',
      },
      parcel: { subdivision: 'lots follow shorelines; irregular waterfront lots — V3 (TBD)' },
      building: { massing: 'continuous low-rise waterfront fabric — V3 (heights TBD)' },
    },
  },

  fezOrganicCore: {
    label: 'Fez — organic historic core',
    family: 'F4 Organic historic core',
    prototype: 'Fez el-Bali',
    identityRules: [
      { id: 'F1', rule: 'Main paths from gates, markets, religious / public nodes', status: 'partly V (UNESCO 170); node weights TBD' },
      { id: 'F2', rule: 'Secondary lanes branch recursively, narrowing, dead ends allowed', status: 'TBD' },
      { id: 'F3', rule: 'Irregular blocks split into inward courtyard lots', status: 'TBD' },
    ],
    conditions: [
      {
        id: 'compactCoreLand', weight: 2, evidence: 'A', metric: 'largestBuildableShare', ramp: [0.05, 0.3],
        description: 'A compact buildable core for a dense fabric (does not need a whole-chunk grid)',
        rationale: 'Dense small-lot fabric (UNESCO 170, V) needs some contiguous land; ramp values are assumptions.',
      },
      {
        id: 'terrainFollowingPaths', weight: 1, evidence: 'I+A', metric: 'mixedSlopeShareOfLand', ramp: [0.15, 0.5],
        description: 'Mixed slopes where paths can follow terrain instead of a grid',
        rationale: 'F4 family: paths grow with terrain (I). Kept at weight 1 so slope alone cannot select Fez.',
      },
      { id: 'boundaryAndGates', weight: 2, evidence: 'TBD', metric: null, description: 'Enclosing boundary with limited gates', rationale: 'Not a terrain property; 00.3 F1 node weights TBD.' },
      { id: 'valleyRelation', weight: 1, evidence: 'TBD', metric: null, description: 'Relation to river valley and local terrain', rationale: '00.3: valley and boundary relations TBD.' },
      { id: 'waterRelation', weight: 1, evidence: 'TBD', metric: null, description: 'Influence of water channels on the internal network', rationale: '00.3: TBD.' },
    ],
    conflicts: [
      { id: 'tooLittleLand', metric: 'buildableFraction', below: 0.05, cap: 0.1, evidence: 'A', description: 'Too little buildable land for a dense core' },
    ],
    hints: {
      network: {
        skeleton: 'node-driven branching paths: gates / markets first, then recursive lanes — F1, F2',
        terrain: 'paths may follow contours inside low-suitability land (I); dead-end ratio TBD',
        nodes: 'TBD — not derivable from terrain',
      },
      parcel: { subdivision: 'irregular blocks into inward courtyard lots — F3 (TBD)' },
      building: { massing: 'dense low-rise courtyard fabric with continuous outer walls — F3 (TBD)' },
    },
  },

  // ---------- 06.1 additions: configuration on existing strategies (see networkStrategies.js DNA_NETWORK_OVERRIDES) ----------
  chicagoGrid: {
    label: 'Chicago — survey grid with river cut',
    family: 'F2 Strong orthogonal grid',
    prototype: 'Chicago Loop and near-centre grid (longlist row 10)',
    identityRules: [
      { id: 'C1', rule: 'Large continuous orthogonal grid on a fixed (cardinal) axis', status: 'row 10 candidate feature (待验证); axis and spacing src TBD' },
      { id: 'C2', rule: 'River cuts the grid; streets bridge it', status: 'row 10 candidate feature (待验证)' },
      { id: 'C3', rule: 'High-rise concentration at transport nodes', status: 'row 10 candidate; approximated by one seeded centre (node gradient unsupported)' },
    ],
    conditions: [
      {
        id: 'continuousLand', weight: 3, evidence: 'I+A', metric: 'largestBuildableShare', ramp: [0.2, 0.6],
        description: 'One continuous buildable area for a large single-direction grid',
        rationale: 'F2 / row 10 "大尺度正交网" (I); same ramp as Manhattan (A).',
      },
      {
        id: 'flatLand', weight: 2, evidence: 'A', metric: 'highSuitabilityShareOfLand', ramp: [0.3, 0.8],
        description: 'Mostly ≤ 5° land so a uniform grid needs little grading',
        rationale: 'Generator assumption; Chicago relief not measured (TBD).',
      },
      {
        id: 'riverCutsGrid', weight: 2, evidence: 'I+A', metric: 'waterEdgeRole',
        lookup: { splitsLand: 1, boundaryOnly: 0.6, none: 0.3 },
        description: 'Water crosses the grid (river) rather than only bounding it',
        rationale: 'Row 10 "河流切割" (I); lookup values A. This is the main terrain difference from Manhattan.',
      },
      { id: 'lakefrontEdge', weight: 1, evidence: 'TBD', metric: null, description: 'Long straight lake shore bounding the grid', rationale: 'No terrain metric separates a lake edge from a river edge yet.' },
      { id: 'measuredRelief', weight: 1, evidence: 'TBD', metric: null, description: 'Measured elevation range and slope', rationale: 'No DEM study for Chicago.' },
    ],
    conflicts: [
      { id: 'noContinuousLand', metric: 'largestBuildableShare', below: 0.1, cap: 0.1, evidence: 'A', description: 'No buildable area large enough for any grid' },
    ],
    hints: {
      network: { skeleton: 'grid strategy, 200 × 100 m, cardinal axis, wide streets, bridges on every street — C1, C2', alleys: 'unsupported (needs a third, service-lane street family)' },
      parcel: { subdivision: '25 × 125 ft frontage lots (src TBD)', alleys: 'rear alley access unsupported' },
      building: { massing: 'tight seeded tower core, low-rise elsewhere — C3 (transit-node centres unsupported)' },
    },
    unsupported: [
      { feature: 'Mid-block service alleys', needs: 'third street family in the grid strategy (service class, ≈ 5 m) and alley-side parcel backs' },
      { feature: 'Height peaks at transport nodes (Loop "L" stations)', needs: 'node-centrality or transit-node input to the building height field instead of one seeded centre' },
      { feature: 'Lakefront edge vs river edge distinction', needs: 'terrainAnalysis metric for straight open shore vs channel' },
      { feature: 'Diagonal arterial streets', needs: 'grid + diagonal overlay rule' },
    ],
  },

  amsterdamCanalRing: {
    label: 'Amsterdam — canal ring',
    family: 'F1 Water network — island fabric',
    prototype: 'Amsterdam central canal belt (longlist row 02)',
    identityRules: [
      { id: 'A1', rule: 'Concentric ring canals with radial connections', status: 'row 02 candidate feature (待验证); NOT generated — canals follow generated water only' },
      { id: 'A2', rule: 'Frequent bridges; streets on both canal banks', status: 'row 02 candidate; bridge interval A' },
      { id: 'A3', rule: 'Narrow deep waterfront lots, uniform 3–5 storey houses', status: 'row 02 "狭长滨水地块" (待验证); sizes A' },
    ],
    conditions: [
      {
        id: 'waterNetwork', weight: 3, evidence: 'I+A', metric: 'waterFraction', ramp: [0.03, 0.2],
        description: 'Enough water for canals, less than a lagoon city',
        rationale: 'F1 / row 02 (I); ramp below Venice because canals are dug, not a lagoon (A).',
      },
      {
        id: 'flatLand', weight: 2, evidence: 'A', metric: 'highSuitabilityShareOfLand', ramp: [0.3, 0.8],
        description: 'Flat delta land',
        rationale: 'Generator assumption; Amsterdam relief not measured (TBD).',
      },
      {
        id: 'landSplitByWater', weight: 1, evidence: 'I', metric: 'landDivision',
        lookup: { split: 1, islands: 0.8, single: 0.2 },
        description: 'Water separates land bodies (canal belts)',
        rationale: 'Row 02 (I).',
      },
      { id: 'ringCanalPattern', weight: 2, evidence: 'TBD', metric: null, description: 'Concentric ring canals', rationale: 'Man-made pattern; no terrain metric and no ring generator (unsupported).' },
      { id: 'canalWidths', weight: 1, evidence: 'TBD', metric: null, description: 'Canal widths and hierarchy', rationale: 'Not measured.' },
    ],
    conflicts: [
      { id: 'noWater', metric: 'waterFraction', below: 0.001, cap: 0, evidence: 'I', description: 'No water: a canal city cannot exist' },
    ],
    hints: {
      network: { skeleton: 'canal-street strategy with dense bridges, quay streets, radial lanes — A2', rings: 'unsupported (canals follow generated water)' },
      parcel: { subdivision: 'narrow deep lots, ≈ 7 m frontage — A3 (A)' },
      building: { massing: 'uniform 3–5 storey houses on almost every lot — A3 (A)' },
    },
    unsupported: [
      { feature: 'Concentric ring canals (grachtengordel)', needs: 'a canal-excavation rule that writes water into the height field — changes upstream terrain, so outside 06.1' },
      { feature: 'Lots perpendicular to the canal with water-side frontage', needs: 'quay-facing parcel orientation (canal-street lots rarely face water, known 04.2 issue)' },
      { feature: 'Back gardens / block interiors', needs: 'rear-yard rule in parcels and buildings' },
    ],
  },

  lisbonHillCore: {
    label: 'Lisbon — hills and valley axis',
    family: 'F6 Mountain — slope adaptation',
    prototype: 'Lisbon historic hills and Baixa (longlist row 35)',
    identityRules: [
      { id: 'L1', rule: 'Several hill centres linked by valley roads', status: 'row 35 candidate feature (待验证); hill count TBD' },
      { id: 'L2', rule: 'Secondary paths follow contours and aspect', status: 'row 35 candidate; approximated by climb-averse least-cost lanes (I)' },
      { id: 'L3', rule: 'Stairs and viewpoint nodes', status: 'unsupported' },
    ],
    conditions: [
      {
        id: 'hillyLand', weight: 2, evidence: 'I+A', metric: 'mixedSlopeShareOfLand', ramp: [0.4, 0.8],
        description: 'Most land on 5–20° slopes (several hills)',
        rationale: 'F6: slope controls the network more than water or grid (I); ramp A.',
      },
      {
        id: 'buildableCore', weight: 1, evidence: 'A', metric: 'largestBuildableShare', ramp: [0.05, 0.3],
        description: 'Some contiguous buildable land between hills',
        rationale: 'Generator assumption.',
      },
      {
        id: 'waterAsEdge', weight: 1, evidence: 'I', metric: 'waterEdgeRole',
        lookup: { boundaryOnly: 1, none: 0.5, splitsLand: 0.3 },
        description: 'Estuary as an edge, not a network',
        rationale: 'Row 35 study area on one bank of the estuary (I).',
      },
      { id: 'hillCount', weight: 2, evidence: 'TBD', metric: null, description: 'Number and spacing of hills', rationale: 'terrainAnalysis has no hill / peak detection.' },
      { id: 'valleyAxis', weight: 1, evidence: 'TBD', metric: null, description: 'Valley floor carrying the main axis (Baixa)', rationale: 'No valley-axis metric.' },
    ],
    conflicts: [
      { id: 'tooLittleLand', metric: 'buildableFraction', below: 0.05, cap: 0.1, evidence: 'A', description: 'Too little buildable land for any hillside fabric' },
    ],
    hints: {
      network: { skeleton: 'organic strategy: 5 hill centres, contour-following lanes (climb-averse) — L1, L2', stairs: 'unsupported' },
      parcel: { subdivision: 'small irregular hillside lots (A)' },
      building: { massing: '3–6 storeys, street-driven height (A)' },
    },
    unsupported: [
      { feature: 'Pedestrian stairs (escadinhas) and funiculars', needs: 'pedestrian edge class allowed above maxSlopeDeg with its own geometry' },
      { feature: 'Orthogonal Baixa grid in the valley floor', needs: 'hybrid rule: grid strategy inside a valley mask, organic on slopes' },
      { feature: 'Hill-top centres and viewpoints (miradouros)', needs: 'terrainAnalysis peak detection feeding organic centres' },
      { feature: 'Terraced building platforms', needs: 'stepped plinth rule (05.1 only absorbs ≤ 4 m)' },
    ],
  },
});
