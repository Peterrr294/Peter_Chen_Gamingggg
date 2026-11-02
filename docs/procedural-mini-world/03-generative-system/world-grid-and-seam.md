# World Grid & Seam

Part of [03 Generative System](./system-architecture.md) · Status: **World Grid Verified**; **seam joins Implemented (partial)** (4 / 12 edges in world 6201); follow-ups 06.3b–06.3c Implemented, verified, pending review (see [Later seam work](#later-seam-work-063b063c))

| Navigation | |
| --- | --- |
| Parent study area | [Knowledge base home](../README.md), research path §4.1 |
| Prerequisite | [System Architecture](./system-architecture.md) (single-chunk chain) |
| This experiment | 06.2 World Grid, 06.3a seam harmonisation, then 06.3b, 06.3a-R, 06.3a-R2, 06.3c |
| Next investigation | [City Influence](./city-influence.md) (mixing at one boundary); later [Procedural Growth](./procedural-growth.md) replaced the preset grid |
| Code | [experiments/world-grid/](../../../experiments/world-grid/) |
| Runtime entry | [Live](https://gameeeee-zc626.web.app/experiments/world-grid/) (M06 state) · local `/experiments/world-grid/?seams=1` |
| Related commit | [`7b21c3e`](https://github.com/Peterrr294/Peter_Chen_Gamingggg/commit/7b21c3e) (06.2, 06.3a) · [`1f63e6f`](https://github.com/Peterrr294/Peter_Chen_Gamingggg/commit/1f63e6f) M06 checkpoint: World Grid seams, terrain coordination, World State checkpoint (06.3b–06.3c) |

## Purpose

Place nine tiles in one world frame, let the designer choose a city per tile, and make shared edges meet where the terrain allows it. Where they can't meet, measure and report why, without hiding the seam.

## Three independent concepts

| Concept | What it is | Status |
| --- | --- | --- |
| **Chunk (fixed grid)** | A fixed 1024 m computation unit at a fixed grid coordinate (gridX, gridY ∈ {−1, 0, 1}; origin = grid × 1024 m). Its terrain seed is derived from the world seed, the grid coordinate, and the landform. | Implemented · Verified · Pending review (06.2) |
| **City ID (user choice)** | Per tile: `null` (empty), `'auto'` (best terrain fit), or a City DNA key. It drives only the city layers of that tile, never its terrain. | Implemented · Verified · Pending review (06.2) |
| **City influence (boundary)** | A future field by which a city could extend across tile edges and define its own boundary. | **Proposed, not implemented**: see [City Influence](./city-influence.md) |

## Inputs → outputs

- **Inputs:** `createWorldConfig({ worldSeed, transitionWidth, variation, terrainMode })` uses the default layout of 9 slots (landform + cityId each) from `worldConfig.js`. The terrain seed per slot is `1 + hash('world-grid-terrain', worldSeed, gridX, gridY, landform) mod 9999`.
- **Layers per tile (`WorldGrid.js`, each with a cache key):** **raw** (`generateChunk` in the tile frame, then placed at its world origin) → **harmony** (`harmonizeWorld` across all tiles) → **terrain** (`deriveFields` + `analyseTerrain` on the harmonised heights) → **city** (match → network → blocks → parcels → buildings). Changing a City ID invalidates only that tile's city layer.
- **Outputs:** per-tile summaries and signatures; a seam report per shared edge (height step, slope kink, water state, port pairing); save / restore (`serialiseWorld` / `restoreWorld`, which rejects a tampered seed).

## Seam rules (`TerrainHarmonizer.js`, 06.3a)

- Raw heights are never modified. Harmonisation writes a separate height and water-level field per tile, only inside the transition band.
- Per shared edge: joint target = mean of both edge heights (corners: group mean), applied with the existing edge weight (smoothstep) plus a slope-matching term (C¹). If that makes ground steeper than 35° (≈ angle of repose; and steeper than raw + 2°), the join falls back to height only (C⁰). If it is still too steep, the edge stays **unresolved** with its raw step. No wall is generated and the band is not widened.
- **Water** spreads by connected flooding only. Sea crosses an edge only where the neighbour lies below sea level, and rivers never continue without a channel. No artificial lakes are created.
- Deterministic and independent of input order and City ID.

## Upstream / downstream

- **Upstream:** the whole single-tile chain, unchanged ([System Architecture](./system-architecture.md)). `ChunkView.js` was changed only to translate a tile to its grid origin.
- **Downstream:** the World Grid page (`experiments/world-grid/`) and the live site ([Release & Resources](../06-release/release-and-resources.md)).

## Code

`experiments/world-grid/worldConfig.js`, `WorldGrid.js`, `TerrainHarmonizer.js`, `SeamCheck.js`, `SeamView.js`, `main.js` · verifiers `verify-world-grid.mjs` (06.2, raw mode), `verify-world-seam.mjs` (06.3a) · in Git since `7b21c3e`.

## Representative experiments

06.2, 06.3a, see [World Experiments](../04-experiments/world-experiments.md).

![Seam debug](../../assets/screenshots/procedural-mini-world/06-3a-seam-debug.png)

*World seed 6201 · transition width 128 m · edge status, band limits, water state; red = unresolved step.*

## Verified / known limitations

- **Verified:** the centre tile equals the single-tile page bit for bit. One City ID change rebuilds one tile (2.3–3.2 s) with its terrain unchanged. In world 6201, 4 / 12 edges are joined with zero height step (identical Float32 values); 0 cells were changed outside the band; all 9 solids are closed. Harmonisation takes 0.54–0.64 s.
- **Limits:** 8 / 12 edges in world 6201 stay unresolved (every mountain edge, steep river banks); 1 / 4 inner corners close. Slope kink up to 8.6° near closed corners and 41.8° on C⁰ joins (world 6202). Water stays discontinuous on unresolved edges and where levels are incompatible (river ≈ 30 m vs sea 0 m). Edge ports are not paired. The outer world edge is not harmonised. Tiles are a mosaic: noise is not continued across tiles.

## Later seam work (06.3b–06.3c)

The limits above are the 06.3a state. Three follow-up tasks (2026-10-20 / 21) worked on them; full numbers are in the [log](../FINAL-EXPERIMENT-LOG.md) §7 and the [Experiment Index](../EXPERIMENT-INDEX.md).

| Task | Question | Result |
| --- | --- | --- |
| 06.3b | Can road ports on joined edges become one network? | One world NetworkGraph across harmonised edges; every unjoined port carries a measured reason |
| 06.3a-R | Can the world get one continuous relief? | World 6201: stepped edges 8 → 0, resolved 7 / 12, corners 4 / 4, but chunk cores were moved by macro ramps |
| 06.3a-R2 | Can cores, water and buildable land stay exact while seams are fixed only inside the band? | Yes; edges that need a steep step are reported as escarpment candidates. Now the World Grid default |
| 06.3c | Can each edge be judged by four separate questions (geometry, landform, hydrology, transport)? | Every edge classified smooth / valid escarpment / candidate / failed; natural scarps no longer counted as failures, nothing unresolved renamed as success |

![World 6201 from above: nine chunks with each shared edge drawn by its seam class, mountains in the top row, coast and river chunks below](../../assets/screenshots/procedural-mini-world/06-3c-seam-classes-overall.png)

**What this shows:** the nine chunks with each shared edge drawn by class; the two mountain chunks of the top row meet the plain and river chunks at escarpment edges; coastal edges hold the sea at the edge instead of cutting it.
**Conditions:** world seed 6201, transition 128 m, terrain mode R2 (default), task 06.3c capture.
**Why it matters:** it separates "the surface is continuous" from "a road can cross", which the 06.3a joined / unresolved split could not express.
**Limit:** it does not show road continuity across scarps; roads still stop at unresolved edges.

**Study notebook, in short.** *Question:* can preset chunks join into one world without hiding seams? *Observation (logged):* most edges between different landforms cannot be joined with natural slopes; each fix exposed a narrower question. *What changed in understanding (from the log):* a seam is several problems (geometry, landform, water, roads), not one. *Next question:* the layout itself was fixed before any rule ran, which led to [Procedural Growth](./procedural-growth.md).

> Observation to complete after testing: are the R2 escarpments acceptable as landscape, or do they read as errors?
