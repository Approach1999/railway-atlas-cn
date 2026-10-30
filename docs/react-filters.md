# React 筛选与交互图例

2026-10-23。`RailwayControls.tsx` 接管预设、撤销、类型/等级/状态筛选、显示选项、线路列表和图例。
`railway-controls.ts` 保存单一的不可变筛选会话（持久筛选、预设前状态、临时隔离线路），
React 用 `useSyncExternalStore` 读取；地图控制器读取同一会话并执行图层/选择/URL 副作用。
控制器不再创建/替换筛选控件 DOM，也不再维护另一份可写筛选或隔离状态。
本阶段尚未迁移搜索、详情、候选选择和分享面板；后续[车站搜索](react-search.md)已迁移。
仍不能据此宣称完整 React 状态迁移或 P2 完成。

## 行为

- 预设可以撤销到此前全部筛选与显示选项；空类型、空状态和空线路数组不转换为全选。
- “仅看此线”临时隔离，退出恢复持久选择；默认分享仍编码当前所见。
  地址恢复清除旧临时隔离；版本切换失败回退完整筛选会话，成功清除旧预设撤销记录。
- 复选框和原生展开项按稳定键保留，筛选、配色恢复、版本变化不重建仍存在的控件。
- 等级、城市轨道类型和状态图例支持点击/Space 开关；用户关闭的图例项保留在当前自定义会话中，
  明示“已关闭”，保留焦点并可原位重新开启。预设恢复清理这些图例展示记录。
- 线路图例按当前城市/运营方分组，名称仅来自已校验的配色配置；未知运营方明确保留未确认。
  “来源”可点击或用键盘展开，展示原配色来源与置信度，不依赖悬停。
- 线路列表与图例可折叠，默认展开；手机 390 px 模拟中来源说明可滚动阅读，无横向溢出，
  新按钮和原生展开入口至少 44 px。模拟并不替代真实设备验收。

调色板新增读取的运营方名称经过运行时校验；没有新增第三方请求或运行时依赖。
地图实例、瓦片来源、相机和底图偏好不因筛选组件重绘而重建。

## 验证

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
python -X utf8 scripts/serve_probe.py --port 8766
```

设置已有 `PLAYWRIGHT_MODULE`、`PREVIEW_URL=http://127.0.0.1:8766` 后运行
`node scripts/verify_react_filters.cjs`。另回归 share/catalog/client/accessibility/resource_recovery/
real_routes/mvp_work 脚本。领域与前端测试合计 31 项；新浏览器检查覆盖键盘控件身份、原生展开、
空筛选撤销/刷新、隔离分享/退出、版本状态、图例开关、运营方分组/配色来源与手机模拟。
全部浏览器请求限本机或底图夹具，不自动批量请求公共瓦片。

证据：[React 筛选检查](evidence/mvp-react-filters.json)、[桌面来源面板](evidence/mvp-react-line-sources.png)、
[模拟手机](evidence/mvp-react-filters-mobile.png)。
[源文件指纹与最终回归汇总](evidence/mvp-react-filters-build.json)。

一次并行回归在列表设施选择时等待超时，原因尚未确定；未修改验证脚本的单独复跑及连续三次复跑通过。
[超时与复跑记录](evidence/mvp-react-list-followup.json) 保留该现象，不把它改写成已确定修复，
也不以本机 Chrome 的通过记录代替目标浏览器/真实设备/独立人工验收。

剩余范围继续按 [MVP 审计](mvp-status.md) 跟踪，包含详情/候选/分享状态迁移、分享原筛选选项、
更多真实样本、许可清单、读屏/真实设备与独立质检等。
