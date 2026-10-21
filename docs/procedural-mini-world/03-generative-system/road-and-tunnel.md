# Road & Tunnel Network

Part of [03 Generative System](./system-architecture.md) · Status: **Verified** (organic / canal-street sparse; one known tunnel defect)

## Purpose

Lay out the city's movement skeleton on the terrain: streets, canals, bridges, mountain roads, and tunnels. Everything is held in one graph structure, whatever the strategy, and every segment must be legal on the terrain.

## Inputs → outputs

- **Inputs:** fields, `terrainAnalysis`, `cityMatch` (selected DNA → strategy and parameters), config, `{ loops }`.
- **Output:** `generateNetwork(fields, analysis, cityMatch, config, { loops })` returns a **NetworkGraph**: nodes, edges (`kind`: road / canal / bridge / tunnel, with class and width), `edgePorts` (where streets reach the tile edge, each with a redirect anchor at the transition inner line; `neighborPortId` reserved, unused), `connectivity.decisions`, `stats`, and `signature`.

## Rules

- **Strategies** (`networkStrategies.js`; DNA → strategy in `DNA_STRATEGY`, per-DNA overrides in `DNA_NETWORK_OVERRIDES`):
  - **Grid:** two orthogonal street families, truncated by water and slope.
  - **Organic:** least-cost paths (Dijkstra with slope and climb penalties) between gates and centres, with dead ends kept.
  - **Canal-street:** canals with quays and bridges at intervals.
  - Values per DNA: [City DNA Library](../research/city-dna-library.md).
- **Validation:** every edge is sampled every 2 m and must stay off water and within the strategy's slope limit. Water is crossed only by bridge candidates. Components shorter than 150 m are removed and counted.
- **Loop closure (03.3, organic / canal-street):** local links that must create a new cycle through shared cells. They never cross water or the transition zone and never remove edge ports.
- **Mountain connectivity (03.2):** a surface mountain road comes first: width 6 m, grade ≤ 15 %, cross-slope ≤ 30°. Only then is a tunnel tried, accepted only if justified: at most 2 per tile, length 80–700 m, grade ≤ 6 %, crown clearance 7 m, cover ≥ 10 m outside 30 m portal zones, and either cheaper than 0.6 × the surface cost or no surface route. All values are tagged A.
- **Excavation (05.1b-2, rendering):** `TunnelGeometry.js` cuts open approaches, portal faces, and an arch tube into the closed solid and re-checks that the solid stays watertight.

## Upstream / downstream

- **Upstream:** [Terrain & Water](./terrain-and-water.md), [Terrain Analysis](./terrain-analysis.md), [City DNA Matching](./city-dna-matching.md). It reuses `SurfaceQuery` (iceland-region), `RoadMeshBuilder` (road-mesh), and `SeededRandom` (flavor-clash) ([Archived Experiments](../04-experiments/archived-experiments.md)).
- **Downstream:** [Block & Parcel](./block-and-parcel.md) (surface roads with real widths, node and edge ids), [World Grid & Seam](./world-grid-and-seam.md) (edge-port report).

## Code

`experiments/seed-terrain/networkStrategies.js`, `NetworkGraph.js`, `NetworkGenerator.js`, `TunnelPlanner.js`, `TunnelGeometry.js`, `NetworkView.js` · verifiers `verify-road-network.mjs`, `verify-loops.mjs`, `verify-tunnels.mjs`, `verify-tunnel-excavation.mjs` · in Git since `7b21c3e`.

## Representative experiments

03.1, 03.3, 03.2, 05.1b-2, see [Network Experiments](../04-experiments/network-experiments.md).

![Networks](../../assets/screenshots/procedural-mini-world/03-1-network-overall.png)

*Seed 1101 · grid on plain, organic on coast, canal-street on river valley.*

## Verified / known limitations

- **Verified:** 03.1: 36 / 36 runs, 0 issues of every type. 03.3: e.g. organic coast 3303 cycles 0 → 13, dead ends 44 → 25 %. 03.2: 9 / 9 mountain runs; 0–1 tunnel per seed. 05.1b-2: 3 tunnels excavated with the solid closed.
- **Limits:** the grid fragments on coast and river valley (14–15 components). Organic and canal-street stay sparse, and loop gains are uneven. Organic does not cross rivers. Most mountain side demands stay unresolved. Portal grade change reaches 12.8–19 %. Known defect: mountain 7922 + Chicago leaves the cut solid non-manifold (χ 6); in the world it is detected and isolated, not fixed (06.2, 06.3a). Edge ports are not paired across tiles.
