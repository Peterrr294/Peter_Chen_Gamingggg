# Terrain & Water

Part of [03 Generative System](./system-architecture.md) · Status: **Implemented · Verified · Pending review**

## Purpose

Generate a city-neutral site, a 1024 m tile of real-metre heights, with water only where a landform rule places it. Derive the fields every later stage reads.

## Inputs → outputs

- **Inputs:** `landform`, `seed` (1–9999), `variation` (0–1), `transitionWidth` (32–256 m), from `createSeedTerrainConfig` in `config.js`. In the world, the tile's grid origin is added as well.
- **Outputs:** `generateChunk` returns `height`, `waterSurface`, and `grid`. `deriveFields` adds `slope`, `waterMask`, `buildableMask`, `transitionWeight`, `boundarySamples` (outer and inner line per edge), and `stats` (incl. `heightSignature`, `waterSignature`).
- **Closed solid (rendering):** `TerrainShell.js` closes the surface with walls and a base at −60 m (minimum thickness 20 m) and checks that it is watertight.

## Rules (current, task 02.4)

| Landform | Rule |
| --- | --- |
| Plain | base 20 m + 7 m fBm + 0.2–0.5° tilt; **no water** |
| River valley | 230 m valley half-width; 32 m channel, 3 m deep, 18 m banks; water surface falling 2 m/km; meander amplitude 150 m |
| Coast | sea level 0 m; shoreline warped ± 90 m; open sea or enclosed bay chosen by the seed |
| Mountain | ridged multifractal (4 octaves) on a massif mask; relief 300 m; no water |

Buildable = slope ≤ 10° and ground ≥ 1 m above the local water surface. The transition zone is a weight field along the edges only: inside one tile it never changes heights. Edge joins happen in the world layer ([World Grid & Seam](./world-grid-and-seam.md)).

## Frozen vs adjustable

Tile size, 257 × 257 samples, 4 m spacing, the buildable rule, and the four landform rules are frozen ([System Architecture](./system-architecture.md)). Seed, variation, and transition width are adjustable. The landform presets were tuned on test seeds 1101 / 2202 / 3303 only.

## Upstream / downstream

- **Upstream:** none (seeded noise; `SimplexNoise` from three, `SeededRandom` from `flavor-clash-prototype`, `checksum` from `cellular-noise`).
- **Downstream:** every later stage ([Terrain Analysis](./terrain-analysis.md) first); `TerrainHarmonizer` in the world.

## Code

`experiments/seed-terrain/config.js`, `TerrainGenerator.js`, `TerrainFields.js`, `ChunkView.js`, `TerrainShell.js` · verifiers `verify-seed-terrain.mjs`, `verify-solid-terrain.mjs` · in Git since `7b21c3e`.

## Representative experiments

02.4 (current algorithms), 05.1b-1 (closed solid); history 02.1 → 02.2 → 02.2b → 02.3 (superseded). See [Terrain Experiments](../04-experiments/terrain-experiments.md).

![Four landforms](../../assets/screenshots/procedural-mini-world/02-4-landforms-overall.png)

*Seed 1101 · variation 0.5 · transition 128 m.*

## Verified / known limitations

- **Verified (02.4):** 12 / 12 landform × seed pairs reproducible; heights identical at transition widths 32 / 128 / 256 m; river with 0 off-channel water samples; coast with 0 land / sea mismatches against the shoreline potential.
- **Verified (05.1b-1):** 6 / 6 cases watertight (χ = 2, volume error ≤ 1.4e-14).
- **Limits:** the river is a carved channel with a falling surface, not a simulated flow. Mountains keep a steep tail (p99 slope 62–71°) and dense small peaks. The plain looks almost flat in 3D at true scale. Water is a separate open sheet, not part of the solid. Presets are tuned on three seeds only.
