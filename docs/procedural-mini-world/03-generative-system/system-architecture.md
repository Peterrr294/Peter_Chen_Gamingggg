# System Architecture — Terrain-first Generation Chain

Part of [03 Generative System](../README.md) · Status: **implemented, pending review** (compass [§1, §5](../FINAL-EXPERIMENT-LOG.md))

## Purpose

One deterministic chain turns a seed and a few spatial parameters into terrain, a street network, blocks, plots, and grey-box buildings on a fixed 1024 m tile. Nine tiles form a 3 × 3 world. Every stage reads only the data of the stages before it and never edits it, so a downstream layer (for example the city) can be rebuilt without touching the upstream terrain.

## Data flow (as called in the code)

```text
config (landform, seed, variation, transitionWidth)
  → generateChunk          TerrainGenerator.js   height + water surface      [Terrain & Water]
  → deriveFields           TerrainFields.js      slope, masks, transition   [Terrain & Water]
  → analyseTerrain         TerrainAnalysis.js    terrainAnalysis            [Terrain Analysis]
  → matchCity              CityMatcher.js        cityMatch (DNA ranking)    [City DNA Matching]
  → generateNetwork        NetworkGenerator.js   NetworkGraph (+ tunnels)   [Road & Tunnel]
  → generateBlocks         BlockGenerator.js     blocks (+ refinement)      [Block & Parcel]
  → generateParcels        ParcelGenerator.js    parcels                    [Block & Parcel]
  → generateBuildings      BuildingGenerator.js  buildings                  [Building Extrusion]
World: WorldGrid.js layers  raw → harmony → terrain → city   (per tile, keyed)  [World Grid & Seam]
```

Order verified in `experiments/seed-terrain/main.js` (single tile) and `experiments/world-grid/WorldGrid.js` (`generateRawLayer`, `generateTerrainLayer`, `generateCityLayer`). Rendering (`*View.js`, `ChunkView.js`, `TerrainShell.js`, `TunnelGeometry.js`) is separate from data generation.

## Frozen engineering specification

| Spec | Value | Frozen? | Source |
| --- | --- | --- | --- |
| Tile (chunk) size | 1024 m × 1024 m | **Frozen** (`CHUNK`, `Object.freeze`, "not exposed as sliders") | `seed-terrain/config.js` |
| Height samples | 257 × 257 (256 segments) | **Frozen** | same |
| Sample spacing | 4 m | **Frozen** | same |
| Buildable slope / shore freeboard | ≤ 10° / 1 m above local water | **Frozen** in `CHUNK` | same |
| Transition width | 32–256 m, step 16, default 128 | **Adjustable** (snapped) | `TRANSITION` in `config.js` |
| Seed / variation | 1–9999 / 0–1 (default 0.5) | Adjustable | `createSeedTerrainConfig` |
| World | 3 × 3 tiles, gridX, gridY ∈ {−1, 0, 1}, world origin = grid × 1024 m, default world seed 6201 | **Frozen** layout size; world seed adjustable | `world-grid/worldConfig.js` |
| City DNA thresholds | spacing, lot sizes, floors, match weights | **Not frozen**: tagged A (assumption) or TBD | [City DNA Library](../research/city-dna-library.md) |

Historical specifications (2026-10-18, superseded): 02.2 used a 64 × 64 map with 129 × 129 samples and 8 abstract parameters. 02.1 used a 44 × 72 Manhattan greybox. See [Terrain Experiments](../04-experiments/terrain-experiments.md).

## Code and commits

All Procedural Mini World code first entered Git in commit `7b21c3e` (2026-10-19 snapshot of the work done on 2026-10-18 / 19; no per-task commits exist). Later commits only changed documentation and the release entry: `29bbe14` (M02) and `b59b26c` (M02b). Each stage has a browser verifier, `scripts/verify-<name>.mjs`; all 22 passed on 2026-10-19 ([Experiment Index](../EXPERIMENT-INDEX.md)).

## Subsystem notes

[Terrain & Water](./terrain-and-water.md) · [Terrain Analysis](./terrain-analysis.md) · [City DNA Matching](./city-dna-matching.md) · [Road & Tunnel](./road-and-tunnel.md) · [Block & Parcel](./block-and-parcel.md) · [Building Extrusion](./building-extrusion.md) · [World Grid & Seam](./world-grid-and-seam.md) · [City Influence (proposed)](./city-influence.md)
