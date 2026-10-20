// 04.1 block extraction settings (all design assumptions, A).
export const BLOCK_RULES = Object.freeze({
  resolution: 1, // m between availability samples (exact road distances are interpolated between samples)
  fieldCap: 3, // m; availability values are clamped to ±cap (only the zero contour matters)
  simplifyTolerance: 0.3, // m; Douglas–Peucker, kept only if the block stays valid
  minBlockArea: 100, // m²; smaller pieces are counted as remnants, not blocks
  // Buildable status from the share of the block's area that is in buildableMask.
  status: { buildableMin: 0.8, partialMin: 0.3 },
  labelMinArea: 2500, // m²; debug labels only on blocks at least this large
  // Surface edges that cut blocks. Tunnels are underground; canals are already water.
  cuttingKinds: ['road', 'bridgeCandidate'],
  // 04.1b buildable polygons: block land that is in the existing buildable rule
  // (slope ≤ CHUNK.maxBuildableSlope, ≥ shoreFreeboard above local water). Test parameters, not building codes.
  buildable: {
    slopeScale: 0.2, // m per degree; only shapes the contour near slope/edge corners
    minPiece: 25, // m²; buildable pieces smaller than this count as unbuildable (avoids raster crumbs)
    // m; buildable outline is kept this far inside the final block outline (measured to its simplified
    // edges; chunk-boundary edges excluded), so it stays inside after its own simplification.
    // Costs ≈ perimeter × edgeMargin of area.
    edgeMargin: 0.6,
  },
  // 04.1b fragment classification, applied in this order (first match wins).
  fragments: {
    thinBlockMaxArea: 2500, // m²; a block this small …
    thinBlockMaxWidth: 10, // … and narrower than this (2·area / perimeter) that touches water is a waterfront strip
    buildableMinArea: 200, buildableMinWidth: 8, buildableMinShare: 0.5, // → buildableFragment (needs road frontage)
    publicMinArea: 40, publicMinWidth: 4, publicMaxSlope: 10, // → publicSpaceCandidate (needs road frontage)
    // otherwise: touches water → waterfrontReserve; else → unbuildable
    mergeSearchCells: 2, // look this many 1 m samples across for neighbouring regions
  },
});
