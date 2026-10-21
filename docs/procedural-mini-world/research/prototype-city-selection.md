# Task 00.3 — Prototype City Selection Decision

> Decision status: awaiting human acceptance. This file selects only on the basis of the project compass, the 00.1 city research template, and the 00.2 city longlist; it does not re-research the 60 cities and does not fill in a complete City DNA. "Verified" here only means that a source anchor already listed in 00.2 supports the direction; it does not mean that parameters, dimensions, or algorithms have been verified.
>
> *Translated to English on 2026-10-20; the original wording is in Git history (commit `7b21c3e`).*

## 1. Decision summary

- **Three prototype cities:** Manhattan (New York), Venice, Fez el-Bali.
- **First city to implement:** Manhattan (New York).
- **Selection logic:** the three use a regular grid, a water network with islands, and organic paths, respectively, as the skeleton of the world, so the same "terrain → network → plots → buildings" process can produce three structural differences.
- **Current limit:** this is a decision on prototype direction, not a complete City DNA; two-source verification of the first city is still needed before any code.

## 2. Check of the existing city families

The 10 families of 00.2 can remain the candidate classification for Stage 0 without a large rewrite. They describe dominant generation logics, not mutually exclusive city types, so a city may have secondary families.

| Overlap or gap | Judgement | Handling at this stage |
| --- | --- | --- |
| F1 water network–island fabric and F7 river–delta–flood adaptation | clear overlap in the water theme, but a different generation order: F1 uses waterways as the city's internal movement network, F7 treats hydrological risk and infrastructure as regional constraints | keep both families; later distinguish by "do waterways carry the main internal network?" |
| F2 strong orthogonal grid and F8 modernist planning–superblock | both may use a regular grid, but block scale and planning unit differ | keep; F2 centres on repeated blocks and plot subdivision, F8 on street hierarchy, functional zones, and superblocks |
| F3 radial–axis–ring and F8 modernist planning–superblock | both may show monumental axes and one-time planning | keep; the generation primitives of F3 are centres, axes, and rings; those of F8 are sectors and superblocks |
| F4 organic historic core and F5 city wall–gate boundary | most historic cores have both walls and organic lanes | keep; decide whether the primary control is internal path growth or an external boundary with limited entrances |
| F6 mountain–slope adaptation and F9 coast–narrow corridor | cities squeezed between mountains and sea may belong to both | keep; F6 centres on slope and elevation connection, F9 on a linear buildable band and corridor continuity |
| F8 Navi Mumbai and F10 polycentric–network nodes | a planned new town may also be a polycentric network | marked to be verified; decide the secondary family by whether "master-plan sectors" or "transport-node density field" dominates |
| F7 port cities such as Shanghai and Hamburg | port, hydrology, flood defence, and grid may dominate at once; the current family basis is broad | marked to be verified; these boundary cases are not used for prototype selection |
| Internal differences in F9 and F10 | both families cover cities of very different scale and history | not split for now; adjust in an expansion stage if one family rule set cannot explain them |

### Conclusion of the family check

The 10 families are sufficient for this prototype selection. The most pressing need is not reclassification but fixing study areas, two-source evidence, and programmable rules for the chosen prototypes.

## 3. Structural comparison of the three prototypes

