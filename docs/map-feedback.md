# 地图提示、恢复入口与面板状态

2026-10-25。加载状态、导航说明、地图提示、源数据日期及“打开当前版本”按钮现在由
React 渲染；地图控制器只发布明确的提示状态，不再通过 textContent、hidden、动态插入按钮或 onclick 改写这些界面。
面板收起/展开及复位按钮也由 React 绑定，面板类名限定在应用根节点，按钮文字与 aria-expanded 同步。
MapLibre 继续管理自己的画布、图层和控件；控制器保留相机、选中布局和焦点协调。

## 修复的实际问题

异常分享地址的参数说明在成功切换数据版本后仍然残留。
[修复前实测](evidence/map-feedback-before.json)显示，包含 invalid_test 的地址已经规范化、版本已经切换，
界面仍提示“已忽略未知参数：invalid_test”。

现在成功的主动版本切换清除旧导航说明；浏览器跨版本前进/后退使用目标地址自己的说明。
失败的预加载不改变当前说明、源日期或地图；提交阶段回退也恢复先前导航状态。
源日期仍取自 OSM 源元数据，不借用构建时间。原来直接写 DOM 的恢复按钮改为状态驱动，
重试成功后和失败提示一起消失，重复失败不创建重复按钮；恢复当前版本仍保留编辑后的查询与 typed ID。

`map-feedback.ts` 提供稳定、不可变的快照，相同状态不重复通知订阅者；销毁后忽略迟到更新。
`MapFeedback.tsx` 用 useSyncExternalStore 读取，源文本作为 React 文本节点展示。
状态节点始终存在并声明 role=status、aria-live 和程序焦点目标，重试恢复不依赖临时补写 tabindex。

## 验证与复现

63 项单元/领域检查及严格类型生产构建通过，新增三项针对原子状态更新、无变化更新、销毁后的更新和源时间格式。
[六组新浏览器检查](evidence/mvp-map-feedback.json)使用实际沈阳不可变数据：

- 失败切换保留当前提示、日期和快照；成功切换清除复现出的旧提示，并保留地图画布。
- 跨版本前进/后退恢复自身警告，带 HTML 字样的参数只显示为文本，没有生成图片节点。
- manifest 410→503→成功，只有一个恢复按钮；成功清除旧入口/提示，保留新输入并返回焦点。
- “打开当前版本”使用新编辑的查询和原 typed ID，恢复后入口消失。
- 390px 视口反复开关面板，按钮文字、展开状态和布局一致；复位通过原相机动作执行。

现有回归通过：分项资源恢复 10 组、七种视口、版本切换 8 组、平移/缩放 3 组、
键盘/减少动效 4 组、分享 7 组。无外部请求或页面异常；同缩放平移仍为零次无变化提示 DOM 重写。
窄屏详情截图已目视检查。没有据此声称帧率、真实手机、读屏或实际 200% 缩放验收完成。

```powershell
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
# 保持本机 8766 预览运行，设置已安装的 PLAYWRIGHT_MODULE
node scripts/verify_map_feedback.cjs
node scripts/verify_resource_recovery.cjs
node scripts/verify_responsive_layout.cjs
# 目录脚本默认端口不同，运行前指定 PREVIEW_URL=http://127.0.0.1:8766
node scripts/verify_catalog.cjs
node scripts/verify_pan_updates.cjs
node scripts/verify_map_keyboard_motion.cjs
node scripts/verify_react_share.cjs
```

证据：[构建与文件指纹](evidence/mvp-map-feedback-build.json)、
[资源恢复](evidence/mvp-feedback-resource-regression.json)、[视口](evidence/mvp-feedback-responsive-regression.json)、
[版本](evidence/mvp-feedback-catalog-regression.json)、[平移](evidence/mvp-feedback-pan-regression.json)、
[键盘](evidence/mvp-feedback-keyboard-regression.json)、[分享](evidence/mvp-feedback-share-regression.json)。
真实设备、独立人工、完整性能、原生工具许可及依赖维护警告等原有 MVP 门槛仍保留。
