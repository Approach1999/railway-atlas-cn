# 地区覆盖与切换：沈阳、大连

2026-11-24。地图现在有两个各自独立的试验地区，可在页头切换。两者都是试验矩形，不是行政边界，
彼此之间没有连通，也没有扩展到沈大走廊或全国。默认地区仍是沈阳。

大连以**本机试用**为目的接入，尚未通过独立数据审核，不代表完整 MVP 验收或公开发布。
依据与指纹见[接入证据](evidence/dalian-trial-20261124.json)。

## 两个地区

| 项目 | 沈阳试验区 | 大连试验区 |
| --- | --- | --- |
| 标识 | `shenyang`（默认） | `dalian` |
| 矩形（西、南、东、北） | 123.0, 41.5, 123.8, 42.1 | 121.10, 38.74, 122.05, 39.47 |
| 默认视野 | 123.42, 41.80，缩放 10.5 | 121.615, 38.969，缩放 10.5 |
| 当前快照 | `shenyang-mvp-geometry-20261027` | `dalian-mvp-20261123` |
| 源数据时间 | 2026-10-20T20:23:47Z | 2026-10-20T20:23:47Z |
| 已发布对象 / 瓦片 | 10,216 / 2,251 | 6,900 / 1,577 |

两地来自同一份 [Geofabrik 辽宁日期文件](https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf)
（28,536,638 字节；提供方 MD5 `c874eac87d81adaa5375c143656ef5f5`；本地 SHA-256
`9ca145eb49d5913f9b92e320e5983c4d7439532d1c448a291692efc89dd74e83`）。该省文件的表头范围为
118.83–126.29 E、38.26–43.49 N，覆盖大连矩形。许可与署名见[数据来源](data-sources.md)。

默认视野的规则两地相同：取两座主要火车站源坐标的中点，缩放 10.5。沈阳是沈阳站与沈阳北站，
大连是大连站（`node/7913022526`）与大连北站（`node/8083924038`）。这个视野在桌面上显示约 0.53°×0.35°、
在手机上约 0.19°×0.155°的主城区，**不是**装下整个试验矩形；矩形中点会落在稀疏地带，所以没有采用。

## 大连边界的依据

矩形用 [`scripts/survey_region.py`](../scripts/survey_region.py) 对省文件做只读调查后确定，
调查的“铁路对象”判定与提取器是同一个函数。

- 源数据中有 20 条城市轨道方向关系和 8 个父线路关系（`route_master`）到达该区域：
  地铁 1、2、3（含支线）、5、12、13 号线，有轨电车 201、202 路。
- 这些线路成员的地理范围并集为 121.139–122.002 E、38.798–39.431 N。所选矩形在四周各留约 0.04–0.06°，
  把旅顺口、金州、开发区、金石滩和普兰店南部都包含在内。
- 更小的城区矩形 121.45–121.85 E、38.78–39.17 N 会让对象更少，但会把 12 号线、13 号线和 3 号线金石滩段截在矩形外，因此没有采用。
- 矩形内触及 1,969 条 `railway=rail`、646 条 `subway`、68 条 `tram` 线路，以及 199 个车站节点。

与沈阳一样，跨出矩形的整条线路会完整保留，所以部分对象的几何会超出矩形。

## 大连数据实况

以下都是源数据里的事实，不是对现实运营的确认。数字来自
[`scripts/verify_route_identity.py`](../scripts/verify_route_identity.py)，它把 6,900 个已发布对象逐一与保存的源 XML
核对了原标签、版本、时间和修改集，并独立重新推导了每条线路的身份。

### 对象

候选 7,510 个对象 = 已发布 6,900 + 具名排除 470 + 关系记录 140，数量对平。排除的 470 个全部因为
`facility_kind_not_in_v1_matrix`（如有轨电车的平交道口、里程碑等不在 v1 设施矩阵内的类别）。

| 类别 | 数量 |
| --- | ---: |
| 轨道：支线/站场线 / 普速干线 / 普速未标注 / 高速 / 地铁 / 有轨电车 / 未知 | 1,423 / 209 / 162 / 192 / 647 / 69 / 146 |
| 设施：道岔 / 平交道口 / 车挡 / 停车位置 / 地铁出入口 / 站台 / 转车盘 / 站场 / 洗车 | 1,717 / 959 / 507 / 233 / 300 / 97 / 6 / 8 / 1 |
| 车站记录：地铁 / 有轨电车 / 铁路 / 制式未标注 | 119 / 64 / 28 / 13 |

