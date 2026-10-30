# 当前真实快照性能与平移更新

最新本机构建的筛选复测见[城轨描边与性能](urban-boundary.md)：概览 p95 84.3 ms，站场 38.1 ms；前后均在 100 ms 内，未测得本次改动带来的 p95 改善。历史超标和其他验收门槛继续保留。

2026-10-28：默认快照已更新，最新筛选及首屏重测见[当前几何快照性能](geometry-performance.md)。概览筛选 p95 104.3 ms，仍未达到 100 ms；本页以下数字保留为各自历史构建记录。

2026-10-27：正式名称管线已变化，最新结果见[标注正式接线](line-label-integration.md)。
后续已[复用当前视图的名称几何](line-label-filter-cache.md)，概览筛选 p95 达到 90.1 ms；本页及下列链接继续保留各自历史构建范围。

2026-10-25 补记：本页数字保留为此前构建的历史基线。后续发现描边宽度表达式会导致图层创建失败，
已在[样式校验修复](track-style-validation.md)中修正并验证实际绘制。
旧测量没有证明所有描边有效，不能作为修复后构建的 N01–N04 验收。
已完成[描边实际安装后的新测量](track-style-performance.md)：桌面两路径各 30 次冷启动、100 次热查询和 30 秒站场平移；
默认 render 间隔 p95=11.6 ms，软件=37.2 ms，软件仍超目标。完整筛选渲染、真实设备及其余门槛保持开放。
后续补充[筛选后源就绪 render/idle 测量](filter-performance.md)，并减少重复车站源提交；
默认概览的源就绪 render p95 观测为 142.3→71.0 ms，软件仍超目标，不与本页历史平移数字混用。
另见[闭合空间轨迹与分组诊断](pan-diagnostics.md)：新方法下软件三次 p95 50.3/44.6/39.0 ms，仍未达标；
键盘输入固定不等于实际地理路径一致，新旧协议不能直接当成前后提速对照。

2026-10-24。固定 `shenyang-mvp-20261023`，对应当前 React/TS 客户端、真实 12 条城市轨道关联与设施。
不把 [旧快照性能报告](performance.md)直接当成当前数据的证明，也不以默认 GPU 覆盖软件失败记录。

## 移除了什么

每次 moveend 原来都会重设位置无关的站区/设施筛选、发布相同 zoom/schemaVersion 的控件对象，
并把同一条提示再次写入 DOM。MapLibre 的 Style.setFilter 在深比较相同时可以返回，
但 Map.setFilter 的公开包装仍会调用 _update(true)，不能据此认为重复调用完全没有成本。

当前平移结束只检查覆盖/选中提示、同步实际 zoom 与 URL。设施筛选仍在图层/版本/数据变化时更新，
缩放可见性由图层 minzoom 执行，zoom 提示按实际新值更新。控制会话的相同字段更新不发布快照，
不改变 session、筛选或焦点；提示 DOM 仅在内容/hidden 实际变化时写入。

同一 300 次键盘轨迹，提示 DOM mutation 从 299 次降为 0 次。纯存储测试也确认相同 zoom 的 300 次更新不唤醒订阅者。
浏览器验证平移 URL 仍更新、设施输入身份与选择保留；设施在 13.5 开启后围绕站点滚轮放大，
跨过 14/15 可点击实际道岔，再缩小提示恢复。没有通过关闭图层、减少数据或降低对比度达到效果。

验证脚本首版固定了缩放后移出视口的抽查点，后又误用 Rust 中间记录的 rail_mode="switch" 过滤候选。
现使用发布轻索引中的规范制式配合源几何，围绕目标缩放，仍要求实际可见且 typed ID 点击一致；未改产品数据填补测试。

## 软件路径的对照与限制

| 同一软件路径、当前快照 | rAF p95 | 提示 DOM 写入 | 判断 |
| --- | ---: | ---: | --- |
| 本轮新基线 | 33.3ms | 299 | 高于 33ms 目标 |
| 去除重复更新后 | 33.4ms | 0 | 没有可归因的帧时间改善证据，未标通过 |

以前 41.7ms 的软件记录仍保留；不同时间测量有波动，不能用它直接和 33.4ms 宣称提速。
该优化证明减少了无用工作，没有证明解决了软件渲染瓶颈。

## 渲染事件与浏览器 rAF 分开记录

