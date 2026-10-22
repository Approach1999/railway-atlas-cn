# Railway Atlas CN · 中国铁路地图

面向全国的铁路地图项目。首个试点为沈阳，随后扩展到东北与全国。
当前阶段：已完成真实沈阳样本可行性验证及 v1.0 需求、设计与技术架构；正式地图产品尚待实施。

## 项目文档

从 [文档总览](docs/README.md) 开始：

- [可行性报告与实测证据](docs/feasibility.md)
- [需求规格](docs/requirements.md)
- [交互与视觉设计](docs/design.md)
- [技术架构](docs/architecture.md)
- [实施与验收计划](docs/implementation-plan.md)
- [复现本次真实样本](docs/reproduce-pilot.md)

## 目录与架构

```text
apps/web/           地图前端；probe/ 为本机技术探针
crates/            Rust 城市 PBF 读取与几何转换探针
config/            可版本化的区域与筛选配置
scripts/           可复现的数据提取入口
docs/              架构、数据源与许可说明
data/raw/          原始 PBF，本地保存，Git 忽略
data/processed/    提取结果，本地保存，Git 忽略
data/manifests/    小型溯源记录，可提交
```

已跑通样本 PBF → Rust → GeoJSON / PMTiles → 浏览器。
正式前端采用 TypeScript + React + MapLibre；Rust 用于离线计算，静态数据服务先行。
WASM 与常驻 API 按性能/需求门槛再引入。详见 [技术架构](docs/architecture.md)。

## 第一步：沈阳数据

按 [数据操作指南](docs/data-pipeline.md) 安装 Osmium Tool、下载并保留一份中国 PBF，运行：

```sh
python scripts/extract_osm.py --help
python scripts/extract_osm.py --input data/raw/china-snapshot.osm.pbf --source-url https://download.geofabrik.de/asia/china-latest.osm.pbf
```

请先阅读指南：全国原始文件较大；脚本不会自动下载或覆盖结果。
完成后检查 `data/manifests/local/shenyang.json`，审核后复制到有快照标识的记录位置再提交。
local 目录被忽略，仓库中已保存的历史实验记录不会被覆盖。
后续复现须使用相同输入 SHA-256、区域配置与 Osmium 版本。

## 数据与许可

地图数据：© OpenStreetMap contributors，ODbL 1.0；下载服务：Geofabrik。
详见 [数据来源与署名](docs/data-sources.md)。应用代码许可证尚未选定，
数据许可不自动成为应用代码许可。不要提交原始或派生的大型数据文件。
