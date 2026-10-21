# 6 · Limitations

[← Midterm Results](./05-midterm-results.md) · [Home](./00-midterm-review.md) · [Next: Next Steps →](./07-next-steps.md)

Nothing below is hidden in the output. Each problem is measured and drawn in the debug views.

## Seams between tiles · Implemented (partial)

Each tile is generated alone, from its own seed and landform, and then joined to its neighbours inside the transition band. In world 6201, **8 of 12 shared edges cannot be joined**: a join within 32–256 m would create slopes steeper than 35° (≈ the angle of repose). These are every mountain edge (height steps 164–296 m) and the river-valley edges with steep banks. They keep their raw step and are drawn red. Only **1 of 4** inner corners closes. Where it does join, the surface is continuous in height. Slope continuity is not reached near corners (kink up to 8.6°) or on height-only joins (up to 41.8° in other world seeds).

![Seam debug, world 6201](../../assets/screenshots/procedural-mini-world/06-3a-seam-debug.png)

*World seed 6201, transition width 128 m. Edge status, band limits, water state; red risers = unresolved height steps.*

**Water** stays discontinuous on 4 of 12 edges. In some cases the levels are simply incompatible: a river at ≈ 30 m meeting the sea at 0 m. Rivers end at a tile edge where the neighbour has no channel. No channel is invented to hide this.

## Street-network ports · Proposed

Every network marks *edge ports* where streets reach the tile boundary, but ports are **not paired or redirected** across edges yet. So no street continues into the next tile. In 06.2 (world 6201), only 7 port pairs matched by position, on 2 edges; 6 of them are on the Chicago | Manhattan plain edge, all offset by 9.5 m. 9 edges were flagged as unpaired or mismatched in height.

## Known tunnel failure · Implemented (partial): isolated, not fixed

On mountain terrain seed 7922 with the Chicago grid, the tunnel geometry accepts one tunnel but the cut terrain solid is not closed (non-manifold edges, χ = 6 instead of 0). The same failure appears on the single-tile page, so it is an existing defect in the tunnel step, exposed by a new terrain and DNA combination. In the world (seed 6202, tile `chunk_0_-1`) the failure is detected and that one cut is removed, keeping the terrain closed. The tunnel stays in the street data. *No screenshot of this case exists (evidence pending).*

## City Influence and expansion · Proposed

A city is currently confined to its own tile. A **city influence field** that reaches into neighbouring tiles, boundary expansion, and the blending of two DNAs across an edge are **not implemented**. In the code this is a reserved interface only. The research question about mixing and stitching identities is therefore not yet answered by the output.

## Research calibration · Implemented (partial)

Most City DNA numbers (spacing, lot sizes, heights, match weights) are labelled assumptions. Manhattan's grid height distribution (mean ≈ 60 m) has not been compared with PLUTO data. Chicago, Amsterdam, and Lisbon have no research row or source anchor yet. Some identity rules are absent from the output, for example Amsterdam's concentric ring canals.

## Other

- **Sparse organic and canal networks:** 78–86 % of their buildable land stays reserve (beyond one lot depth from any street), and canal-street lots almost never face the water.
- **Performance:** the first build of the whole world takes ≈ 17–25 s on the browser's main thread.
- **Older Terrain Seam page:** an older experiment, not part of this pipeline, does not load on the public site because its 3D models are not deployed.
- **No human review recorded:** every task is still "pending review".

[← Midterm Results](./05-midterm-results.md) · [Home](./00-midterm-review.md) · [Next: Next Steps →](./07-next-steps.md)
