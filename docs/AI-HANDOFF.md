# 铁路图集 MVP：AI 接手清单

交接整理日期：2026-10-30。目标是完成既有沈阳地理铁路图 MVP。尚未完成验收，不能据此标为已发布。

## 0. 先拿到正确的代码

- GitHub：`git@github.com:Approach1999/railway-atlas-cn.git`，当前本地分支 `main`。
- **2026-10-31补记：本机新 checkout 位于 `C:\Users\21965\ZCodeProject\railway-atlas-cn`。** 源 PBF
  `data/raw/liaoning-261020.osm.pbf`（MD5/SHA-256 与本文档一致）及快照
  `data/processed/shenyang-mvp-geometry-20261027` 已从同机旧 checkout（`C:\Users\21965\Documents\Codex\2026-10-22\…\work\checkout`）迁入，
  快照经 `scripts/verify_snapshot.py` 全量哈希校验通过；`.venv`（CPython 3.12.14，锁哈希安装）与 `apps/web/*/node_modules` 已重建。
  Playwright 模块路径与第 7 节一致，仍有效。
- **2026-10-31补记：用户已授权提交当前实现。** 本清单、前端、脚本、配置和证据随本次功能提交纳入版本管理。2026-10-30曾有931条工作区状态记录、其中914条未跟踪；这些是交接前历史数量，不是独立任务数。接手时先核对 `git log` 和 `git status`，若远端尚无该提交，仍需取得本地提交或工作区。
- 工作目录：`C:\Users\21965\Documents\Codex\2026-10-22\referenced-chatgpt-conversation-this-is-an\work\checkout`。
- 先检查本地指令、Git 状态和差异，保护用户修改；不要 reset、clean 或重新生成覆盖全部文件。
- 换机器交接时，另行转移当前源码、配置、文档、证据和需要的生成数据；依赖可重装。原始 PBF 与大数据保持忽略，不能直接加入 Git。
- 本次仅获授权先提交当前成果，尚未push或公开部署。提交不代表完整MVP验收通过，也不授权购买托管或替用户批准许可。

## 1. 先读这些文件

1. [完整需求](requirements.md)：R01–R19、D01–D10、N01–N09，共38项，保留原范围。
2. [当前完成审计](mvp-status.md)、[剩余验收](mvp-remaining.md)。部分段落为历史记录，以构建指纹和原始报告判断适用范围。
3. [实施计划](implementation-plan.md)、[架构](architecture.md)、[数据来源](data-sources.md)。
4. [独立用户任务 U01–U08](usability-review.md)。
5. [最近拒绝的增量名称方案](ordered-label-decision.md)、[缓冲128撤回记录](buffer128-decision.md)、[相机同步修复](label-camera-sync.md)。

## 2. 已有实现与可信基线

- React/TypeScript/MapLibre 前端；线路/车站名称、高速与普速颜色区分、预设与详细筛选、设施、搜索、详情、候选选择、图层/底图开关、无地图列表、分享与快照切换均已有实现。
- 包括键盘交互、错误恢复、200%缩放布局等修复；自动检查不等于完整可访问性或人工验收。
- 最近保留的正式构建：`index-D4TfdCvK.js`，SHA256 `227835ec35388d01e5bd2297426e2f34ef92b7c3b5ef0ff1934f93416a94a2cc`。
- 名称源缓冲为512，保留相机变化后等待正确视野的修复。
- 相应证据为120项单元测试、严格TS/构建、Chrome/Edge共86项浏览器回归；不是跨设备全覆盖。接手后若有新修改，旧证据不能直接算新构建通过。
- 默认数据：`data/processed/shenyang-mvp-geometry-20261027`。快照10216个发布对象、2251个MVT瓦片；历史快照保留，不原地覆盖。
- [当前几何抽查包](qa/shenyang-geometry-20261027.md)含115真实对象/45组，但两名独立审核与地图判断字段仍待填写。

## 3. 拖动性能瓶颈：调查已完成（2026-10-31），N03 仍待真实设备

