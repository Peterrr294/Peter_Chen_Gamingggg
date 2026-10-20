# Open-Source Sources Used by the Procedural Map Prototype

This record separates reused packages from project-authored integration code. Version numbers come from `package.json` and the installed package metadata.

| Source | Version / license | What is reused | Why it was selected |
| --- | --- | --- | --- |
| [kchapelier/wavefunctioncollapse](https://github.com/kchapelier/wavefunctioncollapse) | 2.1.0 / MIT | `SimpleTiledModel`, entropy-driven observation, compatibility propagation, and injectable random callback | It accepts an authored tile/neighbor model and a deterministic random function, which fits bounded local road generation. |
| [kchapelier/poisson-disk-sampling](https://github.com/kchapelier/poisson-disk-sampling) | 2.3.1 / MIT | Seedable 2D Poisson-disk candidate sampling | It gives spatially separated candidates while leaving terrain, water, slope, and road rejection rules in project code. |
| [Three.js InstancedMesh](https://threejs.org/docs/#api/en/objects/InstancedMesh) | Three.js 0.180.0 / MIT | Shared-geometry instance rendering and per-instance matrices | It avoids creating one independent Mesh for every regional placeholder object. |
| [Fennec-hub/three-wfc](https://github.com/Fennec-hub/three-wfc) | MIT / work in progress | Evaluated only; no source copied or runtime dependency added | Its Three.js focus was relevant, but its WIP status and image/canvas-oriented API were less suitable than an explicit tile model for this prototype. |

## Project-Authored Integration

The following work is local to this repository: region seed derivation, height-field styles, WFC road socket definitions and boundary constraints, connected-component filtering, spline-to-plaza routing, terrain/water/slope/road scatter filters, InstancedMesh transforms, lifecycle disposal, GUI controls, serialization, and verification scripts.

The dependency install reported existing package-audit findings in the overall dependency tree. No automatic audit fix was run because that could introduce unrelated or breaking changes.
