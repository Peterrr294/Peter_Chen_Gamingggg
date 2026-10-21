# Project Foundation — Proposal, Principles, Design Evolution, Status

Part of [01 Project Foundation](../README.md). The authority for direction and stage status is the **Project Compass**: [FINAL-EXPERIMENT-LOG.md §1–5](../FINAL-EXPERIMENT-LOG.md). This note summarises it and links to it; it does not replace it.

## Project Proposal (original 2026-10-17 / 18; meaning unchanged, translated to English)

From compass §2 and task EXP-00. The proposal was first written in Chinese; this is a faithful English translation (the original wording is preserved in Git history, commit `7b21c3e`):

> A city's identity does not come only from its landmarks, but from the spatial relations between terrain, water, streets, plots, and buildings. This project turns those relations into adjustable parameters and, through different seeds, parameter changes, and city-mixing experiments, studies within what range a city's identity is kept, and when it is weakened, transformed, or recombined.
>
> **Core question:** How can a city's characteristics be encoded as controllable procedural rules? When those rules change continuously, mix with each other, or are stitched together, how is the city's identity kept, weakened, or re-formed?

The project is a **controllable, reproducible, joinable, and interactive** set of urban spatial rules. It is not a game and not a visual copy of a city.

**Semester minimum (compass §3):**
1. three structurally distinct City DNAs;
2. one full chain, terrain → network → parcels → building volumes;
3. parameter changes produce stable, explainable spatial change;
4. at least three city modules joined or mixed into one Mini World;
5. reproducible seeds, with debug views, statistics, and source evidence;
6. a runnable program, project and parameter documentation, process images, and a demo video.

## Design Principles

Compass §4 (work rules) and [AGENTS.md](../../../AGENTS.md) (execution rules), in short:

- one verifiable question per task;
- no downstream system before the upstream data structure is frozen;
- the seed gives reproducible variation inside the rules, never city identity;
- every public parameter has a spatial meaning, with at most 10 per generator;
- at least two reliable sources per city;
- keep facts, inferences, and artistic choices apart;
- a successful build is not a correct spatial result, so check both data and image.

## Design evolution

| Phase | Generation logic | Evidence | Status |
| --- | --- | --- | --- |
| **Early** (2026-10-17 → 18) | **City DNA drives terrain and city.** Research a city first, then generate its terrain (original roadmap, compass §5 "superseded"). First implementation: a city-shaped Manhattan greybox. | EXP-00, 00.2, 02.1 | Superseded 2026-10-18; records kept |
| **Current** (from 2026-10-18) | **Terrain-first:** Seed → Terrain → Terrain Analysis → City DNA Matching → Road Network → Block → Parcel → Building → World Grid. Terrain is city-neutral, and the DNA is *matched* to detected features. | 02.2 → 06.3a ([System Architecture](../03-generative-system/system-architecture.md)) | Implemented, pending review; World Grid seams partial |
| **Future** | City Placement → Seam Connection → City Influence → City Expansion → Morphological Transition | Placement done (06.2); Seam Connection partial (06.3a); the rest planned ([City Influence](../03-generative-system/city-influence.md)) | Proposed; **not implemented** |

**Three independent concepts:**

- **fixed chunk grid:** where computation happens;
- **user-selected City ID:** which rules build on a tile;
- **city influence boundary:** how far a city's rules reach, which is **not implemented**.

See [World Grid & Seam](../03-generative-system/world-grid-and-seam.md).

## Roadmap & Status (mirrors compass §5, 2026-10-19)

| Stage | Content | Status | Tasks |
| --- | --- | --- | --- |
| R | Research base | Pending review; measurements Proposed | EXP-00, 00.2, 00.3, 01.1 |
| T1 | Seed terrain | Implemented, pending review | 02.2 → 02.4 |
| T2 | Terrain analysis | Implemented, pending review | 02.5 |
| T3 | City DNA matching | Implemented, pending review | 02.6, 06.1 |
| T4 | Road / canal network | Implemented, pending review | 03.1, 03.2, 03.3, 05.1b-2 |
| T5 | Blocks and parcels | Implemented, pending review | 04.1, 04.1b, 04.2 |
| T6 | Building extrusion | Implemented, pending review | 05.1, 05.1b-1 |
| T7 | ≥ 3 tiles joined / blended; delivery | **Implemented (partial)**, pending review | 06.2, 06.3a; no network joins, no video |

Current single task and forbidden scope: compass §1.
