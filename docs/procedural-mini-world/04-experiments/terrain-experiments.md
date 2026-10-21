# Terrain Experiments

Part of [04 Experiments](../EXPERIMENT-INDEX.md). One card per task. Numbers are copied from the task entries in the [experiment log](../FINAL-EXPERIMENT-LOG.md) (§7, search the ID), which stays the full record. **Commit:** all tasks below are first in Git in `7b21c3e` (snapshot; no per-task commits). Review status of every card: **pending review**.

System notes: [Terrain & Water](../03-generative-system/terrain-and-water.md) · [Terrain Analysis](../03-generative-system/terrain-analysis.md)

## 02.1 — Manhattan terrain / water / buildability greybox · Superseded

- **Date:** 2026-10-18
- **Question:** can the existing Manhattan greybox run reproducibly?
- **Method / reused:** existing `experiments/manhattan-terrain-greybox/` (no code change); `noise.js` (cellular-noise), `SeededRandom` (flavor-clash), `SurfaceQuery` (iceland-region).
- **Seed / params:** `MANHATTAN-1101 / 2202 / 3303`; map 44 × 72, resolution 112, maxBuildableSlope 8°.
- **Test:** `verify-manhattan-terrain.mjs`. Each seed was reproducible across 2 loads, with 3 unique signatures (`7A91A32A`, `1DE833E4`, `9654BA61`); water / buildable / buffer for 1101 = 3208 / 7637 / 1924 of 12 769 samples.
- **Screenshot:** [manhattan-terrain-greybox.png](../../assets/screenshots/procedural-mini-world/manhattan-terrain-greybox.png): seed MANHATTAN-1101, defaults.
- **Conclusion:** runs and reproduces, but the tile is city-shaped (City DNA imposed on terrain).
- **Open issues:** seed variation < 2 %; dark square artifact; 11 non-seed parameters. → **Superseded** by the Terrain-first pipeline (02.2); its `style.css` is still used by the active pages.

## 02.2 — City-neutral seed terrain with live fields · Superseded

- **Date:** 2026-10-18
- **Question:** can a city-neutral seeded terrain expose reproducible height, water, slope, and buildability fields?
- **Method / reused:** `IcelandTerrain` (iceland-region), `checksum`, slope method from 02.1.
- **Seed / params:** `TERRAIN-01/02/03`; 64 × 64 map, 129 × 129 samples, 8 abstract parameters.
- **Test:** verifier of that time (later rewritten); 3 seeds reproducible; water / buildable / steep / shore for 01 = 3371 / 5540 / 7362 / 368 of 16 641.
- **Screenshot:** the original capture was overwritten by 02.2b at the same path (**missing**).
- **Conclusion:** fields work; water only as an outer sea ring.
- **Open issues:** no inland water; square plateau coast. → Superseded by 02.2b.

## 02.2b — Full square tile, inland water, transition zone · Superseded

- **Date:** 2026-10-18
- **Question:** can the terrain fill the whole tile with rivers, lakes, plains, and a marked edge transition zone?
- **Method / reused:** new `TileShape.js` (deleted in 02.4); `IcelandTerrain` unchanged.
- **Seed / params:** `TERRAIN-01/02/03`; 10 public parameters (incl. lowlandFlattening 0.25, riverWidth 2.2).
- **Test:** reproducible; transition 6 032 samples and corners 676 for every seed; each river crosses two opposite edges.
- **Screenshot:** [02-2-seed-terrain-after.png](../../assets/screenshots/procedural-mini-world/02-2-seed-terrain-after.png): TERRAIN-01, defaults.
- **Conclusion:** no surrounding sea; transition zone marked, not flattened.
- **Open issues:** ≈ half of the land steeper than 12°; buildable only 22–23 %. → Superseded by 02.3 / 02.4.

## 02.3 — One frozen chunk, four landform rule sets · Superseded

