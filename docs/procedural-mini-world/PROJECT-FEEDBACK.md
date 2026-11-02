# Procedural Mini World — AI Project Feedback

Written by an AI assistant (Claude Code) on 2026-10-28, task DOC-06, at the author's request. **This is not a teacher's comment, not the author's observation, and not a review decision.** Review decisions (Accepted / Rejected) are recorded only in the [compass and log](./FINAL-EXPERIMENT-LOG.md); none has been made yet.

Parent: [Knowledge base home](./README.md) · Exercises and commits: [root README](../../README.md#exercises) · Task table: [Experiment Index](./EXPERIMENT-INDEX.md)

## How to Read This Page

Each finding is tagged:

- **[Confirmed]** directly stated by a log entry, verifier result, or visible in the cited screenshot.
- **[Inference]** the AI's interpretation of confirmed facts; may be wrong.
- **[Next check]** the smallest check that would settle the gap. It is a suggestion; nothing was built for it.
- **[Pending]** not yet verified by anyone.

What the AI reviewed: the log §1, §5 and §7 entries, the experiment notes linked below, the cited screenshots (opened and looked at), `git log` and remote branches, and the public URLs (HTTP status and page titles on 2026-10-28). It did **not** run any verifier, read generator code in depth, or judge visual quality in the running app.

## Feedback by Research Area

| Area | Evidence reviewed | What works | Gap or concern | Smallest next check |
| --- | --- | --- | --- | --- |
| Research basis | [60-city longlist](./research/city-longlist-60.md), [prototype selection](./research/prototype-city-selection.md), [Research Compass](./A-City-of-Cities-Research-Compass.md) §15 | **[Confirmed]** Clear separation of source facts, inferences and design choices; the compass states its own rule conflicts | **[Confirmed]** No measurement made yet; every DNA threshold and all Growth DNA profiles are tagged as assumptions (KB home §8; G02 limitation 8). **[Inference]** H1–H3 cannot be answered for real cities while no rule is calibrated | **[Next check]** Measure one Manhattan value (block size from street centrelines) and compare it with the `manhattanGrid` rule |
| Terrain | Log 02.4, [System Architecture](./03-generative-system/system-architecture.md), `02-4-landforms-overall.png` | **[Confirmed]** Frozen chunk spec, four landform algorithms, same-seed reproducibility on 12 pairs | **[Confirmed]** Grown worlds use independent chunks with raw terrain: 0 of 60 edges continuous in G01, 0 continuous in G02 | **[Next check]** On seed 6201 at step 30, count how many G02 edges R2 band correction *could* join, without applying it |
| Water | Log 06.3a, G01 open issue 2, G03a §6 | **[Confirmed]** Water mismatches are measured, never hidden | **[Confirmed]** 18 of 60 G01 edges have wet / dry mismatches; the G03a `waterBody` rule (≥ 50 %) never fires on the test seeds | **[Next check]** Report the water-share distribution of probed cells, to see whether the 50 % threshold can ever trigger |
| City DNA matching | Log 02.6, 06.1, G01-MO, G02-V; `g01-origins-suitability-debug.png` | **[Confirmed]** Ranking is transparent; six DNAs run on shared terrain | **[Confirmed]** Score does not predict output: empty Amsterdam chunks in G01 (5 of 8), G01-MO (seed 1234 core), G02-V (6201: 2; 6203: core + 2), M06. **[Confirmed]** Plain sites saturate at 0.9872 (screenshot) | **[Next check]** Count chunks with 0 buildings per DNA and landform on the three G02 seeds (data already in `city-growth.json`) |
| Network and tunnels | Log 03.1–03.3, 05.1b-2, 06.3b | **[Confirmed]** One graph type for three strategies; loop closure measured; unjoined ports carry reasons | **[Confirmed]** One tunnel defect isolated, not fixed (mountain 7922 + Chicago). Roads are not joined across chunks in the growing world (94–127 unpaired ports in G02-V) | **[Next check]** In G03a data, list the 2 edges with aligned ports and check if 06.3b `RoadSeam` would accept them |
| Blocks and parcels | Log 04.1, 04.1b, 04.2; `04-2-parcels-strategies.png` | **[Confirmed]** 100 % valid frontage; nothing deleted, fragments classified | **[Confirmed]** Interior reserve access is an open decision since 04.2 | **[Next check]** Report the share of parcel area without frontage per DNA |
| Buildings | Log 05.1; `05-1-buildings-overall.png` | **[Confirmed]** Clear morphological contrast (mean 60 m vs 6 m vs 11 m on seed 1101) | **[Confirmed]** Heights are assumptions, not measured | **[Pending]** Compare one DNA's height distribution with a public dataset (for Manhattan, PLUTO is already named in the research notes) |
| Joining and seams | [World Grid & Seam](./03-generative-system/world-grid-and-seam.md), log 06.3a–06.3c; `06-3c-seam-classes-overall.png` | **[Confirmed]** Each fix stayed runnable as a mode; 06.3c splits geometry, landform, water and transport | **[Inference]** The seam work answers "how to report a seam" well but the semester target "≥ 3 tiles joined" is only partly met in the static world and not at all in the grown world | **[Next check]** State in the compass which world (static R2 or grown) counts for compass §3 item 4 |
| City Influence | [City Influence & Fusion](./03-generative-system/city-influence.md), log 07.1, 07.1a; `07-1a-original-vs-fused-compare.png` | **[Confirmed]** Spatial ids reduce unexplained changes in the w = 0 zone from 46 to 0 (seed 6201) | **[Confirmed]** Local only (`79687a0` not pushed), one source / one target; the default-id decision is open. **[Inference]** It is the only test of the "mix" half of the original question and is now parked | **[Next check]** Decide in review whether 07.1a stays history or feeds G03b encounters |
| Growth (G01–G02) | [G01](./A-City-of-Cities/G01-Multi-Origin-Initialization.md), [G02](./A-City-of-Cities/G02-Procedural-Urban-Growth.md), log G02-V; `g02-growth-seed-compare.png` | **[Confirmed]** Reproducible, traceable, save / load exact, Node = browser; a placement failure stopped the work instead of being patched | **[Confirmed]** Chunk counts per city are near-identical on all seeds (Manhattan and Chicago 8 each). **[Inference]** City *size* is set by the scheduler, not by terrain, which weakens the claim that territory emerges from rules | **[Next check]** Re-run 30 steps on one seed with the bid weighted by suitability only and compare chunk counts (an experiment switch, not a new rule) |
| Territory (G03a) | [G03a](./A-City-of-Cities/G03a-Urban-Territory.md), log G03a; `g03a-city-relationships.png`, `g03a-territory-step30.png` | **[Confirmed]** Every per-step derivation checked independently; adjacency never claimed as connection | **[Confirmed]** 1 / 4 / 0 shared edges at step 30; only `steepTerrain` fires. **[Inference]** At this scale H3 (diversity of relations) has too few contacts to measure | **[Next check]** Run the analysis to 60 steps on 6202 (the seed with most contacts) and count shared edges, data only |
| Visualisation and tuning | G01 / G02 / G03a panels and overlays; `g02-growth-frontier-debug.png`, `g03a-frontier-constraints-debug.png` | **[Confirmed]** Debug overlays show scores, rejection reasons and history; public parameters stay within ≤ 10 per generator (G01-MO 4, G02 5 weights) | **[Confirmed]** Synchronous generation: 2–8 s UI pause per step, ~15 MB per chunk, no unloading | **[Pending]** Not assessed in the running app by the AI |
| Verification | `scripts/verify-*.mjs` results as logged | **[Confirmed]** Every task has a verifier; determinism, order and save / load are tested | **[Confirmed]** Verifiers check data, not spatial quality; **0 tasks Accepted or Rejected** across 49 log entries | **[Next check]** Review one stage (G02) and record Accepted / Rejected with reasons in the log |
| Documentation and Git | Root README, this folder, `git log`, `git branch -r --contains` | **[Confirmed]** One compass for status; per-task log entries; screenshots with conditions | **[Confirmed]** Four commits (`79687a0` … `91efb1e`) are local only, so their GitHub links fail; G03a is uncommitted; the public site shows the M06 state | **[Next check]** Push `experiment/procedural-growing-world` when the author decides, then re-check the commit links |
| Presentation film | [presentation README](../../presentation/city-of-cities/README.md), log PRESENTATION-01 | **[Confirmed]** Built from the real seed-6201 history; checked against the verifier record; honesty notes on screen | **[Confirmed]** Uncommitted; the MP4 is git-ignored, so the film is not reproducible from the repository alone without re-rendering | **[Next check]** Record where the delivered MP4 is stored |

Not assessed: Firebase Authentication / Firestore terrain saves, the earlier Game Lab studies, code style and maintainability, and performance on other hardware.

## Three Most Important Findings

1. **Review backlog, not code, is the bottleneck.** **[Confirmed]** No task has been accepted or rejected. Every new stage builds on unreviewed stages, so a later reversal would cascade.
2. **City size is set by the scheduler.** **[Confirmed]** Near-identical chunk counts across seeds (G02 limitation 1). **[Inference]** This is the main threat to the claim that territory and boundaries *emerge* from rules.
3. **Suitability does not predict whether a city appears.** **[Confirmed]** Empty Amsterdam chunks in four separate tasks and saturated plain scores. **[Inference]** Until generator output feeds back into the score, the growth map can contain "cities" with no streets.

## Author Response

> Observation to complete after testing: which findings do you accept, reject, or want re-checked?
