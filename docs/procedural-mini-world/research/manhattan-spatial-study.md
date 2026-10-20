# 01.1｜曼哈顿空间研究

> 状态：研究中｜日期：2026-10-18｜原型决策：第一座实现城市保持为曼哈顿

## 1. 研究范围

| 字段 | 本次定义 | 证据状态 |
| --- | --- | --- |
| 城市 | 美国纽约市，曼哈顿 | 00.3 已决策 |
| 历史参照范围 | 1811 年《Commissioners' Plan》所表达的曼哈顿规则网格；用于辨认“先建立秩序系统，再组织街区”的历史依据 | **资料事实**：美国国会图书馆保存 1811 年原图；纽约城市博物馆将其说明为曼哈顿街道网格的奠基规划 |
| 本次代表性研究区 | **14th Street–59th Street，Hudson River–East River 的中城横断面**；以街道边界为准，水岸及大型开放空间作为边界或例外记录 | **分析推断/研究者选区**：该范围用于在一个连续样区内观察规则网格、河岸裁切、税务地块和不同建筑体量；不是行政边界，也不是历史原图的完整范围 |
| 研究尺度 | 城市模块层：地形/水岸 → 道路网络 → 街区与地块 → 建筑体量 | 项目罗盘已冻结 |
| 明确不做 | 不做 1:1 复原；不确定参数数值；不开发地形、道路、地块或建筑代码 | 本任务约束 |

### 状态标记

- **[V] 可验证数据/资料事实**：来源直接提供可查询的地图、几何或字段。
- **[I] 合理推断**：由资料事实转译出的研究判断，尚未通过样区统计验证。
- **[TBD] 缺失信息**：需要后续裁剪数据、测量或交叉核验；本文件不填猜测值。

## 2. 五类空间证据

### 2.1 地形

