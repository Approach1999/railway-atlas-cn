# 描边图层校验与实际 200% 走查

2026-10-25。真实 Edge 分享接收页短暂显示“Cannot filter non-existing layer urban-boundary”，
随后“已就绪”覆盖了该提示。旧检查主要关注页面异常和颜色求值，没有证明描边图层实际创建成功；
本次补上样式校验和真实渲染检查，不把旧颜色计算当作描边存在的证明。

## 修复的三个问题

MapLibre 要求 zoom 位于顶层 step/interpolate 的输入。原来的城市边界与轨道描边把整个
zoom 插值包在加法里，校验器因此拒绝创建这些图层。
[修复前校验](evidence/track-width-before.json)分别记录普通轨道通过、城市边界和描边失败。
现在 `track-width.ts` 把额外宽度加到每个插值节点，保持原计划的宽度曲线，并让 zoom 仍位于顶层。
实际 Edge 截图中已经可见深色城市外轮廓及对比描边。

恒真/恒假条件改为 literal 布尔表达式，消除数字比较被当作旧筛选语法的混用警告。
显式关闭全部城市线路时，提示现在说明“没有启用”，而不是误报“所选线路不在此快照”。
非空、但在旧版本中找不到的线路仍保留原来的缺失版本说明。

真实 200% 下还发现浮动的临时显示说明被详情挡住。
701–1000 CSS px 的桌面详情打开时，改为在详情滚动区显示同一状态说明，隐藏浮动副本。
说明在加载、失败和完整详情状态都可用；其他布局继续使用浮动提示。
可见的状态区域只有一个，不为同一说明增加两个可见播报区。

## 验证

65 项单元/领域检查与严格类型构建通过。新增检查直接调用已锁定 MapLibre 的样式校验器和
属性表达式求值器，验证三个宽度表达式在六类等级、八个缩放点上的 144 次求值与计划曲线一致。
另用真实 featureFilter 编译空线路、单线路、关闭站场线等条件，核对可见性与零混用警告。
共享规则对照的 798,336 次可见性判断仍一致；3,024 个表达式仅规范化原恒真/恒假常量写法后等价，
未把语法修正描述成字节完全相同。

实际 Edge 走查覆盖搜索消歧、键盘选择、分享恢复、城市轨道/单线/空筛选恢复、列表来源和返回地图。
修复后的接收页没有再记录图层或混用筛选警告。
[Edge 记录](evidence/track-style-edge.json)、[实际描边截图](evidence/track-outline-edge.png)、
[新规则对照](evidence/track-style-rule-replay.json)。

## 实际浏览器 200%

自动原生窗口授权等待超时，访问内部版本页被浏览器 URL 策略阻止；没有绕过该限制。
标签页发送缩放快捷键时尺寸未变，因此那次尝试没有算作 200%。随后用户明确回复“已设为 200%”。
同一窗口 outerWidth 保持 1560，CSS 宽度从 1552 变成 776，DPR 从 2 变成 4，
稳定视口为 776×430；未用修改窗口、CSS zoom 或视口模拟替代。

在最新 Bmlm6J-x 构建上实测：

- 输入“沈阳北”，用方向键选择同名地铁记录；隐藏对象临时显示，原铁路筛选保留。
- 详情说明完整位于滚动区内；文档 scrollWidth=776，没有水平溢出。
- 分享、关于数据对话框完整落在视口内，内容可滚动；Tab/Shift+Tab 循环及 Escape 返回焦点通过。
- 城市轨道、仅看 2 号线及退出恢复均可操作；侧栏可滚动访问全部控件。
- 地图的方向键平移、+ 缩放和 Tab 离开通过，DPR 始终为 4。
- “回到试验区”恢复默认视图并清除选中，城市轨道筛选与查询保留。
- 文字列表在视口内打开，显示实际记录和 2/4 号线来源；返回地图后焦点落在详情标题。
- 底图恢复原来的开启偏好，选中对象、查询、筛选和视图不变；只加载当前视野。

[完整记录](evidence/actual-zoom-200.json)、[遮挡修复前](evidence/actual-zoom-200-before.png)、
[修复后](evidence/actual-zoom-200-after.png)、[构建指纹](evidence/track-style-build.json)。
这是一个 Edge 实例的实际 200% 核心走查；精确版本未取得，不算最近两个稳定版浏览器矩阵验收。
不替代 NVDA/VoiceOver、真实移动设备、全部状态组合、独立人工或完整 N09。

## 后续验证边界

描边现在实际参与绘制。旧首屏、筛选和平移性能记录不能直接作为这个新构建的性能证明，
后续已完成[本机两条渲染路径的复测](track-style-performance.md)，逐次确认实际图层存在，软件路径仍超目标。
本机复测不关闭真实设备、在线底图与完整筛选渲染的 N01–N04 缺口，既有超目标记录继续保留。
本次颜色求值仍覆盖实际 4,150 轨道，最低 authored RGB 对比 3.909884:1，六条地铁配置色保持；
这不代表所有背景、抗锯齿像素与终端的对比度都已通过。

```powershell
npm test --prefix apps/web/client
npm run test:types --prefix apps/web/client
npm run build --prefix apps/web/client
node scripts/verify_shared_rules.mjs docs/evidence/history/shared-model-before.mjs data/processed/shenyang-mvp-20261023/stations.geojson data/manifests/local/track-style-rule-replay.json
node scripts/audit_contrast.mjs
```

实际 200% 走查需在浏览器自身设为 200%，确认比例和视口，再按上述核心任务执行并保留证据。
不要只改自动化 viewport，也不要把未确认版本的单次走查扩大成完整浏览器验收。
