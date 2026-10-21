# City Influence (future stage)

Part of [03 Generative System](./system-architecture.md) · Status: **Proposed, not implemented**

Nothing in this note describes working code. It records what exists as a reserved interface and what the next stages are meant to answer.

## Why it is needed

Today a city is confined to its tile: the City ID selects one DNA for one 1024 m chunk ([World Grid & Seam](./world-grid-and-seam.md)). The research question also asks how identity behaves when rules **mix or are stitched together** ([Project Foundation](../01-foundation/project-foundation.md)). That requires a city whose rules reach beyond its tile and meet another city's rules.

## What exists in the code (interfaces only)

| Item | Where | State |
| --- | --- | --- |
| `applyNeighborConstraints(fields, neighbors)` | `seed-terrain/TerrainFields.js` | Returns the tile unchanged without neighbours; **throws** if neighbours are passed ("reserved for a later task") |
| Edge port `neighborPortId` and redirect anchor | NetworkGraph edge ports (03.1) | Reserved, never set; ports are not paired across tiles |
| City influence | concept defined in 06.2 as "a future cross-chunk field" | No data structure, no code |

## Proposed sequence (from the current design)

```text
City Placement → Seam Connection → City Influence → City Expansion → Morphological Transition
   (06.2, done)    (06.3a, partial)     (proposed)        (proposed)          (proposed)
```

- **Seam Connection, remaining part:** decide what to do with unjoinable edges; pair and redirect street ports across edges.
- **City Influence:** a field per city (street spacing, lot size, height) that weakens with distance and terrain resistance.
- **City Expansion:** a city boundary that follows suitable terrain and competition with neighbours, instead of the tile grid.
- **Morphological Transition:** where two fields overlap, measure where an identity is kept, weakened, or re-formed.

No parameters, results, or screenshots exist for these stages: **TBD**.
