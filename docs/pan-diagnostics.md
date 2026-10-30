# 平移诊断与固定空间轨迹

2026-10-25。本轮改进测试方法与证据，没有改变产品图层或发布数据。
原键盘方法固定每 100 ms 一次方向键，但相机动画被下一次按键打断的位置与帧调度有关。
新诊断中，相同 300 次输入的实际终点不一致，不能假定各组看到了完全相同的几何。

## 分组隐藏只用于诊断

独立测试浏览器临时改写脚本响应，分别隐藏符号、描边、设施，正式静态文件未变。
首次短探测没有拦住初始化恢复 visibility 的操作，不能用于归因；其记录仅留在忽略目录。
修正后，逐次核对实际 visibility=none，并在各组之间交错运行完整内容控制。

| 30 秒键盘诊断，按运行顺序 | render 间隔 p95 |
| --- | ---: |
| 完整内容 1 | 33.2 ms |
| 隐藏符号 | 44.3 ms |
| 完整内容 2 | 42.8 ms |
| 隐藏描边 | 44.4 ms |
| 完整内容 3 | 44.0 ms |
| 隐藏设施 | 39.2 ms |
| 完整内容 4 | 46.9 ms |

隐藏符号或描边没有稳定改善证据。隐藏设施虽有差异，但完整内容自身也有明显波动，
且键盘轨迹的实际终点不同，不能据此判定设施是主因，也不能把隐藏必要内容作为优化方案。
报告顶层与各组明确 acceptance_evidence=false；该诊断不满足 N03，也不能作为性能通过证据。

## 固定空间路径

`benchmark_pan.cjs` 新增显式 `BENCH_TRAJECTORY=drag`，默认 keyboard 保留旧方法可复现性。
拖动方法先用独立浏览器鼠标按下，再按 rAF 时间派发 DOM mousemove，30 秒沿相同屏幕折线推进。
六条边每条 5 秒，相对像素顶点为：

```text
(0,0) → (-240,0) → (-240,-180) → (0,-180) → (0,0) → (240,0) → (0,0)
```

结束计时后再静置 250 ms 并松开鼠标，减少惯性对终点的影响。
保留各帧时间和实际输入点，记录原始锚点名称，按 Mercator 投影验证回到起点误差 <2 CSS px。
容差包含事件坐标量化和地址小数舍入。这是合成 DOM 输入，不是物理鼠标或真实移动设备验收。

为避免“没有移动也回到起点”的假阳性，`verify_pan_drag.cjs` 另验证开放路径：
先移动 (240,120) 再反向移动，实际地址表示的相机位移分别与预期相符，误差约 0.27 / 0.51 CSS px。

## 完整内容下的新结果

当前产品构建 `index-B5hj9MUm.js`，真实锚点 node/676578837，源名称“沈阳北”，z15.5、设施与文字开启。
Chrome 155.0.8059.85，Windows 10.0.26200 x64，1440×1000，模拟 10 Mbps / 100 ms，底图关闭。
每组独立浏览器、串行运行；所有 37 个预期轨道/描边/警示图层存在，无页面错误或外部请求。

| 路径 / 次数 | render p95 / max | rAF p95 | 估算掉帧比例 | 终点误差 |
| --- | ---: | ---: | ---: | ---: |
| SwiftShader 1 | 50.3 / 68.6 ms | 50.0 ms | 55.06% | 1.07 px |
| SwiftShader 2 | 44.6 / 159.3 ms | 41.7 ms | 51.25% | 0.51 px |
| SwiftShader 3 | 39.0 / 51.7 ms | 41.6 ms | 49.55% | 1.07 px |
| 默认 Intel Arc / D3D11 | 8.9 / 91.7 ms | 8.4 ms | 0.055% | 1.07 px |

所有组 >50 ms 长任务为 0，提示 DOM mutation 为 0。掉帧比例仍是按 60 Hz 从 rAF 推算。
软件三次均超过 33 ms，保持未达标；一次较早探索测得 29.6 ms，不能用它覆盖这三次失败。
该[探索记录](evidence/pan-drag-preliminary.json)单独保留，不作为通过证据。
新空间路径与旧键盘路径不同，不直接计算前后加速比例。
render 是主线程提交事件，rAF 是浏览器调度；两者不证明 GPU 完成或物理显示呈现，完整 N03 保持开放。

运行过程中仅更新了 runner 文件开头注释，软件三次保留旧注释的脚本哈希、硬件一次为新注释。
旧 runner 原件留存，去掉开头注释后的正文一致；手势算法、产品资产、数据和条件没有在这四组间改变。

## 锚点说明更正

此前两份报告文字误称“苏家屯”；源数据与全部脚本一直使用 node/676578837，即“沈阳北”。
已更正 [描边性能说明](track-style-performance.md) 与 [筛选性能说明](filter-performance.md)。
输入坐标、快照及原始数字均未改，也不把这次文字更正视作重新验收其他站场。

证据：[分组诊断](evidence/pan-layer-diagnostic.json)、[驱动位移验证](evidence/pan-drag-driver.json)、
[软件 1](evidence/pan-drag-software-1.json)、[软件 2](evidence/pan-drag-software-2.json)、[软件 3](evidence/pan-drag-software-3.json)、
[默认路径](evidence/pan-drag-default-1.json)、[版本与范围](evidence/pan-drag-build.json)。
后续已补充[主线程与图形提交采样](pan-trace.md)，包含同尺寸空画布和硬件对照；
较长记录集中在软件提交与交换，仍不认定某个图层或驱动为唯一原因。

```powershell
$env:BENCH_TRAJECTORY='drag'
$env:MVP_DATA_DIR='data/processed/shenyang-mvp-20261023'
$env:BENCH_DIAGNOSTICS='1'
# 另设 PLAYWRIGHT_MODULE、PREVIEW_URL、独立 PREVIEW_EVIDENCE 和 BENCH_RENDERER
node scripts/verify_pan_drag.cjs
node scripts/benchmark_pan.cjs
```
