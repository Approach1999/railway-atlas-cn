# Railway Atlas CN · 中国铁路地图

面向全国的铁路地图项目。首个试点为沈阳，随后扩展到东北与全国。
当前阶段：沈阳 MVP 实现与验收中，已接入真实铁路、地铁线路关系、车站与设施；完整验收尚未通过。

当前使用 [真实关系数据指南](docs/real-shenyang-data.md) 构建日期快照，
或查看 [MVP 完成审计](docs/mvp-status.md) 中已完成与待完成事项。
继续开发请阅读 [AI 接手清单](docs/AI-HANDOFF.md)，其中列出待办、验收条件和已排除的性能方案。
准备试用请看 [启动与验收指南](docs/trial-guide.md)：Windows可双击根目录 `start-preview.cmd`，同Wi-Fi手机试用使用 `start-preview.cmd --lan`；需先准备下述数据和依赖。
已准备数据和前端依赖时运行：

```sh
npm run build --prefix apps/web/client
python scripts/serve_probe.py --port 8766
```

默认打开 `http://127.0.0.1:8766`，数据目录为 `data/processed/shenyang-mvp-geometry-20261027`。
这是同一份 2026-10-20 源数据的[瓦片几何修订](docs/mvt-integrity.md)，不表示源数据已经更新；旧分享快照保留。
六条地铁按线路色显示、有轨电车使用制式色，提供中文搜索、类型/状态筛选、来源详情、分享、
可隐藏底图、文字列表和版本回退。旧实验数据继续保留。

已增加[第一批可运行沈阳铁路主图](docs/preview-v1.md)：线路等级配色、沿线名称、站名、
搜索/预设与触屏候选选择；本机矢量瓦片按需加载。该预览仍在 probe 中，不代表完整 React 产品已交付。

当前入口升级为 [React 版与可隐藏底图](docs/basemap-preview.md)：底图独立开关、偏好记忆、
加载失败回退；正式类型化与完整产品验收仍在继续。默认本机服务打开 client 构建结果。

## 项目文档

从 [文档总览](docs/README.md) 开始：

- [可行性报告与实测证据](docs/feasibility.md)
- [需求规格](docs/requirements.md)
- [交互与视觉设计](docs/design.md)
- [线路等级与配色](docs/line-colors.md)
- [技术架构](docs/architecture.md)
- [实施与验收计划](docs/implementation-plan.md)
- [复现本次真实样本](docs/reproduce-pilot.md)
- [当前依赖安全核对与 Python 哈希锁](docs/dependency-security.md)
- [页面安全策略与实际浏览器验证](docs/security-policy.md)
- [原生依赖与实际工具链](docs/native-toolchain.md)

## 目录与架构

```text
apps/web/           地图前端；probe/ 为本机技术探针
crates/            Rust 城市 PBF 读取与几何转换探针
config/            可版本化的区域、筛选与线路配色配置
scripts/           可复现的数据提取入口
docs/              架构、数据源与许可说明
data/raw/          原始 PBF，本地保存，Git 忽略
data/processed/    提取结果，本地保存，Git 忽略
data/manifests/    小型溯源记录，可提交
```

已跑通样本 PBF → Rust → GeoJSON / PMTiles → 浏览器。
正式前端采用 TypeScript + React + MapLibre；Rust 用于离线计算，静态数据服务先行。
WASM 与常驻 API 按性能/需求门槛再引入。详见 [技术架构](docs/architecture.md)。

## 后续：中国全量数据入口

沈阳 MVP 使用上面的省级日期快照指南。后续全国阶段可按 [数据操作指南](docs/data-pipeline.md)
安装 Osmium Tool、下载并保留一份中国 PBF，运行：

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
