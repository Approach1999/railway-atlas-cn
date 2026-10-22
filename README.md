# Railway Atlas CN · 中国铁路地图

面向全国的铁路地图项目。首个试点为沈阳，随后扩展到东北与全国。
当前阶段：项目与数据流水线初始化，尚未实现地图应用。

## 目录与架构草案

```text
apps/web/           地图前端（计划 TypeScript + MapLibre GL JS）
crates/            Rust 数据处理与可选 API（尚未创建 Cargo 工程）
config/            可版本化的区域与筛选配置
scripts/           可复现的数据提取入口
docs/              架构、数据源与许可说明
data/raw/          原始 PBF，本地保存，Git 忽略
data/processed/    提取结果，本地保存，Git 忽略
data/manifests/    小型溯源记录，可提交
```

首期先跑通静态数据到地图的链路。Rust 用于后续清洗、拓扑和可选后端；
WebAssembly 等性能测量后再决定。详细边界见 [架构草案](docs/architecture.md)。

## 第一步：沈阳数据

按 [数据操作指南](docs/data-pipeline.md) 安装 Osmium Tool、下载并保留一份中国 PBF，运行：

```sh
python scripts/extract_osm.py --help
python scripts/extract_osm.py --input data/raw/china-snapshot.osm.pbf --source-url https://download.geofabrik.de/asia/china-latest.osm.pbf
```

请先阅读指南：全国原始文件较大；脚本不会自动下载或覆盖结果。
完成后检查 `data/manifests/shenyang.json`，将其与配置、脚本一同提交。
后续复现须使用相同输入 SHA-256、区域配置与 Osmium 版本。

## 数据与许可

地图数据：© OpenStreetMap contributors，ODbL 1.0；下载服务：Geofabrik。
详见 [数据来源与署名](docs/data-sources.md)。应用代码许可证尚未选定，
数据许可不自动成为应用代码许可。不要提交原始或派生的大型数据文件。
