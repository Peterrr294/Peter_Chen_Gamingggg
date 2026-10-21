# Procedural Mini World — Experiment Index

One table row per recorded task. This page is a map, not a second log: every number, method detail, and open issue lives in the matching entry of [FINAL-EXPERIMENT-LOG.md](./FINAL-EXPERIMENT-LOG.md) §7 (search the task ID). Stage status is defined only by the log's §1 and §5.

**How to read the columns**

- **Lifecycle:** **Active** = code used by the current pipeline; **Superseded** = replaced by a later task, kept for history; **Archived** = earlier project, still runnable, not part of the current pipeline.
- **Test:** *logged* = result recorded in the log entry; *re-run 2026-10-19* = the same verifier run again on 2026-10-19, during M02 or, where marked, during M01. "—" = no automated verifier exists.
- **Review:** no task has been accepted yet. Every entry is **Pending review** in the log.
- **Commit:** all Procedural Mini World work was uncommitted until M02. It first enters Git in commit `7b21c3e` on `experiment/terrain-seam`, which `main` follows from M02b on. The deployed state is tag `release/m01-2026-10-19` (`7b21c3e`).

Midterm reading route: [Midterm Review](./midterm-review/00-midterm-review.md). Knowledge base home: [HOME](./README.md).

**Per-task cards** (date, question, method, reused code, seed / parameters, test numbers, screenshots, conclusion, open issues, commit): [Terrain](./04-experiments/terrain-experiments.md) · [Network](./04-experiments/network-experiments.md) · [Urban Form](./04-experiments/urban-form-experiments.md) · [World](./04-experiments/world-experiments.md) · [Archived](./04-experiments/archived-experiments.md). System descriptions: [System Architecture](./03-generative-system/system-architecture.md).

Entry points (Vite dev server, `npm run dev`): single chunk `/experiments/seed-terrain/`, world `/experiments/world-grid/`. Online: <https://gameeeee-zc626.web.app/#miniWorld>.

## Pipeline at a glance

```text
Seed terrain (T1) → terrain analysis (T2) → City DNA match (T3) → road / canal network + tunnels (T4)
  → blocks → parcels (T5) → grey-box buildings + solid terrain + tunnel cuts (T6) → 3 × 3 World Grid + seams (T7)
```

## 1. Research and City DNA

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXP-00 | Shrink the city-world idea into a verifiable research frame | Research template + 40-field CSV · [template](./research/city-research-template.md), [CSV](./research/city-research-template.csv) | Template structure check passed (40 fields in doc = CSV) | text only | manual structure check | Active (research base) | 60-city longlist |
| EXP-00.2 | Global candidate set by dominant spatial logic | 10 families × 6 cities · [city-longlist-60.md](./research/city-longlist-60.md) | 60 unique cities, 10 families, IDs 01–60 complete; most features "to be verified" | text only | manual count check | Active (research database, not an implementation target) | Two-source checks; pick 3 prototypes |
| 00.3 / 01.1 | Prototype selection; Manhattan spatial study | [prototype-city-selection.md](./research/prototype-city-selection.md), [manhattan-spatial-study.md](./research/manhattan-spatial-study.md) | **No log entry.** Files exist; status not recorded (flagged in OPS-01) | — | — | **Pending verification** | Human decides whether to log them |
| 02.6 | Rank City DNAs by terrain fit (fit ≠ identity) | `cityMatchRules.js`, `CityMatcher.js` | 12/12 pass; plain → Manhattan 0.80; mountain weak for all | [img](../assets/screenshots/procedural-mini-world/02-6-city-match-auto-vs-manual.png) | logged pass · re-run 2026-10-19 pass | Active | Review rule table |
| 06.1 | City DNA 3 → 6 (Chicago, Amsterdam, Lisbon) by configuration only | `networkStrategies.js`, `cityMatchRules.js`, `parcelRules.js`, `buildingRules.js` · `scripts/verify-city-dna.mjs` | 72/72 runs ok; original 3 DNAs bit-identical to baseline; Chicago / Amsterdam never win auto-match | [shared terrain](../assets/screenshots/procedural-mini-world/06-1-six-cities-shared-terrain.png), [suitable terrain](../assets/screenshots/procedural-mini-world/06-1-six-cities-suitable-terrain.png) | logged pass · re-run 2026-10-19 (M01) pass | Active | Terrain rule for river plain / canal belt, or keep manual |

