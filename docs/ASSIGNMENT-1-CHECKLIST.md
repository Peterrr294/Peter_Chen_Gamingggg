# Assignment 1 — Repository Documentation and Evidence Checklist

> Audit date: 2026-10-07  
> Scope: root README, repository Markdown files, `docs/`, `experiments/`, website routes, internal links, image references, Mermaid diagrams, and Git status.  
> Status vocabulary: **Complete**, **Partial**, **Missing**, and **Needs verification** describe Assignment 1 evidence—not whether every future project idea is finished.

## Requirement Audit

| Assignment requirement | Status | Repository evidence | What remains |
| --- | --- | --- | --- |
| Improve repository documentation | Complete | [Root study notebook](../README.md), [documentation cover](./README.md), and code-adjacent experiment notebooks | Continue updating observations as new experiments occur. |
| Establish a clear folder structure | Complete | [Project Map](./_meta/project-map.md) explains `docs/projects`, `learning`, `infrastructure`, `standards`, `logs`, and code-adjacent `experiments` | No second parallel taxonomy was created because the existing structure is already clear. |
| Use root README as the entry point | Complete | [Root README](../README.md) now introduces scope, goals, live work, study areas, journey, evidence, status, and structure | None for Assignment 1. |
| Provide clickable research navigation | Complete | Root [Study Areas](../README.md#study-areas) links every evidenced research area to a focused record or section | Flavor Clash now links to its implemented finite-map record. |
| Give major research directions a durable record | Complete | [Cellular Noise](../experiments/cellular-noise/README.md), [Voxel Terrain](../experiments/voxel-terrain/README.md), [Flavor Clash](./projects/flavor-clash/README.md), [Starlight Run](./projects/starlight-run/overview.md), [R3F](./learning/react-three-fiber/learning-path.md), [Firebase](./infrastructure/firebase/account-linked-terrain-saves.md), and [website architecture](./infrastructure/game-lab-website/architecture-and-navigation.md) | Continue adding personal observations without rewriting historical logs. |
| Include actual screenshots in README documents | Partial | Screenshots now appear in the root README and relevant project, experiment, learning, and infrastructure records under [assets/screenshots](./assets/screenshots/) | Authenticated Firebase/Firestore and the new Flavor Clash prototype still require real screenshots. |
| Give screenshots titles and explanations | Complete | Evidence sections use descriptive alt text plus **What this shows**, **Why it matters**, and **Parameters or conditions** | Add the same metadata when future screenshots are captured. |
| Record exploration rather than only final features | Complete | [Exploration Map](./EXPLORATION-MAP.md), dated [logs](./logs/README.md), and experiment notebook summaries retain questions, hypotheses, findings, weaker approaches, and next questions | Continue dated logs instead of rewriting earlier stages. |
| Distinguish implementation, verification, concepts, and plans | Complete | Root status table, [current state](./_meta/current-project-state.md), Firebase checklist, and [Flavor Clash prototype record](./projects/flavor-clash/README.md) | Public Firebase auth/config behavior and Flavor Clash screenshots still need human verification. |
| Preserve existing research records | Complete | Dated logs remain separate; code-adjacent READMEs remain beside experiments; no research record was deleted | None. |
| Maintain valid relative Markdown links and images | Complete | Final local audit reports zero broken Markdown paths and zero broken image paths | Re-run after future moves. |
| Keep Mermaid exploration maps readable | Complete | [Exploration Map](./EXPLORATION-MAP.md) plus local diagrams; Mermaid parsing and browser fallback are tested | Large diagrams require horizontal scrolling on narrow screens by design. |
| Verify public website links | Complete | Four Firebase Hosting routes returned HTTP 200 on 2026-09-29; `git ls-remote origin HEAD` confirmed the GitHub remote | Recheck after future deployment or repository visibility changes. |
| Verify production build and document index | Complete | Vite production build includes the Markdown library and Exploration Map asset; Files & Notes defaults to `docs/README.md` | Existing bundle-size warning is not a documentation failure. |
| Protect unrelated work | Complete | `sources/`, algorithms, Firebase schema, game logic, dependencies, Obsidian settings, and personal Canvas files were not changed by this pass | Existing unrelated uncommitted changes remain owned by the user. |

## Visual Evidence Matrix

| Research area | Screenshot evidence | Status | Interpretation |
| --- | --- | --- | --- |
| Shared Game Lab website | [Local homepage](./assets/screenshots/game-lab-home.png) and [Firebase Hosting homepage](./assets/screenshots/firebase-hosting-home.png) | Complete | Shows the common navigation and the deployed entry page. |
| Starlight Run | [Ready screen](./assets/screenshots/starlight-run.png) | Complete | Shows the playable entry, timer, score, controls, and canvas before a round. |
| React Three Fiber Level 0 | [Three primitive scene](./assets/screenshots/react-three-fiber-level-0.png) | Complete | Shows the verified box, sphere, cylinder, lighting, grid, and camera result. |
| Cellular Noise | [Shared 2D/3D terrain](./assets/screenshots/cellular-noise.png) | Complete | Shows one continuous field as a grayscale map and shaded terrain with parameters visible. |
| SDF primitive | [Sphere preset](./assets/screenshots/voxel-sdf-sphere.png) | Complete | Shows the zero surface of the sphere SDF in visible chunk bounds. |
| CSG subtraction | [Box Cut preset](./assets/screenshots/voxel-csg-box-cut.png) | Complete | Shows Box B subtracting from Sphere A. |
| CSG union and cave subtraction | [Chunk Cave preset](./assets/screenshots/voxel-chunk-cave.png) | Complete | Shows a union followed by a spherical subtraction across chunks. |
| CSG intersection | No dedicated screenshot | Missing | Capture an operation list with **Intersect Box B** and the resulting surface. The operation is implemented, but separate visual evidence has not been preserved. |
| Chunk terrain | [Chunk Cave preset](./assets/screenshots/voxel-chunk-cave.png) | Complete | Visible blue bounds show finite chunk ownership around one surface. |
| Marching Cubes | [Sphere](./assets/screenshots/voxel-sdf-sphere.png) and [Chunk Cave](./assets/screenshots/voxel-chunk-cave.png) | Complete | Screenshots retain the algorithm readout and generated surface. |
| Surface Nets | [Surface Nets result](./assets/screenshots/voxel-surface-nets.png) | Complete | Uses the same Chunk Cave field with Surface Nets selected. |
| Marching Tetrahedra | [Marching Tetrahedra result](./assets/screenshots/voxel-marching-tetrahedra.png) | Complete | Uses the same Chunk Cave field with the tetrahedral mesher selected. |
| Firebase Authentication | Sign-in control is visible, but no authenticated-state screenshot | Missing | Sign in manually and capture the account name or authenticated header without exposing email, UID, tokens, or secrets. |
| Firestore save/load | No signed-in configuration-list screenshot | Missing | Save a clearly named test configuration, refresh the list, load it, and capture the UI plus success status with personal identifiers hidden. |
| Firebase Hosting | [Deployed homepage](./assets/screenshots/firebase-hosting-home.png) | Complete | Captured from the verified public Hosting URL. |
| WFC / Flavor Clash | Executable prototype and automated browser verification exist; no preserved map screenshot yet | Missing evidence | Capture the full default map, Systems mode, four region details, and deterministic/independent regeneration comparisons. |

## Study Notebook Coverage

| Notebook question | Evidence |
| --- | --- |
| What problem started the work? | Project and experiment introductions plus the [timeline](./EXPLORATION-MAP.md#1-exploration-timeline). |
| What was the hypothesis? | Cellular and Voxel study-notebook summaries; dated logs preserve the original stage assumptions. |
| How was it implemented? | Code-adjacent READMEs explain data structures, algorithms, and controls. |
| What parameters were tested? | Screenshot conditions, control descriptions, presets, and dated benchmark records. |
| What was observed? | Cellular binary-to-continuous finding, shared-density mesher comparison, seam audit, and verification sections. |
| What failed or was weaker? | Binary shaping limits, single-large-space scaling concern, duplicated sampling before the shared field, and Storage plan limits are retained without inventing failures. |
| What changed in understanding? | The [Exploration Map](./EXPLORATION-MAP.md) connects each finding to the next question. |
| What is current versus proposed? | Root status table, current state, and Flavor Clash record distinguish the implemented finite prototype from proposed gameplay and future world systems. |

## Evidence Still Needed

1. **CSG intersection:** select an intersection operation, generate the result, and capture both the operation row and surface.
2. **Authenticated Firebase state:** capture a signed-in header while hiding personal information.
3. **Firestore save/list/load:** capture a disposable named configuration appearing in the list and a successful load message.
4. **WFC / Flavor Clash:** capture the implemented local WFC roads and four-region map; record the seed, retries, and visible debug layers.
5. **Manual interactive review:** repeat the screenshot states in a normal browser and record any WebGL, responsive, or input problems.

## Submission Reading Route

1. [Root study notebook](../README.md)
2. [Exploration Map](./EXPLORATION-MAP.md)
3. [Cellular Noise experiment](../experiments/cellular-noise/README.md)
4. [Voxel Terrain experiment](../experiments/voxel-terrain/README.md)
5. [Flavor Clash Map Prototype 0.1](./projects/flavor-clash/README.md)
6. [2026-09-28 development log](./logs/2026-09-28.md)
7. [Firebase account saves](./infrastructure/firebase/account-linked-terrain-saves.md)
8. [Current Project State](./_meta/current-project-state.md)
9. This checklist for the evidence boundary and remaining manual captures
