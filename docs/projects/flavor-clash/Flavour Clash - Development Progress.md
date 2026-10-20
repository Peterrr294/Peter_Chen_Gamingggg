---
aliases:
  - Flavour Clash Progress
  - Flavor Clash Development Progress
tags:
  - project/flavour-clash
  - procedural-generation
  - terrain
  - venice
  - tokyo
status: in-progress
updated: 2026-10-14
---

# Flavour Clash - Development Progress

This is the canonical chronological progress record for Flavour Clash. The [project README](./README.md) remains the technical entry point for the original four-region prototype; this note tracks how that study developed into the focused Venice/Japan terrain-seam world without rewriting the README.

## Status vocabulary

| State | Meaning in this note |
| --- | --- |
| **VERIFIED** | Supported by a focused test, browser assertion, preserved capture, or numerical check. |
| **IMPLEMENTED / UNVERIFIED** | Present in the current working tree, but not yet supported by the required visual or focused geometry evidence. |
| **IN PROGRESS** | Actively being refined; current behavior should not be treated as final. |
| **BLOCKED** | Cannot be signed off until a named dependency or observation is resolved. |
| **PLANNED** | Agreed next work with no completion claim. |

## Project vision

Flavour Clash is developing a connected procedural world whose two active architectural identities are a historical Venice water city and a cyberpunk Tokyo/Japan district. Each zone keeps its own terrain profile, water logic, assets, and building layer while sharing an organic world-space transition. The current objective is a controllable experimental world, not a finished game or culturally complete reconstruction.

## Chronology

| Date | Milestone | State | Evidence boundary |
| --- | --- | --- | --- |
| 2026-10-07 | Class 06 Assignment 1 established deterministic terrain-based architectural scattering: seeded XZ candidates, downward surface queries, bounded rejection, debug views, and instanced placeholders. | **VERIFIED** | Automated results are recorded in [Random Scattering](../../learning/pcg-terrain/random-scattering.md) and the [Class 06 log](../../logs/2026-10-07.md); personal visual observations remained open. |
| 2026-10-07 | Flavor Clash Prototype 0.1 separated seeded regional terrain, local WFC roads, plaza splines, and regional scattering across Iceland, Tokyo, Venice, and Hawaii. | **VERIFIED** | Determinism, independent regeneration, browser behavior, and zero captured browser errors were tested; the planned human screenshot set was incomplete. See the [technical README](./README.md). |
| 2026-10-13 | The focused Terrain Seam lab reused the building generator for separate Venice and Japan terrain meshes, classification, water masks, world-space heights, and independent controls. | **VERIFIED** | Repeated browser captures and assertions are preserved in [Terrain-Bound Building Scatter](./terrain-seam-building-scatter.md). |
| 2026-10-13 | Placeholder grids gained multi-cell GLB replacement, footprint reservation, per-asset normalization, and orientation correction. | **VERIFIED** | The active asset lists, transforms, surface tests, and placement counts pass `verify:terrain-seam`; visual composition is not thereby complete. |
| 2026-10-13 | Each zone expanded from the original focused area to 54 × 54 world units without scaling buildings, grid spacing, or canal widths. Existing building bounds remained pinned instead of filling the expansion. | **VERIFIED** | Both meshes use resolution 120 and 0.45-unit terrain spacing; the shared seam reports zero height error across 121 matching samples. |
| 2026-10-13–14 | Venice moved from grid-like/broken water patches toward one deterministic organic canal network with hierarchical widths, shared carving, water, and retaining-wall boundaries. | **IN PROGRESS** | Numerical generation is stable, but the latest edge projection still needs a new dedicated top-down and close-up visual sign-off. |
| 2026-10-14 | Current working-tree browser verification was rerun. | **VERIFIED** | Two 54 × 54 zones, zero seam error, 41 Venice and 51 Japan valid grid cells/building placeholders, eight active Japan GLBs, ten Venice GLB placements, responsive layout, and no browser errors passed. This does not prove canal appearance is finished. |

No current Terrain Seam milestone is tied to a verifiable Git commit: the relevant experiment and project notes are still uncommitted in the present working tree. Dates above come from preserved logs, captures, file evidence, and the current verification run.

## System progress

### Terrain and transition

