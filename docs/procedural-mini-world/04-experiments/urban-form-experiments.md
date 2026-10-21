# Urban Form Experiments — City DNA, Blocks, Parcels, Buildings

Part of [04 Experiments](../EXPERIMENT-INDEX.md). Numbers are copied from the task entries in the [experiment log](../FINAL-EXPERIMENT-LOG.md) (§7). **Commit:** first in Git in `7b21c3e`. Review status: **pending review**.

System notes: [City DNA Matching](../03-generative-system/city-dna-matching.md) · [Block & Parcel](../03-generative-system/block-and-parcel.md) · [Building Extrusion](../03-generative-system/building-extrusion.md) · [City DNA Library](../research/city-dna-library.md)

## 02.6 — Terrain-to-city matching · Active

- **Date:** 2026-10-18
- **Question:** can `terrainAnalysis` rank the three prototype DNAs by terrain fit, transparently and deterministically, without claiming identity?
- **Method / reused:** new `cityMatchRules.js`, `CityMatcher.js`; research rules M1–M3 / V1–V3 / F1–F3.
- **Seed / params:** 4 landforms × 1101 / 2202 / 3303; variation 0.5; W 128; `rankScore = fit × coverage`.
- **Test:** `verify-city-match.mjs`. 12 / 12 pass. Plain → Manhattan 0.80 > Fez 0.29 (weak) > Venice 0 (weak). Coast 1101 / 2202 → Manhattan 0.56 / 0.48. Mountain → all ≤ 0.09. Re-run 2026-10-19: pass.
- **Screenshot:** [02-6-city-match-auto-vs-manual.png](../../assets/screenshots/procedural-mini-world/02-6-city-match-auto-vs-manual.png): coast 1101, auto (Manhattan) vs manual Venice, signature `4A69CE05 · 602F2BF4`.
- **Conclusion:** ranking is config-driven and traceable; terrain fit and identity are separate fields.
- **Open issues:** a first draft let Fez win the coast on lenient assumptions (fixed by fit × coverage); Venice never fits (no lagoon landform).

## 04.1 — Urban blocks · Active

- **Date:** 2026-10-18
- **Question:** can valid closed blocks (with holes) be extracted from real-width roads, water, and the tile edge for all three strategies?
- **Method / reused:** new `blockRules.js`, `BlockGenerator.js`, `BlockView.js`.
- **Seed / params:** 1101 / 2202 / 3303; grid / plain, organic / coast, canal-street / river valley, plus mountain cases; 1 m resolution, min block 100 m².
- **Test:** `verify-blocks.mjs`. 15 / 15 pass, 0 invalid blocks, area residual < 1 m². Grid plain: 83–84 blocks, 78–80 ha. Organic coast: 4–5 blocks, 0 road-enclosed. Re-run 2026-10-19: pass.
- **Screenshots:** [04-1-blocks-strategies.png](../../assets/screenshots/procedural-mini-world/04-1-blocks-strategies.png), [04-1-blocks-grid-debug.png](../../assets/screenshots/procedural-mini-world/04-1-blocks-grid-debug.png) (seed 1101).
- **Conclusion:** blocks are valid, disjoint, off water and road corridors; buildability is measured.
- **Open issues:** tree-like networks form almost no enclosed blocks (led to 03.3); rounded grid corners.

## 04.1b — Block refinement · Active

- **Date:** 2026-10-18
- **Question:** can each block carry a buildable MultiPolygon, classified fragments (nothing deleted), and transition shares?
- **Method / reused:** new `BlockRefinement.js`; 04.1 field, labelling, marching squares.
- **Seed / params:** 1101 / 2202 / 3303; edge margin 0.6 m, min piece 25 m²; W 128 (+ 32 / 256 test).
- **Test:** `verify-block-refinement.mjs`. 12 / 12 + width series pass. Grid plain: 78–80 → 76–78 ha buildable. Organic coast: 84–92 → 51–59 ha. Re-run 2026-10-19: pass.
- **Screenshots:** [04-1b-buildable-strategies.png](../../assets/screenshots/procedural-mini-world/04-1b-buildable-strategies.png), [04-1b-canal-refinement-debug.png](../../assets/screenshots/procedural-mini-world/04-1b-canal-refinement-debug.png).
- **Conclusion:** block outlines, roads, and terrain unchanged; buildable land explicit.
- **Open issues:** no legal fragment merge exists (merge is a no-op); waterfront slivers 1–50 m².