| Dimension | Manhattan (New York) | Venice | Fez el-Bali |
| --- | --- | --- | --- |
| Main family | F2 strong orthogonal grid | F1 water network–island fabric | F4 organic historic core |
| Study area | area covered by the 1811 grid; exact boundary to be verified | historic city and the central lagoon islands; exact boundary to be verified | Fez el-Bali; exact boundary to be verified |
| Terrain | the first version may abstract the study area as a bounded low-relief base; factual basis to be verified | lagoon and islands are the primary geographic condition; supported by a source anchor | valley, city boundary, and local terrain relations to be verified |
| Water | an outer island boundary exists, but this prototype does not use a water network as its main internal structure; to be verified | water decides land, boundary, and the main network at once; supported by a source anchor | the 00.2 source anchor supports historic districts and a waterway background, but the specific effect of water on the internal network is to be verified |
| Network | the planned numbered orthogonal grid is supported by a source anchor; street hierarchy and proportions to be verified | canals as the main network and bridges connecting islands are supported by a source anchor; pedestrian hierarchy to be verified | the dense historic fabric is supported by a source anchor; the hierarchy of branching lanes to be verified |
| Plots | candidate hypothesis: regular subdivision of long narrow blocks; to be verified | candidate hypothesis: irregular waterfront plots following the shoreline; to be verified | candidate hypothesis: small irregular plots and courtyard units; to be verified |
| Building form | candidate hypothesis: volumes controlled by plot, coverage, and a height field; height distribution to be verified | the relation of historic buildings to the water city has a source anchor; rules for a continuous low-rise street wall to be verified | the dense building fabric has a source anchor; courtyard and street-wall rules to be verified |
| Generation complexity | **low–medium:** a regular grid, deterministic subdivision, and simple volumes are easy to verify in stages | **medium–high:** needs a water / land mask, islands, a dual network, bridges, and shoreline plots working together | **high:** needs organic network growth, accessibility, dead ends, irregular plots, and courtyards working together |
| Reuse potential of old experiments | **pending code audit:** generic terrain, grid, and building volumes may be reusable; this task did not read code | **possibly high but unverified:** the project had a Venice direction before; this task was not allowed to read code, so interfaces and quality cannot be confirmed | **probably low and unverified:** new organic-network and courtyard rules are expected, but this task did not read code |
| Role in the system | establish the common data interface and the lowest-complexity baseline | test whether water can replace streets as the world's skeleton | test whether the system can leave the regular grid and produce a hierarchical organic fabric |

## 4. Why keep these three and not change the prototypes

### Structural difference

The first generation step of each city is different:

```text
Manhattan: boundary → orthogonal streets → regular blocks → plots → height field
Venice:    lagoon water network → islands → shoreline paths and bridges → waterfront plots → buildings
Fez:       boundary and public nodes → hierarchical path growth → irregular blocks → courtyard plots → buildings
```

This demonstrates "one framework, different rules" better than choosing three cities that all depend on a grid, all on water, or all on complex terrain.

### Alternatives not adopted for now

- **Chongqing instead of Fez:** would add terrain difference, but there is no source anchor yet, and its height-difference connections would introduce complex terrain, street, and building problems at once; not suitable as the third early rule set in a two-month delivery.
- **Brasília instead of Manhattan:** has a source anchor and clear rules, but superblocks and functional zoning skip traditional plot subdivision, so it is not suited to testing the generic "network → block → plot → building" chain first.
- **Rotterdam instead of Venice:** would allow study of hydrology and flood defence, but shifts the focus to regional infrastructure; Venice tests more directly whether a water network can become the city's internal network.

These judgements come from the 00.2 candidate classification; they are still project decisions, not complete factual city research.

## 5. Candidate generation rules for the three cities

### A. Manhattan (New York)

1. **Rule M1 — Generate an orthogonal street skeleton with one orientation inside the boundary.**
   - Verification status: **conceptual basis verified.** The 00.2 NYC Municipal Archives source anchor supports the 1811 planned numbered street grid.
   - To be verified: study-area boundary, street spacing, and the hierarchy difference between streets and avenues.
2. **Rule M2 — Recursively subdivide each block into regular plots along the main direction.**
   - Verification status: **to be verified.** So far there is only the candidate hypothesis of "long narrow blocks and plot subdivision".
   - To be verified: plot orientation, size distribution, corner-plot treatment, and exceptions for special blocks.
3. **Rule M3 — Building coverage and height are controlled by an explainable density field, not decided randomly building by building.**
   - Verification status: **to be verified.** Usable as a procedural abstraction, but no source supports a specific density gradient yet.
   - To be verified: the relation of height to transport nodes, street hierarchy, and the study area.

### B. Venice

1. **Rule V1 — Generate the lagoon, waterways, and islands first, then the urban content on land.**
   - Verification status: **conceptual basis verified.** The 00.2 UNESCO source anchor supports islands, lagoon, and canals forming one urban system together.
   - To be verified: waterway hierarchy, island scale, and conditions for buildable shoreline.
