# 对比度与颜色之外的识别线索

2026-10-27 另补[七类表单边界/焦点的实际色对检查](field-contrast.md)，修复浅色输入边界；以下保留原有图形/文字检查的历史范围。

2026-10-25 补记：此前颜色求值不足以证明描边图层成功创建。真实 Edge 走查发现旧宽度表达式被 MapLibre 拒绝，
现在已修复、增加官方校验器检查并目视确认实际描边，见[描边修复与实际 200%](track-style-validation.md)。
本页历史颜色/截图记录不因此扩大为完整实际像素或 N09 验收。

2026-10-24。本轮改善呈现，不修改日期快照中的线路色、关系、标签、坐标或分类。
检查按 [W3C 非文本对比说明](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
与 [文字对比说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)计算；
按未四舍五入的结果判断阈值，文字采用 4.5:1、可识别图形/图例采用 3:1。
绘制颜色/透明度和实际 CSS 是本轮证据，抗锯齿、极细线与真实视觉仍需单独检查。

## 发现与修改

原拆除等状态降低透明度，叠加白色后可能不足 3:1；原部分次级文字在柔和底色上不足 4.5:1。
修正前计算保存在 [原值记录](evidence/mvp-contrast-before.json)，其中源签名为 LF 规范化文本的哈希。

- 状态中心线改为不透明，保留各状态的实线/短虚线/点线/混合线型和未知/冲突的 ?/! 提示。
  不再用降低对比度来承担状态区分；既有历史中性色保持。
- 同一配色决策同时生成中心色与自动黑/白系内描边，选择对比更高的一种。
  地铁/轻轨/电车仍有独立深色外轮廓，高速铁路不套用城市轨道外轮廓。
  配色恢复后中心和内描边一起重绘，避免保留上一次失败配置的描边。
- 站区与设施面保留轻填充，并以实色边界及白色 halo 携带边界信息；设施点与文字保留可辨认的描边。
  选中线的蓝色外描边也改为不透明，保留源中心颜色。
- 线路色块增加实际线路号，文字自动选黑/白，线路全名仍在旁；色块在读屏中隐藏，避免重复读号。
- 图例关闭态保持原色对比，用“已关闭”与 pressed 状态表达开关；次级文案、占位字和版权底色调整。

`contrast.ts` 提供同一 sRGB 算法，`palette-colours.ts` 是地图实际使用的配置/回退/共享决策，
审计使用 MapLibre style-spec 求值器对实际发布属性执行这些表达式，不维护另一份假定线路色表。
数据配置里的旧 lifecycle opacity 没有被原地覆盖；上述改变属于客户端呈现规则，记录在 shared/model.mjs。
不可变数据文件及 palette_version 保持原状，原数据配色来源与核对日期不受影响。

## 当前检查范围

| 检查 | 当前结果 | 不能推出 |
| --- | --- | --- |
| 4,150 个真实轨道记录的中心/内描边 | 最低 3.909884:1；六条地铁中心色逐条与保存配置一致 | 不能证明抗锯齿像素、所有交叉覆盖/背景和真实设备都通过 |
| 12 个线路号徽标 | 各背景/黑白字对比均 ≥4.5:1 | 不证明未来任意新图标/主题 |
| 五种界面状态实际 CSS | 总览、城市轨道、状态图例、详情、关于；抽测文字最低 4.829394:1 | 不覆盖所有状态/控件/背景、读屏或完整 WCAG |
| 活动状态图例 | 不透明色对面板白底均 ≥3:1 | 不将数值通过当作状态语义人工验收 |
| 红绿色觉缺陷模拟 | Chromium deuteranopia/protanopia 截图已查看；线路号、名称和边界仍保留 | 不是独立用户或真实色觉缺陷设备验收 |
| 窄屏 | 390px 页面与线路行未横向溢出 | 不代表真实手机与 200% 缩放全部完成 |

截图取在地图有机会完成渲染之后，避免将控件已更新、画布仍为上一帧的过渡图当作最终效果。
源标签/线路号与 hover/详情仍是颜色之外的路径；城市概览未在截图中出现的全部线路标签不据此宣称已人工检查。

## 复现

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
node scripts/audit_contrast.mjs
python scripts/serve_probe.py --port 8766
# 另一个终端设置 PLAYWRIGHT_MODULE、PREVIEW_URL
node scripts/verify_contrast.cjs
node scripts/verify_mvp_work.cjs
node scripts/verify_real_routes.cjs
node scripts/verify_react_filters.cjs
node scripts/verify_resource_recovery.cjs
```

53 项单元/领域测试通过；含 4,096 种 RGB 样本的描边/文字选择、阈值极值、状态线型与警示保留。
真实设施点击、真实线路、筛选、失败恢复分别通过 7/4/8/10 组回归。
当前快照的单独 30 秒 SwiftShader 软件路径测量 p95 为 41.7ms，高于 33ms 目标，未标通过；
未记录 >50ms 长任务，rAF 估算掉帧比例约 31.87%。这是软件浏览器代理，不是实际设备 GPU 交付帧率，
也不能用来和不同旧快照直接作回归因果比较。完整 N01–N04 与真实设备/读屏/200% 缩放等仍未完成。
之前列表偶发超时和许可证据/独立审核缺口保持开放，不以本轮图形检查关闭。

证据：[实际属性求值](evidence/mvp-contrast-authored.json)、[CSS 与浏览器记录](evidence/mvp-contrast-browser.json)、
[原色视图](evidence/mvp-contrast-urban.png)、[deuteranopia](evidence/mvp-contrast-deuteranopia.png)、
[protanopia](evidence/mvp-contrast-protanopia.png)、[窄屏](evidence/mvp-contrast-mobile.png)。

软件路径记录：[30 秒平移](evidence/mvp-contrast-pan-software.json)。