## 2. Terrain

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 02.1 | Manhattan terrain / water / buildability greybox | `experiments/manhattan-terrain-greybox/` · `verify-manhattan-terrain.mjs` | 3 seeds reproducible; seed variation < 2% | [img](../assets/screenshots/procedural-mini-world/manhattan-terrain-greybox.png) | logged pass · re-run 2026-10-19 pass | **Superseded** by the Terrain-first pipeline (02.2, 2026-10-18); its `style.css` is still used by the active pages | — |
| 02.2 | City-neutral seed terrain with live fields | `experiments/seed-terrain/` (first version) | 3 seeds reproducible; sea ring only | screenshot path later overwritten by 02.2b | logged pass (verifier since rewritten) | **Superseded** by 02.2b / 02.4 | — |
| 02.2b | Full square tile, inland water, transition zone | `TileShape.js` (deleted in 02.4) | Reproducible; river + lakes for every seed | [img](../assets/screenshots/procedural-mini-world/02-2-seed-terrain-after.png) | logged pass (verifier since rewritten) | **Superseded** by 02.3 / 02.4 | — |
| 02.3 | One frozen chunk, four landform rule sets | `config.js` presets | 12 landform × seed pairs reproducible | [img](../assets/screenshots/procedural-mini-world/02-3-landforms-compare.png) | logged pass (verifier since rewritten) | **Superseded** by 02.4 algorithms | — |
| 02.4 | Explicit landform algorithms + adjustable transition weight | `TerrainGenerator.js`, `TerrainFields.js`, `ChunkView.js` · `verify-seed-terrain.mjs` | 12/12 reproducible; height unchanged across widths 32/128/256 m | [overall](../assets/screenshots/procedural-mini-world/02-4-landforms-overall.png), [transition](../assets/screenshots/procedural-mini-world/02-4-transition-debug.png) | logged pass · re-run 2026-10-19 (M01) pass | Active (T1) | Define neighbour blend contract |
| 02.5 | Terrain analysis as constraints for the city | `TerrainAnalysis.js` · `verify-terrain-analysis.mjs` | 12/12 pass; directions reported only with evidence | [img](../assets/screenshots/procedural-mini-world/02-5-suitability-debug.png) | logged pass · re-run 2026-10-19 pass | Active (T2) | Review thresholds |
| 05.1b-1 | Closed manifold solid chunk | `TerrainShell.js` · `verify-solid-terrain.mjs` | 6/6 closed, χ = 2 | [overall](../assets/screenshots/procedural-mini-world/05-1b-solid-terrain-overall.png), [side](../assets/screenshots/procedural-mini-world/05-1b-solid-terrain-side.png) | logged pass · re-run 2026-10-19 pass | Active | Tunnel cuts (05.1b-2) |

## 3. Network and tunnels

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 03.1 | One NetworkGraph, three strategies (Grid / Organic / Canal-Street) | `NetworkGraph.js`, `NetworkGenerator.js`, `networkStrategies.js` · `verify-road-network.mjs` | 36/36 pass; organic / canal-street are tree-like | [overall](../assets/screenshots/procedural-mini-world/03-1-network-overall.png), [debug](../assets/screenshots/procedural-mini-world/03-1-network-strategies-debug.png) | logged pass · re-run 2026-10-19 pass | Active (T4) | Grid truncation / bridge policy |
| 03.2 | Grade-limited mountain roads, then checked tunnels | `TunnelPlanner.js` · `verify-tunnels.mjs` | 9/9 pass; 0–1 tunnel per mountain seed | [overall](../assets/screenshots/procedural-mini-world/03-2-mountain-tunnels-overall.png), [x-ray](../assets/screenshots/procedural-mini-world/03-2-tunnel-xray-profile.png) | logged pass · re-run 2026-10-19 pass | Active | Portal geometry |
| 03.3 | Local loop closure for organic / canal-street | `closeLoops` in `NetworkGenerator.js` · `verify-loops.mjs` | Cycles added (e.g. organic coast 3303: 0 → 13); dead ends kept 25–38% | [network](../assets/screenshots/procedural-mini-world/03-3-loops-network-before-after.png), [blocks](../assets/screenshots/procedural-mini-world/03-3-loops-blocks-before-after.png) | logged pass · re-run 2026-10-19 pass | Active | Tune loop limits |
| 05.1b-2 | Real tunnel excavation in the solid | `TunnelGeometry.js` · `verify-tunnel-excavation.mjs` | 3 tunnels built, solid stays closed | [portals](../assets/screenshots/procedural-mini-world/05-1b2-tunnel-portals.png), [x-ray](../assets/screenshots/procedural-mini-world/05-1b2-tunnel-xray.png) | logged pass · re-run 2026-10-19 pass | Active; known defect on mountain 7922 / Chicago (found in 06.2) | Portal vertical curves |

