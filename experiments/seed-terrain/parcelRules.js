// 04.2 parcel subdivision targets per City DNA. All values are design assumptions (A):
// research gives the topology (M2 frontage lots in grid blocks; V3 lots following shorelines;
// F3 irregular courtyard lots) but no measured lot sizes yet (PLUTO / Fez / Venice data TBD).
export const PARCEL_RULES = Object.freeze({
  frontageKinds: ['road'], // bridges (elevated) and tunnels (underground) never give building frontage
  sampleStep: 2, // m along road edges when tracing frontage runs
  probeDepth: 2, // m inside the road edge used to find the fronting block
  cornerJoin: 12, // m; end pieces of two different roads closer than this form one corner lot
  inset: 0.25, // m; each parcel is shrunk by this from shared lines, so simplification cannot create overlap
  simplifyTolerance: 0.2, // m
  canalProbe: 3, // m; parcel samples this close to water count toward canalFrontage
  byDNA: {
    manhattanGrid: { label: 'regular frontage lots (M2)', targetFrontage: 15, jitter: 0, maxDepth: 32, minFrontage: 6, minArea: 90 },
    fezOrganicCore: { label: 'irregular small lots (F3, courtyards TBD)', targetFrontage: 10, jitter: 0.35, maxDepth: 22, minFrontage: 5, minArea: 50 },
    veniceWaterNetwork: { label: 'narrow lots along quays and lanes (V3)', targetFrontage: 9, jitter: 0.25, maxDepth: 20, minFrontage: 5, minArea: 50 },
    // 06.1 (A). Chicago: standard 25 × 125 ft lot (src TBD); Amsterdam: narrow deep canal-house lots (row 02);
    // Lisbon: small irregular hillside lots (row 35). Rear alleys / back gardens are not modelled (unsupported).
    chicagoGrid: { label: 'regular 25 × 125 ft lots (src TBD)', targetFrontage: 7.6, jitter: 0, maxDepth: 38, minFrontage: 6, minArea: 120 },
    amsterdamCanalRing: { label: 'narrow deep canal-house lots (row 02)', targetFrontage: 7, jitter: 0.1, maxDepth: 30, minFrontage: 4, minArea: 60 },
    lisbonHillCore: { label: 'small irregular hillside lots (row 35)', targetFrontage: 8, jitter: 0.3, maxDepth: 18, minFrontage: 4, minArea: 45 },
  },
  // Reserved inputs for the building step (not computed in 04.2).
  building: { setback: null, coverage: null, height: null, source: 'TBD — DNA rules M3 / V3 / F3 not yet measured' },
});
