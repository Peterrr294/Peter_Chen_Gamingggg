# Archived Experiments — Earlier Studies Kept for History

Part of [04 Experiments](../EXPERIMENT-INDEX.md). These studies came before the Procedural Mini World compass (2026-10-17). They are **Archived**: still runnable and not deleted, but not part of the current pipeline. **Dependency** marks code that the active pipeline still imports. Do not remove it. Their own records stay where they are; this note only connects them.

| Study | Dates (from logs) | Folder · first commit | Record | Test (2026-10-19) | State |
| --- | --- | --- | --- | --- | --- |
| Starlight Run (first game loop) | 2026-09-02 | `legacy-game.html` · `221f957` | [overview](../../projects/starlight-run/overview.md) | no verifier | Archived |
| React Three Fiber scene | 2026-09 | `src/` · `221f957`; `scene.html` · `effd5b9` | [learning path](../../learning/react-three-fiber/learning-path.md) | no verifier | Archived |
| Cellular Noise | [2026-09-09](../../logs/2026-09-09.md), [09-16](../../logs/2026-09-16.md) | `experiments/cellular-noise/` · `effd5b9` | [README](../../../experiments/cellular-noise/README.md) | no verifier | Archived · **dependency** (`noise.js`: `sampleHeight`, `checksum`) |
| Voxel Terrain | [2026-09-28](../../logs/2026-09-28.md) | `experiments/voxel-terrain/` · `effd5b9` | [README](../../../experiments/voxel-terrain/README.md) | no verifier | Archived |
| Shader Basics | [2026-09-29](../../logs/2026-09-29.md), [10-03](../../logs/2026-10-03.md) | `experiments/shader-basics/` · `7b21c3e` | [notes](../../learning/shaders/first-shader-experiments.md) | no verifier | Archived |
| PCG Terrain Lab | [2026-10-07](../../logs/2026-10-07.md) | `experiments/pcg-terrain/` · `7b21c3e` | [notes](../../learning/pcg-terrain/random-scattering.md) | `verify-pcg-terrain` pass | Archived |
| Flavor Clash map (four regions) | [2026-10-07](../../logs/2026-10-07-flavor-clash.md) | `experiments/flavor-clash-prototype/` · `7b21c3e` | [README](../../projects/flavor-clash/README.md), [development progress](../../projects/flavor-clash/Flavour%20Clash%20-%20Development%20Progress.md) | `verify-flavor-clash` pass | Archived · **dependency** (`world/SeededRandom.js`) |
| Iceland Region | 2026-10-07 | `experiments/iceland-region/` · `7b21c3e` | [Flavor Clash README](../../projects/flavor-clash/README.md) | `verify-iceland-region` pass | Archived · **dependency** (`SurfaceQuery.js`; `IcelandTerrain` used by superseded 02.2 / 02.2b / 02.3) |
| Road Projection | 2026-10-07 | `experiments/road-projection/` · `7b21c3e` | [Flavor Clash README](../../projects/flavor-clash/README.md) | `verify-road-projection` pass | Archived |
| Road Mesh | 2026-10-07 | `experiments/road-mesh/` · `7b21c3e` | [Flavor Clash README](../../projects/flavor-clash/README.md) | `verify-road-mesh` pass | Archived · **dependency** (`RoadMeshBuilder.js`, `config.js`) |
| Terrain Seam (Venice / Japan) | 2026-10-13 → 14 | `experiments/terrain-seam/` · `7b21c3e` | [building scatter](../../projects/flavor-clash/terrain-seam-building-scatter.md) (incl. local model list) | `verify-terrain-seam` pass (with local models) | Archived; 06.3a reused its blend principle. **Public page broken** without its git-ignored models |
| Manhattan greybox | 2026-10-18 | `experiments/manhattan-terrain-greybox/` · `7b21c3e` | card 02.1 in [Terrain Experiments](./terrain-experiments.md) | `verify-manhattan-terrain` pass | **Superseded** · its `style.css` still used by the active pages |

## Venice vertical slice (branch / worktree)

`experiment/venice-vertical-slice` is a git worktree at `D:\Documents\GitHub\Gameeeeeeee!-venice-vertical-slice` (in the real folder name the "!" is a full-width exclamation mark), still at commit `a38c73d` (no own commits). Its untracked `experiments/terrain-seam/`, `experiments/flavor-clash-prototype/`, and `scripts/` were compared file by file on 2026-10-19: 0 files differ and 0 exist only there. The main tree holds a superset, so no separate research result exists to archive. The worktree was left untouched.

## Flavor Clash dates and records

The Terrain Seam dates come from the [Flavour Clash development progress](../../projects/flavor-clash/Flavour%20Clash%20-%20Development%20Progress.md) note (updated 2026-10-14) and the capture runs of 2026-10-13 in the building scatter record. The four capture-run image folders other than `2026-10-13-013931-444` no longer exist. Their links were replaced by "image not preserved" notes in M02.
