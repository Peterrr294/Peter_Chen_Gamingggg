# Release & Resources — GitHub, Firebase, References, Attribution

Part of [06 Release & Resources](../README.md).

## GitHub & Firebase

| Resource | Value | Verified |
| --- | --- | --- |
| Live site | <https://gameeeee-zc626.web.app/#miniWorld>; direct pages `/experiments/world-grid/`, `/experiments/seed-terrain/` | 2026-10-19: `verify-live-release.mjs` 10 / 10 |
| Firebase project / site | `gameeeee-zc626` (`.firebaserc`) / site `gameeeee-zc626`, the only site | `firebase hosting:sites:list`, 2026-10-19 |
| Hosting config | `firebase.json`: public `dist`, SPA rewrite `** → /index.html`; Firestore rules in `firestore.rules` (not part of these releases) | file |
| CI | `.github/workflows/firebase-hosting-merge.yml` (push to `main` → live); `firebase-hosting-pull-request.yml` (PR → preview channel, not used so far) | M02b deploy 22:51:43 |
| Repository | <https://github.com/Peterrr294/Peter_Chen_Gamingggg>; `main` = `experiment/terrain-seam` = `b59b26c`; tag `release/m01-2026-10-19` | `git ls-remote`, authenticated. **Anonymous access returns 404 (private repository)**: visitors need an invitation |
| History | [Deployment History](./deployment-history.md) | — |
| Older infrastructure notes | [Firebase account saves](../../infrastructure/firebase/account-linked-terrain-saves.md) · [website architecture](../../infrastructure/game-lab-website/architecture-and-navigation.md) | Game Lab era |

## Technical references

- Stack (from `package.json`): three 0.180, Vite 7, lil-gui 0.21, React 19 / React Three Fiber 9 (older hub studies), firebase 12, playwright-core 1.63 (verifiers, with the system Chrome).
- Open-source sources and licences used by the earlier map prototype: [OPEN_SOURCE_SOURCES.md](../../OPEN_SOURCE_SOURCES.md) (wavefunctioncollapse, poisson-disk-sampling: MIT).
- Code reused inside the pipeline from earlier experiments: see the dependency rows in [Archived Experiments](../04-experiments/archived-experiments.md).
- Research sources for cities: source registers inside [manhattan-spatial-study](../research/manhattan-spatial-study.md) and [city-longlist-60](../research/city-longlist-60.md).

## Assets & attribution

| Asset | Origin | Licence | In Git / deployed |
| --- | --- | --- | --- |
| Screenshots in `docs/assets/screenshots/` | captured by this project's verifiers and live checks ([Screenshot Index](../99-attachments/screenshot-index.md)) | own work | yes / no (docs only) |
| Third-party 3D models in `experiments/terrain-seam/` (`tiny_tokyo.glb`, `01–13.glb`, `v_01–03.glb`, `venice_building.glb`, two cyberpunk building `.glb`, `01–11.fbx`; ≈ 390 MB) | **TBD**: no source or author is recorded anywhere in the vault | **TBD** | no (git-ignored) / no |
| Generated geometry (terrain, streets, buildings) | generated at runtime | own work | code only |

Recording the origin and licence of the 3D models is an open item, needed before they could ever be committed or deployed.
