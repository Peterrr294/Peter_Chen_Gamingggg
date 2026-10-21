# World Experiments — World Grid and Seams

Part of [04 Experiments](../EXPERIMENT-INDEX.md). Numbers are copied from the task entries in the [experiment log](../FINAL-EXPERIMENT-LOG.md) (§7). **Commit:** first in Git in `7b21c3e`. Review status: **pending review**.

System note: [World Grid & Seam](../03-generative-system/world-grid-and-seam.md) · Future stages: [City Influence](../03-generative-system/city-influence.md)

## 06.2 — World Grid and city placement (3 × 3) · Active

- **Date:** 2026-10-18
- **Question:** can nine fixed chunks share one world frame, each running the unchanged single-chunk chain with its own derived seed and a user-chosen City ID, rebuilding only invalidated layers, with seams measured but not hidden?
- **Method / reused:** new `experiments/world-grid/` (`worldConfig.js`, `WorldGrid.js`, `SeamCheck.js`, `SeamView.js`, `main.js`); the whole seed-terrain chain unchanged; `ChunkView.js` translated to the grid origin.
- **Seed / params:** world seed 6201, variation 0.5, W 128. Default layout: north row mountain 5704 (empty), mountain 2264 (auto → Fez), river valley 9187 (Fez); middle row plain 5718 (Chicago), plain 2085 (Manhattan), river valley 2361 (auto → Fez); south row coast 1385 (Amsterdam), coast 3051 (auto → Lisbon), coast 6678 (Lisbon). Tunnel cases in world seeds 6202 / 6203.
- **Test:** `verify-world-grid.mjs`. All checks pass, 0 browser errors. The centre chunk equals the single-chunk page bit for bit; 7 / 7 city chunks equal their origin-0 generation. One City ID change rebuilds one chunk in 2.3–3.2 s. First world build 18.3–21.8 s. Re-run 2026-10-19: pass.
- **Seams (detection only):** 12 / 12 edges stepped (|Δh| max 5.2–296 m); one-sided water on 6 / 12; 7 port pairs by position on 2 edges.
- **Screenshots:** [06-2-world-grid-overall.png](../../assets/screenshots/procedural-mini-world/06-2-world-grid-overall.png) (world 6201, oblique); [06-2-world-grid-selected-chunk.png](../../assets/screenshots/procedural-mini-world/06-2-world-grid-selected-chunk.png) (chunk_1_0 → Amsterdam); [06-2-world-grid-seams-debug.png](../../assets/screenshots/procedural-mini-world/06-2-world-grid-seams-debug.png) (chunk_0_0 | chunk_1_0).
- **Conclusion:** chunk (fixed grid), City ID (user choice), and city influence (future) are kept as separate concepts; placement works without changing the chain.
- **Open issues:** seams everywhere (no neighbour constraint yet); a pre-existing tunnel defect exposed (mountain 7922 + Chicago, χ 6); tiles are a mosaic (noise not continued); outer edges unchecked.

## 06.3a — Multi-chunk terrain and water seam · Active (Partial result)

- **Date:** 2026-10-19
- **Question:** can adjacent chunks get one continuous, reproducible terrain surface and consistent water at shared edges inside the existing transition bands, and where that is impossible, is the reason measured and reported?
- **Method / reused:** new `TerrainHarmonizer.js`; the blend principle of `experiments/terrain-seam` / `flavor-clash-prototype` (`connectedTransitionHeight`, smoothstep) applied as a per-chunk correction field; `edgeWeight`, `deriveFields`, `analyseTerrain` unchanged.
- **Seed / params:** world seeds 6201 / 6202 / 6203; W 128 (also 64, 256 on 6201); maxTransitionSlope 35°, created-slope margin 2°, water tolerance 1 m.
- **Test:** `verify-world-seam.mjs`. All checks pass. World 6201, W 128: 4 / 12 edges joined (C¹), Δh 0 at all 257 samples; 8 / 12 unresolved; 1 / 4 corners closed; 0 cells changed outside the band; one-sided water edges 6 → 4. Seeds: 6202 joined 6, 6203 joined 4. Harmonisation 0.54–0.64 s. Re-run 2026-10-19: pass.
- **Screenshots:** [06-3a-world-harmonized-overall.png](../../assets/screenshots/procedural-mini-world/06-3a-world-harmonized-overall.png) (6201, W 128); [06-3a-seam-closeup-compare.png](../../assets/screenshots/procedural-mini-world/06-3a-seam-closeup-compare.png) (closed corner x −512 / z 512, raw vs harmonised); [06-3a-seam-debug.png](../../assets/screenshots/procedural-mini-world/06-3a-seam-debug.png).
- **Conclusion:** joins happen only where a natural slope is possible; unjoinable edges keep their step and are reported; deterministic and order-independent.
- **Open issues:** every mountain edge unjoinable within 32–256 m; slope kink up to 41.8° on C⁰ edges; water levels incompatible on some edges (river ≈ 30 m vs sea 0 m); ports not paired; known tunnel failure isolated (6202 / chunk_0_-1 / Chicago).
