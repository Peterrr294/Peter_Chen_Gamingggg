# 01.1 — Manhattan Spatial Study

> Status: in research · Date: 2026-10-18 · Prototype decision: Manhattan remains the first city to implement
>
> *Translated to English on 2026-10-20; the original wording is in Git history (commit `7b21c3e`).*

## 1. Study scope

| Field | Definition in this study | Evidence status |
| --- | --- | --- |
| City | Manhattan, New York City, USA | decided in 00.3 |
| Historical reference | The Manhattan grid expressed by the 1811 Commissioners' Plan; used to identify the historical basis of "first establish an ordering system, then organise blocks" | **Source fact:** the Library of Congress holds the original 1811 map; the Museum of the City of New York describes it as the founding plan of Manhattan's street grid |
| Representative study area | **The Midtown transect between 14th Street and 59th Street, Hudson River to East River**; bounded by streets, with waterfronts and large open spaces recorded as edges or exceptions | **Analytical inference / researcher's choice of area:** this range lets one continuous sample show the regular grid, its cut by the riverbanks, tax lots, and different building volumes; it is neither an administrative boundary nor the full extent of the historic plan |
| Study scale | City-module level: terrain / waterfront → street network → blocks and plots → building volumes | frozen in the project compass |
| Explicitly out of scope | no 1:1 reconstruction; no numeric parameter values; no terrain, street, plot, or building code | constraint of this task |

### Status tags

- **[V] Verifiable data / source fact:** the source directly provides a map, geometry, or fields that can be queried.
- **[I] Reasonable inference:** a research judgement translated from source facts, not yet verified by sample-area statistics.
- **[TBD] Missing information:** needs later data clipping, measurement, or cross-checking; this file does not enter guessed values.

## 2. Five kinds of spatial evidence

### 2.1 Terrain

