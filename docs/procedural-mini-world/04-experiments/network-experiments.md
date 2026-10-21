# Network Experiments

Part of [04 Experiments](../EXPERIMENT-INDEX.md). Numbers are copied from the task entries in the [experiment log](../FINAL-EXPERIMENT-LOG.md) (§7). **Commit:** first in Git in `7b21c3e`. Review status: **pending review**.

System note: [Road & Tunnel](../03-generative-system/road-and-tunnel.md)

## 03.1 — One NetworkGraph, three strategies · Active

- **Date:** 2026-10-18
- **Question:** can one graph structure, driven by Grid / Organic / Canal-Street configs, produce deterministic, terrain-legal networks with edge ports?
- **Method / reused:** new `networkStrategies.js`, `NetworkGraph.js`, `NetworkGenerator.js`, `NetworkView.js`; `SurfaceQuery` (iceland-region), `RoadMeshBuilder` (road-mesh), `SeededRandom`.
- **Seed / params:** 1101 / 2202 / 3303 × 4 landforms × 3 DNAs. Manhattan grid: avenues 200 m / cross streets 80 m, slope ≤ 10°.
- **Test:** `verify-road-network.mjs`. 36 / 36 pass, 0 issues of every type. Grid plain: 148–175 edges, 18.4–19.5 km, 1 component, 0 % dead ends. Organic plain: 40–44 edges, ≈ 5.3 km, 44 % dead ends. Re-run 2026-10-19: pass.
- **Screenshots:** [03-1-network-overall.png](../../assets/screenshots/procedural-mini-world/03-1-network-overall.png) (seed 1101: grid / plain, organic / coast, canal-street / river valley); [03-1-network-strategies-debug.png](../../assets/screenshots/procedural-mini-world/03-1-network-strategies-debug.png) (river valley 1101, slope view).
- **Conclusion:** roads never on water or beyond the slope limit; water crossed only by bridge candidates; every edge port lies on its side.
- **Open issues:** the grid fragments on coast and river valley (14–15 components); organic and canal-street are tree-like; organic does not cross rivers.

## 03.3 — Loop closure for organic / canal-street · Active

- **Date:** 2026-10-18
- **Question:** can a local loop-closure step make tree-like networks form real enclosed blocks without faking closures?
- **Method / reused:** `closeLoops` in `NetworkGenerator.js`; 03.1 `searchPath` extended; 04.1 block generator re-run for Before / After (`?loops=off`).
- **Seed / params:** 1101 / 2202 / 3303. Organic: link ≤ 200 m, extension ≤ 120 m, perimeter 180–1 000 m, close ≤ 50 % of dead ends.
- **Test:** `verify-loops.mjs`. Organic coast 1101 / 2202 / 3303: cycles 0→4 / 0→5 / 0→13, enclosed blocks 0→4 / 1→6 / 0→13. Organic plain: cycles 0→8–10. Dead ends stay 25–38 %. Re-run 2026-10-19: pass.
- **Screenshots:** [03-3-loops-network-before-after.png](../../assets/screenshots/procedural-mini-world/03-3-loops-network-before-after.png), [03-3-loops-blocks-before-after.png](../../assets/screenshots/procedural-mini-world/03-3-loops-blocks-before-after.png) (organic coast 3303, canal-street river valley 3303).
- **Conclusion:** new links always create topology and keep the organic character (straightness < 0.99); grid and tunnels unaffected.
- **Open issues:** uneven gains (1–5 loops on some runs); enclosed areas small relative to the tile; loop limits are assumptions.

## 03.2 — Mountain roads and tunnel connectivity · Active

- **Date:** 2026-10-18
- **Question:** when steep terrain cuts the network, can a grade-limited surface road link it first, and a few checked tunnels only when justified?
- **Method / reused:** new `TunnelPlanner.js`; `CONNECTIVITY` in `networkStrategies.js`; 03.1 `GraphBuilder`, `MinHeap`, Dijkstra.
- **Seed / params:** mountain 1101 / 2202 / 3303 × 3 DNAs; W 128 m; tunnel limits in [Road & Tunnel](../03-generative-system/road-and-tunnel.md).
- **Test:** `verify-tunnels.mjs`. 9 / 9 pass. Seed 2202: 0 tunnels for every DNA. Seed 1101: 0 for grid (15 feasible alignments rejected), 1 for organic / canal-street (630 m, −0.38 %, min cover 11.2 m). Seed 3303: 1 for every DNA (146–150 m, 2.5–4.5 %). Re-run 2026-10-19: pass.
- **Screenshots:** [03-2-mountain-tunnels-overall.png](../../assets/screenshots/procedural-mini-world/03-2-mountain-tunnels-overall.png) (2202 / 1101 / 3303: 0 / 1 / 1); [03-2-tunnel-xray-profile.png](../../assets/screenshots/procedural-mini-world/03-2-tunnel-xray-profile.png) (mountain 3303 grid).
- **Conclusion:** tunnels are ordinary graph edges with portals, grade, and cover profile; surface roads are always tried first.
- **Open issues:** most mountain side demands stay unresolved; terrain not yet opened at portals (done in 05.1b-2).

## 05.1b-2 — Tunnel excavation and geometry · Active (one known defect)

- **Date:** 2026-10-18
- **Question:** can each tunnel edge become a real excavated passage (open cuts, portal faces, arch tube) while the solid stays a closed manifold?
- **Method / reused:** new `TunnelGeometry.js`; 05.1b-1 shell; earcut portal triangulation.
- **Seed / params:** A — plain 1101 grid, mountain 2202 grid (no tunnels); B — mountain 3303 grid, mountain 1101 organic, mountain 3303 organic; C, D — synthetic and raised-tunnel cases.
- **Test:** `verify-tunnel-excavation.mjs`. A: 67 074 vertices / 134 144 faces, χ = 2, identical to 05.1b-1. B: 3 tunnels built; e.g. mountain 3303 grid tube 120.5 m, grade 4.53 %, min tube cover 4.5 m. Re-run 2026-10-19: pass.
- **Screenshots:** [05-1b2-tunnel-portals.png](../../assets/screenshots/procedural-mini-world/05-1b2-tunnel-portals.png), [05-1b2-tunnel-xray.png](../../assets/screenshots/procedural-mini-world/05-1b2-tunnel-xray.png).
- **Conclusion:** tunnels are real openings in a valid closed solid; height field untouched.
- **Open issues:** grade change at portals 12.8–19 %; 0.25–1.15 m lips at the cut start. **Defect found later (06.2):** mountain 7922 + Chicago, cut solid non-manifold (χ 6); isolated in the world, not fixed. No screenshot of the failure (**missing**).
