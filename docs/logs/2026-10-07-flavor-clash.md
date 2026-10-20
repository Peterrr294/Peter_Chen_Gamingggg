# 2026-10-07 — Flavor Clash: From Regional Terrain to a Road Mesh

## Context

Today's work turned Flavor Clash from one large map prototype into a small chain of focused experiments. The goal was not to expand the game, but to isolate how one seeded region can provide reliable terrain data, accept a road definition, project that path onto its surface, and finally produce drawable road geometry.

All four experiments remain independent pages, but they now sit under one **Flavor Clash** entry on the website.

## Experiment Chain

```mermaid
flowchart LR
  MAP["Four-region prototype"] --> TERRAIN["Iceland terrain"]
  TERRAIN --> QUERY["Surface query + road JSON"]
  QUERY --> PROJECT["Projected road samples"]
  PROJECT --> MESH["Road ribbon mesh"]
```

| Stage | What changed | Verified result |
| --- | --- | --- |
| [Four-Region Map](../../experiments/flavor-clash-prototype/) | Kept the bounded Iceland, Tokyo, Venice, and Hawaii study with seeded terrain, local WFC roads, plaza splines, and instanced scattering. | Four regions generate independently; visual screenshots remain pending. |
| [Iceland Region Lab](../../experiments/iceland-region/) | Isolated one finite noise-based height field so later road work could use stable terrain data. | Default terrain signature: `5F61302E`. |
| Surface Query and Road Input | Added interpolated height, normal, slope, bounds, water, and passability queries plus normalized `0–1` road control points. | Terrain and road data remain independent; road edits do not rebuild terrain. |
| [Road Projection Lab](../../experiments/road-projection/) | Sampled the road in XZ, queried every point against the terrain, and marked slope or water failures. | 47 projected samples, one invalid range, and two invalid adjacent segments in the default case. |
| [Road Mesh Lab](../../experiments/road-mesh/) | Converted valid projected samples into a two-sided ribbon with surface normals, continuous UVs, and bounded miter joins. | 92 vertices, 88 triangles, and 43.546 m of valid road; two invalid segments are skipped and shown in red. |

## Key Decisions

- Keep terrain generation, road input, projection, and mesh construction separate so changing one stage does not silently rerun the others.
- Use the existing height array and interpolation for surface queries instead of repeated raycasting.
- Store road control points in normalized XZ coordinates; derive height and normals from the terrain.
- Freeze the projected path before mesh construction. Road Mesh rebuilds never modify or re-project it.
- Limit miter length at sharp turns, and postpone formal intersection geometry, terrain flattening, shoulders, buildings, WFC integration, and scattering.

## Verification

The production build and browser checks passed. Repeated input produced the same terrain, projection, and mesh signatures; parameter changes did not regenerate terrain or mutate the original road data. Rebuilding the road disposed its previous geometry, material, and debug objects without accumulating scene children.

> Observation to complete after testing: Compare the projected centerline and final road surface visually, then note where the road still floats, clips, overlaps, or turns too sharply.

## Next Session

Review the four linked pages in order and capture one image per stage. The next technical question should be whether the road needs terrain-aware smoothing or terrain flattening—not additional world systems.
