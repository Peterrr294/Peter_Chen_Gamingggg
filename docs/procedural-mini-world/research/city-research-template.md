# Unified City Research Template

*Translated to English on 2026-10-20; the original wording is in Git history (commit `7b21c3e`). The [CSV](./city-research-template.csv) is unchanged: its header row still uses the original (Chinese) field names, in the same order as the 40 fields below, so the English names map to the CSV columns one-to-one by position.*

## Principles

- This template serves a "controllable procedural world": it studies how city identity is kept, changed, and mixed through terrain, street, plot, and building rules.
- Each city must clearly separate three kinds of content:
  - **Source facts:** descriptions or measurements directly supported by reliable sources and checkable.
  - **Analytical inferences:** generalisations, comparisons, or causal judgements the researcher derives from source facts; the basis of each inference must be stated.
  - **Artistic choices:** design decisions made for legibility, expressiveness, or system limits; they must never be presented as facts.
- Each city needs at least two reliable sources. The two sources should cross-check the key facts; if they conflict, record it under "Uncertainties / notes".
- Each city must finally be condensed into three programmable core rules. Each rule states at least its input, its trigger condition or constraint, and an observable output.
- A seed only provides reproducible variation; it does not represent city identity. City identity must come from explainable terrain, network, plot, and building rules and their interfaces.
- The 60 cities form a research database; they do not mean that 60 cities will be implemented this semester. The scope of implementation is controlled by "Final decision".

## Field definitions

The Markdown and the CSV use the following 40 fields, in exactly this order.

| Field | Definition |
| --- | --- |
| ID | Unique ID of the city record. Filled in when a formal record is created; must not be replaced by a seed. |
| Research status | Current stage of work, e.g. "to be researched", "in research", "reviewed", "decided". |
| City | The city or the explicitly named urban district being studied. |
| Country / region | The country or region the city belongs to, or the applicable administrative and cultural context. |
| Study area | The spatial boundary and scale covered by this record, e.g. historic core, administrative district, or a defined sample area. |
| City family | A research grouping based on spatial structure and generation logic, used to compare cities; not an administrative or style label. |
| Source status | State of source collection and verification: whether at least two reliable sources exist and which gaps remain. |
| Landform type | The dominant terrain category (or combination) in the study area. |
| Water relation | How water bodies relate to the city boundary, movement, plots, and building layout. |
| Terrain relief (1–5) | Score for how strongly height differences and slopes constrain building and movement. |
| Water influence (1–5) | Score for how strongly water shapes the organisation of streets, blocks, plots, buildings, and public space. |
| Geographic constraint summary | Traceable facts summarising limits set by terrain, water, coastline, slope, etc. |
| Network type | The main topological or morphological type of the street network; several types and their areas may be recorded. |
| Network regularity (1–5) | Score for how far street direction, spacing, and connection follow repeatable rules. |
| Street density (1–5) | Relative score of total street-centreline length per unit of buildable land. |
| Street hierarchy clarity (1–5) | Score for how reliably streets can be divided into levels such as arterial, secondary, and local. |
| Main orientation | Dominant orientation of streets, plots, or buildings; if there is none, record "no single main orientation". |
| Block scale (1–5) | Relative score of the typical block area within the common comparison set. |
| Plot scale (1–5) | Relative score of the typical plot area within the common comparison set. |
| Plot regularity (1–5) | Score for how far plot boundaries, angles, proportions, and arrangement follow repeated geometric rules. |
| Building density (1–5) | Relative score of one common density measure (building count, floor area, or floor-area ratio) within the comparison set; the measure used must be stated. |
| Building height (1–5) | Relative score of typical building height or floor count within the comparison set; the statistic used must be stated. |
| Building coverage (1–5) | Score of building footprint area as a share of buildable land. |
| Main building types | The building types (and combinations) that dominate spatial organisation in the study area. |
| Public space types | The main kinds of public space and how they connect to streets, water, blocks, or buildings. |
| Module boundary interface | Boundary data this city's rule module needs to receive from, or provide to, neighbouring modules, e.g. elevation, street end points, waterline, or plot connections. |
| Core generation rule 1 | The first programmable rule condensed from the research findings; must contain input, condition, and observable output. |
| Core generation rule 2 | The second programmable rule condensed from the research findings; must contain input, condition, and observable output. |
| Core generation rule 3 | The third programmable rule condensed from the research findings; must contain input, condition, and observable output. |
| Terrain family | Name of a reusable group of terrain generation rules. |
| Network family | Name of a reusable group of street, path, or waterway network rules. |
| Building family | Name of a reusable group of rules for building volume, type, or placement. |
| Prototype representativeness (1–5) | Score of the share of the city's key spatial features covered by the three core rules. |
| Visual recognisability (1–5) | Score of the share of testers who correctly identify the city from the generated result alone, without its name shown. |
| Implementation feasibility (1–5) | Score of the share of the core rules that the current procedural pipeline can implement directly. |
| Evidence strength (1–5) | Score of the share of key facts and inferences cross-supported by reliable sources. |
| Source 1 | Full citation or stable link of the first reliable source, with the fields or conclusions it supports. |
| Source 2 | Full citation or stable link of the second reliable source, with the fields or conclusions it supports. |
| Uncertainties / notes | Source conflicts, scale bias, items to verify, method limits, and the basis of each score. |
| Final decision | The outcome after research, e.g. enter the prototype set, merge as a family reference, keep as research, or postpone. |

