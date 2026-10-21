# 4 · Experiments

[← Key Parameters](./03-key-parameters.md) · [Home](./00-midterm-review.md) · [Next: Midterm Results →](./05-midterm-results.md)

Each experiment answered one question and was checked by its own script before the next one started. Only the key method and result are listed here. The full entry for each task ID (method, numbers, failures) is in the [experiment log](../FINAL-EXPERIMENT-LOG.md); search for the ID. The [experiment index](../EXPERIMENT-INDEX.md) lists every task with its files and test status.

## Stage R · Research base · Implemented (partial)

| Task | Question → result |
| --- | --- |
| EXP-00, 00.2 | How can cities be compared as rules? → a 40-field research template and a 60-city database in 10 families. |
| 00.3, 01.1 | Which prototypes, and what does Manhattan's evidence look like? → Manhattan, Venice, Fez; Manhattan sources identified, **measurements not yet done**. These two notes have no log entry (evidence pending). |

## Stage T1–T2 · Site: terrain and its reading · Verified

| Task | Question → result |
| --- | --- |
| 02.1 → 02.4 | From a city-shaped greybox (02.1, *superseded*) to city-neutral terrain: four landform algorithms in one frozen 1 km tile. 12 landform × seed pairs reproducible. |
| 02.5 | Can the site be read automatically? → buildable regions, water bodies, shoreline / river direction (reported only with evidence). 12 / 12 checks pass. |

## Stage T3 · City DNA matching · Verified (6 DNAs)

| Task | Question → result |
| --- | --- |
| 02.6 | Can terrain fit rank cities transparently? → plain: Manhattan 0.80 ≫ Fez 0.29 > Venice 0. Mountain is a weak fit for every DNA. Venice never fits, because no landform produces a lagoon. |
| 06.1 | Do the rules generalise? → Chicago, Amsterdam, Lisbon added as configuration only; 72 / 72 runs; the original three DNAs are bit-identical before and after. |

![Auto-match vs manual choice on the same terrain](../../assets/screenshots/procedural-mini-world/02-6-city-match-auto-vs-manual.png)

*Coast, seed 1101: auto → Manhattan, and Venice forced by hand. Same terrain signature in both. The panel shows score, fit × coverage, and the three decisive reasons.*

## Stage T4 · Network and tunnels · Verified (with known gaps)

| Task | Question → result |
| --- | --- |
| 03.1 | One graph for Grid / Organic / Canal-street → 36 / 36 runs legal: no road on water or beyond its slope limit. Organic and canal-street came out tree-like. |
| 03.3 | Can tree-like networks close into blocks without faking it? → e.g. organic coast 3303: loops 0 → 13, dead ends kept at 25 %. |
| 03.2, 05.1b-2 | Mountains: a grade-limited road first, then a checked tunnel → 0–1 tunnel per mountain seed. Three tunnels are excavated as real openings in a closed solid terrain. |

![Mountain tunnels](../../assets/screenshots/procedural-mini-world/03-2-mountain-tunnels-overall.png)

*Mountain seeds 2202 / 1101 / 3303 → 0 / 1 / 1 tunnels; sand = mountain roads, violet dashes = tunnels, yellow = portals.*

![Tunnel portals cut into the terrain](../../assets/screenshots/procedural-mini-world/05-1b2-tunnel-portals.png)

*Portal close-ups, both ends: mountain 3303 with the Manhattan grid, mountain 1101 with the organic strategy.*

## Stage T5 · Blocks and parcels · Verified

| Task | Question → result |
| --- | --- |
| 04.1, 04.1b | Closed blocks from streets, water, and the tile edge → 0 invalid blocks. Buildable land is measured, not assumed: on the coast, organic blocks are only ≈ 60 % buildable. |
| 04.2 | Plots from real street frontage → 100 % of plots touch their own street. Grid plain: about 1 800 plots, ≈ 16 m frontage, 28 m depth. |

![Parcel frontage close-up](../../assets/screenshots/procedural-mini-world/04-2-parcels-frontage-closeup.png)

*Grid block B15: frontage and corner lots; canal-street lots on lanes and quays (seed 1101).*

## Stage T6 · Building volumes · Verified (heights assumed)

| Task | Question → result |
| --- | --- |
| 05.1 | One grey-box volume per plot, height from the DNA → grid plain: about 1 700 buildings, mean height ≈ 60 m (a prototype assumption, not yet a Manhattan measurement). |
| 05.1b-1 | Can the terrain be a closed solid (needed for tunnels)? → 6 / 6 tiles watertight. |

![Street-level grey boxes](../../assets/screenshots/procedural-mini-world/05-1-buildings-street-closeup.png)

*Seed 1101: grid street wall, canal-street lanes and quays, organic courtyards.*

## Stage T7 · World and seams · Implemented (partial)

| Task | Question → result |
| --- | --- |
| 06.2 | Nine tiles, one frame, a City ID per tile → the centre tile is identical to the single-tile page. Changing one City ID rebuilds that tile only (2–3 s). Seams are measured, not hidden: all 12 edges stepped (5–296 m). |
| 06.3a | Join terrain and water where a natural slope is possible → world 6201: 4 / 12 edges joined with zero height step; 8 edges stay open because a join would create slopes over 35°. |

![Closed corner, raw vs harmonised](../../assets/screenshots/procedural-mini-world/06-3a-seam-closeup-compare.png)

*World seed 6201, transition width 128 m. Corner x −512 / z 512 (Chicago plain · Manhattan plain · two coast tiles), raw (step) vs harmonised (joined).*

[← Key Parameters](./03-key-parameters.md) · [Home](./00-midterm-review.md) · [Next: Midterm Results →](./05-midterm-results.md)