| 项目 | 记录 |
| --- | --- |
| 核心空间特征 | **[V]** USGS 3DEP 提供表示裸地地表的 DEM，可作为研究区高程与坡度的可核查基础。**[TBD]** 尚未裁剪代表性研究区，因此不判断其高差、坡度分布或“平坦程度”。 |
| 资料来源 | [USGS 3DEP 1/3 arc-second DEM 数据说明](https://data.usgs.gov/datacatalog/data/USGS%3A3a81321b-c153-416f-98b7-cc8e5f0e17c3)；[USGS The National Map 下载与查看工具](https://www.usgs.gov/tools/download-data-maps-national-map) |
| 潜在生成规则 | **[I]** 先由 DEM/简化高度场形成连续陆地表面，再计算坡度与可建造性；网格只在地形许可范围内生成。坡度阈值与地形夸张程度均为 **TBD**。 |

### 2.2 水域与岸线

| 项目 | 记录 |
| --- | --- |
| 核心空间特征 | **[V]** 研究区的东西两侧分别面向 Hudson River 与 East River；纽约市规划局提供 Coastal Zone Map，官方水岸规划图也以两条河流作为曼哈顿边界语境。**[TBD]** 当前岸线、码头和填海边界尚未提取为可生成几何。 |
| 资料来源 | [NYC Department of City Planning：Coastal Zone Map](https://www.nyc.gov/assets/planning/pages/coastal-zone-map/index.html)；[NYC Comprehensive Waterfront Plan](https://www.nyc.gov/assets/planning/download/pdf/about/publications/cwp.pdf) |
| 潜在生成规则 | **[I]** 水体作为模块外边界而非内部交通网络：先生成两侧岸线，再用岸线裁切规则网格与可建造地；临水街区允许出现不完整街区。岸线简化尺度为 **TBD**。 |

### 2.3 道路网络

| 项目 | 记录 |
| --- | --- |
| 核心空间特征 | **[V]** 1811 年地图记录了一套覆盖曼哈顿扩展区的规划街道秩序；城市博物馆将其解释为一种抽象、可测量的编号网格。**[V]** NYC Street Centerline 以线要素表示现状街道，并包含道路类型、方向等字段，可用于核验研究区的方向和层级。**[TBD]** 尚未统计方向集中度、道路间距或交叉口结构。 |
| 资料来源 | [Library of Congress：1811 Commissioners' Plan 原图](https://www.loc.gov/item/2005625335/)；[Museum of the City of New York：The Commissioners' Plan, 1811](https://thegreatestgrid.mcny.org/greatest-grid/making-the-plan/12)；[NYC Open Data：Street Centerline](https://data.cityofnewyork.us/City-Government/Centerline/3mf9-qshr) |
| 潜在生成规则 | **[I]** 以统一主方向生成两组近似正交的道路序列，并保留“avenue / cross street”两级角色；以水岸和明确例外裁切网络。方向角、间距、宽度和例外清单均为 **TBD**。 |

### 2.4 街区与地块

| 项目 | 记录 |
| --- | --- |
| 核心空间特征 | **[V]** MapPLUTO 将 PLUTO 属性与数字税务地图的 tax-lot 几何合并，可核查 block/lot、地块面积、临街尺度、不规则地块标记等信息。**[TBD]** 尚未对研究区计算街区面积、地块面积、长宽比、规则度或临街方向分布。 |
| 资料来源 | [NYC DCP：PLUTO README 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_readme.pdf)；[NYC DCP：PLUTO Data Dictionary 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf) |
| 潜在生成规则 | **[I]** 道路闭环先形成街区，再沿主要临街方向把街区细分为多个税务地块；岸线或特殊设施造成的非矩形街区进入例外分支。分割数量、深度、临街宽度和例外比例均为 **TBD**。 |

### 2.5 建筑形态

| 项目 | 记录 |
| --- | --- |
| 核心空间特征 | **[V]** NYC Building Footprints 提供建筑基底多边形，并含 ground elevation、roof height、base BBL 等字段；PLUTO 另提供建筑面积、最高建筑层数、建筑临街与进深、Built FAR 等地块级属性。**[TBD]** 尚未统计代表区覆盖率、高度分布、退界、街墙连续性或高度梯度。 |
| 资料来源 | [NYC Open Data：Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue/about_data)；[NYC DCP：PLUTO Data Dictionary 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf) |
| 潜在生成规则 | **[I]** 建筑必须从所属地块与建筑基底关系生成：先确定覆盖与退界，再由可解释的密度/高度场形成体量；不得把 Seed 直接当作高度来源。覆盖率、退界与高度分布均为 **TBD**。 |

## 3. 三条候选空间规则

> 本节只冻结“规则问题”，不冻结任何数值。三条规则均需在代表区完成测量后才能进入城市 DNA。

### M1｜岸线裁切的正交层级网格

- **输入**：研究区边界、岸线、主方向、道路层级、Seed。
- **条件/约束**：先建立两组近似正交且角色不同的道路序列；所有道路受陆地边界裁切；Seed 只能扰动允许变化的间距或局部例外，不能破坏主方向与连通性。
- **可观察输出**：形成方向高度一致、由 avenue 与 cross street 共同组织、在两侧水岸终止的连通网络。
- **证据状态**：历史与现状网络来源 **[V]**；具体方向、间距、宽度和允许扰动 **[TBD]**。

### M2｜“道路闭环 → 街区 → 临街地块”的连续分解

- **输入**：道路网络、岸线裁切结果、MapPLUTO 地块样本、Seed。
- **条件/约束**：道路闭环先定义街区；常规街区按主要临街方向重复分割；水岸与特殊设施边缘使用例外分割，但不得产生越界或不可达地块。
- **可观察输出**：规则街区内出现重复且可比较的临街地块，边界处出现数量受控的不完整或不规则地块。
- **证据状态**：tax block/lot 几何与字段可得 **[V]**；分解算法属于 **[I]**；尺度与规则度分布 **[TBD]**。

### M3｜地块约束下的覆盖—高度体量场

- **输入**：地块、建筑基底样本、地块级建筑属性、密度/高度控制、Seed。
- **条件/约束**：建筑不得越出地块或占用道路/水体；覆盖、退界与高度先服从地块和空间场，再允许 Seed 在规定范围内产生变体。
- **可观察输出**：相同网格可形成不同但可复现的体量组合，同时保持“规则地块承载密集且高度有组织的建筑体量”这一结构身份。
- **证据状态**：建筑轮廓与高度/层数相关字段可得 **[V]**；空间梯度与分布关系为 **[TBD]**，当前表述仅为 **[I]**。

## 4. 来源登记

| 编号 | 来源 | 机构 | 支持内容 | 可访问状态 |
| --- | --- | --- | --- | --- |
| S1 | [1811 Commissioners' Plan 原图](https://www.loc.gov/item/2005625335/) | Library of Congress | 历史规划网格与原始地图 | 已访问 |
| S2 | [The Commissioners' Plan, 1811](https://thegreatestgrid.mcny.org/greatest-grid/making-the-plan/12) | Museum of the City of New York | 网格作为抽象、可测量的城市秩序 | 已访问 |
| S3 | [Street Centerline](https://data.cityofnewyork.us/City-Government/Centerline/3mf9-qshr) | NYC Open Data / OTI | 现状道路中心线、方向及类型字段 | 已访问 |
| S4 | [Coastal Zone Map](https://www.nyc.gov/assets/planning/pages/coastal-zone-map/index.html) | NYC Department of City Planning | 水岸与海岸带空间核验 | 已访问 |
| S5 | [USGS 3DEP DEM](https://data.usgs.gov/datacatalog/data/USGS%3A3a81321b-c153-416f-98b7-cc8e5f0e17c3) | U.S. Geological Survey | 裸地高程栅格及其数据定义 | 已访问 |
| S6 | [PLUTO README 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_readme.pdf) | NYC Department of City Planning | PLUTO 与数字税务地图合并关系、数据版本 | 已访问 |
| S7 | [PLUTO Data Dictionary 25v4](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf) | NYC Department of City Planning | lot、建筑面积、层数、临街/进深等字段定义 | 已访问 |
| S8 | [Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue/about_data) | NYC Open Data / OTI | 建筑基底、地面高程、屋顶高度与 BBL | 已访问 |

## 5. 最多三个关键地图/图像参考

1. [1811 Commissioners' Plan 高清原图与馆藏记录](https://www.loc.gov/item/2005625335/)：用于历史网格、岛屿边界和规划秩序的视觉依据。
2. [NYC Coastal Zone Map](https://www.nyc.gov/assets/planning/pages/coastal-zone-map/index.html)：用于水岸、海岸带与研究范围边界核验。
3. [NYC Map Tiles](https://maps.nyc.gov/tiles/)：官方现状底图，包含街道、建筑与平面要素，可用于代表区叠合检查。

> 本次仅登记链接，不重复下载或复制图像。

## 6. 缺失证据与下一关前检查

- **[TBD] 地形**：裁剪代表区 DEM，计算高程极差、坡度分布与可建造性；在完成前不得称其为“平坦地形”。
- **[TBD] 岸线**：确定本项目采用的岸线年份、码头/填海处理和简化尺度。
- **[TBD] 网络**：用 Street Centerline 测量主方向、方向集中度、层级、连通性、间距及边缘出口。
- **[TBD] 街区/地块**：用同一研究范围统计街区与地块面积、长宽比、临街方向和不规则比例。
- **[TBD] 建筑**：统计覆盖率、退界、屋顶高度/层数分布、街墙连续性，并检查 Building Footprints 与 PLUTO 的时间与缺失值差异。
- **[TBD] 范围敏感性**：检查 14th–59th Street 样区是否因大型开放空间、交通设施或岸线例外而偏离“典型网格”；必要时只调整样区，不更换城市。

## 7. 本次结论

- 已证明：曼哈顿存在可由官方地图和数据继续测量的“地形—岸线—道路—地块—建筑”证据链。
- 尚未证明：任何具体尺度、密度、高度、坡度或随机扰动范围。
- 当前停止点：保留 M1–M3 为候选规则，等待人工验收；不进入城市 DNA 数值填写或地形开发。