- **Date:** 2026-10-18
- **Question:** can one frozen chunk format produce plain, river valley, coast, and mountain, with water only by rule?
- **Method / reused:** 02.2b `TileShape` / `TerrainFields`, presets in `config.js`.
- **Seed / params:** **chunk frozen here:** 1024 × 1024 m, 257 × 257 samples (4 m), 128 m edge zone, freeboard 1 m, buildable ≤ 10°. Seeds 1101 / 2202 / 3303.
- **Test:** 12 / 12 pairs reproducible. Water / buildable: plain 2.6–4.3 % / 75–80 %; coast 29–34 % / 57–63 %; mountain 0 % / 3.7–4.3 %.
- **Screenshot:** [02-3-landforms-compare.png](../../assets/screenshots/procedural-mini-world/02-3-landforms-compare.png): seed 1101, variation default.
- **Conclusion:** one data interface (`stats`, `boundary`, `fields`) for all landforms.
- **Open issues:** presets probe-tuned on 3 seeds; plain looks flat at true scale. → Algorithms superseded by 02.4 (chunk spec kept).

## 02.4 — Landform algorithms and adjustable transition weight · Active

- **Date:** 2026-10-18
- **Question:** can each landform come from an explicit algorithm, with an adjustable transition weight that leaves terrain untouched?
- **Method / reused:** new `TerrainGenerator.js`, `ChunkView.js`; rewritten `TerrainFields.js`; three's `SimplexNoise` seeded by `SeededRandom`.
- **Seed / params:** seeds 1101 / 2202 / 3303; variation 0.5; transition 32–256 m (default 128). Rules: [Terrain & Water](../03-generative-system/terrain-and-water.md).
- **Test:** `verify-seed-terrain.mjs`. 12 / 12 reproducible; height and water identical at 32 / 128 / 256 m; river with 0 off-channel water; 0 browser errors. Re-run 2026-10-19: pass.
- **Screenshots:** [02-4-landforms-overall.png](../../assets/screenshots/procedural-mini-world/02-4-landforms-overall.png) (seed 1101, variation 0.5, W 128); [02-4-transition-debug.png](../../assets/screenshots/procedural-mini-world/02-4-transition-debug.png) (coast 1101, W 32 / 128 / 256).
- **Conclusion:** four rule-based landforms in one chunk; data generation separate from rendering.
- **Open issues:** mountain p99 slope 62–71°; neighbour blending only an interface (later done in the world layer, 06.3a).

## 02.5 — Terrain analysis for city generation · Active

- **Date:** 2026-10-18
- **Question:** can explainable features and buildability be extracted automatically from the 02.4 fields?
- **Method / reused:** new `TerrainAnalysis.js`; 02.4 fields only.
- **Seed / params:** 4 landforms × 1101 / 2202 / 3303; variation 0.5; W 128; thresholds in [Terrain Analysis](../03-generative-system/terrain-analysis.md).
- **Test:** `verify-terrain-analysis.mjs`. 12 / 12 pass. Plain 0 % water / 100 % buildable; river valley 3.3–3.5 % water, 19–22 significant regions. Re-run 2026-10-19: pass.
- **Screenshot:** [02-5-suitability-debug.png](../../assets/screenshots/procedural-mini-world/02-5-suitability-debug.png): seed 1101, variation 0.5.
- **Conclusion:** statistics, regions, edge connections, and suitability trace back to fields and thresholds.
- **Open issues:** signature ignores statistics; plain tilt stays `unknown`; fragmented buildable land on river / mountain.

## 05.1b-1 — Closed solid terrain chunk · Active

- **Date:** 2026-10-18
- **Question:** can the open surface become a closed manifold solid without changing heights?
- **Method / reused:** new `TerrainShell.js`; the rendered 257 × 257 surface.
- **Seed / params:** plain 1101, river valley 2202, coast 3303, mountain 1101 (variation 0.5); coast 1101 and mountain 3303 at variation 1.0; base −60 m, min thickness 20 m.
- **Test:** `verify-solid-terrain.mjs`. 6 / 6 + synthetic: 0 open / non-manifold edges, χ = 2, volume error ≤ 1.4e-14. Re-run 2026-10-19: pass.
- **Screenshots:** [05-1b-solid-terrain-overall.png](../../assets/screenshots/procedural-mini-world/05-1b-solid-terrain-overall.png), [05-1b-solid-terrain-side.png](../../assets/screenshots/procedural-mini-world/05-1b-solid-terrain-side.png).
- **Conclusion:** the solid is the prerequisite for real tunnel cuts (05.1b-2).
- **Open issues:** water is a separate open sheet; no capped cross-section; no exported mesh file.