## Unified 1–5 scoring standard

### General rules

- Scores use only the integers 1, 2, 3, 4, 5. When data are insufficient, leave the score empty; do not use 0.
- All scores use the same study area, the same measurement basis, and the 60-city comparison set of this database. While the comparison set is incomplete, mark scores as provisional and record the basis under "Uncertainties / notes".
- **Ratio-type** measures always use: 1 = 0–20 %, 2 = >20–40 %, 3 = >40–60 %, 4 = >60–80 %, 5 = >80–100 %.
- **Relative scale or density** measures always use quintiles of the comparison set: 1 = 1st quintile (smallest 20 %), 2 = 2nd quintile, 3 = 3rd quintile, 4 = 4th quintile, 5 = 5th quintile (largest 20 %).
- A field must use the same raw measure for every city. If the measure changes, all cities must be recalculated; scores based on different measures must not be compared directly.

### Measurement basis per scored field

| Scored field | Basis of the 1–5 score |
| --- | --- |
| Terrain relief (1–5) | Elevation range of the study area divided by its equivalent diameter gives a relative relief ratio, scored by 60-city quintiles. |
| Water influence (1–5) | Of five systems (streets, blocks, plots, buildings, public space), the share directly constrained by a water boundary or by water-crossing conditions; ratio-type score. |
| Network regularity (1–5) | Share of street-centreline length that follows repeated direction, spacing, or connection rules; ratio-type score. |
| Street density (1–5) | Total street-centreline length ÷ buildable land area, scored by comparison-set quintiles. |
| Street hierarchy clarity (1–5) | Share of street-centreline length that can be reliably assigned to a predefined level by width, connectivity, or function; ratio-type score. |
| Block scale (1–5) | Median block area in the study area, scored by comparison-set quintiles (1 = smallest group, 5 = largest). |
| Plot scale (1–5) | Median plot area in the study area, scored by comparison-set quintiles (1 = smallest group, 5 = largest). |
| Plot regularity (1–5) | Share of plots explained by repeated angles, proportions, or subdivision logic; ratio-type score. |
| Building density (1–5) | One measure for all cities, either "building count ÷ buildable land" or "total floor area ÷ buildable land", scored by comparison-set quintiles. |
| Building height (1–5) | Median typical building height or median floor count, one basis for the whole database, scored by comparison-set quintiles. |
| Building coverage (1–5) | Total building footprint area ÷ buildable land area; ratio-type score. |
| Prototype representativeness (1–5) | List the city's key spatial features as a checklist and compute the share covered by the three core rules; ratio-type score. |
| Visual recognisability (1–5) | In a test with the city name hidden, the share of testers who identify the city correctly; ratio-type score; record sample size and test conditions. |
| Implementation feasibility (1–5) | Split the three core rules into acceptance items and compute the share the current pipeline can deliver without new base systems; ratio-type score. |
| Evidence strength (1–5) | Share of key facts and analytical inferences supported by at least two reliable sources; ratio-type score. |

## Filling-in and review process

1. Fix the "Study area" first, then collect sources; data at different spatial scales must not be mixed directly.
2. Enter source facts in their fields and state in "Source 1" / "Source 2" what each source supports.
3. Mark analytical inferences and artistic choices explicitly under "Uncertainties / notes", so they are not confused with source facts.
4. Compute scores with the unified basis; leave them empty when they cannot be computed.
5. Condense the research findings into three core generation rules and check that each can be translated into program conditions and outputs.
6. Review the module boundary interface, the three families, and the final decision, then decide whether the city enters this semester's prototype implementation.