2. **Rule V2 — Bridges are scarce connections; their number and position decide the hierarchy of the cross-island network.**
   - Verification status: **partly to be verified.** The source anchor supports the island and waterway system, but bridge hierarchy and connection patterns are not yet verified.
   - To be verified: bridge density, main pedestrian routes, and their relation to public nodes.
3. **Rule V3 — Plots follow shorelines and paths; buildings form a continuous but not fully regular waterfront fabric.**
   - Verification status: **to be verified.** There are only the candidate plot and building descriptions from 00.2.
   - To be verified: plot orientation, street-wall continuity, height, and public-space exceptions.

### C. Fez el-Bali

1. **Rule F1 — Build the main path skeleton from gates, markets, religious buildings, or other public nodes.**
   - Verification status: **basis partly verified.** The 00.2 UNESCO source anchor supports the enclosed historic fabric, its districts, and the density of public buildings; the specific node weights are to be verified.
   - To be verified: node types, number of entrances, and how main paths connect.
2. **Rule F2 — Secondary lanes branch recursively from the main paths, getting narrower at each level and allowing dead ends.**
   - Verification status: **to be verified.** Currently a candidate generation hypothesis for an organic historic core.
   - To be verified: branching probability, path hierarchy, share of dead ends, and accessibility criteria.
3. **Rule F3 — Irregular blocks are divided into inward-facing courtyard plots; buildings form a continuous face along the outer edge.**
   - Verification status: **to be verified.** The dense historic fabric has a source anchor, but the subdivision logic of courtyard plots is not yet verified.
   - To be verified: courtyard proportion, plot scale, entrance organisation, and public-space exceptions.

## 6. Recommended first city to implement

### Recommendation: Manhattan (New York)

Manhattan is the best first complete vertical slice, not because it represents all cities, but because it can test the full data chain the project must share with the lowest rule complexity.

#### Main reasons

1. **The full chain is clear.** Boundary, orthogonal network, blocks, plots, and building volumes can be generated in sequence, each layer with clear inputs and outputs.
2. **Deterministic verification is easy.** The same seed and parameters should give the same grid, plots, and height field, so errors are easier to locate.
3. **It maps directly to the first parameters.** Network regularity, street density, block scale, plot regularity, building density, and building height can all be observed in one prototype.
4. **It suits freezing the common interfaces.** First verify `Terrain/Surface → Network → Block → Parcel → Building` with simple rules; then let Venice replace the network premise and Fez replace the path and plot algorithms.
5. **It reduces the risk of old experiments dictating the new architecture.** Even if the old Venice experiment has high reuse potential, a city special case should not decide the common interfaces; reuse of old code must wait for the next code audit.
6. **It works without visual assets.** Even with simple volumes only, the prototype still expresses structure if the grid, plots, and height field are clear; it does not depend on finished models.

### Recommended implementation order

```text
1. Manhattan: build the shared full generation chain and debug interfaces
2. Venice: test whether water dominance, islands, and bridges can replace the base network logic
3. Fez el-Bali: test whether organic paths, irregular plots, and courtyards work within the same framework
```

## 7. Mandatory verification before code

Even after this decision is accepted, a complete generator must not be written immediately. The first city must first have:

- an explicit boundary for the Manhattan study area;
- at least two reliable sources, each marked with the fields it supports;
- the boundary between fact, inference, and artistic choice for rules M1, M2, and M3;
- assumed parameter ranges where exact values are not used, and how they will be calibrated later;
- a read-only audit of old experiments and existing code, confirming which interfaces can be reused.

## 8. Items to be verified

1. The study areas of the three cities do not yet have a unified, comparable scale.
2. Each of the three cities has only one source anchor, so the two-source requirement of 00.1 is not yet met.
3. Plot structure, building coverage, height distribution, and boundary interfaces still lack evidence.
4. The reuse potential of old experiments has not passed a code audit and cannot count as a confirmed advantage.
5. Manhattan as the first city to implement still needs human acceptance; this file does not mean that programming starts.

## 9. Human acceptance items

- [ ] Accept the three prototypes: Manhattan, Venice, Fez el-Bali.
- [ ] Accept the first city to implement: Manhattan.
- [ ] Accept the implementation order: Manhattan → Venice → Fez el-Bali.
- [ ] Agree that the next task only completes Manhattan's two-source research and rule calibration, without writing code.
