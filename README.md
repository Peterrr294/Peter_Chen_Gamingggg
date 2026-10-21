# Procedural Mini World

A controllable procedural world driven by real urban spatial relations. Seeded terrain is generated city-neutral first. A **City DNA** (Manhattan, Venice, Fez, Chicago, Amsterdam, Lisbon) is then matched to the detected landforms and drives roads and canals, blocks, parcels, and grey-box buildings. Nine such chunks form a 3 × 3 world whose shared edges are joined where the terrain allows it. Edges that can't be joined are measured and reported, not hidden.

It is not a traditional game and not a visual copy of a city. The seed only produces reproducible variation inside the rules; the City DNA carries the identity.

> **Research question:** How can city characteristics be encoded as controllable procedural rules, and when those rules change continuously, mix, or are stitched together, how is city identity kept, weakened, or re-formed?

**Live:** <https://gameeeee-zc626.web.app/#miniWorld> · **Source:** <https://github.com/Peterrr294/Peter_Chen_Gamingggg> (branch `main`)

![Live site, Mini World tab: 3 × 3 world, world seed 6201, one chunk switched to Amsterdam](./docs/assets/screenshots/procedural-mini-world/m01-live-world-grid-after.png)

*Public site, 2026-10-19: world seed 6201, transition 128 m, harmonised terrain. `chunk_1_0` (yellow outline) was switched to Amsterdam, and only that chunk rebuilt (2.3 s).*

## Current status (midterm, 2026-10-19)

The authority is the project compass: [FINAL-EXPERIMENT-LOG.md §1 and §5](./docs/procedural-mini-world/FINAL-EXPERIMENT-LOG.md). Every task below is implemented, verified by its own script, and **pending human review**. None has been accepted yet.

| Pipeline step | What exists | Task IDs |
| --- | --- | --- |
| Terrain | 1024 m chunk, four landform algorithms (plain, river valley, coast, mountain), height / water / slope / buildability fields, closed solid | 02.4, 05.1b-1 |
| Analysis + City DNA | Explainable feature detection; ranking of 6 DNAs by terrain fit; manual override | 02.5, 02.6, 06.1 |
| Network | One graph for Grid / Organic / Canal-Street, loop closure, mountain roads, checked tunnels with real excavation | 03.1–03.3, 05.1b-2 |
| Blocks → parcels → buildings | Closed blocks, buildable polygons, road-fronted parcels, DNA-driven grey-box heights | 04.1, 04.1b, 04.2, 05.1 |
| World | 3 × 3 World Grid, City ID per slot, layered rebuilds, seam detection and terrain / water harmonisation | 06.2, 06.3a |
| Release | Deployed to Firebase Hosting; checked online | M01 |

Semester targets (compass §3): three distinct City DNAs ✔ (six by configuration); one full terrain → network → parcel → building chain ✔; at least 3 tiles joined or blended: partial (4 of 12 edges join in world 6201, and no road network crosses chunks yet); tunable parameters and debug layers ✔; comparison evidence ✔ (screenshots and JSON per task).

## Knowledge base

| Start here | For |
| --- | --- |
| [Knowledge base home](./docs/procedural-mini-world/README.md) | The six-part structure: foundation, city research, generative system, experiments, midterm review, release |
| [Midterm Review](./docs/procedural-mini-world/midterm-review/00-midterm-review.md) | Seven short chapters in reading order: statement, workflow, parameters, experiments, results, limitations, next steps |
| [Experiment index](./docs/procedural-mini-world/EXPERIMENT-INDEX.md) | Every task by category with purpose, files, screenshots, test status, lifecycle (active / superseded / archived), and next step |
| [Final experiment log](./docs/procedural-mini-world/FINAL-EXPERIMENT-LOG.md) | Compass (§1–5) and the full record of each task (§7) |
| [Research](./docs/procedural-mini-world/research/city-longlist-60.md) | 60-city research database, prototype selection, Manhattan study |
| [AGENTS.md](./AGENTS.md) | Execution rules for coding agents and evidence conventions |
| [Session logs](./docs/logs/README.md) | Dated summaries (e.g. [2026-10-18](./docs/logs/2026-10-18.md), [2026-10-19](./docs/logs/2026-10-19.md)) |
| [Documentation catalog](./docs/README.md) | Earlier Game Lab projects, learning notes, Firebase and website infrastructure |

