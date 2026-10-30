# 发布详情的几何完整性

2026-10-27。补齐 N05 的完整详情几何检查，产品应用和已有不可变数据均不改动。

## 新增检查

原独立快照验证器已核对资产字节/指纹、身份、分片、数量与引用，但没有逐条检查几何。
现在对每条发布详情检查二维有限 WGS84 坐标、最少点数、零长度边、路径中重复坐标，
以及多边形环闭合和非零面积。闭合路径允许首点在末尾重复一次；不同 MultiLineString
分段的公共端点分别保留，不把真实连接点当重复对象。不会修复、移动或吸附原坐标。
环面积先平移到局部原点求和，避免小站区因大经纬度乘积抵消被误判。

构建器在现有具名排除与 LineString 连续重复点规范化之后，检查所有待发布几何。
新的违规记录会带源 typed ID 和坐标路径停止构建，发生在切瓦片/重命名为发布目录之前，
不会静默丢弃问题对象，也不会覆盖已有快照。
模块支持当前原始详情契约的 Point、LineString、MultiLineString、Polygon；
向量瓦片裁切后的 MultiPolygon 属于另一条路径，不以原始详情规则替代其校验。

## 当前实际结果

| 快照 | 全部详情 | 点 | 线 | 面 | 坐标记录数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| shenyang-mvp-20261023 | 10,216 | 6,010 | 4,166 | 40 | 43,600 |
| shenyang-mvp-accessible-20261022 | 10,167 | 5,964 | 4,163 | 40 | 43,543 |
| shenyang-mvp-progress-20261022 | 10,167 | 5,964 | 4,163 | 40 | 43,543 |

三个实际快照的六组独立完整性检查均通过，包含每条完整详情的新几何检查。
线数包含符合发布契约的线状设施，不将 4,166 误称为轨道数量；坐标记录数包含闭合末点，
也不把跨快照重复记录宣传为新的独立对象。
当前快照 manifest 与先前真实样本包的指纹一致；所有详情分片与其原 manifest 一致。

七项几何/门禁测试和十三项既有关系/站区单元检查通过。
测试包含 NaN/Infinity、布尔值伪装数值、越界/过大整数、额外维度、重复点、短线、
未闭合/零面积环、内环、真实公共端点与小环、原输入不变。
另构造自洽资产指纹的坏快照，确认不能只靠哈希通过几何门禁；
通过真实 build_mvp.main 路径、受控 Rust 输出，确认坏站区会在切瓦片/发布前阻断。
后者是明确的夹具测试，没有执行完整 Rust/PBF 重建或把夹具冒充真实数据。

## 边界与复现

不证明面自相交/洞的拓扑、道路网络连通、瓦片量化/裁切后几何、现实位置或分类正确。
不是完整 N05/N08、独立人工审核或生产保留期验收；完整目标继续保持进行中。
本轮没有改应用或重建数据，因此没有重复浏览器、前端构建或性能测量。

```powershell
.venv/Scripts/python.exe -m unittest discover -s scripts -p test_geometry_integrity.py -v
.venv/Scripts/python.exe -m unittest discover -s scripts -p test_mvp_data.py -v
.venv/Scripts/python.exe scripts/verify_snapshot.py data/processed/shenyang-mvp-20261023 --report data/manifests/local/geometry-integrity/current.json
```

其他两个快照同样运行 verify_snapshot.py，报告写入独立目录，不修改快照。
[汇总与输入/代码指纹](evidence/geometry-integrity.json)、[当前快照](evidence/geometry-integrity-current.json)、
[accessible](evidence/geometry-integrity-accessible.json)、[progress](evidence/geometry-integrity-progress.json)。
