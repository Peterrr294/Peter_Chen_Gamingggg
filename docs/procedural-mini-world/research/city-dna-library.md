# City DNA Library — Six Configured DNAs

Part of [02 City Research](../README.md). Values read on 2026-10-19 from `experiments/seed-terrain/cityMatchRules.js`, `networkStrategies.js`, `parcelRules.js`, and `buildingRules.js` (in Git since `7b21c3e`). How they are scored: [City DNA Matching](../03-generative-system/city-dna-matching.md).

**Evidence status:** every number below is tagged **A** (generator assumption, uncalibrated). No research row in the [research template CSV](./city-research-template.csv) has measured values yet. Manhattan, Venice, and Fez rest on the [prototype selection](./prototype-city-selection.md) (rules M1–M3, V1–V3, F1–F3) and the [Manhattan study](./manhattan-spatial-study.md). Chicago, Amsterdam, and Lisbon rest only on candidate features in the [60-city longlist](./city-longlist-60.md) (rows 10, 02, 35, all "to be verified"): **Unverified**.

## Overview

| DNA | Family (longlist) | Network strategy | Match conditions (weight, tag) |
| --- | --- | --- | --- |
| `manhattanGrid` Manhattan — orthogonal grid | F2 grid | Grid | continuous land 3 [I+A], low-slope land 2 [A], water as edge 1 [V+I], measured relief 1 [TBD] |
| `chicagoGrid` Chicago — survey grid with river cut | F2 grid | Grid | continuous land 3 [I+A], flat land 2 [A], river cuts grid 2 [I+A], lakefront edge 1 [TBD], measured relief 1 [TBD] |
| `veniceWaterNetwork` Venice — water network and islands | F1 water network | Canal-street | water structures city 3 [V+A], land divided by water 2 [I], enclosed water 1 [I], channel hierarchy 1 [TBD], island scale 1 [TBD] |
| `amsterdamCanalRing` Amsterdam — canal ring | F1 water network | Canal-street | water network 3 [I+A], flat land 2 [A], land split by water 1 [I], ring canal pattern 2 [TBD], canal widths 1 [TBD] |
| `fezOrganicCore` Fez — organic historic core | F4 organic | Organic | compact core land 2 [A], terrain-following paths 1 [I+A], boundary and gates 2 [TBD], valley relation 1 [TBD], water relation 1 [TBD] |
| `lisbonHillCore` Lisbon — hills and valley axis | F6 hillside | Organic | hilly land 2 [I+A], buildable core 1 [A], water as edge 1 [I], hill count 2 [TBD], valley axis 1 [TBD] |

## Street, plot, and building rules

| DNA | Network (m, °) | Plot: frontage / max depth / min area | Building: floors × floor height / occupancy / max depth |
| --- | --- | --- | --- |
| Manhattan | primary 200, secondary 80, slope ≤ 10, bridges on primaries only (span ≤ 80) | 15 m / 32 m / 90 m² | 3–32 × 3.6 m / 0.92 / 26 m |
| Chicago | primary 200, secondary 100, fixed axis 0°, slope ≤ 10, bridges on all streets (span ≤ 120) | 7.6 m (25 ft, src TBD) / 38 m / 120 m² | 2–45 × 3.8 m / 0.90 / 30 m |
| Venice | canal bridges every 260, slope ≤ 15, 14 lanes | 9 m / 20 m / 50 m² | 2–6 × 3.3 m / 0.85 / 14 m |
| Amsterdam | canal bridges every 120, slope ≤ 10, 24 lanes | 7 m / 30 m / 60 m² | 3–5 × 3.4 m / 0.95 / 18 m |
| Fez | slope ≤ 20, 3 secondary centres, 26 lanes, slope penalty 3 | 10 m / 22 m / 50 m² (courtyards on lots ≥ 140 m²) | 1–4 × 3.2 m / 0.85 / 16 m |
| Lisbon | slope ≤ 20, 5 hill centres, 32 lanes, slope penalty 1.5 + climb penalty 2 | 8 m / 18 m / 45 m² | 3–6 × 3.2 m / 0.90 / 14 m |

## Identity features not represented (recorded as `unsupported` in the code)

- **Chicago:** mid-block service alleys; height peaks at transit nodes (Loop stations).
- **Amsterdam:** concentric ring canals (would need canals written into the terrain, an upstream change); lots perpendicular to the canal with water-side frontage.
- **Lisbon:** pedestrian stairs and funiculars; the orthogonal Baixa grid in the valley floor; hill-top centres.

Full lists: `CITY_DNA.<id>.unsupported` in `cityMatchRules.js` and log entry 06.1 in the [experiment log](../FINAL-EXPERIMENT-LOG.md).
