# 官方 Firefox 核心流程与列表详情可见性

2026-10-27。使用 Mozilla 官方 Windows x64 包和 geckodriver 0.37.1，通过标准 W3C WebDriver 核对实际浏览器。
没有用 Chromium 修改 User-Agent 代替 Firefox，也没有使用 Playwright 修改版 Firefox。
当日[版本表](https://product-details.mozilla.org/1.0/firefox_versions.json)与
[稳定版历史](https://product-details.mozilla.org/1.0/firefox_history_stability_releases.json)确认当前 158.0.1、上一主版本 157.0.1。
包路径、官方校验值和来源固定在 [运行环境清单](../config/firefox-test-runtimes.json)。

## 环境与实际结果

原始安装包、解包运行文件和新建的独立测试资料均在被忽略的本地目录中。
先核对官方 SHA-256，再验证嵌入 7z 头部的 CRC，由 Windows 自带 tar 解包；没有执行安装程序。
测试显式指定解包后的 Firefox 和新资料目录，关闭默认浏览器询问及更新/遥测偏好，使用无头模式。
Firefox 内容进程在受限执行环境中首次启动失败，尚未载入应用页面；正常进程权限下同一二进制通过。
没有为运行测试关闭 Firefox 的内容隔离或修改其安全设置。

| 目标 | 实际浏览器返回 | Build ID | 结果 |
| --- | --- | --- | --- |
| Firefox 158.0.1 | Firefox/158.0 | 20261019185856 | 六项核心任务通过 |
| Firefox 157.0.1 | Firefox/157.0 | 20261005135250 | 六项核心任务通过 |

两版本都记录实际 WebGL 字符串、上下文未丢失、地图截图、完整名称/字体就绪及应用入口/JS/脚本/驱动指纹。
Firefox 的显卡字符串含“or similar”，不据此推断确切物理显卡型号。
实际 CSS 视口为 1440×915、DPR 1，并非误将设置的外窗口 1440×1000 当成网页视口。
浏览器日志有自身图形/任务栏诊断，不将本轮表述为“整个浏览器日志无错误”。

六项任务包括：真实地图/41 层/字体加载；画布键盘平移及缩放；键盘搜索并选择沈阳北铁路站点 node/676578837；
分享对话框焦点与重新导航恢复身份；高速/概览预设切换；按需列表及键盘记录详情、焦点交接和标题可见性。
只检查了文档 Resource Timing 中没有外部资源，不能据此声称浏览器后台完全没有网络活动。
这不是原生输入法、剪贴板权限、全套故障注入、真实设备、读屏或性能验收。

## 发现并修复的产品问题

最初已有“焦点进入列表记录详情”检查通过，但截图中只看到关闭按钮，记录标题被对话框底边裁切。
加强可见几何检查后，Firefox 158 实测标题 top/bottom=902.65/931.57，对话框 bottom=903，实际不可完整阅读。
这说明仅检查 DOM 标题存在或当前焦点不足以证明详情可见。

现在仅在记录仍是当前选择、且用户未转去其他操作时：先保持位置设置焦点，再明确 scrollIntoView 到详情区。
用户在等待时滚动鼠标滚轮也计入交互意图，迟到详情不再抢焦点或强制滚动。
原有输入、指针、Tab/Escape 保护继续保留，关闭详情仍返回原记录按钮。

修复后 Firefox 158 标题位于 279.57–308.48、157 位于 279.63–308.52，均完整落在同一对话框可见区域。
Chrome/Edge 各有三项定向回归：桌面标题可见和关闭焦点返回、390px 模拟下标题可见和关闭焦点返回、
真实浏览器滚轮在延迟详情期间阻止迟到焦点/程序滚动。两者各三项通过，pageerror/外部请求数组为空。
另外两浏览器原有五项列表/键盘/失败恢复回归分别通过，108 项领域/单元测试与严格类型/生产构建通过。

当前构建为 index-iogNndbc.js。此前 Chrome/Edge 86 项报告继续保留 index-B5DC1WQs.js，
字体和性能报告也保持原构建，不能据此宣称当前构建完成了全部性能/浏览器矩阵。
本轮仍未覆盖 Safari、Chrome/Edge 各最近两个版本、手机/平板、NVDA/VoiceOver及完整 N09。

## 复现与证据

初次获取某版本时使用以下命令。脚本要求新解包目录，不覆盖已有运行目录；后续只运行验证器。

```powershell
python scripts/prepare_firefox_runtime.py --version 158.0.1 --fetch
python scripts/prepare_firefox_runtime.py --version 157.0.1 --fetch
python scripts/verify_firefox_core.py --version 158.0.1 --output data/manifests/local/firefox-browser/158.0.1/new-run
python scripts/verify_firefox_core.py --version 157.0.1 --output data/manifests/local/firefox-browser/157.0.1/new-run
```

预览服务使用 127.0.0.1:8766；受限工具环境下 Firefox 内容进程可能需要正常进程权限。
该条件已记录，不把页面载入前的进程失败归因于应用，也没有把失败记录删除。
驱动只监听回环地址，使用标准库客户端，不增加应用运行依赖。

[构建/包校验与报告摘要](evidence/firefox-core.json)、[158 结果](evidence/firefox-core-158.0.1.json)、
[157 结果](evidence/firefox-core-157.0.1.json)、[修复前几何失败](evidence/firefox-core-before-heading-scroll.json)。
大体积官方运行包保留在忽略目录；旧组件源文件归档于 evidence/history。
