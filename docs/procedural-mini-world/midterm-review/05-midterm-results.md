# 5 · Midterm Results

[← Experiments](./04-experiments.md) · [Home](./00-midterm-review.md) · [Next: Limitations →](./06-limitations.md)

**Online:** [gameeeee-zc626.web.app/#miniWorld](https://gameeeee-zc626.web.app/#miniWorld) (3 × 3 world) · [single tile](https://gameeeee-zc626.web.app/experiments/seed-terrain/?landform=plain&seed=2085&dna=manhattanGrid) · **Source:** [GitHub, branch `main`](https://github.com/Peterrr294/Peter_Chen_Gamingggg) (private repository; access by invitation).

## Against the semester targets

Same table as the [Midterm Overview](./00-midterm-review.md); the target wording follows compass §3 in the [experiment log](../FINAL-EXPERIMENT-LOG.md).

| Semester target (compass §3) | Status | Evidence |
| --- | --- | --- |
| 1. Three structurally distinct City DNAs | **Verified**: six, on three network strategies | 06.1: 72 / 72 runs; Chicago, Amsterdam, and Lisbon added by configuration only |
| 2. Full chain terrain → network → parcels → buildings | **Verified** | 02.4 → 05.1, each step with its own passing verifier |
| 3. Parameter changes give stable, explainable spatial change | **Verified** for seed, landform, transition width, City ID | reproducibility checks per task; City ID change leaves terrain unchanged (06.2); [Key Parameters](./03-key-parameters.md) |
| 4. ≥ 3 modules joined or mixed into one Mini World | **Implemented (partial)** | 9 tiles in one world; terrain joins on 4 / 12 edges (world 6201); no street crosses a tile edge; no mixing |
| 5. Reproducible seeds, debug views, statistics, source evidence | **Verified** for seeds, debug views, and statistics; **Implemented (partial)** for sources | 33 task screenshots + evidence JSON; research measurements TBD |
| 6. Runnable program, documentation, process images, demo video | **Verified** except the **video (TBD)** | live site; this knowledge base; [Screenshot Index](../99-attachments/screenshot-index.md) |

## Measured results

| What | Number (from the logged verifier run) |
| --- | --- |
| Terrain reproducibility | 12 / 12 landform × seed pairs identical on reload (02.4) |
| Street network legality | 36 / 36 runs: 0 roads on water, 0 beyond slope limit (03.1) |
| Blocks | 0 invalid blocks across 15 runs (04.1) |
| Plots | 100 % valid street frontage; grid plain ≈ 1 810–1 860 plots (04.2) |
| Buildings | grid plain ≈ 1 660–1 700 volumes, mean height ≈ 60 m (05.1) |
| Solid terrain | 6 / 6 tiles watertight (Euler characteristic 2); 3 tunnels cut, solid still closed (05.1b) |
| City swap | changing one City ID rebuilds one tile in 2.3–3.2 s; terrain unchanged (06.2) |
| Seams, world 6201 | 4 / 12 edges joined with zero height step; 1 / 4 inner corners closed (06.3a) |
| Whole world build | ≈ 17–25 s for nine tiles in the browser (06.3a: 21.6–24.5 s; M01 online: 17.2 s) |
| Automated checks | all 22 task verifiers passed on 2026-10-19; live-site check 10 / 10, 0 browser errors (M01, M02b) |

## Verified · Implemented (partial) · Proposed

| Verified | Implemented (partial) | Proposed |
| --- | --- | --- |
| Four landform algorithms in one tile format | Terrain seams: 4 / 12 edges, 1 / 4 corners | Streets that continue across tile edges (port pairing) |
| Site analysis (buildability, water, directions) | Water continuity across edges (2 of 6 one-sided edges resolved) | City influence field across tiles |
| 6 City DNAs with transparent match scores | City DNA thresholds: mostly assumptions, research measurements pending | City boundary expansion and mixing of DNAs |
| Grid / organic / canal-street networks, loop closure | Organic and canal-street networks: sparse, much reserve land | Calibration against real data (e.g. Manhattan PLUTO heights) |
| Mountain roads and excavated tunnels | Tunnels: one known failing combination, isolated | Video walk-through |
| Blocks, buildable land, road-fronted plots | | |
| Grey-box buildings on terrain | | |
| 3 × 3 World Grid with a City ID per tile | | |
| Public deployment and automated online check | | |

![Six City DNAs on their best-scoring test terrain](../../assets/screenshots/procedural-mini-world/06-1-six-cities-suitable-terrain.png)

*Each City DNA on the test terrain where it scores highest (selected by data, not by hand). From `city-dna-comparison.json`: Manhattan plain 1101 (score 0.80), Chicago plain 1101 (0.62), Lisbon coast 2202 (0.47), Fez coast 1101 (0.43), Amsterdam coast 1101 (0.31), Venice coast 1101 (0.23). Venice and Amsterdam stay weak fits because no test landform produces a lagoon (Venice) or flat land with a river or canal belt (Amsterdam).*

[← Experiments](./04-experiments.md) · [Home](./00-midterm-review.md) · [Next: Limitations →](./06-limitations.md)