| Capability | State | Current record |
| --- | --- | --- |
| Separate zones | **VERIFIED** | Venice and Japan own separate meshes, geometries, materials, seeds, and height profiles. |
| Organic seam | **VERIFIED** | A seeded noise-displaced transition blends the profiles while preserving a shared geometric edge at world X = 0. |
| Expanded world | **VERIFIED** | Each zone is 54 × 54 with deterministic world-space sampling; camera and generation bounds cover the larger world. |
| Classification and water mask | **VERIFIED** | `SurfaceQuery` returns height, slope, buildability, and water-mask data; accepted buildings remain dry, slope-safe, and inside pinned bounds. |
| Venice canal carving | **IMPLEMENTED / UNVERIFIED** | Terrain cuts use the same analytic canal paths and widths as water classification, but current verification does not inspect every rendered terrain-to-wall top edge. |
| Tokyo terrain | **VERIFIED** | Low-relief rolling terrain and its stream profile remain independent of Venice canal edits; no recent Venice pass intentionally changed Japan. |

Primary code: [terrain-seam config](../../../experiments/terrain-seam/config.js), [terrain generation](../../../experiments/flavor-clash-prototype/generation/TerrainGenerator.js), and [SurfaceQuery/building scatter](../../../experiments/flavor-clash-prototype/generation/BuildingScatterGenerator.js).

### Buildings and assets

- **VERIFIED:** Venice and Japan use independent seeded scatter layers, terrain references, density controls, grid spacing, and placement bounds.
- **VERIFIED:** Placement is grid-aligned and supports multi-cell footprints; occupied cells are reserved before a GLB replaces placeholder instances.
- **VERIFIED:** Active Japan replacements are `glb-04` through `glb-11`. `tiny_tokyo.glb` remains a separate whole-scene reference asset rather than a separable building source.
- **VERIFIED:** Active Venice sources are `v_01.glb` and `v_02.glb`; `v_01` receives a local +90° Y correction and `v_02` remains at zero local yaw before bounds and footprint calculation.
- **VERIFIED:** `ModularAssetLoader.js` normalizes base origin, uniform scale, front rotation, yaw, and post-transform footprint before terrain placement.
- **IMPLEMENTED / UNVERIFIED:** Asset appearance and street composition still require human review. The loader's dominant-axis inference is a compatibility heuristic, not proof that every model's authored front direction is correct.
- **IN PROGRESS:** Buildings remain confined to the earlier core bounds (`Venice: X -18…0`, `Japan: X 0…18`, `Z -9…9`); the expanded land is intentionally not auto-filled.

Relevant implementation: [Terrain Seam scene](../../../experiments/terrain-seam/main.js), [ModularAssetLoader](../../../experiments/terrain-seam/ModularAssetLoader.js), and [BuildingScatterGenerator](../../../experiments/flavor-clash-prototype/generation/BuildingScatterGenerator.js).

### Venice canals and waterfront

| Area | State | Current behavior |
| --- | --- | --- |
| Topology | **IMPLEMENTED / UNVERIFIED** | One main route, irregular secondary branches, narrow branches, a loop, and westward outlets are deterministic and share one path definition. A fresh rendered component audit is still required after the latest smoothing change. |
| Width hierarchy | **VERIFIED** | Exposed defaults are main 0.72, secondary 0.44, and branch 0.30 world units with low-frequency seeded variation; building and world scales remain unchanged. |
| Shared field | **IMPLEMENTED / UNVERIFIED** | Canal mask, terrain cut, indexed water cells, and vertical retaining walls derive from the same signed-distance/path field. Current browser assertions load this geometry successfully but do not test all shoreline contacts. |
| Elevation section | **IMPLEMENTED / UNVERIFIED** | Streets/building platforms remain above water; vertical walls descend below the water plane. The intended section is urban ground → shared top edge → retaining wall → submerged bed. |
| Mesh stitching | **IMPLEMENTED / UNVERIFIED** | Water and walls share indexed boundary coordinates, clipping, winding, normals, and intentional terrain-border outlets. A dedicated invalid/open-edge check should be rerun against the latest geometry. |
| Edge smoothing | **IN PROGRESS** | Canal raster resolution is capped at 540 samples; boundary vertices are projected toward the analytic signed-distance contour. This reduces staircase edges without widening canals, but the latest projection lacks final visual comparison evidence. |
| Waterfront types | **PLANNED** | Building-at-edge, narrow quay, landing/dock, and stepped access remain deferred until base topology and wall alignment are visually stable. |
| Water appearance | **IMPLEMENTED / UNVERIFIED** | Subtle bounded ripples and tone variation exist inside the canal mesh; they are not fluid simulation and are outside structural sign-off. |

## Verified results

