# Block & Parcel

Part of [03 Generative System](./system-architecture.md) · Status: **Verified** (organic / canal-street leave most land as reserve)

## Purpose

Turn the street network into urban land. **Blocks** are the closed areas between streets (at their real widths), water, and the tile edge, each with its actually buildable part. **Parcels** are plots that front a real street, at the selected DNA's lot scale. Land that cannot be parcelled stays explicit **reserve**.

## Inputs → outputs

- **Blocks:** `generateBlocks(fields, analysis, network, cityMatch, config)` (with `refineBlocks` from `BlockRefinement.js`) returns block polygons with holes, status (road-enclosed / clipped), NetworkGraph references, a buildable MultiPolygon per block, classified fragments (waterfront and others; nothing deleted), transition-band shares, and `terrainBlockIndex`.
- **Parcels:** `generateParcels(blocks, fields, network, cityMatch, config)` returns parcel polygons with fronting edge, frontage lines, orientation, corner flag, reserve per block, `terrainParcelIndex`, and stats.

## Rules

- **Blocks** (`blockRules.js`; 04.1 / 04.1b): 1 m availability field; road corridors at real widths; minimum block 100 m². Buildable = existing rule (slope ≤ 10°, ≥ 1 m above water), with a 0.6 m edge margin and a 25 m² minimum piece. Tunnels never cut blocks.
- **Parcels** (`parcelRules.js`; 04.2): lots are cut from each `buildablePolygon` along surface-road frontage, at the DNA's target frontage, maximum depth, and minimum area ([City DNA Library](../research/city-dna-library.md)). A parcel is valid only if its fronting edge is a road of its own block and the parcel reaches it. Land farther than one lot depth from a street becomes reserve and is never forced into lots.
- All thresholds are tagged A (lot sizes TBD in research).

## Upstream / downstream

- **Upstream:** [Road & Tunnel](./road-and-tunnel.md) (surface edges, widths), [Terrain & Water](./terrain-and-water.md) (`height`, `waterSurface`, `slope`, `buildableMask`), [Terrain Analysis](./terrain-analysis.md) (`suitabilityMask`), [City DNA Matching](./city-dna-matching.md) (lot hints).
- **Downstream:** [Building Extrusion](./building-extrusion.md).

## Code

`experiments/seed-terrain/blockRules.js`, `BlockGenerator.js`, `BlockRefinement.js`, `BlockView.js`, `parcelRules.js`, `ParcelGenerator.js`, `ParcelView.js` · verifiers `verify-blocks.mjs`, `verify-block-refinement.mjs`, `verify-parcels.mjs` · in Git since `7b21c3e`.

## Representative experiments

04.1, 04.1b, 04.2, see [Urban Form Experiments](../04-experiments/urban-form-experiments.md).

![Parcels](../../assets/screenshots/procedural-mini-world/04-2-parcels-strategies.png)

*Seed 1101 · grid / organic / canal-street.*

## Verified / known limitations

- **Verified:** 04.1: 15 / 15 runs, 0 invalid blocks, area residual < 1 m². Grid plain: 83–84 blocks. 04.1b: 12 / 12. Grid blocks lose only the 0.6 m margin (≈ 2 %); organic coast blocks are 51–59 of 84–92 ha buildable. 04.2: 9 / 9, 100 % valid frontage. Grid plain: 1 810–1 862 parcels, mean frontage 16.0–16.6 m, depth 28.4–28.5 m, using 86 % of buildable land.
- **Limits:** organic and canal-street use only 14–22 % of buildable land (the rest is reserve). Canal-street lots almost never face the water (0–4 canal-facing parcels). Grid blocks have rounded corners (distance-field geometry). Waterfront fragments are mostly 1–50 m² slivers, classified but not merged.