“未知”轨道中包含窄轨、索道、单轨等不由等级规则归类的制式。

### 线路

| 线路 | 方向关系数 | 源关系中的轨道段 | OSM `colour` 标注 | 配置色 | 置信度 |
| --- | ---: | ---: | --- | --- | --- |
| 1号线 | 2 | 2 | `#42B227` | `#43B02A` | manual |
| 2号线 | 2 | 13 | `#0066A1` | `#009CDD` | manual |
| 3号线（含支线） | 6 | 139 | `#DD00BB` | `#D60078` | manual |
| 5号线 | 2 | 3 | `#E60012` | `#DA291C` | manual |
| 12号线 | 2 | 44 | `#523E98` | `#4C4298` | manual |
| 13号线 | 2 | 74 | `#FFE400` | `#F0C600` | manual |
| 201路、202路（有轨电车） | 各 2 | 6、26 | 无 | 制式色 | fallback |

需要如实呈现的几点：

- **成员齐备不等于运营线路完整。** 已发布的 716 段城市轨道里，只有 307 段在源数据中属于某条线路关系，
  另外 409 段按制式回退色显示。1 号线、5 号线在源线路关系中分别只有 2 段、3 段轨道，地图上只有这几段使用线路色。
- **运营方标签不一致。** 1、2 号线同时出现 `Dalian Metro` 和 `大连交通集团`；3、12 号线是
  `Dalian Public Transportation Group` 和 `大连交通集团`；13 号线没有 `operator` 标签。
  线路身份只依据一致的 `network=大连地铁` 加 `ref`，不依赖运营方拼写。
