# Multi-Origin Procedural Growth (G01)

Research framing: [A City of Cities — Research Compass](../A-City-of-Cities-Research-Compass.md). In its roadmap this note covers **G01** (Multi-Origin Initialization) and the **G02 baseline** (frontier, scoring, single step). Status: implemented, verified, pending review.

Code: [experiments/growing-world/](../../../experiments/growing-world/) · Verifier: [verify-growing-world.mjs](../../../scripts/verify-growing-world.mjs) · Log entry: G01 in [FINAL-EXPERIMENT-LOG.md](../FINAL-EXPERIMENT-LOG.md).

## Why growth instead of a fixed grid

The 3 × 3 World Grid (06.2–07.1a) assembled nine pre-placed chunks. Teacher feedback (2026-10-27): a world built that way is a static assembly. Its size, its city boundaries and its neighbourhoods are fixed before any rule runs. In G01 the map is instead the result of a process:

- Six cities start from one core chunk each.
- Each city extends outward one chunk at a time.
- City boundaries appear where the growth fronts meet.

The 3 × 3 World Grid stays runnable and unchanged.

## Model

| Concept | Rule | Depends on |
| --- | --- | --- |
| Cell | Integer world grid coordinate (gx, gy) of a 1024 m chunk; the map is a sparse set of cells with no fixed size | — |
| Landform | World-scale value-noise field (5-chunk lattice) → mountain / coast / river valley / plain | worldSeed + cell only |
| Terrain seed, variation | 06.2 `terrainSeedOf(worldSeed, gx, gy, landform)`; variation 0.35–0.65 hashed by cell | worldSeed + cell only |
| Chunk content | Unchanged single-chunk chain (terrain → analysis → City Match with the chunk's City ID → network → blocks → parcels → buildings, 07.1a spatial ids) | cell + City ID only |
| Core | Per city (fixed order): sample sites around the origin, keep those at Chebyshev distance ≥ `coreMinDistance` from placed cores; best of 10 by 0.7 · DNA fit + 0.3 · landform preference | worldSeed |
| Frontier | Unoccupied cells edge-adjacent to a city's chunks | current world |
| Scheduler | City with the fewest chunks / growth rate grows next (fair queue); a city without a legal cell is skipped | current world |
| Score | Weighted mean of five terms + seeded jitter (below) | worldSeed + cell + step |
| Contest | If another city also touches the cell and scores higher by more than 0.05, the cell is reserved for it | current world |
| Parent | Adjacent chunk of the same city with the most road / canal ports toward the cell, then the oldest | current world |
| Ownership | First occupant keeps a cell; records are immutable; no City DNA fusion in G01 | — |

Score terms (each 0–1):

- **terrain:** 02.6 fitScore of the growing city's DNA on the candidate cell.
- **slope:** buildable share and low-slope land share.
- **roads:** ports the parent chunks already open toward the cell.
- **water:** water share, read as an affinity for Venice / Amsterdam and as a penalty for land cities.
- **dna:** the city's growth tendency: landform preference, preferred axis (Manhattan along y, Chicago along x) and compactness (Fez high).

A cell with less than 3 % buildable land is never a candidate. All weights and profiles are **design hypotheses**, not calibrated against real-city growth data.

## Reproducibility

- There is no shared random stream. Every random value is a keyed hash of (worldSeed, purpose, city, position, step) through FNV-1a with a murmur3 `fmix32` finaliser. Without the finaliser, neighbouring cells gave striped landforms.
- Because terrain and content depend only on the cell (plus the City ID), growing other chunks first never changes a chunk.

## Seams

Chunks are generated independently with a shared world frame and an absolute height datum (sea level 0 m). The Terrain Seam system (06.3a–06.3c) is **not** applied to grown chunks in G01, so most new shared edges show height steps.

Every shared edge is measured once, when its second chunk appears. Each edge gets four separate results:

- **Identity:** same city or city boundary.
- **Geometry:** continuous if |Δh| ≤ 2 m, step if ≤ 30 m, cliff above that.
- **Hydrology:** whether the wet / dry flags match along the edge.
- **Transport:** paired and unpaired ports.

All four are shown in the page's seam layer.

## Public parameters (9)

| Parameter | Default | Spatial meaning |
| --- | --- | --- |
| worldSeed | 6201 | Variation of the landform field, core sites, tie-breaks |
| coreMinDistance | 3 chunks | Minimum spacing between two city cores |
| coreSpread | 5 chunks | Radius of the core sampling area (widened and logged if six cores do not fit) |
| jitter | 0.12 | Amplitude of the seeded score perturbation |
| wTerrain / wSlope / wRoads / wWater / wDNA | 3 / 2 / 2 / 1 / 2 | Weights of the five score terms |

The page also has run controls: steps per click, target chunk count, and the layer toggles.