- [x] Independent Venice/Japan terrain ownership, seeds, materials, classifications, and building controls.
- [x] Shared seam: 121 matching samples, maximum and mean height error 0 in the current automated run.
- [x] Expanded dimensions: 54 × 54 per zone at resolution 120 without changing building or canal scale.
- [x] Current accepted building points pass dry-land, slope, buildability, grid, and pinned-bound assertions.
- [x] Current GLB verification: eight Japan replacements (`glb-04`–`glb-11`) and ten Venice placements (four `v_01`, six `v_02`).
- [x] Current focused browser run completed without captured page or console errors.
- [ ] Canal visual continuity, shoreline/wall contact, and smooth intersections are not certified by those assertions.

## Known issues and blockers

| Issue | State | Consequence |
| --- | --- | --- |
| Latest canal contour projection has no final comparison capture or canal-specific numerical audit. | **BLOCKED** | Waterfront geometry cannot be called visually complete even though the page passes browser verification. |
| The last focused proximity scan flagged 26 procedural buildings near refined canal edges; it predates the latest projection. | **IN PROGRESS** | Conflicts must be rechecked and reported; buildings must not be moved automatically. |
| Narrow diagonal canals can still reveal raster-cell faceting, especially at intersections and clipped outlets. | **IN PROGRESS** | Remaining jaggedness may require a local contour/triangulation improvement; a broad meshing refactor is not yet justified. |
| Wall tops sample terrain at projected boundary points, but no current test proves every top vertex is watertight against the rendered terrain surface. | **IMPLEMENTED / UNVERIFIED** | Small cracks or exposed triangles may remain in close-up views. |
| Expanded outer land has terrain and canals but no expanded building program. | **PLANNED** | Performance and composition can be evaluated before increasing instance count. |
| Personal assessment of Venetian atmosphere and Tokyo composition remains incomplete. | **BLOCKED** | Automated geometry and build results cannot substitute for architectural visual review. |

## Reverted or abandoned approaches

- Rigid parallel canal grids, broad depressed bands, and disconnected puddle-like masks were replaced by a seeded irregular connected path hierarchy.
- Separately generated water strips and canal walls were replaced by one shared canal field because independent sampling produced gaps, fragments, inconsistent widths, and incomplete banks.
- Soft terrain slopes were rejected for dense Venice edges; the active structural direction uses low urban platforms and near-vertical retaining walls.
- Scaling the existing core content to fill the expanded world was rejected. Terrain bounds expanded while buildings, grid cells, footprints, and canal widths retained their world scale.
- Full physics/fluid simulation was not pursued. Lightweight mask-constrained water and geometry contact remain the chosen scope.
- Automatic building relocation was repeatedly excluded; conflicts are reported so architectural placement decisions remain explicit.
- Decorative waterfront variants were deferred when topology defects were still visible, preventing decoration from hiding structural problems.

## Key design decisions

1. Keep the original four-region prototype and the focused Venice/Japan Terrain Seam lab separate.
2. Use deterministic world-space functions so regeneration, expansion, and seam checks remain reproducible.
3. Treat terrain classification and the water mask as shared placement data rather than visual-only materials.
4. Preserve independent building scatter layers and reserve whole grid footprints before placing multi-cell assets.
5. Derive Venice terrain cuts, water, and retaining walls from one canal definition; classify border outlets separately from broken dead ends.
6. Preserve building transforms during canal work and report conflicts instead of silently correcting them.
7. Treat build success as a prerequisite, not visual completion.

## Next priorities

- [ ] **PLANNED:** Capture one new top-down and one close-up diagnostic view of the current projected canal boundary; compare against the preserved pre-projection overview.
- [ ] **PLANNED:** Run canal-specific checks for connected rendered water components, invalid/degenerate triangles, open wall edges, boundary-coordinate mismatch, and unintended dry-land water cells.
- [ ] **PLANNED:** Re-run building-to-canal clearance against current GLB footprints and list conflicts without relocation.
- [ ] **PLANNED:** Fix only confirmed local causes of remaining faceting or wall/terrain cracks; stop if correction requires a canal-system refactor.
- [ ] **PLANNED:** After structural sign-off, add deterministic waterfront edge variants and review Venice/Tokyo composition manually.

## Technical entry points

- [Repository README](../../../README.md) — overall study index and status language.
- [Flavor Clash technical README](./README.md) — original four-region architecture and verification boundary.
- [Terrain-Bound Building Scatter](./terrain-seam-building-scatter.md) — preserved Venice/Japan building evidence.
- [Terrain Seam experiment](../../../experiments/terrain-seam/) — active focused world.
- [Terrain Seam verifier](../../../scripts/verify-terrain-seam.mjs) — automated ownership, seam, building, asset, and browser assertions.
- [2026-10-07 Flavor Clash handoff](../../logs/2026-10-07-flavor-clash.md) — earlier finite-map decisions and road-mesh progression.