- **颜色没有运营方来源。** 六条地铁线的配置色取自中文维基百科
  [Module:Adjacent stations/大连地铁](https://zh.wikipedia.org/wiki/Module:Adjacent stations/大连地铁)，该模块没有注明色值来源，
  所以置信度标为 `manual`，不是 `operator-map`，更不是官方色值。六条线的 OSM `colour` 标注都与配置色不同，
  原值保留在每条记录的源标签里。线路状态取自中文维基百科“大连地铁”条目，不是运营方确认。
  详见[线路配色](line-colors.md)。
- **有轨电车线路信息不全。** 201、202 路的方向关系没有 `name` 和 `colour` 标签，线路名（大连公交201路、202路）
  取自父线路关系，颜色使用制式色。
- **源数据中没有 4 号线、7 号线的线路关系**，因此没有为它们配置颜色。

### 车站

- 29 个国铁 `railway=station` 节点都没有 `train=yes`。其中 25 个带 `operator=中国铁路沈阳局集团有限公司…`
  和单值 `railway:ref`，按“国铁运营方 + 车站编码”这条规则归为铁路，证据文字写在该对象详情里，
  构建时会核对编码，变化即中止。这条规则与沈阳已有的 4 处覆盖相同，但**没有经过独立人工核验**。
- 周家沟、大窑湾港、大连湾没有 `railway:ref`，甘井子的编码是多值（`54299;54300`），梭鱼湾东、海茂、龙头石、
  水师营、广宁寺南、龙头、烟台北站以及两个未命名站区缺少制式标签，共 13 条记录保留为“制式未标注”。
- 低缩放标注的 5 个重点站（大连、大连北、金州、旅顺、普兰店）是编辑选择，只用于标注排版。

## 配置在哪里

地区的全部事实只配置在 `config/` 下，前端代码里没有城市名。

| 文件 | 内容 |
| --- | --- |
| [`catalog.json`](../config/catalog.json) | 地区注册表：默认地区、各地区名称、默认视野、界面文案、数据入口文件和候选快照。服务据此生成 `/catalog.json`，前端在构建时嵌入它。 |
| [`dalian.json`](../config/dalian.json)、[`shenyang.json`](../config/shenyang.json) | 提取矩形与说明。`shenyang.json` 的哈希已被历史记录引用，本次没有改动。 |
| [`map-preview-dalian.json`](../config/map-preview-dalian.json) | 大连的重点站名单与车站制式覆盖，注明生成依据。 |
| [`line-colors.json`](../config/line-colors.json) | `dalian-metro` 运营方及线路色，含来源、置信度和与 OSM 标注的差异说明。 |

数据脚本都接受 `--region`，默认取注册表中的默认地区。快照目录名必须以地区标识开头（如 `dalian-…`），
构建器会拒绝其他名字，也会拒绝把一个地区的提取结果构建成另一个地区的快照。
`serve_probe.py` 和 `start_preview.py` 不再写死沈阳路径，默认使用默认地区的首个完整、未过期的已配置快照。

### 新增地区或快照后还要做的一步

地图名称用的字体子集必须覆盖目录里**全部**快照的名称。把大连快照加进目录后，原有的子集就缺了大连名称里的 107 个字符，
`scripts/build_map_font.py --check` 会报子集过期。要在具备字体构建环境、且目录里的快照文件齐全的目录里重新生成并再次执行 `--check`。
本次已经这样做过：子集由 501 个字符增加到 608 个，五个快照的名称缺字均为零；重建后 `--check` 和 `verify_map_font.cjs`
都在最终构建上通过，详见[地图字体](map-font.md)。

## 地区切换的行为

对应需求 R01 与 R14：

- 默认打开沈阳；地址指定了有效地区时按地址打开。只写地区不写版本时（如 `/?region=dalian`），从目录取该地区的当前版本。
- 未发布的地区会提示“暂无数据，已回到沈阳试验区”，并回到沈阳的默认视野，不会显示成一张没有铁路的空地图。
- 地址里的地区与版本不一致时，显示版本所属的地区并说明，两者不会混在一起。
- 切换地区保留筛选和查询，清空选中对象并关闭详情，回到该地区的默认视野。保留的线路筛选如果不在新地区里，
  会提示“所选线路不在此快照，可恢复全部线路”。
- 加载期间可以取消；失败时当前地区、地址、视野、筛选、查询和选中记录都保留，并提供“重试切换地区”。
  新地区的全部索引先读取并校验，通过后才替换地图上的图层。
- 切换完成后不再读取旧地区的任何资源；浏览器前进/后退按历史记录恢复地区、版本、查询和选中对象。
- 分享链接携带地区、版本、筛选、查询、视野和选中对象；文字列表只读取地址中版本的数据。

页头的地区名称在目录里有多于一个地区时是下拉框，否则只是文字。目录读取失败时地图照常可用，
可在“地区与数据版本”里重试。

## 复现大连快照

在仓库根目录执行；脚本拒绝覆盖已有的输出，重跑请换新的快照名。原始 PBF、提取结果和快照都在 Git 忽略目录里。

```powershell
& .venv/Scripts/python.exe scripts/survey_region.py --input data/raw/liaoning-261020.osm.pbf --bbox 121.10 38.74 122.05 39.47 --report data/manifests/local/dalian-survey.json
& .venv/Scripts/python.exe scripts/extract_region.py --region dalian --input data/raw/liaoning-261020.osm.pbf --output data/raw/dalian-geofabrik-20261020.osm --source-url https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf --expected-md5 c874eac87d81adaa5375c143656ef5f5
& .venv/Scripts/python.exe scripts/convert_osm.py --input data/raw/dalian-geofabrik-20261020.osm --output data/raw/dalian-geofabrik-20261020.osm.pbf
& .venv/Scripts/python.exe scripts/build_mvp.py --region dalian --input data/raw/dalian-geofabrik-20261020.osm.pbf --metadata data/raw/dalian-geofabrik-20261020.osm.metadata.json --source-manifest data/raw/dalian-geofabrik-20261020.source.json --output-dir data/processed/NEW_DALIAN_SNAPSHOT_ID
& .venv/Scripts/python.exe scripts/verify_snapshot.py data/processed/NEW_DALIAN_SNAPSHOT_ID
node scripts/verify_mvt_integrity.mjs data/processed/NEW_DALIAN_SNAPSHOT_ID
node scripts/verify_client_contracts.mjs data/processed/NEW_DALIAN_SNAPSHOT_ID
& .venv/Scripts/python.exe scripts/verify_route_identity.py data/processed/NEW_DALIAN_SNAPSHOT_ID --xml data/raw/dalian-geofabrik-20261020.osm --expect-lines 8 --expect-directions 20
```

本次的指纹：提取 XML SHA-256 `2a5fe3afa6a15dcae0d17a458bee8378fec71d19fe90e53d8afc2f0ffe285ec6`（5,181,201 字节，
27,821 个节点、3,024 条线路、140 个关系，缺失引用 0）；`dataset.json` 的 SHA-256 和瓦片索引指纹见接入证据。

2026-11-24 做过重放验证。`extract_region.py` 用同样的输入和参数重放到新文件名，结果与原提取逐字节相同。
`build_mvp.py` 用相同的输入重建时，1,577 个瓦片、瓦片索引、要素/车站/线路/对象索引和全部详情分片都与已发布的快照逐字节相同，
只有 `dataset.json` 的构建时间与保留期、`rust-report.json` 的处理耗时不同。
比较时要注意：快照标识写在每个要素的 `snapshot_id` 属性里，换一个目录名重建，瓦片和索引的大小与哈希就必然不同。
要验证一个快照可复现，须在另一个位置用相同的标识重建（构建器只拒绝已存在的目录），比较后删除重放目录。

## 验证入口

```powershell
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
python scripts/serve_probe.py --port 8766
# 另设 PLAYWRIGHT_MODULE、PREVIEW_URL=http://127.0.0.1:8766 和独立的 PREVIEW_EVIDENCE
node scripts/verify_region_switch.cjs
```

`verify_region_switch.cjs` 需要两个地区都各有完整快照，覆盖页头切换、状态一致性、分享链接、前进/后退、
失败重试、取消、未知地区、目录失败、文字列表和 390×844 下的页头布局，全程关闭底图，不请求公共瓦片。
它还读取地图上实际绘制的要素：默认视野下的轨道每一个都必须属于当前显示的地区；放大到大连北站后，
“站场与设施”关闭时没有设施被绘制，打开后绘制的道岔、站台等设施全部属于大连快照。共 17 项，在最终构建上通过。

## 回归脚本的现状

2026-11-24 在最终构建 `index-C_uGsf3N.js` 上把 `scripts/verify_*.cjs` 跑了一遍，逐项结果见接入证据。
63 个脚本里，`verify_region_switch`、`verify_basemap_zoom`、`verify_lan_details` 单独运行并通过；
`verify_client`、`verify_preview`、`verify_installed_browsers`、`verify_license_inventory` 没有运行；其余 56 个全部运行，53 个通过。

几个旧脚本把“当前版本”写死为 `shenyang-mvp-20261023`，而目录的当前版本是 `shenyang-mvp-geometry-20261027`。
`verify_catalog`、`verify_react_details`、`verify_mvp_work` 要用 `MVP_CURRENT_SNAPSHOT` 或 `MVP_DATA_DIR` 指定当前版本；
`verify_map_feedback`、`verify_real_routes` 没有参数，要另起一个 `--data-dir data/processed/shenyang-mvp-20261023` 的预览再跑
（`verify_real_routes` 这样能越过版本断言，但仍停在下面说的既有失败点）。

## 已知限制

- 大连数据没有独立人工审核；需求 §6 的两名审核者和抽查包都还没有。
- 需求 §2 写明其他区域“通过数据验收后加入区域目录”。大连先于验收进入本机目录，是否允许这样列出需要项目负责人决定。
- 没有重测性能；N01–N04、N09 的真实设备验收不变。
- 地铁线路色没有运营方来源；1 号线、5 号线等线路在源数据中的轨道成员很少。
- 量化几何门禁为大连做了一处细化（规则版本 `quantized-geometry-v2`），说明见[瓦片几何修订](mvt-integrity.md)，待负责人确认。
- 最终构建上有 3 个既有回归脚本没有通过，在未改动的 `bae01c2` 构建上同样复现，本轮没有修改它们：
  `verify_real_routes`（页面上有两个“恢复全部线路”按钮，全页定位冲突）和 `verify_line_label_levels`
  （到 `tracks` 源里找名称图层，名称实际在 `rail-line-labels` 源上）稳定失败；`verify_product_label_spacing`
  （只改地址 hash 的场景有时读到零个标注）偶发，最终构建 13 次通过 11 次，基线 13 次通过 10 次。
  它们没走到的步骤没有被验证。
