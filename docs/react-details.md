# React 地图详情与重叠对象选择

2026-10-24。`FeaturePanels.tsx` 管理详情、加载/错误/重试、原始来源及重叠对象 DOM，
`feature-details.ts` 为可订阅的面板状态。地图控制器保留相机、选中高亮、分享身份与筛选例外，
不再创建详情节点、候选按钮或写入面板 hidden 属性。

每次选择生成请求代次；完成和失败都必须匹配当前选择。关闭、新选择、版本切换或销毁后，
迟到请求不能重开面板、覆盖新来源或改变选中对象。分片缓存与已校验源几何仍按不可变快照隔离。
重试保留原相机/筛选/临时选站例外；提交加载状态后提供焦点，再按用户是否已转移操作决定是否聚焦完成标题。
来源包括源编号、快照、版本/时间/修改集缺失标记、原标签、分类依据、明确线路关系与配色依据；未删减原有字段。

真实重叠候选展示名称、类别和 typed ID；提交后聚焦首项，Esc/关闭返回地图画布。
选择候选再关闭详情也返回画布；车站搜索选择则保留原搜索触发元素或回退到输入框。
排除 body 和已隐藏触发元素，防止“返回焦点”落在不可见处。
React 布局提交后通知地图重新测量，不重建 MapLibre 实例。
详情/候选关闭按钮宽高至少 44px；新增窄屏检查发现原关闭按钮缺少最小宽度并修正。

## 复现

先构建，再启动本机预览，设置 Playwright 模块和预览地址：

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
python scripts/serve_probe.py --port 8766
# 在另一个终端设置 PLAYWRIGHT_MODULE 与 PREVIEW_URL
node scripts/verify_react_details.cjs
node scripts/verify_mvp_work.cjs
node scripts/verify_resource_recovery.cjs
node scripts/verify_share.cjs
node scripts/verify_accessibility.cjs
node scripts/verify_react_search.cjs
node scripts/verify_catalog.cjs
```

39 项单元/领域检查通过，其中新增状态检查覆盖换选/关闭后的迟到成功和失败、身份不匹配、重试上下文与销毁。
本机浏览器新增 4 组详情检查；实际沈阳北站区道岔/轨道重叠点击覆盖候选焦点、来源身份、Esc、重开及详情关闭返回。
真实来源逐项核对详情编号、快照、外链和原标签。另验证重试迟到不抢新输入焦点、关闭不重开、新选不被旧响应覆盖。
原分享、恢复、搜索和版本回归通过；这不是所有终端、真实输入法、读屏或完整 MVP 验收。

本轮列表回归保留两次失败：首次并行运行在设施条目等待超时，四套浏览器并行时另一次在首屏就绪等待超时。
单独诊断设施状态为“道岔 / facilities / 2395 条”并通过，随后原列表独立与两套并行运行通过。
原因仍未确定，不以复跑通过宣称故障修复；验证器现保存失败时输入、类别、筛选、焦点与弹窗内容，方便继续定位。
以前的列表设施超时记录保持原状，也不将它归因于本轮改动。

证据：[详情回归](evidence/mvp-react-details.json)、[真实重叠选择](evidence/mvp-react-details-overlap.json)、
[本轮构建/指纹与失败记录](evidence/mvp-react-details-build.json)、[390px 截图](evidence/mvp-react-details-mobile.png)。
[分享面板及原筛选选项](react-share.md)已完成本机验证；悬浮提示、许可清单、质检样本与完整终端/独立验收仍待完成。
