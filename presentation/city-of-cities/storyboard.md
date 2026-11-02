# A City of Cities — Storyboard

*The Emergence of a Plural Urban World through Procedural Growth*

**Film:** 75 s · 1920 × 1080 · 30 fps · H.264 MP4 · no sound.

**Source:** every image is rendered from the real generators of the Procedural Mini World (commit `91efb1e`, branch `experiment/procedural-growing-world`). Everything uses world seed 6201:

- G01 origins (placement v2);
- 30 growth steps of the verified G02 `WorldGrowthController`. The film's growth history is checked against `experiments/city-of-cities/evidence/city-growth.json` before encoding.

**Look:** orthographic axonometric camera (elevation 32°) on a neutral dark background, with muted city colours (the project palette mixed 35 % toward grey).

Stills: [storyboard/](./storyboard/) (rendered frames) and [storyboard/decoded-from-mp4/](./storyboard/decoded-from-mp4/) (frames decoded from the final MP4).

| Time | Scene | Image (real output) | Text on screen | Camera |
| --- | --- | --- | --- | --- |
| 00:00–00:04 | Title | Dark card | **A CITY OF CITIES** · *The Emergence of a Plural Urban World through Procedural Growth* · "Procedural Mini World · Research Film" | — |
| 00:04–00:12 | S01 The Land Before the City | Terrain of chunk c_5_0 (coast; the Lisbon core cell), terrain classes only: water, buildable, shore, steep | "Every urban world begins with a landscape." · tag: TERRAIN · WORLD SEED 6201 · CHUNK c_5_0 · COAST · 1024 × 1024 M | Fade in; slow orbit, azimuth 28° → 38° |
| 00:12–00:28 | S02 From Terrain to Urban DNA | Same chunk, same seed, six stages of 2.67 s with 0.5 s cross-fades:<br>01 Terrain<br>02 Terrain analysis (slope / buildability classes)<br>03 Road network<br>04 Urban blocks<br>05 Parcels (grey = interior land without lots; presentation palette)<br>06 Buildings | Stage row 01–06 (active stage white) and a one-line description · "Urban form emerges from spatial rules." · tag: CITY ID: LISBON · 6.8 km roads · 17 blocks · 836 parcels · 705 buildings | Slow orbit, azimuth 38° → 52° |
| 00:28–00:34 | S03 Six Autonomous Urban Origins (a) | The six G01 core chunks at their real world positions (no 3 × 3 grid) | City labels (VENICE … CHICAGO) · "Six cities. Six distinct urban identities." · tag: G01 · six city origins · placed by terrain suitability, not a 3 × 3 grid | Pull-out from Lisbon to the six origins (azimuth 52° → 45°) |
| 00:34–00:42 | S03 (b) | Six panels (3 × 2), each a core chunk with its real roads, blocks and buildings | Per panel: city, City ID, landform, km roads / blocks / parcels / buildings | Per panel: fitted axonometric, slow rotation |
| 00:42–01:02 | S04 Procedural Urban Growth | Origins → growth steps 1–30, each new chunk rising at its real step (steps 1–5 every 1.0 s, 6–10 every 0.6 s, 11–30 every 0.4 s), outline flashing white, then city colour | GROWTH STEP nn / 30 · chunk count · "STEP n: CITY → chunk" · "Independent cities grow through local rules." · "Collective form emerges without a predetermined master plan." · city legend · tag: G02 · procedural growth prototype · real generated chunks | Fixed on the final 36-chunk extent (azimuth 45°), slow 4 % zoom-in; no jumps |
| 01:02–01:15 | S05 A City of Cities | Final world (36 chunks) | Opening tag: CLOSE-UP START: CHICAGO c_5_-5 (the growth chunk with the most buildings) · city labels · **A CITY OF CITIES** · "Not a collection of cities, but a world emerging through their relationships." · tag: Procedural Growth Prototype · world seed 6201 · 6 origins · 30 growth steps · 36 chunks | Close-up on Chicago c_5_-5 (azimuth 30°) → pull-out to the whole world (azimuth 45°); fade to black at 01:14.2 |

**Honesty notes:**

- **Real growth:** S04 and S05 show 30 steps that exist in the verified G02 run; no step, chunk or geometry is invented.
- **Animation only:** the "rise" of a new chunk (scale 0 → 1 over 0.35 s) is an animation of that real chunk.
- **Status:** the final screen marks the world as a prototype.
- **Visible seams:** the cliffs between chunks are the recorded, unrepaired seam conflicts (G02 limitation).
