# 7 · Next Steps

[← Limitations](./06-limitations.md) · [Home](./00-midterm-review.md)

All items below are **Proposed**. They are ordered so that each one builds on a verified previous step, and each will be one task with its own check, as before.

## 1. Cross-tile coordination of terrain and streets

- **Unjoinable edges:** decide how they are handled. Options: a wider band chosen explicitly by the designer, a landform-compatibility rule when tiles are assigned (e.g. mountain next to plain needs an escarpment), or a dedicated escarpment / shoreline rule. *(Next task recorded in the log, 06.3a.)*
- **Street continuity:** pair edge ports across each shared edge and redirect a street to its partner, starting with the plain | plain edge, where 6 ports already match by position. Then measure how many streets continue and how far they bend.
- **Water continuity:** let a river continue into a neighbour only where a channel can follow the terrain.

## 2. City influence field

Replace "one city per tile" with a field: each city radiates its rules (street spacing, lot size, height) outward, weakening with distance and terrain resistance (water, steep slopes). Where two fields overlap, the stronger or better-fitting rule wins locally. Spatial question to test: *how far can Manhattan's grid reach into a river valley before it stops reading as a grid?*

## 3. City boundary expansion and mixing

- **Expansion:** let a city grow across tile edges along suitable terrain. Its boundary then emerges from terrain and competition rather than from the tile grid.
- **Mixing:** blend two DNAs inside a shared band, for example grid spacing interpolated into organic lanes. Measure where identity is kept, weakened, or becomes a new pattern. This is the core research question ([Project Statement](./01-project-statement.md)).

## 4. Evidence to complete before the final review

- Manhattan measurements (DEM slope, street-centreline spacing and orientation, PLUTO lot sizes and heights), to replace assumed DNA values.
- A short video walk-through of the 3 × 3 world (required by compass stage T7).
- Human review of tasks T1–T7, recorded in the log.

[← Limitations](./06-limitations.md) · [Home](./00-midterm-review.md)
