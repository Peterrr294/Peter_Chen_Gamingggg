# Deployment History — Firebase Hosting `gameeeee-zc626`

Part of [06 Release & Resources](./release-and-resources.md). Times are local (−0400), as reported by `firebase hosting:channel:list` and the task log entries M01 / M02b in the [experiment log](../FINAL-EXPERIMENT-LOG.md).

| Release (live channel) | Source | Method | Homepage entry | Verified online | Recover with |
| --- | --- | --- | --- | --- | --- |
| 2026-09-28 23:14:19 | Game Lab hub (before Procedural Mini World; no Mini World pages) | **TBD** (CLI or CI not recorded) | `/assets/main-D55VH64K.js` | 2026-09-29 audit: 4 routes HTTP 200 ([Assignment 1 checklist](../../ASSIGNMENT-1-CHECKLIST.md)) | preview channel `m01-rollback` (below) or Console → Hosting → Release history |
| 2026-10-19 21:43:20 | **M01**: working tree of `experiment/terrain-seam`, tag `release/m01-2026-10-19` = `7b21c3e` | local `firebase deploy --only hosting` | `/assets/main-CIzbo2qH.js` | smoke test 11 / 11, 22 / 22 requests 200, 0 errors | Console release history |
| 2026-10-19 22:51:43 | **M02b**: `main` fast-forwarded to `b59b26c` | GitHub Actions `firebase-hosting-merge.yml` on push to `main` | `/assets/main-CF2seIHF.js` | `verify-live-release.mjs` 10 / 10, 51 / 51 requests 200, 0 errors | Console release history |

**Rollback copy:** preview channel `m01-rollback` = clone of the 2026-09-28 release, made on 2026-10-19 21:32:33. URL: <https://gameeeee-zc626--m01-rollback-tyjrl79u.web.app>. It **expires 2026-10-26 21:32:32**; after that, use the Console release history.

**Not changed by any release:** Firestore rules, Authentication, Storage. Every deploy was Hosting only.

**Known defect since M01:** `/experiments/terrain-seam/` is in the build, but its 3D models are not deployed, so the page stops at load ([Archived Experiments](../04-experiments/archived-experiments.md)). It was absent before M01.

**Re-check the live site:** `npm run verify:live` (or `node scripts/verify-live-release.mjs <url>`).