- [x] 已复核 [图层/调度诊断原件汇总](evidence/pan-layer-decision.json)，并完成历史原始帧序列的逐帧结构分析与受控复现实验，见 [呈现节奏调查](present-pacing.md)与[证据索引](evidence/present-pacing-20261031.json)。
- [x] **结论：2026-10-28 的 ~35ms p95 尾部（正式地图默认路径 35.0ms、空白 WebGL 页面 34.6ms）是环境绑定现象，不是应用代码问题。** 慢帧量化在 ~34ms（≈2 个 vsync 周期）且成簇爆发，属间歇性 30Hz 调度；2026-10-31 同机同协议下空白对照与正式地图同步转干净（产品 JS 字节未变，构建指纹一致）：无头/有头 Chrome 156.0.8078.74、Edge、小画布、不清屏均 8.4ms；默认平移 render p95 9.1ms。最显眼的环境差异是 Chrome 补丁 .48→.74，驱动/系统状态不能排除，无法回装旧补丁做 A/B。
- [ ] 软件渲染路径 35.8ms 仍超 33ms 口径，如实保留；软件路径非 N03 验收对象，但不得据此宣称达标。
- [ ] N03 正式验收对象是真实中端 Android/iPhone/平板与桌面浏览器（每设备 30 秒轨迹），仍未验；不以本机无头代理、rAF 或平均 FPS 代替。
- [ ] 历史结论维持：分层隐藏诊断不能作为删功能依据；已排除方案（缓冲512→128、有序前缀增量更新）不要重复尝试；33ms、30秒、终点误差<2px 口径不放宽，不剔除慢样本。

已排除的方案：缓冲512→128和有序前缀增量更新均未证明提速，正式路径未采用。后者100次筛选对照p95概览91.1→109.4ms、站场40.8→63.6ms。不要重复把它们当成已验证优化。

## 4. 修改后需要完成的工程验证

- [ ] 基于具体变更运行相关测试；通过后再做必要回归，避免无变更地反复跑全套。
- [ ] 最终构建复测：桌面30次冷启动、100次热搜索、各场景100次筛选、30秒固定站场平移；10Mbps/100ms，记录设备/浏览器/构建/快照/原始样本及median/p95/max。
- [ ] N01桌面首屏≤3s，手机/平板≤5s；N02筛选p95≤100ms、搜索≤300ms；N04首屏自有资源≤2MiB、单MVT gzip≤500KiB。在线底图的总传输和第三方请求另报。
- [ ] 浏览器版本范围按需求核对：桌面Chrome/Edge/Firefox/Safari最近两个稳定版，Android Chrome、iOS Safari、平板默认浏览器。安装旧版本不等于满足当日版本范围。
- [ ] Firefox已有有限历史验证，见 [Firefox记录](firefox-current.md)；不能自动套到最新构建。Windows不能代替真实Safari/iOS验收。
- [ ] 故障/恢复路径仍要保留：WebGL不可用、字体/索引/瓦片/详情失败、重试、版本切换竞态、分享往返、列表替代路径。

## 5. 需要真人或外部设备的验收

这些不能由AI自填“通过”；可准备表格和操作步骤、修复实际发现的问题。

- [ ] 真实中端Android、iPhone、平板的N01–N04验证，记录型号/OS/浏览器。用户此前表示暂不方便，不要反复要求立即配合；保持明确待验。
- [ ] 完整N09：NVDA桌面、VoiceOver iOS、实际OS输入法、200%缩放、键盘焦点、减少动态效果、触摸目标、文字/非文字对比度和红绿色觉缺陷检查。AX树/合成IME/视口模拟不能替代这些。
- [ ] 两名独立审核者检查115条抽查记录并按需求补齐覆盖：原标签、实际展示、分类、位置偏差、审核人和日期；严重错误0、一致率≥95%，分歧交第三人/负责人裁决。
- [ ] 至少3名未参与开发的人，含铁路兴趣用户和普通地图用户，桌面/手机执行U01–U08，记录用时、误选、求助、原话。修阻断项后复测失败任务。
- [ ] 缺少真实源记录的设施类别注明不足，不能用合成数据伪造真实样本覆盖；不要把OSM“当前标注”称为已核实运营。

## 6. 依赖、安全与发布准备

