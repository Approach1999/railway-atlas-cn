# 沈阳铁路主图 · 第一批可运行预览

这是 v1.3 规格的第一批实现，不代表 P1/P2 全部完成。
在原生 JS 探针内验证真实地图行为，React/TypeScript 产品迁移尚未完成。
后续已增加 [React 入口与可隐藏底图](basemap-preview.md)；下文保留第一批能力与验证边界。

## 本批能力

- Rust 输出线路显示等级、名称来源、分类规则与警告；站场 service 优先于走廊 usage/highspeed。
- 高速红、普速蓝、支线/站场线棕色；区域级线路名称与重点站名，放大增加普通站。
- 铁路概览、仅高速、仅普速和城市轨道预设；一次撤销，详细显示选项折叠。
- 中文名称/别名匹配、铁路/地铁消歧、键盘选择；隐藏结果仅临时显示，不清空筛选。
- 点选轨道/车站与重叠候选，详情按需读取；手机底部面板与地图署名避让。
- 轨道按视野加载 MVT；启动仅载站点索引、配置和小型目录，不载完整轨道 GeoJSON。

未完成：正式地理底图、地铁分线路关系与配色、设施细节、完整生命周期线型区分、
全国目录、分享 URL、数据更新发布流水线和正式浏览器/设备验收。
目前非当前状态共用虚线作为第一批展示，不能宣称 v1.3 生命周期样式全部实现。
分类覆盖的审核规则注册表尚未实现，仅使用显式标签；未知/多值保留警告和回退。
站区面未生成代表点，本批搜索/符号仅含源站点 node，不自动合并站区 way。

## 复现

先按 [数据提取指南](data-pipeline.md) 准备有界沈阳 PBF 和对应的来源记录。
需要 Python 3.10+、Rust、Node/npm。示例使用已保留的本次输入；路径不存在时先获取样本，
不得创建占位数据。原始 PBF 与生成目录均由 Git 忽略。

```sh
npm ci --prefix apps/web/probe --ignore-scripts
cargo fetch --locked
python scripts/build_preview.py --input data/processed/shenyang/railway.osm.pbf --source-manifest data/raw/shenyang-overpass.source.json --output-dir data/processed/shenyang-map-20261022
python scripts/serve_probe.py --app probe --data-dir data/processed/shenyang-map-20261022 --port 8766
```

打开本机 `http://127.0.0.1:8766/`。输出已存在时换一个目录名，并把服务的 --data-dir 指向新目录。
构建先写 `.building-*` 目录，全部成功后重命名为目标；失败保留中间输出，不覆盖旧快照。
脚本先检查来源 bbox 是否为沈阳试验矩形，但不能仅凭 bbox 验证任意 PBF 的来源真实性；
输入与来源必须来自同一次提取，实际输入 SHA-256 单独写入 dataset.json。

本机 WSL 工具启动被环境限制阻断，第一批改为使用锁文件中已存在的
`@maplibre/geojson-vt 6.3.0` 与 `@maplibre/vt-pbf 4.3.2` 生成静态 MVT 目录。
无需 WSL、字体服务或在线瓦片服务。正式大规模 Tippecanoe/PMTiles 方案不因此变更；
本次未证明此内存型 Node 构建器适合全国。

### 文件与身份

| 文件 | 用途 |
| --- | --- |
| railway.geojson / report.json | Rust 完整转换与统计，仅用于本地构建/审查 |
| tracks.geojson | 精简瓦片输入；浏览器不下载 |
| stations.geojson | 小型站点/别名索引，搜索与绘制共用 |
| tiles/{z}/{x}/{y}.pbf | z8–14 MVT，z15+ 过缩放；不含原始 tags |
| tiles/build.json | 全部瓦片指纹与字节清单，仅用于离线审计 |
| details/{shard}.json | feature_key UTF-8 SHA-256 首字节的两位十六进制分桶，点击懒加载 |
| dataset.json / palette.json | 小型快照目录与版本化配色，不把完整瓦片清单加载到首屏 |

源身份仍用 osm_id（node/123、way/123）；渲染身份与源身份分离。
GeoJSON 站点使用唯一数值渲染 ID 并以 osm_id promoteId；MVT 不写伪造的整数源 ID。
`config/map-preview.json` 的重点站名单只决定标签优先级，不推断客流/站级。
其中四个站点制式覆盖记录源 operator/railway:ref 证据，构建时检查 expected_ref；
其余缺失制式保持 unknown。修改源数据时须重新复核覆盖记录，不按站名猜测。

## 验证

```sh
cargo test --locked --offline
cargo clippy --locked --offline -- -D warnings
node --test apps/web/probe/model.test.mjs
python scripts/validate_line_colors.py --strict
```

浏览器集成检查使用独立的 Playwright 测试环境与已安装 Chrome；Playwright 不进入前端依赖。
在能解析 playwright 模块的 Node 环境执行 `node scripts/verify_preview.cjs`；如模块位于单独工具目录，
设置 PLAYWRIGHT_MODULE 为其绝对模块路径。可通过 PREVIEW_URL、PREVIEW_EVIDENCE、
PLAYWRIGHT_CHANNEL 指定本机地址、证据输出目录与浏览器，默认分别为 8766、
`data/manifests/local/preview-browser` 和 chrome。

检查覆盖：主要站名与线路名、仅高速、预设撤销、中文/键盘搜索、临时显示、
地图重叠候选、390px 手机布局/署名、外部请求与完整轨道下载、浏览器与 HTTP 错误。
测试对我们自己的 app.js 响应增加地图访问句柄以检查真实渲染结果；正式代码不导出该句柄。
截图和报告是桌面 Chrome 与手机模拟结果，不替代真实 Android/iPhone 测试或独立用户测试。

本次保留证据：[重复构建](evidence/preview-v1-build.json)、
[浏览器检查](evidence/preview-v1-browser.json)、[桌面截图](evidence/preview-v1-desktop.png)。
6 项 Rust 领域测试、3 项前端规则测试与 9 项浏览器流程通过；
两次构建的 3,156 个数据/索引/瓦片/详情文件字节一致（不比较含耗时的 report 或快照名不同的目录）。

历史探针的原始哈希验证与 PMTiles 格式对照，应在 cc943a0 版本按
[历史复现指南](reproduce-pilot.md) 执行；不要用新增属性后的 Rust 输出去比较旧 GeoJSON 字节哈希。