The repository root is also an Obsidian vault (`.obsidian/`). All links are relative and work on GitHub, in Obsidian, and in VS Code.

## Run locally

Requirements: Node.js 20+ (or the portable copy that `dev.cmd` / `build.cmd` expect in `.tools/`). The verifiers also need Google Chrome installed, because they drive it through `playwright-core`.

```powershell
npm install
npm run dev          # http://localhost:5173/
```

| Page | URL (dev server) |
| --- | --- |
| 3 × 3 World Grid | `/experiments/world-grid/` (`?worldSeed=6202`, `?terrain=raw`, `?seams=1`) |
| Single chunk | `/experiments/seed-terrain/?landform=plain&seed=2085&dna=manhattanGrid` |
| Site hub | `/#miniWorld` |

```powershell
npm run build                           # production build into dist/
node scripts/verify-world-grid.mjs      # each task has scripts/verify-<name>.mjs
node scripts/verify-markdown-links.mjs  # documentation link check
npm run verify:live                     # check the deployed site (optional URL: node scripts/verify-live-release.mjs <url>)
```

Deployment uses the existing Firebase project `gameeeee-zc626` (`firebase deploy --only hosting`). A push to `main` also deploys through `.github/workflows/firebase-hosting-merge.yml`.

## Tech stack

JavaScript (ES modules) · Three.js 0.180 · Vite 7 · lil-gui · Firebase Hosting (plus Authentication / Firestore for the older terrain-save feature) · `playwright-core` for automated verification and screenshots. No game engine, no UE5.

## Repository layout

```text
experiments/seed-terrain/   active: single-chunk pipeline (terrain → … → buildings, tunnels)
experiments/world-grid/     active: 3 × 3 World Grid, seams, harmonisation
experiments/…               earlier studies; some modules are still imported (see the index)
scripts/verify-*.mjs        one browser verifier per task
docs/procedural-mini-world/ compass + log, experiment index, research
docs/assets/screenshots/    evidence images (procedural-mini-world/<task>-<subject>-<kind>.png)
site.js, index.html         Game Lab hub that hosts every experiment
```

## Known limitations

- **Seams:** 8 of 12 edges in world 6201 cannot be joined without slopes over 35° (mountain edges, steep river banks). Only 1 of 4 interior corners closes. Water stays discontinuous on unresolved edges. Roads and edge ports are not joined across chunks.
- **Performance:** the first world build takes about 17 s on the main thread (no worker).
- **Tunnels:** a known tunnel-geometry defect (mountain seed 7922 with Chicago) is isolated, not fixed.
- **Research calibration:** most DNA thresholds are assumptions without registered sources. Chicago and Amsterdam never win auto-match on the test terrains.
- **Terrain Seam models:** the archived Terrain Seam experiment needs ≈ 390 MB of third-party `.glb` / `.fbx` models that are git-ignored. Without `tiny_tokyo.glb` the page stops at load, both in a fresh clone and on the public site. See [Local model files](./docs/projects/flavor-clash/terrain-seam-building-scatter.md).

## Earlier work in this repository

Before Procedural Mini World, this repository was "Peter's Game Lab", a notebook of smaller studies that share the same site: Starlight Run (first playable loop), React Three Fiber basics, Cellular Noise, Voxel Terrain (SDF, CSG, three meshers), Shader Basics, PCG Terrain Lab, and the Flavor Clash regional map with its Iceland, road, and terrain-seam labs. They stay runnable and are listed as archived in the [experiment index](./docs/procedural-mini-world/EXPERIMENT-INDEX.md). Their records are in the [documentation catalog](./docs/README.md), the [exploration map](./docs/EXPLORATION-MAP.md), and the [Assignment 1 checklist](./docs/ASSIGNMENT-1-CHECKLIST.md).
