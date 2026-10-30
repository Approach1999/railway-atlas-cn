# 筛选时复用当前视图的名称几何

后续已增加[本机地图字体](map-font.md)，最新字体/构建与其性能记录见该页；以下保留本次几何复用构建的原始证据。

2026-10-27。接续[名称正式接线](line-label-integration.md)，当前构建 `index-CySf3A_f.js`。
上一构建的概览筛选源就绪绘制 p95 为 145.6 ms，超过 100 ms 目标。本轮针对实际重复计算修复，未改变标注或筛选规则。

## 瓶颈与修改

在正式产品上观察公开 querySourceFeatures/setData 调用，8 次预设切换均重新读取 4,607 个要素。
查询本身约 5.4–8.8 ms，返回后到提交名称又用 30.9–47.4 ms，用于解码、同来源拼接与几何候选生成。
诊断不改源数据或名称布局，也不是性能验收样本。

现在把候选准备与按筛选选择分开。控制器只保留当前已加载瓦片/当前视图的一份准备结果，
类型、等级、状态、城市线路或预设变化时复用几何，再应用当前可见规则、候选去重和同身份间距。
筛选在去重/间距选择之前执行，因此隐藏候选不会压掉当前可见来源的名称。
不是按几个固定预设保存结果，也没有扩大同名来源的合并规则。

平移、缩放、窗口变化对应的地图移动事件、轨道源 content 更新会丢弃准备结果；
关闭名称、显式重试、版本切换和销毁也会清理。错误保留与上一代点击映射的既有行为继续适用。
新增控制器测试核对复用、清理和刷新，几何测试覆盖同一城市线路内隐藏来源先被过滤的情况。

## 正确性证据

103 项领域/单元测试、严格类型与生产构建通过，最终构建 JS 指纹与浏览器观察报告一致。
四份真实瓦片捕获分别含 4,845/4,607/86/9 个片段，按概览/高速/普速/城市轨道，
分别有无上一代候选 ID，共 32 组对照。旧算法与新准备/选择流程的完整名称集合逐字节相同，
锚点、短片段计数、接续次数及候选数也相同。

实际产品的 6 组名称接线检查通过，涵盖点击原来源、分享、名称开关、站场筛选、错误恢复、版本往返。
另用公开 API 观察四项动态检查：

- 高速/概览切换不再查询轨道，恢复完全相同的候选 ID；高速名称源只含 high_speed。
- 同缩放平移后重新查询一次，视口名称候选发生变化。
- 实际窗口变小时重新查询两次，候选随视口更新。
- 同相机下调用实际向量源 setTiles 重载，content 事件使准备失效并重新查询一次，结果与重载前一致。

这四项使用真实产品事件，没有用伪造的内容更新回调替代实际瓦片源重载。
上述证据不代替全部视图的覆盖、易读性或真实设备验收。

## 性能结果

Windows 本机 Intel Core Ultra 5 125H / Intel Arc，Chrome 155.0.8059.85 无头默认渲染，
1440×1000、10 Mbps/100 ms、关闭底图、没有外部请求。每个场景各 100 次实际预设切换，
就绪守卫要求 41 个图层安装完整、名称 ready/source_loaded、无资源错误，并验证实际绘制的轨道等级。

| 场景 | 旧构建源就绪绘制 p95 | 当前 median / p95 / max | 当前控件应用 p95 |
| --- | --- | --- | --- |
| 概览 | 145.6 ms | 66.5 / 90.1 / 112.4 ms | 10.8 ms |
| 沈阳北站场 | 50.1 ms | 37.6 / 48.6 / 56.4 ms | 9.0 ms |

两个桌面场景的绘制 p95 均达到 100 ms 目标，不能仅用控件应用时间作此判断。
两轮为顺序测量；没有证明所有提升完全来自代码，诊断则直接证明重复查询/几何准备已消除。
首轮最大值仍为 112.4 ms，p95 达标不代表每次都在 100 ms 内。

最终构建另做 30 次冷启动，新上下文、禁用缓存：首个可用视图 median/p95/max 为
1.859/1.931/2.059 秒；搜索索引 p95 1.076 秒已包含在等待中，每次自有传输量 695,033 字节。
本轮没有重新测量连续拖动；前一构建的 8.8 ms 仍是其原构建证据。
软件渲染、Android/iPhone/平板、在线底图与完整浏览器/读屏范围继续开放，因此不关闭完整 N01/N02/N09。

## 复现与记录

保留预览服务，设置 PLAYWRIGHT_MODULE、PREVIEW_URL、独立 PREVIEW_EVIDENCE。
串行执行浏览器脚本，性能测量期间不并发运行其他浏览器套件。

```powershell
node scripts/verify_label_candidate_reuse.mjs
node scripts/verify_label_candidate_cache.cjs
node scripts/verify_line_label_integration.cjs
# BENCH_RENDERER=default，BENCH_FILTER_RUNS=100
node scripts/benchmark_filters.cjs
# BENCH_RENDERER=default，BENCH_RUNS=30，BENCH_SNAPSHOT=shenyang-mvp-20261023
node scripts/benchmark_client.cjs
```

[构建与测量摘要](evidence/label-filter-cache.json)、[实际刷新](evidence/label-filter-cache-invalidation.json)、
[名称集成](evidence/label-filter-cache-browser.json)、[32 组重放](evidence/label-filter-cache-replay.json)。
原始测量和较大输入保留在被忽略的 data/manifests/local 中；历史源文件保留在 evidence/history 下供对照。
