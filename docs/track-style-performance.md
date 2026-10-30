# 描边修复后的本机性能复测

2026-10-25，固定真实快照 `shenyang-mvp-20261023`，构建 `index-D7DCoTuz.js`。
每次首屏计时同时记录实际安装图层：37 个预期图层，包括 16 个描边和城市轨道外轮廓，无缺失。
这补上旧测量没有确认描边实际存在的问题；旧报告保留为历史记录，不直接作速度对照。

## 条件与结果

Windows 10.0.26200 x64、Intel Core Ultra 5 125H、18 逻辑核、约 32 GiB 内存，
Chrome 155.0.8059.85，无头浏览器，1440×1000 CSS 像素。
默认渲染实际为 Intel Arc / D3D11；软件路径显式使用 SwiftShader。
网络模拟 10 Mbps 下行、100 ms 延迟；每条路径串行完成 30 个独立上下文冷启动、100 次热查询、100 次筛选。
底图关闭，所有测试第三方请求为 0；没有批量请求公共底图。

| 指标 | 默认硬件路径 | 强制软件路径 |
| --- | ---: | ---: |
| 首个铁路视图 median / p95 / max | 1594.3 / 1866.0 / 1869.8 ms | 1613.8 / 1726.7 / 1783.3 ms |
| 索引就绪 median / p95 / max | 1057.3 / 1421.7 / 1437.2 ms | 1080.6 / 1133.4 / 1190.8 ms |
| 热查询 p95（含输入防抖） | 217.5 ms | 214.2 ms |
| 筛选界面与两次 rAF p95 / max | 20.8 / 386.1 ms | 48.3 / 64.2 ms |
| 首屏自有响应体 / 含 HTTP 头传输 | 678,179 / 689,344 B | 678,179 / 689,344 B |

首屏诊断要求轨道实际绘制、轨道与车站源加载完成，并另外检查搜索框能聚焦。
它没有逐次点击首屏铁路对象，因此不是完整 N01 交互验收。
筛选数字是界面更新与两次 rAF 的代理，不能证明瓦片工作线程重排、GPU 完成或所有筛选组合都满足 N02。
两条路径的 p95 低于相应桌面首屏、热查询和自有传输预算，仅适用于上述条件。

同一沈阳北站场锚点 node/676578837、z15.5、设施开启、30 秒、300 次方向键平移：
此前文字误写为“苏家屯”，已根据源名称更正；输入坐标与原始测量记录未改。

| 指标 | 默认硬件路径 | 强制软件路径 |
| --- | ---: | ---: |
| MapLibre render 间隔 median / p95 / max | 9.6 / 11.6 / 35.9 ms | 21.2 / 37.2 / 49.8 ms |
| rAF 间隔 p95 | 10.2 ms | 41.6 ms |
| 按 60 Hz 估算掉帧比例 | 0.032% | 31.94% |
| >50 ms 长任务 / 提示 DOM mutation | 0 / 0 | 0 / 0 |

软件路径的 render p95 仍超过 33 ms，保持待优化。掉帧比例是 rAF 推算，render 事件是主线程提交，
两者都不是显示器实际呈现帧或 GPU 完成时间。不同路径的先后测量也不能用来宣称软件更快或修复带来提速。

## 防止缺失图层产生无效结果

`atlas:first-usable` 的本地诊断详情增加预期图层和缺失图层列表。
两个性能脚本共同调用 `benchmark_style_guard.cjs`，缺少描边或外轮廓即失败。
`verify_style_layer_guard.cjs` 在隔离浏览器中仅改写响应内容，重现旧 zoom 嵌套错误；
正常构建被接受，17 个图层缺失的故障构建被拒绝，尽管其中心轨道仍能绘制。
此验证不修改生产文件或数据，避免单凭“没有 pageerror”或配色计算误判样式已安装。

65 项单元/领域检查、严格 TS/checkJs 与生产构建、真实 other 制式地图/列表与 WebGL 失败回退 4 项回归通过。
实际 200% 走查仍对应此前 UI 等价构建，见 [200% 证据](evidence/actual-zoom-200.json)，不重新标成这次构建的人工验收。
本轮只增加本地诊断和测试守卫，没有改变线型、数据或布局。

## 证据与后续门槛

首屏明细：[默认](evidence/track-style-performance-default.json)、[软件](evidence/track-style-performance-software.json)；
平移原始间隔：[默认](evidence/track-style-pan-default.json)、[软件](evidence/track-style-pan-software.json)；
[真实故障守卫](evidence/track-style-layer-guard.json)、[渲染与回退回归](evidence/track-style-performance-regression.json)、
[构建指纹](evidence/track-style-performance-build.json)。

原快照全部 2,251 个 MVT 的既有 gzip 检查仍见 [瓦片体积报告](evidence/mvp-real-relations-tile-sizes.json)，本轮没有重做该全量检查。
真实手机/平板、在线底图总传输、完整筛选渲染、目标浏览器矩阵与物理呈现验证仍待完成，N01–N04 不整体关闭。

复测时使用既有预览，设 `PLAYWRIGHT_MODULE`、`PREVIEW_URL`、`BENCH_SNAPSHOT=shenyang-mvp-20261023`、
`MVP_DATA_DIR=data/processed/shenyang-mvp-20261023`、独立 `PREVIEW_EVIDENCE`；
`BENCH_RUNS=30`、`BENCH_INTERACTIONS=1`、`BENCH_DIAGNOSTICS=1`。
对 `BENCH_RENDERER=default` 和 `software` 分别串行运行 `node scripts/benchmark_client.cjs`、
`node scripts/benchmark_pan.cjs`，最后运行 `node scripts/verify_style_layer_guard.cjs`。
