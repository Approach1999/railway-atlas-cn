# 站场名称避让顺序

2026-10-27，构建 index-CtnPWcB4.js / index-BwFbEAPn.css。

## 实际问题

设计 §3.1 要求选中名称 > 重点站 > 一般站 > 线路名 > 设施文字。
原重排函数却把设施文字放在线路名之上。安装的 MapLibre 6.15 按图层栈由后向前处理符号避让，
因此大量“岔”“信”等设施文字可以先占空间，使线路名称退让。
这不是轨道名称来源缺失，也不应通过删除设施记录或强开文字重叠解决。

在原构建 index-DF9QuDZj.js 的独立观察页，仅用公开 moveLayer 改变设施文字层顺序，
沈阳北站场 z16 的可公开查询线路标签 ID 从 6 增至 13，设施文字 ID 从 33 减至 25。
另两个站场/电车视图中的名称 ID 集合不变。这里统计唯一可查询标签 ID，不将它等同于逐字形或原生锚点数量。

正式修改只调整重排次序，让设施文字先于线路名称、一般站名、重点站名、选中名称参与绘制栈。
不改对象几何、身份、来源、筛选或名称候选生成；文字仍通过原生碰撞避让，设施记录继续可查看。

## 验证

Chrome 156.0.8078.48、Edge 156.0.4314.42 各检查三个真实视图的图层优先级，
选择实际沈阳北 node/676578837 后确认选中名称可查询；实际应用另一数据版本并返回后，优先级仍正确。
原生标注间距检查四个视图通过：42 个短片段说明文字保持横排，站场/电车同身份重复锚点最小间距
分别为 308.3135/323.1828 CSS px，超过既定 300px。
原线路名称六组集成检查（来源点击、分享、开关、缩放/站场筛选、故障重试、版本往返）通过。
严格类型与生产构建通过。两种检查范围不同，不把图层顺序断言充作全部像素覆盖证明。

首轮新驱动在桌面环境误用 tap，检查明确失败；改为桌面原生 click。
同时核对版本切换必须按“使用此版本”并验证实际 URL，而非只选择下拉选项。
最终两浏览器重新运行通过，首轮失败保留。

只覆盖所列实际视图与操作。全部名称覆盖、所有遮挡/字形边缘间距、物理设备/读屏、
在线底图、完整浏览器/200% 矩阵及性能仍不由本次结果关闭，独立数据审核继续待办。

## 复现与证据

预览运行时设置 PLAYWRIGHT_MODULE、PREVIEW_EVIDENCE、ATLAS_BROWSER_CHANNEL=chrome 或 msedge：

```powershell
node scripts/verify_label_priority.cjs
node scripts/verify_product_label_spacing.cjs
node scripts/verify_line_label_integration.cjs
```

后两脚本使用其明确配置的 Chrome；前一个选择当前安装浏览器。
`--experiment` 只用于独立页的顺序对照，不代表正式产品修改，也不执行选择/版本验收。
本次基线在旧构建运行，当前构建再次运行该参数不会重现旧顺序。

[汇总与源指纹](evidence/label-priority.json)、[原顺序对照](evidence/label-priority-before.json)、
[Chrome](evidence/label-priority-chrome.json)、[Edge](evidence/label-priority-edge.json)、
[间距](evidence/label-priority-spacing.json)、[集成](evidence/label-priority-integration.json)、
[站场截图](evidence/label-priority-north-yard.png)。