在 canvas 上显式派发 `atlas:profile-frames`、detail `{active:true}` 才开启本地帧标记；`false` 停止。
普通浏览不逐帧记录，无网络或坐标采集。每次显式开始清空同名旧标记，最多 10,000 个，避免无界增长；
格式错误的启用事件被忽略，交互检查确认默认没有标记。MapLibre render 回调标记 `atlas:map-render`。

| 路径，30 秒站场 | MapLibre render 间隔 median / p95 / max | rAF p95 | >50ms 长任务 |
| --- | --- | ---: | ---: |
| 默认 Intel Arc / D3D11 | 9.9 / 10.4 / 39.1ms | 10.1ms | 0 |
| 强制 SwiftShader | 25.7 / 43.9 / 64.5ms | 50.0ms | 0 |

默认路径这次 MapLibre 提交间隔低于 33ms 目标，软件路径仍未达到。
无帧标记的默认路径另有 rAF p95=8.4ms 记录，不能把它当成 MapLibre 实际帧间隔。
render 事件比单独 rAF 更接近地图渲染提交，但仍不等于物理 GPU 完成/显示器呈现，也不是其他真实设备 N03 验收。
两条路径未并发运行，网络同为 10Mbps/100ms，设施开、底图关、1440×1000，源锚点沈阳北。
原始报告包含浏览器/GPU/CPU/OS、源/构建指纹和实际加载脚本。

## 当前默认 GPU 的 30 次冷启动和热交互

Chrome 155.0.8059.85；Windows release 10.0.26200；Core Ultra 5 125H / Intel Arc；
每次新隔离 context、禁用 HTTP 缓存，10Mbps/100ms，1440×1000，底图关闭、零第三方请求。
这是 railway-only headless 配置，不代表默认在线底图、物理高 DPI 或手机/平板。

| 指标 | 次数 | median / p95 / max |
| --- | ---: | --- |
| 首个可用铁路视图 | 30 | 1566.5 / 1846.7 / 1851.7ms |
| 索引就绪 | 30 | 1027.0 / 1416.0 / 1416.6ms |
| 自有传输（含响应头） | 30 | 均 681,556 bytes，约 0.65MiB |
| 热搜索：输入至最新结果 | 100 | 211.1 / 214.4 / 220.1ms |
| 筛选界面反馈 + 两帧 | 100 | 18.6 / 19.7 / 22.0ms |

首屏标记要求实际轨道命中、车站源加载，并另验证搜索框可聚焦；源资源没有 HTTP 错误、没有预载全对象索引或完整轨道 GeoJSON。
响应体/头/压缩明细保存在报告，不只按资源文件磁盘大小计算。

旧热搜索脚本直接写 input.value，并见任意结果容器变动就停止；迁入 React 后可能漏触发或误计“正在查找”。
现在经原生 input setter 派发事件，必须看到最新 q 已提交且 listbox aria-busy=false 才结束，保留 200ms 输入等待。
筛选指标仍只是 UI 反馈加两帧，不证明所有 GPU 轨道更新都满足完整 N02。

## 复现

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
python scripts/serve_probe.py --port 8766
# 另一个终端，按实际安装路径设置 PLAYWRIGHT_MODULE
$env:PREVIEW_URL='http://127.0.0.1:8766'
$env:MVP_DATA_DIR='data/processed/shenyang-mvp-20261023'
$env:BENCH_RENDERER='default' # 软件路径使用 software；不要同时跑性能脚本
$env:BENCH_DIAGNOSTICS='1'
node scripts/benchmark_pan.cjs
$env:BENCH_RUNS='30'
$env:BENCH_INTERACTIONS='1'
node scripts/benchmark_client.cjs
node scripts/verify_pan_updates.cjs
```

54 项单元/领域检查通过；新增平移/缩放 3 组、筛选 8 组、资源恢复 10 组、分享 7 组回归通过。
完整 N01–N04/N09 仍需在线底图、真实 Android/iPhone/平板、其他浏览器、读屏/缩放及独立验收。
此前列表偶发超时、许可证据和人工样本签字缺口保持开放，MVP 不标完成。

证据：[当前冷/热报告](evidence/mvp-current-performance-desktop.json)、[默认 render 事件](evidence/mvp-pan-default-render-events.json)、
[软件 render 事件](evidence/mvp-pan-software-render-events.json)、[软件优化前](evidence/mvp-pan-optimization-before.json)、
[软件优化后](evidence/mvp-pan-optimization-after.json)、[交互检查](evidence/mvp-pan-updates-browser.json)、
[构建与汇总指纹](evidence/mvp-current-performance-build.json)。
