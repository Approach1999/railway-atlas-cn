# 平移提交链路采样

2026-10-25，产品构建仍为 `index-B5hj9MUm.js`，本轮没有改变产品代码或数据。
完整地图使用沈阳北 node/676578837、z15.5、设施开启、底图关闭及既有闭合 30 秒输入路径。
Chrome 155.0.8059.85，1440×1000 视口，DPR=1；实际地图画布是 1094×924，不能用视口尺寸替代。

## 对照与观察

采集完整地图 / 仅清屏的 WebGL 空画布，分别走默认 Intel Arc / D3D11 与强制 SwiftShader。
空画布的位置、实际绘制尺寸和 WebGL 属性与地图匹配，但没有地图内容或侧栏界面，
它是诊断控制，不能代表地图性能通过，也不能单独隔离所有页面合成成本。
四次采样均明确 `data_loss_occurred=false`，无页面错误或外部页面请求。

| 30 秒采样对象 | 主线程 idle 样本 | 应用资产自身样本 | Skia SwapBuffers 累计 / 次数 / 均值 |
| --- | ---: | ---: | ---: |
| 完整地图 / 软件 | 82.65% | 4.24% | 27,562.65 ms / 1,703 / 16.185 ms |
| 空画布 / 软件 | 96.68% | 0% | 4,608.91 ms / 3,620 / 1.273 ms |
| 完整地图 / 默认硬件 | 89.63% | 0.48% | 326.83 ms / 3,060 / 0.107 ms |
| 空画布 / 默认硬件 | 97.14% | 0% | 317.52 ms / 3,111 / 0.102 ms |

CPU 样本来自页面主线程；“应用资产”按调用帧 URL 归类，包括打包的 MapLibre 与应用本身，不能当成 React 单独占用。
idle 不是整机 CPU 空闲率。SwapBuffers 是 GPU 进程的 inclusive 时间，可能包含提交、执行及等待；
嵌套事件不能相加为 CPU 利用率，跨后端均值也不是同一硬件指令的直接对照。

这组证据不支持把当前问题主要归因于 JavaScript 主线程计算。
较长记录集中于软件路径的画面提交与交换，地图场景和页面合成的额外成本值得进一步定位；
尚不能认定具体图层、着色器、驱动或系统等待是唯一原因。
当前证据也不支持把重写 React 或引入 WebAssembly 当成已知修复。

采样有额外开销，所有报告 `acceptance_evidence=false`，不替代[无采样性能复测](pan-diagnostics.md)或真实设备验收。
早期空画布面积不同、未记录完整丢失标志的探测不用于上表；其原件在忽略目录压缩留存。

## 透明通道候选未采用

独立浏览器曾尝试给 Map 构造参数设置 `canvasContextAttributes.alpha=false`。
实际 `getContextAttributes().alpha` 仍为 true，测试因此失败，没有生成有效候选性能报告。
安装的 MapLibre 6.15.0 在 `src/ui/map.ts::_setupPainter` 中明确强制 alpha、depth、stencil、premultipliedAlpha 为 true。
没有绕开引擎这项约束；实验开关已经从标准 runner 移除，并与实验前文件做了逐字节一致性检查。
两张探索截图相同，是因为候选未生效，不能据此宣称改变透明通道后画面仍相同。

## 原件与复现

完整原始 trace 以 gzip 保存在忽略目录，压缩前后核对 SHA-256；页面 CPU profile 同样保留在本机。
此前生成的大型临时 JSON 只在校验压缩内容完整后删除，原始字节可恢复。
仓库仅收录诊断摘要和哈希，不加入数百 MB 原始 trace。

[地图 / 软件](evidence/pan-trace-map-software.json)、[空画布 / 软件](evidence/pan-trace-clear-canvas-software.json)、
[地图 / 默认](evidence/pan-trace-map-default.json)、[空画布 / 默认](evidence/pan-trace-clear-canvas-default.json)、
[聚合与原件索引](evidence/pan-trace-analysis.json)、[透明通道未生效](evidence/pan-opaque-rejected.json)、[版本指纹](evidence/pan-trace-build.json)。

```powershell
$env:TRACE_CONTROL='map' # 空画布为 clear-canvas
$env:BENCH_RENDERER='software' # 默认硬件为 default
# 另设 PLAYWRIGHT_MODULE、PREVIEW_URL 和独立 PREVIEW_EVIDENCE
node scripts/diagnose_pan_trace.cjs
```

软件无采样复测仍超 33 ms，真实设备、浏览器矩阵与其他 MVP 门槛继续保持开放。
