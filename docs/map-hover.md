# 地图悬浮预览

2026-10-24。`MapHover.tsx` 与 `map-hover.ts` 提供桌面鼠标预览；点击与悬浮复用同一套
已显示图层查询、typed ID 去重、严格瓦片边界解码及距离排序。
预览只用已加载的瓦片/车站索引和线路目录，不请求详情，不改变相机、筛选、选中、URL 或键盘焦点。

预览展示名称、类别、生命周期、已知线路身份与源编号；最多三条，同时显示全部命中数量。
点击仍打开全部重叠候选，不能将预览的三条限制套用到候选选择。
未命名轨道、缺失类别和未知状态沿用已有明确文案，不推断运营状态或合并同名对象。
React 以文本渲染源名称，不把源文本作为 HTML。

鼠标查询合并到下一动画帧；拖动、平移、缩放、弹窗、筛选/版本变化、失去窗口焦点与销毁时清理。
触屏单击沿用 12px 命中容差，不依赖悬浮；鼠标沿用 6px。键盘用户仍通过搜索/文字列表取得同一来源，
不会将 canvas 悬浮作为唯一的信息入口，也不在鼠标移动时发出连续 live 播报。

提示可移入阅读，离开目标及提示后短暂延迟收起；Esc 优先关闭预览，不退出底层隔离或详情。
同一目标在 Esc 后不立即重开，离开再移入或指向其他对象可以重新预览。
提示按实际尺寸在视口内向左/上避让；改变窗口尺寸时清理，避免遗留在屏幕外。
首轮真实事件检查发现 React 进入提示与原生画布离开事件的先后问题：离开事件晚到会重新启动清理计时。
现依据 relatedTarget 确认移入提示时保留，原移入阅读断言通过，没有延长超时掩盖问题。

## 验证与复现

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
python scripts/serve_probe.py --port 8766
# 另一个终端设置 PLAYWRIGHT_MODULE 与 PREVIEW_URL
node scripts/verify_map_hover.cjs
node scripts/verify_mvp_work.cjs
node scripts/verify_react_share.cjs
```

44 项单元/领域检查通过，其中新增预览字段、只读快照、Esc 抑制、保持/延迟离开及销毁计时检查。
8 组本机 Chrome 检查使用当前真实快照、沈阳北铁路站点和道岔 node/12640376343：
重叠内容/数量、不新增详情请求/相机/焦点/URL 变化、移入阅读、Esc、拖动、全部候选点击、
右下边缘避让、实际站名/类型和模拟触屏。截图已人工查看。
这些检查不替代真实设备、读屏、OS 输入法或完整 MVP 验收；此前列表偶发超时仍保持缺口。

证据：[浏览器报告](evidence/mvp-map-hover.json)、[桌面截图](evidence/mvp-map-hover-desktop.png)、
[右下边缘截图](evidence/mvp-map-hover-edge.png)、[构建/源码与回归指纹](evidence/mvp-map-hover-build.json)。
更多真实数据质检样本、许可清单、完整终端/性能及独立验收继续实施。
