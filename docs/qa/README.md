# 沈阳真实数据抽查包（待人工验收）

2026-10-27 默认预览为 `shenyang-mvp-geometry-20261027`，对应[新的 115 条真实样本](shenyang-geometry-20261027-samples.json)
与[本轮说明](shenyang-geometry-20261027.md)。独立签字、地图与分类判断仍全部待完成。

以下保留 2026-10-24 快照 `shenyang-mvp-20261023` 的历史 [106 条样本](shenyang-samples.json)，
供人工复查；样本仅从 10,216 个实际发布对象选择，排除未发布候选，不创建合成对象填额度。
排序使用快照与 typed ID 的 SHA-256，结果可重复；同一对象可覆盖多个检查组，共 45 组。

每条记录保存源标签、版本/时间、分类规则/告警、线路/颜色依据、几何类型/指纹和本机地图相对链接。
原标签、版本及时间的 UTC 瞬间已逐条与保存的同日期 XML 比较；XML 指纹必须与快照来源一致，
同时固定 manifest、轻索引、线路和所用详情分片的指纹。不将不同日期线上对象混入原件对账。

生成时实际发现：轻对象索引省略桥隧等原标签及部分配色证据，不能据此宣称该类不存在。
现从完整详情限定发布集合后选样，当前有 480 个带桥梁标签轨道和 207 个带隧道标签轨道可供检查；
共线和制式回退样本也从完整证据读取。时间字符串形式不同按 UTC 瞬间比较，保留源字符串。
没有匹配到已发布对象的类别明确列出，不把“当前快照无记录”扩展成现实中没有设施。

## 人工复查步骤

1. 保持当前快照，启动本机预览，将样本 `view` 接在本机服务地址后打开。样本链接启用全部类型/状态和设施，
   方便发现已停用、废弃和被默认隐藏的对象；链接不会改变其他窗口。
2. 按地图展示核对身份、位置、名称、类型/状态、颜色/线型、等级依据、线路关系和缺失说明；
   标签原件相同不代表分类/运营判断正确。检查两个铁路锚点与邻近同名地铁没有误合并。
3. 将本生成包复制到独立审核记录后填写 `map_display_review`、`classification_review`、`deviation`，
   保留本包指纹；不要直接在生成文件填签字后又运行生成器覆盖。
4. 由两名独立审核者记录自己的签字和日期；分歧按既有需求交第三人/项目负责人裁决。
   当前两个签字字段及地图/分类人工判断全部为空，`human_review_complete=false`。

源码编号的 OSM 外链便于追溯，但在线对象可能已更新，验收以保存的日期原件为对照。
几何只保存指纹与地图代表位置，不将原始完整几何复制到代码仓库。
样本标签属于 OSM 数据，署名 OpenStreetMap contributors / Geofabrik，ODbL 1.0，声明包含在 JSON 中。

## 覆盖表

| 检查组 | 当前发布可选数 | 选样 / 目标 | 取样状态 |
| --- | ---: | ---: | --- |
| `identity-anchor:node/6179162407` | 1 | 1 / 1 | target_met |
| `identity-anchor:node/676578837` | 1 | 1 / 1 | target_met |
| `identity-anchor:node/13028356638` | 1 | 1 / 1 | target_met |
| `identity-anchor:node/11224161741` | 1 | 1 / 1 | target_met |
| `station-areas` | 4 | 4 / 4 | target_met |
| `station-mode:rail` | 5 | 2 / 2 | target_met |
| `station-mode:subway` | 145 | 2 / 2 | target_met |
| `station-mode:tram` | 160 | 2 / 2 | target_met |
| `stations-20` | 361 | 20 / 20 | target_met |
| `tracks-20` | 4150 | 20 / 20 | target_met |
| `track-grade:high_speed` | 260 | 5 / 5 | target_met |
| `track-grade:conventional_main` | 626 | 5 / 5 | target_met |
| `track-grade:conventional_other` | 54 | 5 / 5 | target_met |
| `track-grade:branch` | 2638 | 5 / 5 | target_met |
| `track-grade:industrial` | 14 | 5 / 5 | target_met |
| `track-state:disused` | 11 | 2 / 2 | target_met |
| `track-state:abandoned` | 68 | 2 / 2 | target_met |
| `track-attribute:bridge` | 480 | 2 / 2 | target_met |
| `track-attribute:tunnel` | 207 | 2 / 2 | target_met |
| `facility:platform` | 51 | 5 / 5 | target_met |
| `facility:stop_position` | 318 | 5 / 5 | target_met |
| `facility:entrance` | 137 | 5 / 5 | target_met |
| `facility:signal` | 0 | 0 / 5 | no_published_source_records |
| `facility:switch` | 2395 | 5 / 5 | target_met |
| `facility:level_crossing` | 2333 | 5 / 5 | target_met |
| `facility:buffer_stop` | 461 | 5 / 5 | target_met |
| `facility:depot` | 0 | 0 / 5 | no_published_source_records |
| `facility:yard` | 9 | 5 / 5 | target_met |
| `facility:works` | 0 | 0 / 5 | no_published_source_records |
| `facility:maintenance` | 0 | 0 / 5 | no_published_source_records |
| `facility:water_tower` | 0 | 0 / 5 | no_published_source_records |
| `facility:turntable` | 1 | 1 / 5 | all_available |
| `facility:roundhouse` | 0 | 0 / 5 | no_published_source_records |
| `facility:wash` | 0 | 0 / 5 | no_published_source_records |
| `facility:fuel` | 0 | 0 / 5 | no_published_source_records |
| `facility:loading_ramp` | 0 | 0 / 5 | no_published_source_records |
| `metro-line:shenyang-metro/1` | 4 | 1 / 1 | target_met |
| `metro-line:shenyang-metro/2` | 4 | 1 / 1 | target_met |
| `metro-line:shenyang-metro/3` | 20 | 1 / 1 | target_met |
| `metro-line:shenyang-metro/4` | 6 | 1 / 1 | target_met |
| `metro-line:shenyang-metro/9` | 4 | 1 / 1 | target_met |
| `metro-line:shenyang-metro/10` | 2 | 1 / 1 | target_met |
| `shared-track` | 46 | 1 / 1 | target_met |
| `missing-line-colour` | 71 | 1 / 1 | target_met |
| `light-colour-line` | 26 | 1 / 1 | target_met |

取样状态不是验收状态。转车盘只有 1 条，按规则覆盖全部；九个设施类别当前无发布记录，保留缺口说明。
20 站点/20 片段、五类铁路等级各 5 条、六条地铁、桥隧、共线/缺色/浅色均已有可打开的真实样本。

```powershell
python scripts/prepare_qa_samples.py
python scripts/prepare_qa_samples.py --check
```

可用 `--data-dir`、`--source-xml` 和 `--output` 指向新批次；必须使用 manifest 指纹匹配的原件。
[取样/配额检查记录](../evidence/qa-sampling-checks.json)只证明取样和保存源对账，不证明人工展示与独立验收完成。

## 展示检查进展

12 个真实样本的自动地图/列表字段对照见 [统一详情字段](../record-details.md)。这不填写本包人工判断或两名签字，
也不将 12 个自动检查扩大为所有 106 个样本、分类正确或独立人工验收。
