# Procedural Mini World — Experiment Archive: From Random Terrain to a 3 × 3 World Grid

*One self-contained record of the project's later phase, 2026-10-18 → 2026-10-19, in the order it was actually built. Every image is a real runtime capture, copied once into `Screenshots/` from the location given in its caption. The originals stay in place.*

**Research proposition.** A city's identity comes not only from landmarks but from the spatial relations between terrain, water, streets, plots, and buildings. If those relations become controllable, reproducible procedural rules, we can test when an identity is kept, weakened, or re-formed as the rules change, mix, or are stitched together. This is a rule system for urban space, not a game and not a visual copy of a city.

**Generation chain (current).**

```text
Seed → Terrain → Terrain Analysis → City DNA Matching → Road Network → Block → Parcel → Building → World Grid
```

**Status words.**
- **Implemented:** code exists and runs.
- **Verified:** its automated verifier passes (data validity, not spatial quality).
- **Pending review:** awaiting a human decision. Every task below is pending review; none is Accepted or Rejected yet.
- **Implemented (partial):** works for some cases, with measured failures.
- **Proposed:** planned, not implemented.
- **Historical:** superseded, kept for the record.
- **Missing Screenshot:** no real capture exists.

**Links:** [live site → Mini World](https://gameeeee-zc626.web.app/#miniWorld) · [GitHub repository](https://github.com/Peterrr294/Peter_Chen_Gamingggg) (private; access by invitation) · [project compass and full log](../../FINAL-EXPERIMENT-LOG.md) · [knowledge base home](../../README.md) · [Midterm Overview](../../midterm-review/00-midterm-review.md)

**Contents**

1. [[#01 Experiment Overview|Experiment Overview]]
2. [[#02 Terrain Generator|Terrain Generator]]
3. [[#03 Terrain Analysis|Terrain Analysis]]
4. [[#04 City DNA Matching & Selection|City DNA Matching & Selection]]
5. [[#05 Road Network|Road Network]]
6. [[#06 Urban Blocks|Urban Blocks]]
7. [[#07 Road-Oriented Parcel Subdivision|Road-Oriented Parcel Subdivision]]
8. [[#08 Building Footprint & Extrusion|Building Footprint & Extrusion]]
9. [[#09 Volumetric Terrain & Tunnel Geometry|Volumetric Terrain & Tunnel Geometry]]
10. [[#10 Tunnel-Building Constraints|Tunnel-Building Constraints]]
11. [[#11 World Grid & City Placement|World Grid & City Placement]]
12. [[#12 Terrain/Water Seam|Terrain/Water Seam]]
13. [[#13 Results, Limitations & Next Steps|Results, Limitations & Next Steps]]

---

## 01 Experiment Overview

| | |
| --- | --- |
| Period | 2026-10-18 (02.1 → 06.2) and 2026-10-19 (06.3a, M01 release) |
| Code | `experiments/seed-terrain/` (single tile), `experiments/world-grid/` (3 × 3 world); first in Git in commit `7b21c3e`, no per-task commits |
| Verification | one browser verifier per task (`scripts/verify-*.mjs`, Playwright + Chrome); all 22 passed again on 2026-10-19 |
| Frozen tile spec | 1024 m × 1024 m, 257 × 257 height samples, 4 m spacing (frozen in 02.3) |
| Adjustable | seed 1–9999, landform, variation 0–1, transition width 32–256 m, City ID per tile, world seed |

**The turn that shapes everything below:** the first attempt (02.1) let a city shape its own terrain, a Manhattan-shaped greybox. On 2026-10-18 the project switched to **Terrain-first**: the landscape is generated city-neutral, analysed, and only then matched to a City DNA. The fixed chunk grid, the user-chosen City ID, and a future city-influence boundary are kept as three separate concepts.

---

## 02 Terrain Generator

**Tasks:** 02.1 → 02.2 → 02.2b → 02.3 → 02.4 · **Date:** 2026-10-18 · **Status:** Verified (02.4); earlier versions **superseded**.

**Goal:** a reproducible, city-neutral site with height, water, slope, and buildability fields, where water appears only by rule and the tile edge carries an adjustable transition zone.

### Evolution, including the discarded versions

| Task | Approach | Result | Why it was replaced |
| --- | --- | --- | --- |
| 02.1 | reuse the existing Manhattan greybox (44 × 72 map, 11 non-seed parameters) | seeds MANHATTAN-1101 / 2202 / 3303 reproducible; 3 signatures | city-shaped terrain, seed variation < 2 %, a dark square artifact, too many non-spatial parameters |
| 02.2 | city-neutral terrain from `IcelandTerrain`, 64 × 64 map, 129 × 129 samples | 3 seeds reproducible; water 3 371 / 16 641 samples (seed 01) | water only as an outer sea ring, coast reads as a square plateau |
| 02.2b | full square tile, seeded edge-to-edge river, lakes, marked transition zone (`TileShape.js`) | every river crosses two opposite edges; transition 6 032 samples per seed | half the land steeper than 12°; buildable only 22–23 % |
| 02.3 | **frozen chunk** 1024 m, 257 × 257, 4 m; four landform rule sets | 12 / 12 pairs reproducible; plain 75–80 % buildable, mountain 3.7–4.3 % | presets tuned by probing; rules still built on the old generator |
| **02.4** | **explicit algorithms**: plain fBm (+ 0.2–0.5° tilt, no water); river valley (230 m half-width, 32 m channel, 3 m deep, surface falling 2 m/km); coast (warped shoreline ± 90 m, open sea or bay by seed); mountain ridged multifractal (relief 300 m) | 12 / 12 reproducible; heights identical at transition 32 / 128 / 256 m; 0 off-channel river water | current |

![[02-terrain-a-manhattan-greybox-legacy.png]]
*Legacy 02.1: Manhattan greybox, seed MANHATTAN-1101, default parameters. Source: `docs/assets/screenshots/procedural-mini-world/manhattan-terrain-greybox.png`.*

![[02-terrain-b-square-tile-inland-water-legacy.png]]
*Legacy 02.2b: square tile with inland river and lakes, seed TERRAIN-01. Source: `…/02-2-seed-terrain-after.png`. **Missing Screenshot:** the original 02.2 island capture was overwritten at this path by 02.2b.*

![[02-terrain-c-four-landform-rules-legacy.png]]
*Legacy 02.3: four landform rule sets in the frozen chunk, seed 1101. Source: `…/02-3-landforms-compare.png`.*

![[02-terrain-d-landform-algorithms-after.png]]
*After 02.4: plain, river valley, coast, mountain; seed 1101, variation 0.5, transition 128 m. Source: `…/02-4-landforms-overall.png`.*

![[02-terrain-e-transition-width-debug.png]]
*Debug 02.4: transition weight on coast 1101 at widths 32 / 128 / 256 m; a weight only, heights untouched. Source: `…/02-4-transition-debug.png`.*

**Parameters and seeds (02.4):** seeds 1101 / 2202 / 3303; variation 0.5; transition width 32–256 m in 16 m steps, default 128 m; buildable = slope ≤ 10° and ≥ 1 m above local water.

**Resolved:** the IcelandTerrain base and `TileShape.js` were dropped for explicit algorithms. A continuity bound near corners was corrected during testing: a diagonal can move both edge weights, so the bound is 2×, not √2×.

**Open:** the river is a carved channel with a falling surface, not simulated flow. Mountains keep a steep tail (p99 slope 62–71°). The plain looks almost flat at true scale. Presets are tuned on three seeds.

---

## 03 Terrain Analysis

**Task:** 02.5 · **Date:** 2026-10-18 · **Status:** Verified.

**Goal:** read the tile as a site: water bodies, buildable regions, suitability, edge connections, and a dominant direction. A direction is reported only if the evidence supports it.

**Method:** one renderer-independent `terrainAnalysis` object, computed from the 02.4 fields only. Suitability by slope: high ≤ 5°, medium ≤ 10°, low ≤ 20° (dry, needs grading). Regions under 2 500 m² count as fragments. Directions require evidence: water elongation ≥ 4, shoreline elongation ≥ 3, slope coherence ≥ 0.5.

**Parameters and seeds:** 4 landforms × 1101 / 2202 / 3303; variation 0.5; transition 128 m.

**Results:** 12 / 12 pass, incl. exact area totals and component counts checked against an independent BFS.

| Landform | Water | Buildable | Direction |
| --- | --- | --- | --- |
| Plain | 0 % | 100 % | unknown (coherence 0.29–0.50 < 0.5) |
| River valley | 3.3–3.5 % | 49–50 % | water axis matching each crossing within 30° |
| Coast | 8.6–16.8 % | 53–60 % | shoreline direction with seaward side |

![[03-analysis-a-suitability-debug.png]]
*Debug: suitability classes on four landforms, seed 1101, variation 0.5 (dark green high · light green medium · orange needs grading · maroon unsuitable · blue water). Source: `…/02-5-suitability-debug.png`.*

**Open:** the analysis signature hashes masks only, so two uniform plains share one signature. The real plain tilt is left `unknown`; the threshold was not tuned to pass. Buildable land on river and mountain terrain splits into 250–440 pieces.

---

## 04 City DNA Matching & Selection

**Tasks:** 02.6 (three DNAs), 06.1 (three → six) · **Date:** 2026-10-18 · **Status:** Verified; thresholds **Unverified** (all tagged A, assumptions).

**Goal:** rank City DNAs by how well the terrain fits their spatial rules, transparently and deterministically, without claiming that the result *is* that city. Let the designer override the choice.

**Method:** each DNA has weighted conditions on analysis metrics, tagged V (sourced) / I (inference) / A (assumption) / TBD (missing, never scored). **rankScore = fit × evidence coverage.** `auto` takes the top score; a manual choice overrides it.

**Failure and correction:** the first ranking draft let **Fez win the coast with fit 1.00** from two lenient assumption-tagged conditions, while 5 conditions were TBD. Ranking on fit × coverage fixed it, because missing research now earns no credit.

**Parameters and seeds:** 4 landforms × 1101 / 2202 / 3303; variation 0.5; transition 128 m. 06.1: 72 runs (× 6 DNAs).

**Results.**
- **02.6:** plain → Manhattan 0.80 > Fez 0.29 (weak) > Venice 0. Coast 1101 / 2202 → Manhattan 0.56 / 0.48. Mountain → all ≤ 0.09.
- **06.1:** Chicago, Amsterdam, and Lisbon added **by configuration only**. 72 / 72 runs ok; the original three DNAs bit-identical to the baseline. On coast 1101, Manhattan builds 529 buildings (mean 57 m, FAR 4.5); Amsterdam 513 with 2 distinct heights; Lisbon 866 (mean 11.9 m).

![[04-dna-a-auto-vs-manual-compare.png]]
*Comparison: coast 1101, auto → Manhattan vs Venice chosen by hand; same terrain signature `4A69CE05 · 602F2BF4`. Source: `…/02-6-city-match-auto-vs-manual.png`.*

![[04-dna-b-six-cities-shared-terrain-compare.png]]
*Comparison: six City DNAs on the same terrain (coast 1101). Source: `…/06-1-six-cities-shared-terrain.png`.*

![[04-dna-c-six-cities-best-terrain-compare.png]]
*Comparison: each DNA on its best-scoring test terrain: Manhattan plain 1101 (0.80), Chicago plain 1101 (0.62), Lisbon coast 2202 (0.47), Fez coast 1101 (0.43), Amsterdam coast 1101 (0.31), Venice coast 1101 (0.23). Source: `…/06-1-six-cities-suitable-terrain.png`.*

**Resolved (06.1):** two verifier read errors (`network.meta`, `parcels.rules.byDNA`) and one favicon 404.

**Open:** Venice never fits, because no landform produces a lagoon. Chicago and Amsterdam never win auto-match. Amsterdam's ring canals are absent: they would require writing canals into the terrain. The new cities have no research row.

---

## 05 Road Network

**Tasks:** 03.1 (three strategies), 03.3 (loop closure), 03.2 (mountain roads and tunnels) · **Date:** 2026-10-18 · **Status:** Verified (organic / canal-street sparse).

**Goal:** one street-graph structure for **Grid** (Manhattan, Chicago), **Organic** (Fez, Lisbon), and **Canal-Street** (Venice, Amsterdam), legal on the terrain, with ports where streets reach the tile edge.

**Method.**
- **Grid:** two orthogonal families (Manhattan 200 m avenues, 80 m cross streets, slope ≤ 10°), truncated by water and slope.
- **Organic:** least-cost paths between gates and centres, with slope and climb penalties.
- **Canal-Street:** canals with quays and bridges.
- Every edge is sampled every 2 m: never on water, never over the slope limit; water is crossed only by bridges.
- **03.3:** local links that must close a real cycle.
- **03.2:** a grade-limited surface road first (≤ 15 %), and a tunnel (≤ 6 %, 80–700 m, ≥ 10 m cover) only if justified.

**Parameters and seeds:** 1101 / 2202 / 3303 × 4 landforms × 3 DNAs (36 runs); mountain 1101 / 2202 / 3303 × 3 DNAs for tunnels.

**Results.**
- **03.1:** 36 / 36 pass with 0 issues. Grid plain: 18.4–19.5 km, 1 component, 0 % dead ends. Organic plain ≈ 5.3 km with 44 % dead ends (tree-like).
- **03.3, Before → After:** organic coast 3303 cycles 0 → 13 and dead ends 44 → 25 %; organic plain cycles 0 → 8–10.
- **03.2:** mountain 2202 → 0 tunnels; 1101 → 1 tunnel for organic / canal-street (630 m, −0.38 %); 3303 → 1 for every DNA (146–150 m).

![[05-network-a-three-strategies-after.png]]
*After 03.1: grid on plain, organic on coast, canal-street on river valley, seed 1101. Source: `…/03-1-network-overall.png`.*

![[05-network-b-strategies-slope-debug.png]]
*Debug 03.1: three strategies on river valley 1101, slope view. Source: `…/03-1-network-strategies-debug.png`.*

![[05-network-c-loop-closure-before-after.png]]
*Before / After 03.3: organic coast 3303 and canal-street river valley 3303. Source: `…/03-3-loops-network-before-after.png`.*

![[05-network-d-mountain-tunnels-after.png]]
*After 03.2: mountain seeds 2202 / 1101 / 3303 → 0 / 1 / 1 tunnels (violet dashes = tunnels, yellow = portals). Source: `…/03-2-mountain-tunnels-overall.png`.*

![[05-network-e-tunnel-profile-debug.png]]
*Debug 03.2: tunnel x-ray and recorded profile, mountain 3303, grid. Source: `…/03-2-tunnel-xray-profile.png`.*

**Resolved (03.2):** a connector joined the wrong edge in a shared cell; it now attaches to the sample nearest the cell centre. A split point took terrain height instead of the graded profile; it is now interpolated.

**Open:** the grid fragments on coast and river valley (14–15 components). Organic does not cross rivers. Loop gains are uneven. Most mountain side demands stay unresolved. No seed produced two tunnels, so the second-tunnel rule is untested.

---

## 06 Urban Blocks

**Tasks:** 04.1 (blocks), 04.1b (refinement) · **Date:** 2026-10-18 · **Status:** Verified.

**Goal:** closed block polygons between real-width streets, water, and the tile edge, each with its *actually buildable* part. Nothing is deleted, only classified.

**Method:** a 1 m availability field; road corridors at their real widths; minimum block 100 m². Refinement adds a buildable MultiPolygon per block (slope ≤ 10°, ≥ 1 m above water, 0.6 m edge margin), classified fragments (waterfront and others), and transition-band shares.

**Parameters and seeds:** 1101 / 2202 / 3303; grid on plain, organic on coast, canal-street on river valley (+ mountain cases).

**Results.**
- **04.1:** 15 / 15 pass, 0 invalid blocks, area residual < 1 m². Grid plain: 83–84 blocks (78–80 ha). Organic coast: only 4–5 blocks, **0 enclosed by roads**, which led to 03.3.
- **04.1b:** grid plain 78–80 → 76–78 ha buildable (only the 0.6 m margin lost); organic coast 84–92 → 51–59 ha.

![[06-blocks-a-three-strategies-after.png]]
*After 04.1: blocks for grid / organic / canal-street, seed 1101. Source: `…/04-1-blocks-strategies.png`.*

![[06-blocks-b-grid-labels-debug.png]]
*Debug 04.1: grid plain 1101 with block labels and statistics. Source: `…/04-1-blocks-grid-debug.png`.*

![[06-blocks-c-loop-blocks-before-after.png]]
*Before / After 03.3 applied to blocks: closing loops turns open regions into enclosed blocks (organic coast 3303, canal-street river valley 3303). Source: `…/03-3-loops-blocks-before-after.png`.*

![[06-blocks-d-buildable-polygons-after.png]]
*After 04.1b: buildable outlines inside the blocks, seed 1101. Source: `…/04-1b-buildable-strategies.png`.*

![[06-blocks-e-canal-refinement-debug.png]]
*Debug 04.1b: canal-street river valley 1101: blocks, buildable land, waterfront reserves, transition line. Source: `…/04-1b-canal-refinement-debug.png`.*

**Resolved (04.1b):** buildable outlines could cross block outlines after independent simplification, so the margin is now measured to the final block edge. The verifier's regular 2 m lattice aliased against the grid (≈ 2 % bias) and now uses stratified jitter.

**Open:** grid blocks have rounded corners (distance-field geometry). No legal fragment merge exists. Canal-street leaves many thin quay remnants.

---

## 07 Road-Oriented Parcel Subdivision

**Task:** 04.2 · **Date:** 2026-10-18 · **Status:** Verified (organic / canal-street leave most land as reserve).

**Goal:** plots cut from real street frontage inside each buildable polygon, at the DNA's lot scale, with explicit reserve where no frontage reaches.

**Method:** lots along surface-road frontage, at target frontage, maximum depth, and minimum area (grid: 15 m / 32 m / 90 m², all assumptions). A plot is valid only if its fronting road belongs to its own block and the plot actually touches it.

**Failure and correction:** the first lot-cell distance term was not a metric distance. It shrank lots to ≈ 7 m and used only **49 %** of grid land. It was replaced by the first-order bisector distance, raising use to **86 %**. Corner lots had recorded roads they did not touch; frontage is now measured contact.

**Parameters and seeds:** 1101 / 2202 / 3303; grid / plain, organic / coast, canal-street / river valley.

**Results:** 9 / 9 pass, 100 % valid frontage, area error ≤ 0.29 %. Grid plain: 1 810–1 862 parcels, mean frontage 16.0–16.6 m, depth 28.4–28.5 m, using 86.3–86.4 % of buildable land.

![[07-parcels-a-three-strategies-after.png]]
*After 04.2: parcels for grid / organic / canal-street, seed 1101. Source: `…/04-2-parcels-strategies.png`.*

![[07-parcels-b-frontage-closeup-debug.png]]
*Debug 04.2: grid block B15 frontage and corner lots; canal-street lots on lanes and quays. Source: `…/04-2-parcels-frontage-closeup.png`.*

**Open:** organic and canal-street use only 14–22 % of buildable land; the rest is beyond one lot depth from any street. Canal-street plots almost never face the water (0–4 canal-facing).

---

## 08 Building Footprint & Extrusion

**Task:** 05.1 · **Date:** 2026-10-18 · **Status:** Verified; heights **Unverified** (assumptions).

**Goal:** 0 or 1 grey-box volume per plot: footprint from frontage and setbacks, height from the DNA, base on the terrain without floating or cutting it.

**Method:** the footprint fills a DNA share of the lot from the frontage. Height = floors × floor height, driven by distance to a seeded centre, street class, and lot area (Manhattan 3–32 floors × 3.6 m; Fez 1–4 floors with courtyards). Ground contact is sampled on a 1 m lattice plus 0.5 m along edges.

**Parameters and seeds:** 1101 / 2202 / 3303. Grid occupancy 0.92, depth 26 m. Organic floors 1–4 × 3.2 m, courtyard ring 4.5 m.

**Results:** 9 / 9 pass. Grid: 1 664–1 702 buildings (91–92 % of plots), mean height 60.1–60.5 m, max 115 m, coverage 79 % of built plots, 236–249 corner buildings.

![[08-buildings-a-grey-box-overall-after.png]]
*After 05.1: full-tile grey boxes, grid / organic / canal-street, seed 1101. Source: `…/05-1-buildings-overall.png`.*

![[08-buildings-b-street-closeup-after.png]]
*After 05.1: grid street wall, canal-street lanes and quays, organic courtyards, seed 1101. Source: `…/05-1-buildings-street-closeup.png`.*

**Resolved:** 54 grid footprints crossed sharp parcel corners at 1 m resolution, so a finer-grid containment retry was added. One organic floor sat below a ground high point missed by 2 m sampling, so sampling went to 1 m plus 0.5 m on edges. A street-wall threshold of 2.0 m was arbitrary and was replaced by 3.0 m derived from the intended offsets.

**Open:** mean grid height ≈ 60 m is an assumption, not checked against Manhattan PLUTO data. Organic heights use only 3 floor counts. Courtyards are simplified ring voids.

---

## 09 Volumetric Terrain & Tunnel Geometry

**Tasks:** 05.1b-1 (closed solid), 05.1b-2 (excavation) · **Date:** 2026-10-18 · **Status:** Verified; one defect found later (see 11).

**Goal:** make the terrain a closed solid, so that tunnels can be real openings with cuts, portal faces, and an arch tube rather than lines drawn on the surface.

**Method:** the 257 × 257 surface is closed with walls and a base at −60 m (≥ 20 m thick). Each accepted tunnel edge gets open approach cuts, portal faces, and a tube (width 9 m, clearance 7 m). The closed-manifold check runs after every cut.

**Parameters and seeds.**
- **A (no tunnel):** plain 1101 grid, mountain 2202 grid.
- **B (one tunnel each):** mountain 3303 grid, mountain 1101 organic, mountain 3303 organic.
- **C (synthetic):** a shifted copy, a 60° crossing copy, a per-tile limit of 0.
- **D (should fail):** a tunnel raised 20 m, a tunnel across a plain, a tunnel from the sea.

**Results.**
- **05.1b-1:** 6 / 6 tiles watertight (χ = 2, 0 open or non-manifold edges, volume error ≤ 1.4e-14).
- **05.1b-2:** A identical to 05.1b-1 (67 074 vertices). B: 3 tunnels built, e.g. mountain 3303 grid tube 120.5 m at 4.53 % grade, each solid χ = 0 (one through-hole). C and D: every invalid case rejected with nothing cut.

![[09-solid-a-closed-terrain-overall-after.png]]
*After 05.1b-1: closed solid tiles: plain, river valley, coast, mountain. Source: `…/05-1b-solid-terrain-overall.png`.*

![[09-solid-b-thickness-side-debug.png]]
*Debug 05.1b-1: side views (low coast, high mountain, plain) with thickness above the −60 m base. Source: `…/05-1b-solid-terrain-side.png`.*

![[09-solid-c-tunnel-portals-after.png]]
*After 05.1b-2: portal close-ups, both ends, mountain 3303 grid and mountain 1101 organic. Source: `…/05-1b2-tunnel-portals.png`.*

![[09-solid-d-tunnel-xray-debug.png]]
*Debug 05.1b-2: x-ray of the tubes inside the solid. Source: `…/05-1b2-tunnel-xray.png`.*

**Failure and correction:** a zipper triangulation of the portal folded under the arch (8–10 inconsistent edges) and was replaced by earcut. **A tunnel raised 20 m above the ground was first accepted**, because portals were only searched inside the hill; portal ground-contact and open-approach rules were added. The rebuild ran before the new seed's heights were written; the ordering was fixed.

**Open:** grade change at portals reaches 12.8–19 % (no vertical curves). Lips of 0.25–1.15 m remain where cuts start. Water is not part of the solid.

---

## 10 Tunnel-Building Constraints

**Tasks:** rules inside 04.1 and 05.1b-2 (no dedicated task) · **Status:** **Implemented (partial)**.

What was actually built and verified:

| Constraint | Where | Verified |
| --- | --- | --- |
| Tunnels never give a block street frontage; blocks are identical with or without tunnel edges | 04.1 | `verify-blocks.mjs`: blocks recomputed without tunnel edges match |
| A tunnel cut is rejected if it crosses another surface road **or a building**, overlaps an accepted tunnel, or lies within 8 m of the tile edge | 05.1b-2 rejection rules | 3 built tunnels: road / building crossings 0; synthetic overlap copy rejected |
| The tunnel step runs after buildings, with the current heights | 05.1b-2 | ordering fixed during testing |

**Not done:** no rule keeps building foundations clear of a tube *below* them, beyond the tunnel's own cover requirement. No experiment varied building density over tunnels.

**Missing Screenshot:** no capture shows a tunnel next to or under buildings. The portal images in [[#09 Volumetric Terrain & Tunnel Geometry|09]] are the closest evidence.

---

## 11 World Grid & City Placement

**Task:** 06.2 · **Date:** 2026-10-18 · **Status:** Verified.

**Goal:** nine fixed tiles in one world frame, each running the unchanged single-tile chain with its own derived seed and a user-chosen City ID. Changing one tile rebuilds only what is invalid. Seams are measured, not hidden.

**Method.**
- **Placement:** tile = 1024 m chunk at grid (gx, gy) ∈ {−1, 0, 1}², origin = grid × 1024 m.
- **Terrain seed:** `1 + hash(world seed, gx, gy, landform) mod 9999`.
- **City ID:** empty / auto / a DNA.
- **Layers per tile:** terrain → city, each with a cache key, so a City ID change touches only the city layer.
- **Three separate concepts:** chunk (fixed grid), City ID (choice), city influence (future, not implemented).

**Parameters and seeds:** world seed 6201, variation 0.5, transition 128 m. Default layout:
- **north row:** mountain 5704 (empty), mountain 2264 (auto → Fez), river valley 9187 (Fez);
- **middle row:** plain 5718 (Chicago), plain 2085 (Manhattan), river valley 2361 (auto → Fez);
- **south row:** coast 1385 (Amsterdam), coast 3051 (auto → Lisbon), coast 6678 (Lisbon).

**Results:** all checks pass. The centre tile equals the single-tile page bit for bit, and 7 / 7 city tiles equal their origin-0 generation. **One City ID change rebuilds one tile in 2.3–3.2 s**; the other 8 are unchanged. First world build 18.3–21.8 s. Save / restore works, and a tampered seed is rejected.

![[11-world-a-3x3-grid-overall-after.png]]
*After 06.2: the whole 3 × 3 world, oblique, world seed 6201. Source: `…/06-2-world-grid-overall.png`.*

![[11-world-b-city-id-switch-after.png]]
*After 06.2: `chunk_1_0` after its City ID was set to Amsterdam; the panel shows seed, resolved DNA, layer counts, and edge states. Source: `…/06-2-world-grid-selected-chunk.png`.*

**Resolved:** the canvas rendered at the browser default 300 × 150 and now has its own CSS rule. Plan-view captures could not show height steps, so a `?focus` oblique close-up was added.

**Defect exposed (not fixed):** on mountain terrain seed 7922 with the Chicago grid, the 05.1b-2 tunnel geometry accepts one tunnel but leaves the cut solid **non-manifold** (6 non-manifold edges, χ = 6 instead of 0). The same failure appears on the single-tile page, so it is an existing tunnel defect. **Missing Screenshot:** no capture of this case exists.

---

## 12 Terrain/Water Seam

**Tasks:** 06.2 (detection), 06.3a (harmonisation) · **Dates:** 2026-10-18 / 2026-10-19 · **Status:** **Implemented (partial)**.

**Goal:** make neighbouring tiles meet in one continuous surface with consistent water where a natural slope allows it. Where it doesn't, measure and report why, without walls and without hiding the step.

**Method (06.3a).**
- Raw heights are never changed. A separate harmonised field is written only inside each tile's transition band.
- **Edge target:** the mean of both edge heights (corner groups use a group mean), blended with the existing edge weight plus a slope-matching term (C¹).
- **Fallback:** if a cell gets steeper than **35°** (≈ angle of repose), the join falls back to height only (C⁰). If it is still too steep, the edge stays **unresolved**.
- **Water:** spreads only by connected flooding. Rivers never continue without a channel, and no artificial lakes are made.

**Parameters and seeds:** world seeds 6201 / 6202 / 6203; transition 128 m (also 64 and 256 m on 6201); slope limit 35°, margin 2°, water tolerance 1 m.

**Results.**
- **Before (06.2, detection only):** all **12 / 12** edges stepped (5.2–296 m), with one-sided water on 6 / 12.
- **After, world 6201 at 128 m:** **4 / 12** edges joined with zero step (identical values at all 257 samples); **8 / 12 unresolved**; **1 / 4** inner corners closed; one-sided water edges 6 → 4.
- **Bounds:** 0 cells changed outside the bands, and all 9 solids stay closed.
- **Other seeds:** 6202 joins 6 edges, 6203 joins 4.
- **Wider bands are not always better:** at 64 m, 5 edges join; at 256 m, also 5.

![[12-seam-a-raw-seams-detected-before.png]]
*Before (06.2): seam debug at chunk_0_0 | chunk_1_0; red risers = height step > 0.5 m, magenta = one-sided water. Source: `…/06-2-world-grid-seams-debug.png`.*

![[12-seam-b-harmonised-world-after.png]]
*After (06.3a): harmonised world, world seed 6201, transition 128 m. Source: `…/06-3a-world-harmonized-overall.png`.*

![[12-seam-c-closed-corner-compare.png]]
*Comparison (06.3a): the one closed corner, x −512 / z 512 (Chicago plain · Manhattan plain · two coast tiles), raw step vs harmonised join. Source: `…/06-3a-seam-closeup-compare.png`.*

![[12-seam-d-edge-status-debug.png]]
*Debug (06.3a): edge status, band limits, water state; red = unresolved height step. Source: `…/06-3a-seam-debug.png`.*

**Failure and correction:**
- The first 4-tile corner target averaged mountain heights into a 5 m plain | plain edge, which then failed the slope rule. Corners are now grouped through active edges only, and each edge is screened alone first.
- Slope matching transplanted steep banks across edges, so C¹ is tried first with a C⁰ fallback per edge.
- A kink from the corner ramp was compensated.

**Open (kept from the midterm, not resolved):**
- **Height steps at chunk seams:** every mountain edge (164–296 m) and the steep river-bank edges stay unjoined; 3 of 4 corners stay open (74–255 m spread).
- **Water discontinuity:** 4 of 12 edges; some levels are incompatible (river ≈ 30 m vs sea 0 m); rivers end at a tile edge.
- **Street ports not matched:** only 7 port pairs match by position, on 2 edges; ports are not paired or redirected, so no street continues into the next tile.
- **Slope kinks:** up to 8.6° near closed corners and 41.8° on C⁰ edges (world 6202).

---

## 13 Results, Limitations & Next Steps

**Release:** M01 deployed the build to Firebase Hosting on 2026-10-19 (21:43). The live check passed 11 / 11 with 0 browser errors. After `main` was updated, CI redeployed it at 22:51 (M02b), and the live check passed 10 / 10.

![[13-results-a-live-site-m01-after.png]]
*After M01: public site, Mini World tab, world seed 6201, `chunk_1_0` switched to Amsterdam. Source: `…/m01-live-world-grid-after.png`.*

![[13-results-b-live-site-ci-deploy-after.png]]
*After M02b (CI deploy): public site, world seed 6201, 9 / 9 tiles ready in 18.0 s, captured 2026-10-19 22:52 by `scripts/verify-live-release.mjs`. Source: `%TEMP%\verify-live-release\live-world-grid.png` (not stored in the repository before this archive).*

| Verified | Implemented (partial) | Proposed |
| --- | --- | --- |
| Four landform algorithms in a frozen 1024 m tile | Terrain seams: 4 / 12 edges, 1 / 4 corners (world 6201) | Street ports paired across tiles |
| Terrain analysis with evidence-gated directions | Water continuity across tiles (4 / 12 edges still one-sided) | City influence field |
| Six City DNAs, transparent terrain-fit ranking | City DNA values: assumptions; research measurements TBD | City expansion and boundaries |
| Grid / organic / canal-street networks, loop closure, mountain roads | Organic / canal-street networks sparse; 78–86 % of buildable land left as reserve | Morphological transition between DNAs |
| Blocks, buildable land, road-fronted parcels | Tunnel-building constraints: rules exist, no dedicated test | Calibration against real data (e.g. PLUTO) |
| Grey-box buildings on terrain | Tunnel geometry: one known non-manifold case (7922 + Chicago), isolated, not fixed | Demo video |
| Closed solid terrain and excavated tunnels | | |
| 3 × 3 World Grid with a City ID per tile; public deployment | | |

**Limitations kept from the midterm:**
- height steps at chunk seams;
- water discontinuity;
- insufficient street-port matching;
- the old tunnel-geometry defect.

No later verification has resolved any of them.

**Next steps:**

```text
City Placement → Seam Connection → City Influence → City Expansion → Morphological Transition
  (done, 06.2)    (partial, 06.3a)     (proposed)        (proposed)          (proposed)
```

1. Decide how unjoinable edges are handled: an explicit wider band, a landform-compatibility rule, or an escarpment / shore rule.
2. Pair and redirect street ports, starting on the plain | plain edge, where 6 ports already match by position.
3. Define a city influence field and measure where identity holds or changes when two DNAs meet.

### Missing Screenshot list

| Stage | Missing content |
| --- | --- |
| 02 (02.2) | the original island-terrain capture, overwritten at the same path by 02.2b |
| 05 (03.2) | the two network defects found and fixed during testing (no before images) |
| 10 | any capture of a tunnel near or under buildings |
| 11 / 09 | the failing tunnel case: mountain 7922 + Chicago, non-manifold cut |
| 12 | streets crossing a tile edge (not implemented, so no capture is possible) |
| 13 | a video walk-through of the 3 × 3 world (compass target 6) |
