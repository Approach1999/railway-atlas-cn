# 独立浏览器 200% 页面缩放

2026-10-27，应用保持 index-CtnPWcB4.js。没有修改产品代码。

## 方法与范围

旧验收标签页当前已不存在，不能沿用旧人工确认。新建的本机预览没有确认处于 200%；
原生窗口恢复两次返回 failed to activate captured window，未要求用户再次配合设置。

另建工作区内专用临时浏览器配置，使用实际安装的 Chrome 156.0.8078.48 / Edge 156.0.4314.42。
根据 [Chromium 缩放配置实现](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)，
默认分区使用空相对路径对应键 x；按
[缩放换算实现](https://chromium.googlesource.com/chromium/src/+/af5d6d78ea0252ce141d31779e7d1bb01105a80d/third_party/blink/renderer/core/exported/web_view_impl.cc)
把两倍比例写为 log(2)/log(1.2)。不读取或修改用户浏览器配置。

不是仅缩小自动化视口：viewport 为 null，没有覆盖设备指标，也没有 CSS zoom 或手势缩放。
每次通过 CDP Page.getLayoutMetrics 确认 cssVisualViewport.zoom=2、scale=1，
并与同窗口尺寸的 100% 独立配置对照：DPR 从 1 变为 2、CSS 视口约减半，搜索字体声明仍为 14px。
错误的标量配置实际停在 zoom=1，检查明确拒绝 1!=2，不把写了配置当作已放大。

## 已通过操作

两个窗口尺寸 1552×1000、1280×800，对应实际缩放后视口：

| 浏览器 | 较大窗口 CSS 视口 | 较小窗口 CSS 视口 |
| --- | --- | --- |
| Chrome | 763×450 | 627×350 |
| Edge | 759×451 | 623×351 |

每浏览器两项 100% 基线确认和 16 项 200% 核心任务检查通过，共 36 项（其中四项基线）。
包括键盘选择准确铁路站点、详情关闭、预设往返、分享链接/关闭返回焦点、关于页、
文字列表详情标题、手动分享链接的记录与快照身份、列表关闭返回焦点和回到试验区。
检查控件完整落在可滚动到的视口内，中心不被其他元素覆盖，页面没有横向溢出。
未发生页面脚本错误或跨源页面请求；关闭底图，剪贴板拒绝受控，不写用户剪贴板。

## 截图复核已补齐

常规 Playwright 截图只截取了放大表面的 CSS 大小区域，视觉上是页面一角，不能作为完整视口验收。
驱动已改为 CDP 完整表面截图，并加入 PNG 宽高应与 CSS 视口×缩放比例一致的断言。
第一次补拍时，启动新测试进程及轻量确认均被系统拒绝，报
CreateProcessWithLogonW failed: 1909。旧的两份操作报告是在截图修订之前产生，仍保留该范围。

随后在已有 JavaScript 测试环境中直接调用同一验证函数，显式使用已核对的安装执行文件路径，
完成 Chrome/Edge 全部操作及完整表面截图检查，没有改变系统配置或用户浏览器配置。
Chrome 两张完整图为 1526×900、1254×700；Edge 为 1518×903、1246×703。
每张均通过图像尺寸与当前 CSS 视口×实际缩放的核对（允许奇数高度取整），不再只截页面一角。
两浏览器各 18 项检查再次通过，无页面脚本错误或跨源页面请求。
已目视查看 Chrome 较大窗口的完整截图，能看到链接区域与关闭按钮；没有据此声称逐像素可读性全部通过。

测试模块新增显式浏览器路径/通道参数与仓库绝对路径解析，保持命令入口与操作断言共用。
浏览器描述辅助函数接受显式环境配置，原调用默认不变；实际 CDP 执行路径与版本核对仍保留。
已有运行环境最初按通道查找 AppData 下的 Chrome 失败，随后通过 stat 核对 Program Files 的实际文件再显式启动，
没有将未启动当作成功。三个辅助检查的原断言通过最小回调注册适配器执行通过；
常规 node:test 流在此环境超时并重置内核，不将适配器结果标为常规测试运行器或完整应用单元套件通过。

当前预览截图 browser-zoom-preview.png 只展示新开的预览与已隐藏底图，不能标成 200% 证明。
此轮不关闭全部 200% 任务、浏览器菜单 UI、OS 输入法、读屏、真实设备或完整 N09。

## 复现

命令入口可用时，预览运行时设置 PLAYWRIGHT_MODULE、PREVIEW_EVIDENCE 和 ATLAS_BROWSER_CHANNEL：

```powershell
node scripts/verify_browser_zoom.cjs
```

也可从已有 Node 环境 require 此模块，await verifyBrowserZoom，显式传入 playwrightModule、
channel、executablePath 与 outputDirectory；函数与命令入口共用操作和截图断言。
两个浏览器分别顺序运行到新输出目录；命令入口当前仍报 1909，不能将替代运行说成系统故障已经修复。
`--invalid-scalar` 是故意保留错误配置的负向检查，预期失败退出。
[汇总与指纹](evidence/browser-zoom.json)、[Chrome 操作报告](evidence/browser-zoom-chrome.json)、
[Edge 操作报告](evidence/browser-zoom-edge.json)、[错误配置拒绝](evidence/browser-zoom-invalid-scalar.json)。

后续完整复核：[Chrome](evidence/browser-zoom-complete-chrome.json)、[Edge](evidence/browser-zoom-complete-edge.json)、
[辅助检查适配器记录](evidence/browser-zoom-helper-callbacks.json)。
四张完整截图分别为 [Chrome 较大窗口](evidence/browser-zoom-chrome-1552x1000.png)、
[Chrome 较小窗口](evidence/browser-zoom-chrome-1280x800.png)、
[Edge 较大窗口](evidence/browser-zoom-edge-1552x1000.png)、[Edge 较小窗口](evidence/browser-zoom-edge-1280x800.png)。
