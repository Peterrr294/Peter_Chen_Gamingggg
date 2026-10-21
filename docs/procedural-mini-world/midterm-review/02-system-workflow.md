# 2 · System Workflow

[← Project Statement](./01-project-statement.md) · [Home](./00-midterm-review.md) · [Next: Key Parameters →](./03-key-parameters.md)

```text
Seed → Terrain → Terrain Analysis → City DNA → Network → Block → Parcel → Building → World Grid
```

Each step reads only the steps before it and never edits them. That is why a city can be swapped on one tile without regenerating its landscape. Each step has its own automated check (`scripts/verify-*.mjs`). Every image below is a real capture from that check, and its parameters are given in the caption.

## 1. Seed → Terrain · Verified

A 1024 m × 1024 m tile of real-metre heights from one of four landform rules: plain, river valley, coast, mountain. Water appears only where a rule puts it: a river in the valley, sea on the coast. The seed moves features around inside the rule. *Task 02.4.*

![Four landforms](../../assets/screenshots/procedural-mini-world/02-4-landforms-overall.png)

*Seed 1101 · variation 0.5 · transition width 128 m · plain, river valley, coast, mountain.*

## 2. Terrain Analysis · Verified

The tile is read as a site: slope, water, buildable land, shoreline and river direction. A direction is reported only when the evidence passes a threshold. *Task 02.5.*

![Suitability](../../assets/screenshots/procedural-mini-world/02-5-suitability-debug.png)

*Seed 1101 · variation 0.5 · dark green = highly suitable, light green = medium, orange = needs grading, maroon = unsuitable, blue = water.*

## 3. City DNA · Verified (6 DNAs; thresholds partly assumed)

Each DNA lists terrain conditions with weights. The tile is scored for every DNA, and the best fit is chosen automatically (`auto`) unless a DNA is chosen by hand. *Tasks 02.6, 06.1.*

![Six City DNAs on one terrain](../../assets/screenshots/procedural-mini-world/06-1-six-cities-shared-terrain.png)

*Coast, seed 1101, the same terrain for all six: Manhattan, Chicago, Venice, Amsterdam, Fez, Lisbon. Only the City DNA differs.*

## 4. Network · Verified (organic networks still sparse)

One street graph with three strategies. **Grid** (Manhattan, Chicago) uses fixed block spacing, cut by water and steep land. **Organic** (Fez, Lisbon) uses least-effort paths between gates and centres, with dead ends. **Canal-street** (Venice, Amsterdam) has canals with quays and bridges. On mountains, a road first tries a grade-limited surface route; a tunnel is accepted only when the check justifies it. *Tasks 03.1–03.3, 05.1b-2.*

![Networks](../../assets/screenshots/procedural-mini-world/03-1-network-overall.png)

*Seed 1101 · grid on plain, organic on coast, canal-street on river valley · white primary, orange secondary, sand lanes, cyan canal, pink bridges.*

## 5. Block · Verified

Closed blocks are cut out between real street widths, water, and the tile edge. Each block records how much of it is actually buildable. *Tasks 04.1, 04.1b.*

![Blocks](../../assets/screenshots/procedural-mini-world/04-1-blocks-strategies.png)

*Seed 1101 · grid / organic / canal-street.*

## 6. Parcel · Verified

Plots are laid out along street frontage at the DNA's lot scale; for example Manhattan ≈ 16 m frontage, 28 m depth. Land beyond one lot depth from a street stays reserve. It is not forced into plots. *Task 04.2.*

![Parcels](../../assets/screenshots/procedural-mini-world/04-2-parcels-strategies.png)

*Seed 1101 · grid / organic / canal-street.*

## 7. Building · Verified (heights are assumptions)

Zero or one grey-box volume per plot, set back from the frontage. Its height comes from the DNA (floors × floor height), and its base sits on the terrain. *Task 05.1.*

![Buildings](../../assets/screenshots/procedural-mini-world/05-1-buildings-overall.png)

*Seed 1101 · grid / organic / canal-street.*

## 8. World Grid · Implemented (partial)

Nine tiles in one world frame, each with its own landform and a City ID (empty, `auto`, or a DNA). Each tile's terrain seed is derived from the world seed and the tile's position. Shared edges are joined where a natural slope allows; the rest are reported. *Tasks 06.2, 06.3a.*

![World grid](../../assets/screenshots/procedural-mini-world/06-3a-world-harmonized-overall.png)

*World seed 6201 · transition width 128 m · harmonised terrain. Default layout: north row two mountains + river valley, middle row two plains + river valley, south row three coast tiles.*

[← Project Statement](./01-project-statement.md) · [Home](./00-midterm-review.md) · [Next: Key Parameters →](./03-key-parameters.md)
