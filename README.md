# Peter's Game Lab — Unified Project Website

A shared website for the first Starlight Collection game, Cellular Noise experiments, React Three Fiber lessons, the original portfolio, and project notes/source files.

The architecture baseline, decisions, verification checklist, and personal-website roadmap are recorded in [WEBSITE-FOUNDATION.md](./WEBSITE-FOUNDATION.md). Read it before restructuring or expanding the website.

The account login, per-user Firestore terrain configurations, local JSON backup, Hosting workflow, and Storage plan limitation are documented in [FIREBASE-TUTORIAL.md](./FIREBASE-TUTORIAL.md).

Website UI and primary content are English. Shared `typography.css` uses local Helvetica/DengXian for English and FangSong for Chinese annotations, with system fallbacks. Chinese comments remain available in source files.

## Website Tabs

- Home: project overview and navigation.
- Starlight Game: the first playable prototype in `legacy-game.html`.
- Noise Experiment: terrain generation and simulation.
- 3D Learning: the original React Three Fiber scene, now at `scene.html`.
- Portfolio: the preserved original website with its corrected script path.
- Files and Notes: Markdown records and authored source files, displayed as text with downloads.

Tab navigation uses URL hashes, so links can be bookmarked and browser Back/Forward works. Only the selected project iframe is loaded. Switching tabs unloads the previous page and resets its running game/simulation; use Open Separately to retain a project session. Notes and source files are bundled as raw text, so the library works in production without a filesystem server. Dependencies, generated outputs, lockfiles, and local editor configuration are outside the library.

## Run locally

```powershell
.\dev.cmd
```

Open the local URL printed in the terminal, normally `http://localhost:5173/`. Select a tab to open its content. In 3D Learning, drag to rotate, use the wheel to zoom, and right-drag to pan.

## Production build

```powershell
.\build.cmd
```

The static site is generated in `dist/`. All four project pages are included alongside the unified homepage. Serve this directory over HTTP rather than opening the module-based site as a local file.

## Structure

- `index.html`, `site.js`, `site.css`: shared website and file library
- `scene.html`: standalone entry for the original React scene
- `legacy-game.html`: first playable game
- `src/App.jsx`: Canvas, camera, lighting, grid, and controls
- `src/components/SceneObjects.jsx`: box, sphere, and cylinder
- `src/main.jsx`: React application entry
- `src/style.css`: full-browser layout

The previous portfolio version is preserved in `archive/portfolio/`.

## Project List

- Main learning path: the React Three Fiber basic scene and level-by-level exercises.
- Independent exercise: [Cellular Noise Binary Map](./experiments/cellular-noise/index.html) — a working 0/1 map demo that demonstrates random access, parallel-friendly generation, reproducibility, and chunking.

To resume development in a future session, start with [PROJECT-STATE.md](./PROJECT-STATE.md).
