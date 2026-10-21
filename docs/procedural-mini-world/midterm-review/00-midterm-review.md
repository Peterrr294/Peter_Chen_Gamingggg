# Procedural Mini World — Midterm Overview

*Architecture design course · midterm 2026-10-19 · reading time 5–8 minutes. Each section links to a longer chapter if you want more.*

**Open:** [Live site → Mini World](https://gameeeee-zc626.web.app/#miniWorld) · [GitHub repository](https://github.com/Peterrr294/Peter_Chen_Gamingggg) (private, access by invitation) · [Project compass](../FINAL-EXPERIMENT-LOG.md) · [Knowledge base home](../README.md)

**Full experiment archive (one page, every stage with its screenshots):** [Procedural Mini World — Experiment Archive](../04-experiments/EXP-Procedural-Mini-World/Procedural-Mini-World.md)

![The 3 × 3 world on the public site](../../assets/screenshots/procedural-mini-world/m01-live-world-grid-after.png)

*Public site, 2026-10-19 · world seed 6201 · transition width 128 m · harmonised terrain · tile `chunk_1_0` set to Amsterdam (yellow outline).*

**Status words:**
- **Implemented:** code exists and runs.
- **Verified:** its automated verifier passes (data validity, not spatial quality).
- **Pending review:** awaiting a human decision. Every task below is pending review; none is Accepted or Rejected yet.
- **Implemented (partial):** works for some cases, with measured failures.
- **Proposed:** planned, not implemented.
- **Historical:** superseded, kept for the record.
- **TBD / Unverified:** evidence missing.

## 1. Project Statement

A city's identity does not come only from its landmarks but from the **spatial relations** between terrain, water, streets, plots, and buildings. This project turns those relations into controllable, reproducible, joinable rules and builds a small interactive world with them. It is not a game and not a visual copy of a city. → [Chapter 1](./01-project-statement.md) · [Project Foundation](../01-foundation/project-foundation.md)

## 2. Research Question

> How can a city's characteristics be encoded as controllable procedural rules? When those rules change continuously, mix, or are stitched together, how is the city's identity kept, weakened, or re-formed?

The prototypes are Manhattan (grid), Venice (water network), and Fez (organic core), chosen from a [60-city research database](../research/city-longlist-60.md) because each makes a different element the city's skeleton. Chicago, Amsterdam, and Lisbon were later added as pure configuration. The research measurements are still **TBD**, so most rule values are labelled assumptions. → [City DNA Library](../research/city-dna-library.md)

## 3. Generative Method

```text
Seed → Terrain → Terrain Analysis → City DNA Matching → Road Network → Block → Parcel → Building → World Grid
```

The design changed on 2026-10-18. Early on, a City DNA shaped its own terrain (a city-shaped Manhattan tile). Now the terrain is generated **city-neutral first**, and the City DNA is *matched* to what the site offers. Each step reads only earlier steps, so a city can be swapped without regenerating the landscape. → [Chapter 2](./02-system-workflow.md) · [System Architecture](../03-generative-system/system-architecture.md)

![Six City DNAs on one terrain](../../assets/screenshots/procedural-mini-world/06-1-six-cities-shared-terrain.png)

*Coast, seed 1101: the same terrain under six City DNAs. Only the rules differ.*

## 4. Main Experiments

| Stage | Key experiment | Result (measured) |
| --- | --- | --- |
| Terrain | 02.4 four landform algorithms | 12 / 12 landform × seed pairs reproducible |
| City DNA | 02.6, 06.1 terrain-fit ranking, 3 → 6 DNAs | plain → Manhattan 0.80; 72 / 72 runs, originals bit-identical |
| Network | 03.1 – 03.3, 05.1b-2 streets, loops, tunnels | 36 / 36 runs legal; 3 tunnels excavated in a closed solid |
| Urban form | 04.1 – 05.1 blocks, plots, buildings | 0 invalid blocks; 100 % plots with real frontage; ≈ 1 700 grey boxes on the grid plain |
| World | 06.2, 06.3a 3 × 3 grid, seams | one City ID change rebuilds one tile (2–3 s); 4 / 12 edges joined |

→ [Chapter 4](./04-experiments.md) · [Experiment Index](../EXPERIMENT-INDEX.md) (all cards, with seeds and screenshots)

## 5. Verified Achievements

| Semester target (compass §3) | Status |
| --- | --- |
| 1. Three structurally distinct City DNAs | **Verified**: six, on three network strategies |
| 2. Full chain terrain → network → parcels → buildings | **Verified** |
| 3. Parameter changes give stable, explainable spatial change | **Verified** for seed, landform, transition width, City ID (reproducibility and isolation verified) |
| 4. ≥ 3 modules joined or mixed into one Mini World | **Implemented (partial)**: 9 tiles in one world; terrain joins on 4 / 12 edges; no streets cross tiles; no mixing |
| 5. Reproducible seeds, debug views, statistics, source evidence | **Verified** for seeds, debug views, and statistics; **Implemented (partial)** for sources (measurements TBD) |
| 6. Runnable program, documentation, process images, demo video | **Verified** for the program (online), documentation, and images; **video TBD** |

All 22 automated task checks passed on 2026-10-19, and the live-site check passed 10 / 10 with 0 browser errors. → [Chapter 5](./05-midterm-results.md)

## 6. Interactive World Prototype

On the [live World Grid](https://gameeeee-zc626.web.app/#miniWorld), you can:
- click a tile and change its **City ID** (empty, auto, or one of six DNAs);
- change the **world seed** (a new site, same layout);
- change the **transition width** (32–256 m), where tiles may adjust to meet their neighbours;
- switch between raw and harmonised terrain;
- turn on the seam debug view.

The fixed grid of 1024 m tiles, the City ID chosen on each tile, and a future city-influence boundary are three separate concepts; only the first two exist. A single tile with every debug layer is at [/experiments/seed-terrain/](https://gameeeee-zc626.web.app/experiments/seed-terrain/?landform=plain&seed=2085&dna=manhattanGrid). → [Chapter 3, Key Parameters](./03-key-parameters.md) · [World Grid & Seam](../03-generative-system/world-grid-and-seam.md)

## 7. Known Limitations

- **Seams:** 8 of 12 tile edges can't be joined without slopes over 35° (mountains, steep banks), and only 1 of 4 corners closes.
- **Ports:** streets end at tile edges, because edge ports are not paired.
- **Tunnel defect:** one known failing combination (mountain 7922 + Chicago) is isolated, not fixed.
- **City influence:** expansion and DNA mixing are **not implemented**, so the "mixing" half of the research question is still open.
- **Assumed values:** rule values are uncalibrated (Manhattan's mean building height of ≈ 60 m is assumed).

→ [Chapter 6](./06-limitations.md)

## 8. Next Stage

1. **Cross-tile coordination:** decide how to handle unjoinable edges, pair street ports, and continue rivers.
2. **City influence field:** each city's rules spread outward and weaken with distance and terrain resistance.
3. **Expansion and morphological transition:** city boundaries emerge from terrain and competition; measure where identity holds or changes when two DNAs meet.
4. **Evidence:** Manhattan measurements and a video.

→ [Chapter 7](./07-next-steps.md) · [City Influence (proposed)](../03-generative-system/city-influence.md)

## Missing evidence (TBD)

| Missing | Affects |
| --- | --- |
| Video walk-through of the 3 × 3 world | Stage T7 / target 6 |
| Manhattan measurements: DEM slope, street-centreline spacing, PLUTO lot and height data | City DNA values (assumptions) |
| Log entries for the prototype selection (00.3) and Manhattan study (01.1) | Research stage status |
| Research rows and sources for Chicago, Amsterdam, Lisbon | 06.1 DNAs |
| Screenshot of the failing tunnel case (mountain 7922, Chicago) | Limitations (numbers only) |
| Streets across tiles, city influence, DNA mixing | Not implemented, so no evidence can exist yet |
| Human review of each task | every task "pending review" |
| Original 02.2 capture (island terrain), overwritten by 02.2b | T1 history only |

**Chapters:** [1 Statement](./01-project-statement.md) · [2 Workflow](./02-system-workflow.md) · [3 Parameters](./03-key-parameters.md) · [4 Experiments](./04-experiments.md) · [5 Results](./05-midterm-results.md) · [6 Limitations](./06-limitations.md) · [7 Next steps](./07-next-steps.md)
