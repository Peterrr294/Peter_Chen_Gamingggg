# G02c-R Road Growth Review

- **Task:** G02c-R (review only, 2026-11-04).
- **Full report:** [G02c-ROAD-GROWTH-MILESTONE-REVIEW](./G02c-ROAD-GROWTH-MILESTONE-REVIEW.md).
- **Question:** Does the road system support continuous, terrain-aware and morphologically meaningful urban growth?
- **Recommendation:** **CONDITIONAL GO**. Pending human review; not Human Accepted.

## Key Results

**Continuity:**
- Every recorded join is continuous.
- Aligned same-city road ends joined on seed 6202:
  - 12-event replay: 36 → 51 → 62 of 97 (G02c-01 → G02c-02 → G02c-03a);
  - 60 free steps: 421 of 634.

**Terrain:**
- Max grade 7.36 % (limit 7.5 %).
- Committed chunks changed: 0.

**Fabric:**
- Committed buildings affected: 0.
- About 2.4 % of new building candidates excluded by corridors.
- Abnormal parcels: 0.

**Stability:**
- Steps reached with a 60-step budget: 6201 19, 6202 60, 6203 41.
- Determinism and save / load pass (6202).

## Defects Found (not fixed)

- Accepted chunks carry street pieces with no road link to the city: Manhattan 14 / 15 components, Chicago 6203 8. The cause is the base grid on split land; validation needs one join only.
- The Amsterdam core on seed 6203 still has **no road graph** (0 edges, no warning).

## Not Implemented

- **G02c-03b (two-junction corridor).**
- Waterfront growth for canal cities.

## Evidence

- Review Board: **Pending** (not rendered; see the report, section 9).
- Browser review: 9 of 10 checks pass; check 10 fails (cross-runtime signatures) and was not completed.
- Follow-up: [G02c-R1 Network Integrity](./G02c-R1-Network-Integrity.md).
- Records: `experiments/city-of-cities/evidence/road-growth-review.json`, `road-growth-review-browser.json`.
- Scripts: `scripts/review-road-growth.mjs`, `scripts/review-road-growth-browser.mjs`, `scripts/render-road-review-board.mjs`.

## Next

Stop for human review. G03c-02 is not started. Suggested next single task: refuse or trim unreachable street pieces in validation; then G02c-03b.
