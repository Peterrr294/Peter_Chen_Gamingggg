# Project Map — Documents, Code, and Current Ownership

## Purpose

This map is the canonical entry to the repository's knowledge base. It separates durable project documentation from chronological logs while keeping technical READMEs next to the code they explain.

## Projects

| Project | Runtime or source | Documentation | State |
| --- | --- | --- | --- |
| Starlight Run | `legacy-game.html` | [Project index](../projects/starlight-run/README.md) | First playable prototype |
| Cellular Noise | `experiments/cellular-noise/` | [Project index](../projects/cellular-noise/README.md) | Implemented; browser visual QA pending |
| Voxel Terrain | `experiments/voxel-terrain/` | [Project index](../projects/voxel-terrain/README.md) | Implemented; browser visual QA pending |
| Flavor Clash | `experiments/flavor-clash-prototype/` | [Map Prototype 0.1](../projects/flavor-clash/README.md) | Implemented and browser-verified locally; screenshots pending |
| React Three Fiber learning scene | `scene.html`, `src/` | [Learning path](../learning/react-three-fiber/learning-path.md) | Level 0 complete; Level 1 paused |
| Shader Basics | `experiments/shader-basics/` | [Round-one learning record](../learning/shaders/first-shader-experiments.md) | Five modes implemented; personal observations and screenshots pending |
| Procedural Mini World | `experiments/seed-terrain/`, `experiments/world-grid/` (active); `experiments/manhattan-terrain-greybox/` (superseded) | [Knowledge base home](../procedural-mini-world/README.md); [experiment index](../procedural-mini-world/EXPERIMENT-INDEX.md); [compass and experiment log](../procedural-mini-world/FINAL-EXPERIMENT-LOG.md); agent rules in [AGENTS.md](../../AGENTS.md) | Terrain → buildings chain and 3 × 3 World Grid implemented; all tasks pending review; deployed 2026-10-19 (M01) |
| PCG Terrain Lab | `experiments/pcg-terrain/` | [Random Scattering record](../learning/pcg-terrain/random-scattering.md) | Round 01 implemented; personal observations and screenshots pending |

## Knowledge Base Areas

- [Current Project State](./current-project-state.md)
- [Projects](../projects/README.md)
- [Learning](../learning/README.md)
- [Infrastructure](../infrastructure/README.md)
- [Standards](../standards/README.md)
- [Development Logs](../logs/README.md)

## Documentation Boundaries

- Project overviews explain intent and current behavior.
- Experiment READMEs remain beside code and explain implementation details.
- Logs preserve what changed at a particular stage, including superseded decisions.
- Infrastructure notes explain shared website and Firebase behavior.
- Standards describe reusable rules rather than one project's implementation.
- `sources/`, generated output, dependencies, `.git/`, and editor state are not part of this curated map.