- [ ] 重查 [依赖与安全开放项](dependency-current-recheck.md)、[许可清单](dependency-licenses.md)及各自证据，历史audit不等于当前批准。
- [ ] 处理Rust `smartstring` 的 `RUSTSEC-2026-0249` 停止维护提示；替换/升级要验证全部传递依赖，先前盲目升级曾引入其他公告。缺少severity不等于已处置。2026-10-31复查：`osmpbfreader` 0.19.1 与 `osmpbf` 0.3.8 仍各自为最新发行版（前者依赖smartstring、后者 memmap2 0.5 公告未修），`smartstring` 1.0.1（2022）即其最终版——当前无可用的上游修复路径，维持 findings_require_review，例外须有 owner/理由/到期批准；见 [复查记录](dependency-current-recheck.md)。
- [ ] 补齐原生工具、Microsoft C++ runtime条款、安全和传递依赖核对；npm/Cargo/Python包级清单不能替代这些。
- [ ] 最终依赖锁、许可/署名、字体/底图/数据来源、工具链和输出指纹齐全。high/critical问题必须修复或取得有owner/理由/到期的真实例外批准，不能替负责人签字。
- [ ] 确认实际托管与发布方案后验证HTTPS/CSP/隐私及署名；本机HTTP通过不代表线上通过。公开发布还需确认底图、许可和原文列出的适用要求。
- [ ] N06：不可变版本URL、至少12个月保留机制、当前/上一通过版本切换、current指针TTL≤5分钟、5分钟内回滚演练。准备配置与演练证据，不伪造12个月运行历史。
- [ ] 用户选择好托管/发布方案并授权后再执行外部发布；不要自行猜测账号、域名或付费套餐。

## 7. 常用启动与检查命令（PowerShell）

在仓库根目录执行；先确认依赖存在，缺少时按锁文件安装。重新构建会改变dist，须保留需要的旧构建证据。

```powershell
npm.cmd --prefix apps/web/client test
npm.cmd --prefix apps/web/client run build
.venv/Scripts/python.exe scripts/serve_probe.py --app client --port 8766 --data-dir data/processed/shenyang-mvp-geometry-20261027
```

预览 `http://127.0.0.1:8766/`。先检查端口/已有进程，不因一次超时重启或重复起服务。

浏览器脚本使用Playwright；本机模块路径可设为：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/21965/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:PREVIEW_URL='http://127.0.0.1:8766'
$env:MVP_DATA_DIR='data/processed/shenyang-mvp-geometry-20261027'
$env:BENCH_SNAPSHOT='shenyang-mvp-geometry-20261027'
$env:BENCH_RENDERER='default'
$env:BENCH_TRAJECTORY='drag'
$env:PREVIEW_EVIDENCE='data/manifests/local/handoff-new-run'
node scripts/benchmark_pan.cjs
```

迁移机器后替换运行时路径；性能测量必须串行，不同时开多个浏览器任务。`benchmark_client.cjs`、`benchmark_filters.cjs`和各`verify_*.cjs`先阅读参数/覆盖范围再用。
数据完整性可从 `scripts/verify_mvt_integrity.mjs` 和 `scripts/prepare_qa_samples.py --help` 入手；不要把确定性对账当人工分类通过。

## 8. 交付与完成条件

- [ ] 列出实际修改、运行命令、原始证据路径、构建/数据指纹及剩余缺口。
- [ ] 对38项需求逐项核对当前证据，区分已证明、未完成、未验证；历史报告不能覆盖新版。
- [ ] 保留原始PBF/大型生成数据的忽略规则，保留许可与来源文档；避免`git add .`把所有本地材料混入提交。
- [ ] 对仍需真人、外部设备或托管证据的项目诚实标注待验；不能以“可用原型”或“桌面自动测试通过”宣称完整MVP完成。

可直接给接手AI的指令：

> 请接手当前本地工作区，先阅读 docs/AI-HANDOFF.md 和 docs/requirements.md，保护已有未提交修改。按交接清单推进完整沈阳MVP，先复核性能诊断，再做有证据支持的修改。保留R01–R19、D01–D10、N01–N09全部范围；不要重做已验证功能、伪造真人验收或自行发布。每次交付说明改动、验证和未完成项。
