# 1 · Project Statement

[← Home](./00-midterm-review.md) · [Next: System Workflow →](./02-system-workflow.md)

## Research question

> How can a city's characteristics be encoded as controllable procedural rules? When those rules change continuously, mix, or are stitched together, how is the city's identity kept, weakened, or re-formed?

The premise: a city's identity does not come only from its landmarks. It also comes from the **spatial relations** between terrain, water, streets, plots, and buildings. Manhattan is an orthogonal grid cut off by its shoreline. Venice is a lagoon where canals take the role of streets. Fez is a dense organic core of lanes and courtyards. If those relations become explicit parameters, they can be varied, combined, and tested.

## Three separations that shape the system

| Kept apart | Why |
| --- | --- |
| **Terrain ≠ city** | The landscape is generated city-neutral first. A City DNA is then *matched* to what the terrain offers (flat land, a river, a coast). It is not imposed on a city-shaped tile. |
| **Seed ≠ identity** | The seed only produces reproducible variation *inside* the rules. The same seed always gives the same world; a different seed gives a different site, not a different city. |
| **Terrain fit ≠ identity** | The match score says how well a terrain suits a DNA's spatial rules. It does not claim that the result *is* Manhattan. |

## Why these cities

The research base is a 60-city database in 10 families (water-network, grid, radial, organic, hillside, and others). It is a research database, not an implementation target ([longlist](../research/city-longlist-60.md)). Three prototypes were chosen because each one makes a different element the skeleton of the city ([selection note](../research/prototype-city-selection.md)):

| Prototype | Family | Skeleton of the city | Role in the system |
| --- | --- | --- | --- |
| Manhattan | Strong orthogonal grid | Street grid, cut by the shoreline | Baseline with the simplest data interface |
| Venice | Water network + islands | Canals and bridges instead of streets | Can water replace roads as the world's skeleton? |
| Fez (el-Bali) | Organic historic core | Branching lanes, dead ends, courtyards | Can the system leave the grid? |

Chicago, Amsterdam, and Lisbon were added later as **configurations** of the same three strategies (task 06.1), to test whether the rules generalise without new code.

**Status of the research:** implemented as documents, pending review; measurements proposed. The Manhattan study ([01.1](../research/manhattan-spatial-study.md)) identifies the sources (DEM, street centrelines, PLUTO lot data) but has not measured them yet. Most numeric thresholds in the City DNAs are therefore working assumptions, labelled as such in the code. Two-source verification is still pending for most cities.

[← Home](./00-midterm-review.md) · [Next: System Workflow →](./02-system-workflow.md)
