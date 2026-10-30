# React 车站搜索与输入状态

2026-10-23。`StationSearch.tsx` 接管输入框、结果选项、状态播报、中文输入事件和键盘操作。
`station-search.ts` 为单一搜索状态源，区分编辑文本、已确认关键词、组合输入、等待查询、索引可用性与当前选项。
地图控制器提供当前快照的已校验车站索引和筛选可见性，按 typed ID 处理选站，不再读写搜索框或重建结果 DOM。
筛选状态仍独立按 [筛选会话](react-filters.md) 管理；详情与候选现见 [面板状态](react-details.md)；分享面板现见 [原筛选与键盘操作](react-share.md)。

## 保留与修正的行为

- 名称/别名沿用同一规范化与排序规则；铁路/地铁、站点/站区分别保留源身份与说明。
  每次最多 20 个选项，更多结果提示收窄；空/空白不列出全部记录。
- 普通输入等待 200 ms；新输入、地址恢复、版本回退与销毁取消旧任务。
  Enter、方向键、打开列表、分享或切换版本等明确操作先提交当前普通输入，避免选择旧结果或继承旧查询。
- 组合输入期间不查询、不选站，也不把未确认文本写入分享地址；确认后立即查找。
  防止输入法 Enter/229 被当成选站，Esc 也不会清空正在组合的输入。迟到组合结束不会恢复已清空的搜索。
- 初次 ArrowUp 正确选择当前前 20 条中的末条；上下键循环，Enter 用最新关键词和当前快照选站。
  选项 DOM ID 来自 typed ID；活动选项仍存在时，筛选或索引刷新保留其身份。
- 被筛选隐藏的结果仍可选择，临时显示和原筛选保持独立。键盘选站关闭详情后返回搜索；
  原结果移除时也提供输入框焦点回退。
- 索引失败不伪装成无匹配；manifest 失败明确先重试数据说明。
  恢复当前版本时保留失败之后新输入的关键词、初始分享对象与当前相机。
- 全部原生弹窗打开时，地图 Esc 不再作用于底层选择/搜索。
- 列表详情改为渲染提交后交接焦点，替代单次 rAF；用户已开始编辑、转移焦点或切换操作时不抢回焦点。

状态区与 listbox 分离，输入的 `aria-controls` 和 `aria-activedescendant` 指向实际存在的节点，
提供 loading/busy 与结果状态；键盘操作保持输入焦点。没有新增第三方请求或运行时依赖。

## 验证与边界

```powershell
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
python -X utf8 scripts/serve_probe.py --port 8766
```

设置已有 `PLAYWRIGHT_MODULE`、`PREVIEW_URL=http://127.0.0.1:8766` 后运行
`node scripts/verify_react_search.cjs`，并回归 share/catalog/client/accessibility/typed_boundary/
react_filters/resource_recovery/real_routes/mvp_work。
当前 37 项单元/领域检查包含过期任务、IME、前 20 条导航、索引更换、失败重试和待查输入回退。

新浏览器检查使用当前真实索引、真实类型身份与唯一名称；上限检查先从实际数据选取超过 20 条的查询，
不假设“沈阳”必有 20 条。组合输入和快速同任务 Enter 用合成事件测试 React 路径，
延迟详情响应测试焦点不抢占；390 px 仅为设备模拟。
证据：[浏览器检查](evidence/mvp-react-search.json)、[模拟手机](evidence/mvp-react-search-mobile.png)。
[本轮回归、连续列表检查与源文件指纹](evidence/mvp-react-search-build.json)。

本轮回归捕获并修正列表“标题已出现但焦点仍等待下一帧”的时序问题。
此前一次列表设施等待超时的[观测记录](evidence/mvp-react-list-followup.json)仍保留，不能仅凭此次焦点修正宣称已确定其全部原因。
不把合成事件、Chrome 无头测试或模拟手机当作实际 OS 输入法、NVDA、VoiceOver、真实设备或完整 MVP 验收。