## 04.2 — Road-oriented parcels · Active

- **Date:** 2026-10-18
- **Question:** can parcels be generated from real road frontage inside the buildable polygons, at the DNA's lot scale, with explicit reserve?
- **Method / reused:** new `parcelRules.js`, `ParcelGenerator.js`, `ParcelView.js`; 04.1 / 04.1b geometry helpers.
- **Seed / params:** 1101 / 2202 / 3303; grid frontage 15 m, depth ≤ 32 m, min area 90 m² (all A).
- **Test:** `verify-parcels.mjs`. 9 / 9 pass, valid frontage 100 %, area error ≤ 0.29 %. Grid plain: 1 810–1 862 parcels, mean frontage 16.0–16.6 m, depth 28.4–28.5 m, 86.3–86.4 % of buildable land. Re-run 2026-10-19: pass.
- **Screenshots:** [04-2-parcels-strategies.png](../../assets/screenshots/procedural-mini-world/04-2-parcels-strategies.png), [04-2-parcels-frontage-closeup.png](../../assets/screenshots/procedural-mini-world/04-2-parcels-frontage-closeup.png) (grid block B15; canal-street lots).
- **Conclusion:** parcels have real topological frontage; land beyond one lot depth stays reserve.
- **Open issues:** organic / canal-street use only 14–22 % of buildable land; canal-facing lots 0–4.

## 05.1 — Grey-box buildings · Active

- **Date:** 2026-10-18
- **Question:** can each parcel receive 0–1 building whose footprint follows frontage and setbacks, whose height follows the DNA, and whose base sits on the terrain?
- **Method / reused:** new `buildingRules.js`, `BuildingGenerator.js`, `BuildingView.js`; three's `ExtrudeGeometry`.
- **Seed / params:** 1101 / 2202 / 3303. Grid: occupancy 0.92, floors 3–32 × 3.6 m, depth 26 m. Organic: floors 1–4 × 3.2 m, courtyard ring 4.5 m (all A).
- **Test:** `verify-buildings.mjs`. 9 / 9 pass. Grid: 1 664–1 702 buildings, mean height 60.1–60.5 m, max 115 m, coverage 79 % of built parcels. Re-run 2026-10-19: pass.
- **Screenshots:** [05-1-buildings-overall.png](../../assets/screenshots/procedural-mini-world/05-1-buildings-overall.png), [05-1-buildings-street-closeup.png](../../assets/screenshots/procedural-mini-world/05-1-buildings-street-closeup.png) (seed 1101).
- **Conclusion:** buildings stay inside parcels with setbacks and touch the ground.
- **Open issues:** heights are assumptions (no PLUTO check); organic uses only 3 floor counts.

## 06.1 — City DNA 3 → 6 by configuration · Active

- **Date:** 2026-10-18
- **Question:** can Chicago, Amsterdam, and Lisbon be added purely as configuration, with the original three DNAs and the terrain bit-identical?
- **Method / reused:** 3 new entries each in `cityMatchRules.js`, `networkStrategies.js` (+ `strategyParams` hook), `parcelRules.js`, `buildingRules.js`; new `verify-city-dna.mjs`.
- **Seed / params:** 4 landforms × 1101 / 2202 / 3303 × 6 DNAs = 72 runs; variation 0.5; W 128; shared terrain coast 1101.
- **Test:** 72 / 72 runs ok; original DNAs 36 / 36 bit-identical to baseline; mean rebuild 2.0 s. Coast 1101: Manhattan 529 buildings vs Chicago 468, Amsterdam 513, Lisbon 866. Re-run 2026-10-19: pass.
- **Screenshots:** [06-1-six-cities-shared-terrain.png](../../assets/screenshots/procedural-mini-world/06-1-six-cities-shared-terrain.png) (coast 1101); [06-1-six-cities-suitable-terrain.png](../../assets/screenshots/procedural-mini-world/06-1-six-cities-suitable-terrain.png) (best-fit terrain per DNA, from `city-dna-comparison.json`).
- **Conclusion:** the rule schema generalises to new cities without new generators.
- **Open issues:** all new thresholds A and no research rows (**Unverified**); Amsterdam's ring canals absent; Chicago / Amsterdam never auto-selected.
