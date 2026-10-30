# 地图键盘与动态减效 · 2026-10-25

侧栏“键盘操作”提供中文说明和“进入地图操作”按钮。画布在浏览器辅助功能树中命名为“沈阳铁路地图”，
并关联方向键、缩放、Tab、搜索和关闭操作说明。缩放控件使用“放大地图 / 缩小地图”辅助名称；
画布通过键盘获得焦点时显示 3px 内描边，不因地图容器裁切而消失。

保持 MapLibre 原生方向键平移、+ / − 缩放和 Tab 离开行为。地图连续移动替换 URL 视图，
不为每一步创建历史条目。中文车站搜索可以用上下键、Enter 与 Escape 完成选择、查看与返回。

定位与“回到试验区”现在每次读取当前 prefers-reduced-motion，而非永久保留页面启动时的值。
开启减效时不执行过渡动画；活动定位/复位过程中切换到减效，会立即完成原来的目标与 offset，
避免只停止在目标尚不可见的半途中。没有应用定位请求时，偏好变化会停止其他进行中的地图惯性/动画。
恢复正常偏好后，后续定位恢复标准时长。组件销毁会移除媒体事件和 moveend 监听。

## 当前证据

60 项单元/领域测试及严格类型构建通过，其中三项针对动态偏好、替换目标、偏移、取消和清理。
`scripts/verify_map_keyboard_motion.cjs` 使用真实 Chrome 键盘事件和 MediaQueryList change 事件，
未暴露地图私有实例或伪造 camera：

- 在实际复位动画尚未结束时启用减效，记录同一偏好事件任务后的 URL 已到达默认目标。
- 检查真实浏览器辅助功能树中的中文地图名/说明，以及计算样式中的焦点框。
- 验证方向键位置变化、+ / − 及中文按钮缩放、历史条目数量、Tab 离开画布。
- 验证键盘搜索/结果选择、详情、Escape 焦点返回及正常偏好恢复事件。

媒体事件中的 URL 是本机公开测试数据，报告不包含设备位置。底图关闭，无外部请求。
证据：[键盘与偏好事件](evidence/mvp-keyboard-motion.json)、[构建指纹](evidence/mvp-keyboard-motion-build.json)。
本次构建的 [搜索回归](evidence/mvp-keyboard-search-regression.json)、
[分享回归](evidence/mvp-keyboard-share-regression.json) 及
[七种视口回归](evidence/mvp-keyboard-responsive-regression.json) 均通过。

```powershell
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
# 启动本机预览，设置 PLAYWRIGHT_MODULE；默认使用 8766
node scripts/verify_map_keyboard_motion.cjs
```

这不是 NVDA/VoiceOver、真实设备或实际浏览器 200% 缩放证据，也不替代完整 N09 验收。
2026-10-25 用户表示暂不方便真机验收，该项保留待办，不以模拟结果替代或视为豁免。

后续用户手动设置 Edge 为 200%，实际 CSS 宽度减半、DPR 加倍后完成了核心键盘/对话框/列表走查，
并修复详情提示遮挡；详见[实际 200% 记录](track-style-validation.md)。
它是独立于上述早期检查的单实例证据，不替代读屏、手机或完整浏览器矩阵。
