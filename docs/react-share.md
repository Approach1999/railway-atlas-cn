# React 分享面板与原筛选

2026-10-24。`ShareDialog.tsx` 接管分享方式、链接、复制进度/失败、弹窗与焦点；
`share-session.ts` 从打开时的视图捕获两份独立副本，地图控制器只提供状态，不再操作分享 DOM。
打开时提交已确认的搜索；未确认的组合输入仍沿用上一个已提交关键词。
源地图筛选、临时隔离、选中对象和相机不因切换分享方式改变。

- 默认“按当前所见分享”：当前“仅看此线”转换为接收页普通线路筛选，不依赖接收页拥有源临时状态。
- “保留原筛选分享”：使用进入单线隔离之前的实际筛选，保留取消勾选的线路、空类型/状态及显示选项。
- 两者保留快照、相机、查询与 typed 选中对象。临时车站通过 feature 显式恢复；关闭详情后恢复链接中的筛选。
- 没有临时单线隔离时，两种方式图层相同，面板明确说明。重新打开重置为默认方式。

链接只读、可全选；复制拒绝/不可用时提供手动复制，异步完成只更新当前复制尝试。
切换方式或关闭使旧操作失效，旧失败不能重置新链接、播报到新弹窗或抢占焦点。
用户已转移操作时，失败提示不抢回输入焦点。
面板保留原生 dialog、命名/说明、单选键盘行为与 Esc；首尾 Tab 明确循环，关闭返回原分享按钮。
初轮窄屏检查发现原生 Tab 到末尾可短暂落到页面，增加循环后原断言通过，没有放宽检查。
复制/关闭/选项触摸区域至少 44px，窄屏弹窗内部可滚动。

## 验证与复现

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
python scripts/serve_probe.py --port 8766
# 另一个终端设置 PLAYWRIGHT_MODULE 和 PREVIEW_URL
node scripts/verify_react_share.cjs
node scripts/verify_share.cjs
node scripts/verify_react_filters.cjs
node scripts/verify_react_search.cjs
```

41 项单元/领域检查通过；新状态检查覆盖两种分享捕获、数组隔离、typed 对象和明确空筛选往返。
新浏览器 7 组检查使用实际快照、4 号线、原先取消的 2 号线和沈阳北铁路站点，验证两种接收页、
原页面不变、隐藏站临时显示、关闭恢复、复制拒绝/成功/迟到失败、键盘/Esc/重开及 390px 布局。
原分享导航 7 组、筛选 8 组、搜索 9 组回归通过。
剪贴板接口使用本机受控 mock，不把它作为真实 OS 剪贴板权限、真实手机或读屏验收。
之前列表设施与并行首屏等待超时原因仍未明确，保持缺口，不以本轮通过归因或关闭。

证据：[分享检查](evidence/mvp-react-share.json)、[构建/源码与回归指纹](evidence/mvp-react-share-build.json)、
[390px 分享面板](evidence/mvp-react-share-mobile.png)。分享地址仍是本机地址；跨设备使用要求可访问同一服务。
悬浮提示、更多真实样本、许可清单、完整目标终端与独立验收仍待完成；完整 MVP 保持进行中。
