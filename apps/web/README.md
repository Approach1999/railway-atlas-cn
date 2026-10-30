# 地图前端

`client/` 是当前 React + TypeScript + Vite 入口，包含可隐藏底图与上一批铁路交互。
`shared/` 存放共用搜索/筛选规则。`probe/` 保留原生 JS 预览与有界瓦片构建器。
轨道按视野加载、原始详情按点击分片加载，不再预载完整轨道 GeoJSON。

启动与来源见 [第二批预览](../../docs/basemap-preview.md)。
入口、底图和铁路控制器均已纳入严格 TypeScript 检查，客户端禁用 `allowJs`。
索引/详情与 MVT 点击采用各自的运行时数据校验，见 [前端类型与数据边界](../../docs/frontend-types.md)。
筛选/撤销/线路/交互图例已由 React 与统一筛选会话管理，见 [迁移与复现](../../docs/react-filters.md)。
车站搜索与结果也已由 React 及单一搜索状态管理，见 [输入与键盘路径](../../docs/react-search.md)。
地图详情与重叠候选见 [来源、请求与焦点](../../docs/react-details.md)。
分享面板及当前所见/原筛选选项见 [分享与键盘操作](../../docs/react-share.md)。
通知/状态等仍含控制器 DOM；完整组件拆分、P2 验收与公开发布尚未完成。

桌面鼠标预览见 [地图悬浮提示](../../docs/map-hover.md)，与点击共用已显示图层命中，不下载详情。

地图和文字列表的桥隧/轨距、关联及来源字段见 [统一详情](../../docs/record-details.md)。

关于数据及配色核对日期现见 [实现与版本上下文](../../docs/about-data.md)。
