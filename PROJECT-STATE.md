# PROJECT STATE

> Last saved: 2026-09-28
> Main-path milestone: React Three Fiber Level 0 complete / Level 1 paused
> Active exercise: Voxel Terrain SDF + ordered CSG + chunked three-algorithm meshing comparison / browser visual review next

## Resume Here

Active handoff: [[2026-09-28]] records the complete Voxel Terrain implementation, shared-density optimization, Marching Cubes / Surface Nets / Marching Tetrahedra comparison, measured results, verification, and exact resume checklist. Read it first. The current page is #voxel.

Website foundation milestone: [[WEBSITE-FOUNDATION]] records the shared site's content map, architecture, file responsibilities, run/build workflow, pending browser review, and roadmap toward a personal website. Read it before future website optimization or structural changes.

The root URL is now a unified Game Lab with Home, Starlight Game, Noise Experiment, 3D Learning, Portfolio, and Files/Notes tabs. Original React scene is available at `scene.html` and `#scene`; the first playable game is `legacy-game.html` and `#game`. Notes and source files can be read/downloaded in `#files`. Vite builds all project pages. See [[2026-09-16]] for the website integration handoff.

Teaching preference: treat the learner as a coding beginner. Explain one graphics or mathematics principle, make one bounded change with detailed Chinese comments, provide a browser check, and ask one understanding question before the next major concept.

The Cellular Noise assignment from [[2026-09-16]] remains intact but is not the active resume point. The active experiment is the Voxel Terrain meshing comparison documented in [[2026-09-28]].

Keep detailed Chinese code comments and Chinese teaching discussion; write project notes in English.

The React Three Fiber main path remains available in [[REACT-THREE-FIBER-LEARNING-LOG]]. When it resumes, begin with Level 1 scene coordinates and transforms.

## Current Application

- Full-browser React Three Fiber Canvas
- Dark-gray background
- Box, sphere, and cylinder using `meshStandardMaterial`
- Ambient and directional lights
- XZ infinite fading grid from Drei
- OrbitControls with rotate, zoom, and pan
- Production build verified successfully
- Independent cellular-noise assignment with side-by-side 2D and 3D views
- Deterministic Cellular F1 sampling with 16 × 16 chunks
- Binary Threshold, Invert Threshold, and Band shaping operations
- lil-gui controls for noise scale, grid height, and resolution
- Shared continuous heightMap rendered as grayscale and terrain elevation
- Multi-layer Cellular noise and fixed-domain resolution calibration
- Simulation start/pause, reset, arrow navigation, Space and W shortcuts

## Documentation Language

Public website UI and primary content are English. All page roots use `lang="en"`. Shared `typography.css` selects Helvetica/DengXian for English and FangSong for Chinese annotations, with system fallbacks. Chinese teaching comments remain in source files. Apply this policy to future website changes.

All Obsidian project notes are written in English for classmates and instructors. Development conversations may continue in Chinese or a Chinese-English mix.

## Important Files

- `src/App.jsx` — Canvas, camera, lights, grid, and controls
- `src/components/SceneObjects.jsx` — the three sample meshes
- `src/main.jsx` — React entry point
- `src/style.css` — full-screen layout
- `STYLE-GUIDE.md` — black/Klein-blue UI and content rules
- `REACT-THREE-FIBER-LEARNING-LOG.md` — incremental learning plan
- `experiments/cellular-noise/` — independent Cellular Noise terrain exercise
- `experiments/voxel-terrain/` — active finite SDF, ordered CSG, chunking, and three-mesher comparison
- `2026-09-28.md` — current complete session record and resume handoff
- `2026-09-09.md` — complete session record and next-session handoff
- `package.json` / `package-lock.json` — installed dependency definitions
- `archive/portfolio/` — preserved previous portfolio version

## Installed Stack

- Node.js 24.19.0 — portable copy in `.tools/`
- npm 11.17.0
- React 19.2.8
- React DOM 19.2.8
- Three.js 0.180.0
- React Three Fiber 9.7.0
- Drei 10.7.8
- Vite 7.3.6
- Vite React Plugin 5.0.4
- lil-gui 0.21.0

## Start Next Time

From the project root:

```powershell
.\dev.cmd
```

Open the URL printed by Vite, normally `http://localhost:5173/`. For the active experiment, open `http://localhost:5173/#voxel` or `http://localhost:5173/experiments/voxel-terrain/`. If that port is occupied, replace `5173` with the port selected by Vite.

Build check:

```powershell
.\build.cmd
```

## Next Action

1. Read [[2026-09-16]] and open the experiment's Vite URL.
2. Visually check simulation start/pause, terrain materials, wireframe, and both views.
3. Compare resolutions over the same world extent and inspect a sample for MATCH.
4. Review the learner's understanding before choosing the next feature.

## Local Environment Notes

- System `node`, `npm`, and `git` are not currently available through the terminal PATH.
- `dev.cmd` and `build.cmd` already use the local portable Node.js, so the app remains usable.
- Git is installed at `D:\Github\Git\cmd\git.exe` and can be called using that full path.
- `.tools/`, `node_modules/`, `dist/`, and logs are intentionally excluded by `.gitignore`.

## Related Obsidian Notes

- [[STYLE-GUIDE]]
- [[REACT-THREE-FIBER-LEARNING-LOG]]
- [[GAME]]
- [[TUTORIAL]]
- [[First lesson]]
- [[2026-09-09]]
- [[2026-09-16]]
- [[2026-09-28]]
- [[experiments/voxel-terrain/README]]
- [[experiments/cellular-noise/README]]
