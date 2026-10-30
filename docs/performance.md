# 本机性能测量 · 2026-10-23

当前真实快照与新测量口径见 [2026-10-24 记录](current-performance.md)。下文保留旧 accessible 快照的历史结果，不直接作为当前版本证明。


本节三十次测量保留旧 accessible 快照的历史证据；当前主图已升级到包含真实关系的日期快照，
新快照三次预检见 [真实数据指南](real-shenyang-data.md)，尚不能替代完整性能复验。

当前是沈阳快照的可复现本机测量，性能验收仍在进行。
未测真实 Android、iPhone、平板、默认在线底图的性能；无头浏览器与 rAF 采样不能替代全部 N01–N04 验收。

## 环境与口径

- Chrome 155.0.8059.85，Windows（内核版本 10.0.26200），Intel Core Ultra 5 125H，约 32 GiB RAM。
- 默认硬件路径实际报告 Intel Arc / ANGLE D3D11；另外保留强制 SwiftShader 的软件渲染结果。
- 1440×1000，10 Mbps 下行、CDP latency 100 ms；每次新建隔离浏览器上下文并禁用 HTTP 缓存。
- 底图关闭，第三方请求为零。没有对公共 OSM 底图执行批量性能请求。
- 快照 `shenyang-mvp-accessible-20261022`，真实旧源；没有城市轨道线路关系。
- 首个可用视图标记在铁路/站点源已加载、轨道实际进入渲染命中集合之后；同时验证搜索输入可聚焦。
  索引就绪时间另列，未用“JSON 已读取”冒充首个可用地图。
- 首屏自有资源计入响应头与压缩后的响应体，包含主 JS、MapLibre worker、CSS、配置、索引与首屏铁路瓦片。
  每次资源明细随原始报告保存。OS/浏览器/GPU、数据与资源路径一并记录。

## 首屏结果

| 条件 | 冷启动数 | 首屏 median / p95 / max | 自有资源传输 |
| --- | ---: | --- | ---: |
| 压缩前，强制软件渲染，预检 | 3 | 3461 / 3549 / 3549 ms | 2,627,458 bytes |
| 压缩后，强制软件渲染 | 30 | 1579 / 1707 / 1721 ms | 630,965 bytes |
| 最终版本，默认 Intel Arc 硬件路径 | 30 | 1400 / 1457 / 1557 ms | 630,974 bytes |

自有资源传输减少约 76%，压缩后约 0.602 MiB；本机关闭底图条件下低于 2 MiB 预算。
硬件路径的索引就绪 median / p95 / max 为 1000 / 1041 / 1116 ms。
压缩前为三次预检，不作为正式三十次验收；软件与硬件行不能混在一起归因。
最终硬件行有独立三十次原始记录，不以软件路径结果代替。

## 交互与平移

硬件路径热查询各 100 次：输入至结果列表更新的 median / p95 / max 为 210 / 212 / 214 ms；
筛选 DOM 反馈并等待两个动画帧为 18 / 20 / 21 ms。
筛选测量没有证明所有 worker 重建与 GPU 图层更新已经完成，故不据此宣布 N02 全项通过。

沈阳北站场 z15.5、设施开启、底图关闭，按右/左/下/上每五秒一个方向、每 100 ms 一个键盘平移动作，采样三十秒：

| 路径 | rAF 间隔 median / p95 / max | 超过 50 ms 长任务 |
| --- | --- | ---: |
| 默认 Intel Arc | 8.3 / 8.4 / 16.7 ms | 0 |
| 强制 SwiftShader | 25 / 50 / 58.4 ms | 0 |

软件路径 p95 超过 33 ms 目标，保留为未达标证据，不删除失败结果。
硬件路径当前 rAF 指标低于目标；rAF 是浏览器调度代理，不等同于 GPU 实际送显帧。
报告的掉帧比例是按 60 Hz 假设估算，不能当作对真实设备刷新率的完整测量。

## 传输实现与瓦片预算

本机服务对可压缩的完整 JS/CSS/JSON/GeoJSON/PBF 等响应协商 gzip，缓存压缩结果；
缓存键含文件路径、修改时间与长度，不改写原文件。
设置 `Vary: Accept-Encoding` 和编码后 `Content-Length`；明确拒绝 gzip 时返回原体。
字节 Range 返回原始数据的 206 响应，不叠加 gzip，不破坏既有 Range 读取。
归档型 PMTiles 不在此压缩集合中。

独立检查全部 2,251 个 MVT，采用同样的 gzip level 6：最大 156,664 bytes（约 153 KiB），
p95 3,870 bytes，均低于单瓦片 500 KiB 门槛。
这只证明当前城市快照，不证明东北/全国规模。

## 复现

先构建前端并启动指向同一快照的 `scripts/serve_probe.py`。
设置本机 Playwright 模块位置与 `PREVIEW_URL`，再运行：

```powershell
$env:BENCH_RUNS='30'
$env:BENCH_INTERACTIONS='1'
$env:BENCH_RENDERER='default'
$env:PREVIEW_EVIDENCE='data/manifests/local/performance'
node scripts/benchmark_client.cjs
node scripts/benchmark_pan.cjs
python -X utf8 scripts/verify_transport.py --base http://127.0.0.1:8766
python -X utf8 scripts/measure_tile_sizes.py data/processed/shenyang-mvp-accessible-20261022
```

不设置 `BENCH_RENDERER=default` 时强制 SwiftShader，用于可重复的软件路径诊断；不要把它标成真实 GPU 测量。
报告分别写入 `benchmark-client.json` 与 `benchmark-pan.json`，避免被功能验证的 `report.json` 覆盖。
测试不接触公共底图、不上传设备数据；测量只保存在本机文件。

证据：[压缩前](evidence/mvp-performance-before.json)、[软件路径首屏](evidence/mvp-performance-software.json)、
[最终桌面首屏与交互](evidence/mvp-performance-desktop.json)、[硬件平移](evidence/mvp-pan-desktop.json)、
[软件平移](evidence/mvp-pan-software.json)、[HTTP 行为](evidence/mvp-http-transport.json)、[全部瓦片体积](evidence/mvp-tile-sizes.json)。