## 4. Blocks and parcels

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 04.1 | Closed block polygons from roads, water, chunk edge | `BlockGenerator.js`, `blockRules.js` · `verify-blocks.mjs` | 15/15 pass, 0 invalid blocks | [strategies](../assets/screenshots/procedural-mini-world/04-1-blocks-strategies.png), [grid debug](../assets/screenshots/procedural-mini-world/04-1-blocks-grid-debug.png) | logged pass · re-run 2026-10-19 pass | Active (T5) | Loop closure (done in 03.3) |
| 04.1b | Buildable MultiPolygons, fragments, transition shares | `BlockRefinement.js` · `verify-block-refinement.mjs` | 12/12 pass; nothing deleted, fragments classified | [strategies](../assets/screenshots/procedural-mini-world/04-1b-buildable-strategies.png), [canal debug](../assets/screenshots/procedural-mini-world/04-1b-canal-refinement-debug.png) | logged pass · re-run 2026-10-19 pass | Active | Parcels on enclosed grid blocks |
| 04.2 | Road-oriented parcel subdivision | `ParcelGenerator.js`, `parcelRules.js` · `verify-parcels.mjs` | 9/9 pass, 100% valid frontage | [strategies](../assets/screenshots/procedural-mini-world/04-2-parcels-strategies.png), [close-up](../assets/screenshots/procedural-mini-world/04-2-parcels-frontage-closeup.png) | logged pass · re-run 2026-10-19 pass | Active | Interior reserve access |

## 5. Buildings

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 05.1 | 0–1 grey-box building per parcel, DNA heights, ground contact | `BuildingGenerator.js`, `BuildingView.js`, `buildingRules.js` · `verify-buildings.mjs` | 9/9 pass; grid mean height ≈ 60 m (assumption, not measured) | [overall](../assets/screenshots/procedural-mini-world/05-1-buildings-overall.png), [street](../assets/screenshots/procedural-mini-world/05-1-buildings-street-closeup.png) | logged pass · re-run 2026-10-19 pass | Active (T6) | Check heights against research |

## 6. World Grid

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 06.2 | 3 × 3 chunks in one world frame, City ID per slot, layered rebuilds | `experiments/world-grid/` (`worldConfig.js`, `WorldGrid.js`, `main.js`) · `verify-world-grid.mjs` | All checks pass; one City ID change rebuilds one chunk only | [overall](../assets/screenshots/procedural-mini-world/06-2-world-grid-overall.png), [selected chunk](../assets/screenshots/procedural-mini-world/06-2-world-grid-selected-chunk.png) | logged pass · re-run 2026-10-19 (M01) pass | Active (T7) | Neighbour constraint for one edge |

## 7. Seams

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 06.2 (seams) | Detect seams without hiding them | `SeamCheck.js`, `SeamView.js` | 12/12 edges stepped (5.2–296 m), 6 one-sided water edges | [debug](../assets/screenshots/procedural-mini-world/06-2-world-grid-seams-debug.png) | as 06.2 | Active (detection) | — |
| 06.3a | Join terrain + water at shared edges where a natural slope is possible | `TerrainHarmonizer.js` · `verify-world-seam.mjs` | World 6201: 4/12 edges joined (Δh 0), 8 unresolved and reported; 1/4 corners closed | [overall](../assets/screenshots/procedural-mini-world/06-3a-world-harmonized-overall.png), [corner](../assets/screenshots/procedural-mini-world/06-3a-seam-closeup-compare.png), [debug](../assets/screenshots/procedural-mini-world/06-3a-seam-debug.png) | logged pass · re-run 2026-10-19 (M01) pass | Active | Policy for unresolvable edges |

