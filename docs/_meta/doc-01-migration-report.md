# DOC-01 Migration Report — Procedural Mini World Knowledge Base

Task DOC-01, 2026-10-19 / 20. The result is browsed from the [knowledge base home](../procedural-mini-world/HOME.md). This report records what was found, what was mapped, and what still needs a human decision.

## 1. Vault and inventory (read-only step)

- **Active vault:** `D:\Documents\GitHub\Gameeeeeeee!` (the repository root; in the real folder name the "!" is a full-width exclamation mark; `"open": true` in Obsidian's vault list). No second vault was created.
- **Other vaults found:** `D:\Documents\GitHub\URBAN DATA` is registered in Obsidian with one note, `First day's test.md`, which is empty. Nothing to import. The `Gameeeeeeee!-venice-vertical-slice` worktree carries the tracked `.obsidian/` copy; it is not a separately registered vault.
- **Before any change:** 54 Markdown notes and 65 files under `docs/assets/` (119 files, md5 manifest kept in the session scratch). Git state: `HEAD` = `b59b26c` (= `origin/main`). Uncommitted at start: the M03 Midterm Review and its log / README / index edits.
- **Recovery:** no file was moved, renamed, or deleted. Every pre-existing note can be restored with `git checkout b59b26c -- <path>`, except the M03 notes, which were uncommitted at the start of this task.

## 2. Structure decision

The six target categories are realised **by index, not by moving files**: [HOME](../procedural-mini-world/HOME.md) lists each logical entry and points to its real path. Reason: existing paths are linked from 50+ notes, from the site's Files & Notes page, and from Git history. A move would add risk without adding information. New notes were created only where real content existed to fill them.

## 3. Old → target mapping

| Existing file | Target category / role | Action |
| --- | --- | --- |
| `docs/procedural-mini-world/FINAL-EXPERIMENT-LOG.md` | 01 Project Compass (§1–5) + 04 full log (§7) | kept; DOC-01 entry appended |
| `AGENTS.md`, `docs/standards/documentation/knowledge-base-rules.md` | 01 Design Principles (rules) | kept, linked |
| `docs/procedural-mini-world/research/city-research-template.md` / `.csv` | 02 City Research Template | kept |
| `research/city-longlist-60.md` | 02 60 Cities Database + City Families | kept |
| `research/prototype-city-selection.md`, `research/manhattan-spatial-study.md` | 02 (00.3, 01.1; no log entries) | kept; marked Pending verification |
| `docs/procedural-mini-world/EXPERIMENT-INDEX.md` | 04 Experiment Index | kept; links to the new category cards |
| `docs/procedural-mini-world/midterm-review/00-midterm-review.md` | 05 **Midterm Overview** (restructured into the 8 required sections, same path) | rewritten in place |
| `midterm-review/01` … `07` | 05 chapters (Research Argument, Workflow, Parameters, Experiments, Verified Results, Known Limitations, Next Development) | kept; ch. 5 targets table aligned with compass §3 |
| `docs/logs/2026-10-18.md`, `2026-10-19.md` | 04 dated session summaries | kept, linked |
| `docs/projects/flavor-clash/*`, `experiments/*/README.md`, `docs/learning/*`, `docs/logs/2026-09-*`, `2026-10-0*` | 04 Archived Experiments (Game Lab era) | kept, linked from [archived-experiments](../procedural-mini-world/04-experiments/archived-experiments.md) |
| `docs/infrastructure/**`, `docs/OPEN_SOURCE_SOURCES.md` | 06 Release & Resources (older infrastructure, references) | kept, linked |
| `docs/assets/screenshots/procedural-mini-world/*.png` (34) | 99 Attachments | kept; indexed once in [screenshot-index](../procedural-mini-world/99-attachments/screenshot-index.md) |
| `docs/_meta/current-project-state.md` | outdated (Game Lab state, 2026-10-07) | **superseded banner added**, content unchanged |
| `docs/README.md`, `docs/_meta/project-map.md`, root `README.md` | vault / repository entries | one link each to HOME |
| Other Game Lab notes (`docs/EXPLORATION-MAP.md`, `ASSIGNMENT-1-CHECKLIST.md`, `docs/standards/**`, project / learning indexes) | Game Lab history, outside the six PMW categories | unchanged |

**New notes (20):** `HOME.md`; `01-foundation/project-foundation.md`; `research/city-dna-library.md`; `03-generative-system/` (9 notes: architecture, 7 subsystems, City Influence as planned); `04-experiments/` (5 category notes with per-task cards); `06-release/` (release-and-resources, deployment-history); `99-attachments/screenshot-index.md`; plus this report.

## 4. Duplicates, conflicts, outdated, empty

| Finding | Decision |
| --- | --- |
| `docs/assets/screenshots/firebase-hosting-home.png` and `game-lab-home.png` are **byte-identical**; the Assignment 1 checklist presents them as two separate captures (local and hosted) | not changed; **needs human confirmation** (the "local" capture may never have existed separately) |
| `.obsidian/app.json` = `.obsidian/appearance.json` (both `{}`) | harmless, unchanged |
| Many folders contain `README.md` | not duplicates; relative links resolve unambiguously |
| No duplicate PMW screenshots; each of the 34 stored once | — |
| `Flavour Clash - Development Progress.md`: **orphan** (0 inbound links) and breaks the naming rule (spaces, capitals) | linked from Archived Experiments; not renamed (rename = move; needs approval) |
| `current-project-state.md` contradicts the compass (frozen at 2026-10-07) | superseded banner |
| Compass §5 vs §1 (T2–T6 "Not started") | resolved earlier in M02b; verified consistent now |
| Midterm ch. 5 semester targets paraphrased compass §3 | aligned to the six §3 items |
| 02.3 describes plain ponds; the current 02.4 plain has no water | both kept as history; system notes describe the current 02.4 rule |
| 02.2's original screenshot was overwritten by 02.2b at the same path | recorded as missing evidence |
| Empty notes / empty sections | none found in the vault's notes (the only empty file is in the unrelated URBAN DATA vault) |

## 5. Integrity checks (after the change)

- `node scripts/verify-markdown-links.mjs`: all relative links and image targets resolve (see the DOC-01 log entry for the final count).
- Obsidian wikilinks: 0 in the vault (relative Markdown links only, as the vault rules prefer).
- Orphan notes: 0 (excluding the root `README.md` / `AGENTS.md` entry points).
- PMW screenshots: 34 on disk = 34 rows in the screenshot index; every one is referenced from at least one note.
- Files present from the pre-change manifest: 119 / 119 (none moved or deleted). Markdown notes: 54 → 75.
- External URLs (2026-10-20): live site, single-tile page, and rollback channel return HTTP 200. The GitHub repository returns 404 to anonymous requests (private). Research-source links on whc.unesco.org, www.nyc.gov, loc.gov, and usgs.gov return 403 to automated requests: **Unverified** (likely bot blocking, not checked in a browser).

## 6. Open items for human confirmation

1. Whether the duplicate Assignment 1 homepage screenshot hides a missing local capture.
2. Whether to rename `Flavour Clash - Development Progress.md` to the vault naming rule (no inbound links would break).
3. Origin and licence of the third-party 3D models in `experiments/terrain-seam/`: **TBD** ([Release & Resources](../procedural-mini-world/06-release/release-and-resources.md)).
4. Log entries for research tasks 00.3 and 01.1, and acceptance of all tasks: every one is still "pending review".
5. How the public Terrain Seam page should behave without its models (open since M02b).
6. 403 research-source URLs: check once in a browser.
