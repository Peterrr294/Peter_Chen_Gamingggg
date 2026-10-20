# AGENTS.md — Codex Rules for Procedural Mini World

This file holds execution rules for coding agents (Codex, Claude Code). It does not restate project intent.

## Source of Truth

- **Project compass (direction, current stage, current single task, forbidden scope):** [FINAL-EXPERIMENT-LOG.md §1–5](docs/procedural-mini-world/FINAL-EXPERIMENT-LOG.md). It is the only authority for stage status. Read §1 and §5 before every task.
- **Experiment log:** §7 of the same file. Append one entry per task using the §6 template. Never regenerate past entries.
- **Research evidence:** [docs/procedural-mini-world/research/](docs/procedural-mini-world/research/).
- **Documentation conventions:** [knowledge-base-rules.md](docs/standards/documentation/knowledge-base-rules.md).

## Project Boundaries (summary only; compass wins on conflict)

- A controllable procedural Mini World driven by real urban spatial relations — not a traditional game, not a visual copy of a city, not UE5.
- Stack: VS Code + JavaScript/Three.js + Vite, as already installed.
- City DNA controls terrain, water, roads/canals, blocks, parcels, buildings, and tile joins. Seed only produces reproducible variation inside the rules; it is not city identity.
- Semester target: 3 distinct city DNAs, 1 full terrain → network → parcel → building chain, ≥3 tiles that join or blend, tunable parameters, debug layers, comparison evidence.
- The 60-city list is a research database, not an implementation target.
- The four traditional analysis drawings are skipped; spatial rules are validated with runnable greybox experiments plus minimal real-city evidence.

## Execution Rules

1. Start each task by reading the compass stage (§1, §5) and this file.
2. Handle one minimal, verifiable question per task. Stop when done and wait for review.
3. Search and reuse before writing: existing experiments (`experiments/terrain-seam/`, `experiments/flavor-clash-prototype/`, `experiments/manhattan-terrain-greybox/`, road/region experiments), `scripts/verify-*.mjs`, and the `experiment/venice-vertical-slice` branch/worktree when relevant.
4. Do not rewrite existing features from scratch. No unrequested refactors, dependency installs, upstream interface changes, branch switches, commits, pushes, or deployments.
5. Read only task-relevant code. Keep output and debug rounds short.
6. Every public parameter must have a spatial meaning. First version of any generator: ≤10 public parameters.
7. Keep old experiments runnable. New work goes in a minimally isolated folder under `experiments/`.
8. No UE5. Borrow the MCP idea only: natural-language driven, tool calls, automated verification.
9. If something cannot be verified, say why and mark it **Pending verification**. Never present a guess as done. Earlier tasks are not assumed verified unless the log shows evidence.
10. Semester delivery first: no extra cities, complex assets, gameplay, or visual polish ahead of the compass stage.

## Evidence and Screenshots

- Only for tasks that actually generate output; text-only tasks need no screenshot.
- Default: one **After** screenshot. Add Before / Debug / Comparison only when it proves a change or locates a bug. Usually ≤3.
- Real runtime captures only. Reuse the existing Playwright flow (`scripts/capture-evidence.mjs`, `scripts/verify-*.mjs`); do not install large dependencies just to capture.
- Save to `docs/assets/screenshots/procedural-mini-world/` with stable names: `<task-id>-<subject>-<after|before|debug|compare>.png`.
- Link from the log with a relative Markdown image link pointing to `../assets/screenshots/procedural-mini-world/<file>.png` (relative to the log). Record the seed, City DNA, parameters, and task ID next to each image.

## Obsidian Rules

- The vault is this repository root (`.obsidian/` lives here). Do not create another vault.
- Write Obsidian/log entries in English.
- Prefer relative Markdown links (they resolve in GitHub, Obsidian, and VS Code). Keep filenames stable; avoid deep nesting.
- Do not paste large code, long logs, or full terminal output. Record only decisions, changes, parameters, test results, and screenshots.
- After moving or adding docs, run `node scripts/verify-markdown-links.mjs` (or the bundled Node under `.tools/`).