## 8. Release, deployment, and process

| ID | Purpose | Method · main files | Result (logged) | Evidence | Test | Lifecycle | Next (from log) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-01 | Agent + Obsidian rules aligned with the compass | [AGENTS.md](../../AGENTS.md) | Link check passed | text only | `verify-markdown-links.mjs` | Active | Human confirms §1 stage |
| M01 | Publish the midterm build to the existing Firebase site | `vite.config.js`, `site.js`, `index.html` (hub entry only) | 11/11 smoke checks on the public URL, 0 browser errors | [img](../assets/screenshots/procedural-mini-world/m01-live-world-grid-after.png) | `verify-live-release.mjs` (added in M02b): 10/10 pass on the public URL, 2026-10-19 | Active (live) | Done in M02b: `main` fast-forwarded |
| M02 | GitHub knowledge base: README, this index, link fixes, `.gitignore` | `README.md`, this page, [terrain-seam-building-scatter.md](../projects/flavor-clash/terrain-seam-building-scatter.md) | See log entry M02 | text only | `verify-markdown-links.mjs` | Active | — |
| M02b | Follow-up: `main`, compass §5, Terrain Seam models note, live verifier | log §5, `scripts/verify-live-release.mjs`, `package.json` (`verify:live`) | See log entry M02b | text only | `verify-live-release.mjs` 10/10 | Active | Decide on the live Terrain Seam page |

## Archived experiments (before Procedural Mini World)

Earlier studies on the same site. They are kept runnable and are not part of the current pipeline. Rows marked **dependency** have modules that the active code still imports, so do not delete them.

| Experiment | Folder | Record | Test | Lifecycle |
| --- | --- | --- | --- | --- |
| Starlight Run | `legacy-game.html` | [overview](../projects/starlight-run/overview.md) | — | Archived |
| React Three Fiber scene | `scene.html`, `src/` | [learning path](../learning/react-three-fiber/learning-path.md) | — | Archived |
| Cellular Noise | `experiments/cellular-noise/` | [README](../../experiments/cellular-noise/README.md) | — | Archived · **dependency** (`noise.js`) |
| Voxel Terrain | `experiments/voxel-terrain/` | [README](../../experiments/voxel-terrain/README.md) | — | Archived |
| Shader Basics | `experiments/shader-basics/` | [notes](../learning/shaders/first-shader-experiments.md) | — | Archived |
| PCG Terrain Lab | `experiments/pcg-terrain/` | [notes](../learning/pcg-terrain/random-scattering.md) | re-run 2026-10-19 pass | Archived |
| Flavor Clash map | `experiments/flavor-clash-prototype/` | [README](../projects/flavor-clash/README.md) | re-run 2026-10-19 (M01) pass | Archived · **dependency** (`world/SeededRandom.js`) |
| Iceland Region | `experiments/iceland-region/` | [Flavor Clash README](../projects/flavor-clash/README.md) | re-run 2026-10-19 pass | Archived · **dependency** (`SurfaceQuery.js`) |
| Road Projection | `experiments/road-projection/` | [Flavor Clash README](../projects/flavor-clash/README.md) | re-run 2026-10-19 pass | Archived |
| Road Mesh | `experiments/road-mesh/` | [Flavor Clash README](../projects/flavor-clash/README.md) | re-run 2026-10-19 pass | Archived · **dependency** (`RoadMeshBuilder.js`, `config.js`) |
| Terrain Seam (Venice / Japan) | `experiments/terrain-seam/` | [building scatter](../projects/flavor-clash/terrain-seam-building-scatter.md) | re-run 2026-10-19 pass | Archived; 06.3a reused its blend principle. Needs git-ignored local models ([list](../projects/flavor-clash/terrain-seam-building-scatter.md)). Without them, and on the public site, the page stops at load |

Dated session summaries: [2026-10-18](../logs/2026-10-18.md), [2026-10-19](../logs/2026-10-19.md). Superseded plan: the "Original roadmap" table in log §5.
