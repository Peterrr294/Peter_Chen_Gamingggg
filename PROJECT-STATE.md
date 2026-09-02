# PROJECT STATE

> Last saved: 2026-09-02  
> Current milestone: Level 0 complete / Level 1 ready to begin

## Resume Here

This repository currently contains a working beginner React Three Fiber scene. The next session should begin with **Level 1: scene coordinates and transforms** from [[React Three Fiber 学习日志]].

Do not add animation or extra UI during Level 1. Change and preview only `position`, `rotation`, and `scale`, then record the result in Obsidian.

## Current Application

- Full-browser React Three Fiber Canvas
- Dark-gray background
- Box, sphere, and cylinder using `meshStandardMaterial`
- Ambient and directional lights
- XZ infinite fading grid from Drei
- OrbitControls with rotate, zoom, and pan
- Production build verified successfully

## Important Files

- `src/App.jsx` — Canvas, camera, lights, grid, and controls
- `src/components/SceneObjects.jsx` — the three sample meshes
- `src/main.jsx` — React entry point
- `src/style.css` — full-screen layout
- `STYLE-GUIDE.md` — black/Klein-blue UI and content rules
- `React Three Fiber 学习日志.md` — incremental learning plan
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

## Start Next Time

From the project root:

```powershell
.\dev.cmd
```

Open the URL printed by Vite, normally `http://localhost:5173/`. If that port is occupied, Vite will select the next available port.

Build check:

```powershell
.\build.cmd
```

## Next Action

1. Open `src/components/SceneObjects.jsx`.
2. Preview the unchanged Level 0 scene.
3. Begin Level 1 with one transform change only.
4. Verify the visual result and run the production build.
5. Add a dated Level 1 entry to `React Three Fiber 学习日志.md`.

## Local Environment Notes

- System `node`, `npm`, and `git` are not currently available through the terminal PATH.
- `dev.cmd` and `build.cmd` already use the local portable Node.js, so the app remains usable.
- Git is installed at `D:\Github\Git\cmd\git.exe` and can be called using that full path.
- `.tools/`, `node_modules/`, `dist/`, and logs are intentionally excluded by `.gitignore`.

## Related Obsidian Notes

- [[STYLE-GUIDE]]
- [[React Three Fiber 学习日志]]
- [[GAME]]
- [[TUTORIAL]]
- [[First lesson]]