| Item | Record |
| --- | --- |
| Core spatial feature | **[V]** USGS 3DEP provides a DEM of the bare-earth surface, a checkable basis for elevation and slope in the study area. **[TBD]** The representative study area has not been clipped yet, so no judgement is made about its height range, slope distribution, or "flatness". |
| Sources | [USGS 3DEP 1/3 arc-second DEM data description](https://data.usgs.gov/datacatalog/data/USGS%3A3a81321b-c153-416f-98b7-cc8e5f0e17c3); [USGS The National Map download and viewer tools](https://www.usgs.gov/tools/download-data-maps-national-map) |
| Potential generation rule | **[I]** First form a continuous land surface from the DEM or a simplified height field, then compute slope and buildability; the grid is generated only where the terrain allows. Slope threshold and terrain exaggeration are both **TBD**. |

### 2.2 Water and shoreline

| Item | Record |
| --- | --- |
| Core spatial feature | **[V]** The study area faces the Hudson River on the west and the East River on the east; the NYC Department of City Planning publishes a Coastal Zone Map, and the official waterfront plan also uses the two rivers as Manhattan's boundary context. **[TBD]** The current shoreline, piers, and landfill boundary have not been extracted as generatable geometry. |
| Sources | [NYC Department of City Planning: Coastal Zone Map](https://www.nyc.gov/assets/planning/pages/coastal-zone-map/index.html); [NYC Comprehensive Waterfront Plan](https://www.nyc.gov/assets/planning/download/pdf/about/publications/cwp.pdf) |
| Potential generation rule | **[I]** Water acts as the module's outer boundary, not as an internal movement network: generate the shorelines on both sides first, then use them to cut the regular grid and the buildable land; blocks along the water may be incomplete. Shoreline simplification scale is **TBD**. |

### 2.3 Street network

| Item | Record |
| --- | --- |
| Core spatial feature | **[V]** The 1811 map records a planned street order covering Manhattan's expansion area; the City Museum interprets it as an abstract, measurable numbered grid. **[V]** NYC Street Centerline represents current streets as line features with fields such as street type and direction, usable to verify orientation and hierarchy in the study area. **[TBD]** Orientation concentration, street spacing, and intersection structure have not been measured. |
| Sources | [Library of Congress: original 1811 Commissioners' Plan](https://www.loc.gov/item/2005625335/); [Museum of the City of New York: The Commissioners' Plan, 1811](https://thegreatestgrid.mcny.org/greatest-grid/making-the-plan/12); [NYC Open Data: Street Centerline](https://data.cityofnewyork.us/City-Government/Centerline/3mf9-qshr) |
| Potential generation rule | **[I]** Generate two near-orthogonal street sequences with one shared main orientation, keeping two roles, "avenue" and "cross street"; cut the network by the waterfront and by explicit exceptions. Orientation angle, spacing, width, and the exception list are all **TBD**. |

### 2.4 Blocks and plots

| Item | Record |
| --- | --- |
| Core spatial feature | **[V]** MapPLUTO combines PLUTO attributes with the tax-lot geometry of the Digital Tax Map, so block / lot, lot area, frontage, irregular-lot flags, and similar information can be checked. **[TBD]** Block area, lot area, proportions, regularity, and frontage-orientation distribution have not been computed for the study area. |
| Sources | [NYC DCP: PLUTO README 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_readme.pdf); [NYC DCP: PLUTO Data Dictionary 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf) |
| Potential generation rule | **[I]** Closed street loops form blocks first; blocks are then subdivided into several tax lots along the main frontage direction; non-rectangular blocks caused by the shoreline or special facilities go to an exception branch. Number of divisions, depth, frontage width, and exception share are all **TBD**. |

### 2.5 Building form

| Item | Record |
| --- | --- |
| Core spatial feature | **[V]** NYC Building Footprints provides building footprint polygons with fields such as ground elevation, roof height, and base BBL; PLUTO adds lot-level attributes such as building area, maximum floors, building frontage and depth, and built FAR. **[TBD]** Coverage, height distribution, setbacks, street-wall continuity, and height gradient have not been measured for the representative area. |
| Sources | [NYC Open Data: Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue/about_data); [NYC DCP: PLUTO Data Dictionary 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf) |
| Potential generation rule | **[I]** Buildings must be generated from the relation between their plot and their footprint: first set coverage and setbacks, then form volumes from an explainable density / height field; the seed must never be used directly as a source of height. Coverage, setbacks, and height distribution are all **TBD**. |

## 3. Three candidate spatial rules

> This section freezes only the "rule questions", not any numbers. All three rules must be measured in the representative area before they can enter the City DNA.

### M1 — Shoreline-cut orthogonal hierarchical grid

- **Input:** study-area boundary, shoreline, main orientation, street hierarchy, seed.
- **Condition / constraint:** first establish two near-orthogonal street sequences with different roles; all streets are cut by the land boundary; the seed may only perturb spacings or local exceptions that are allowed to vary, never the main orientation or connectivity.
- **Observable output:** a connected network with highly consistent orientation, organised jointly by avenues and cross streets, ending at the waterfront on both sides.
- **Evidence status:** sources for the historical and current network **[V]**; specific orientation, spacing, width, and allowed perturbation **[TBD]**.

### M2 — Continuous decomposition "street loop → block → fronting plot"

- **Input:** street network, shoreline-cut result, MapPLUTO lot samples, seed.
- **Condition / constraint:** street loops define blocks first; regular blocks are divided repeatedly along the main frontage direction; edges at the waterfront and special facilities use exception subdivision, but must not produce plots outside the block or without access.
- **Observable output:** repeated, comparable fronting plots inside regular blocks, and a controlled number of incomplete or irregular plots at the edges.
- **Evidence status:** tax block / lot geometry and fields available **[V]**; the decomposition algorithm is **[I]**; scale and regularity distribution **[TBD]**.

### M3 — Plot-constrained coverage–height volume field

- **Input:** plots, building footprint samples, lot-level building attributes, density / height controls, seed.
- **Condition / constraint:** buildings must not extend beyond their plot or occupy streets or water; coverage, setbacks, and height follow the plot and the spatial field first, and only then may the seed create variants within defined limits.
- **Observable output:** the same grid can produce different but reproducible combinations of volumes, while keeping the structural identity of "regular plots carrying dense buildings with organised heights".
- **Evidence status:** building outlines and height / floor fields available **[V]**; spatial gradients and distributions **[TBD]**; the current wording is only **[I]**.

## 4. Source register

| ID | Source | Institution | Supports | Access status |
| --- | --- | --- | --- | --- |
| S1 | [Original 1811 Commissioners' Plan](https://www.loc.gov/item/2005625335/) | Library of Congress | historical planned grid and original map | accessed |
| S2 | [The Commissioners' Plan, 1811](https://thegreatestgrid.mcny.org/greatest-grid/making-the-plan/12) | Museum of the City of New York | the grid as an abstract, measurable urban order | accessed |
| S3 | [Street Centerline](https://data.cityofnewyork.us/City-Government/Centerline/3mf9-qshr) | NYC Open Data / OTI | current street centrelines, direction and type fields | accessed |
| S4 | [Coastal Zone Map](https://www.nyc.gov/assets/planning/pages/coastal-zone-map/index.html) | NYC Department of City Planning | spatial check of waterfront and coastal zone | accessed |
| S5 | [USGS 3DEP DEM](https://data.usgs.gov/datacatalog/data/USGS%3A3a81321b-c153-416f-98b7-cc8e5f0e17c3) | U.S. Geological Survey | bare-earth elevation raster and its data definition | accessed |
| S6 | [PLUTO README 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_readme.pdf) | NYC Department of City Planning | how PLUTO is merged with the Digital Tax Map; data version | accessed |
| S7 | [PLUTO Data Dictionary 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf) | NYC Department of City Planning | field definitions for lot, building area, floors, frontage / depth | accessed |
| S8 | [Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue/about_data) | NYC Open Data / OTI | building footprints, ground elevation, roof height, and BBL | accessed |

## 5. Up to three key map / image references

1. [1811 Commissioners' Plan, high-resolution original and catalogue record](https://www.loc.gov/item/2005625335/): visual basis for the historical grid, the island boundary, and the planned order.
2. [NYC Coastal Zone Map](https://www.nyc.gov/assets/planning/pages/coastal-zone-map/index.html): to check the waterfront, the coastal zone, and the study-area boundary.
3. [NYC Map Tiles](https://maps.nyc.gov/tiles/): the official current base map with streets, buildings, and planimetric features, usable for overlay checks of the representative area.

> This study only registers links; images are not downloaded or copied.

## 6. Missing evidence and checks before the next stage

- **[TBD] Terrain:** clip the DEM of the representative area and compute elevation range, slope distribution, and buildability; until then it must not be called "flat terrain".
- **[TBD] Shoreline:** decide the shoreline year used by this project, the treatment of piers and landfill, and the simplification scale.
- **[TBD] Network:** use Street Centerline to measure main orientation, orientation concentration, hierarchy, connectivity, spacing, and edge exits.
- **[TBD] Blocks / plots:** within the same study area, compute block and plot areas, proportions, frontage orientation, and the share of irregular plots.
- **[TBD] Buildings:** compute coverage, setbacks, roof-height / floor distribution, and street-wall continuity, and check differences in date and missing values between Building Footprints and PLUTO.
- **[TBD] Scope sensitivity:** check whether the 14th–59th Street sample departs from the "typical grid" because of large open spaces, transport facilities, or shoreline exceptions; if needed, adjust only the sample area, not the city.

## 7. Conclusion of this study

- **Shown:** Manhattan has a "terrain → shoreline → streets → plots → buildings" evidence chain that can be measured further from official maps and data.
- **Not yet shown:** any specific scale, density, height, slope, or range of random perturbation.
- **Current stopping point:** keep M1–M3 as candidate rules pending human acceptance; do not enter City DNA values or start terrain development.
