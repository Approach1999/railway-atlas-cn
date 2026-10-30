# 收起面板后的键盘与布局恢复

2026-10-27，构建 index-Dv8VHl6p.js / index-BwFbEAPn.css。

## 修复

小屏（≤700px）收起探索面板后，再把窗口扩大到平板/桌面尺寸，原收起状态仍生效，
但“打开面板”按钮已被宽屏样式隐藏。实际 390→768px 观察中，面板与按钮同时 display:none，
无法返回搜索/筛选。另一方面，选择搜索结果后收起面板，再关闭详情，原焦点返回逻辑只排除
HTML hidden，没有排除被 CSS 隐藏的搜索入口，实际焦点掉到 BODY。

现在越过 700px 小屏边界时自动恢复面板，沿用现有地图 resize，不重建地图或重置查询。
原面板按钮或 BODY 持有焦点时，在恢复后聚焦可见搜索框；原本聚焦地图时继续留在地图。
监听器随状态清理。详情关闭时按“仍连接、非隐藏/非 inert、确有布局矩形且可见”检查原入口，
不可用则尝试搜索框，再回退地图画布。非画布目标允许浏览器滚动到焦点，避免焦点停在滚动区之外。

## 检查

Chrome 156.0.8078.48、Edge 156.0.4314.42 各八项定向检查通过：
收起时连续八次 Tab 不进入隐藏面板；扩大窗口后面板恢复及搜索焦点；收起时关闭详情回到画布；
重开后保留查询；已有画布焦点不被抢走；实际 700→701px 交界恢复且画布身份/URL 不变；
回到 390px 后搜索仍可用。
原基线是最初六项检查，其中三项断言失败，对应两个问题；随后补入精确交界与再次回到小屏两项。

首轮驱动误从 768px 尝试点击仅小屏提供的收起按钮，等待失败；保留失败记录。
修正为真实提供按钮的 390px 后才取得上述产品问题的基线，没有把驱动设置错误算成产品缺陷。
严格类型与生产构建、108 项单元检查通过；两浏览器各九组原搜索回归也通过。
本轮新构建另完成两浏览器的实际 200% 缩放复跑：各两项基线与 16 项核心任务，
共 36 项（含四项基线）通过，完整截图尺寸守卫通过；不借用前一构建结果。
截图只用于观察布局与焦点，未等待每个地图文字的原生淡入结束，不作为线路名称覆盖或易读性证据。

这不是物理设备旋转、OS 输入法、读屏、全部断点/方向及全部 N09 验收。
原数据、名称与性能证据保持各自构建，独立人工数据审核继续待办。

## 复现

本地预览运行时设置 PLAYWRIGHT_MODULE、PREVIEW_EVIDENCE、ATLAS_BROWSER_CHANNEL=chrome 或 msedge：

```powershell
node scripts/verify_panel_keyboard.cjs
```

`--observe` 保存基线失败而不以失败码退出；正式检查不传此参数。
[汇总与指纹](evidence/panel-keyboard.json)、[基线](evidence/panel-keyboard-before.json)、
[Chrome](evidence/panel-keyboard-chrome.json)、[Edge](evidence/panel-keyboard-edge.json)、
[修复前](evidence/panel-keyboard-before.png)、[修复后](evidence/panel-keyboard-after.png)。
当前构建缩放记录：[Chrome](evidence/panel-keyboard-chrome-zoom.json)、[Edge](evidence/panel-keyboard-edge-zoom.json)。
