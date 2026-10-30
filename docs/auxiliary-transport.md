# 数据说明与底图配置的读取期限

2026-10-26。对 R10/R11/R19 的加载路径核对发现两项缺口：关于页的独立读取在拒绝 HTTP 状态后不关闭未读正文；
底图配置没有应用层读取期限，真实 HTTP 响应头挂起 16.5 秒后仍显示“底图加载中”，没有重试入口。
关于页两个 HTTP 503 部分正文探测，在错误提示出现 300 ms 后仍保持连接。

AboutDialog 的 manifest 与 palette、BasemapControl 的本地配置现在共用 requestJson。
15 秒覆盖响应头和完整 JSON 正文，失败释放未读正文，关闭/卸载保留父取消语义。
去掉关于页重复的外层定时器，超时显示中文读取提示；既有 404/410 说明、快照/配色版本校验、
manifest 与 palette 独立重试、迟到结果隔离和焦点返回均保留。
底图配置超时进入已有“底图暂不可用，铁路仍可浏览”重试入口；不修改公共栅格瓦片的读取路径或 CSP。

## 真实本机 HTTP 结果

| 入口 | 故障 | 服务端观察关闭 | 恢复 |
| --- | --- | ---: | --- |
| 关于页 manifest | 503，正文未结束 | 30 ms | 独立重试成功，焦点回说明标题 |
| 关于页 manifest | 无响应头 | 15,012 ms | 同版本说明恢复 |
| 关于页 manifest | 关闭挂起的说明 | 30 ms | 再打开正常，无迟到覆盖 |
| 关于页 palette | 503，正文未结束 | 8 ms | 配色记录恢复，焦点回来源摘要 |
| 关于页 palette | 正文传输中断 | 15,027 ms | 核对日期恢复 |
| 关于页 palette | 关闭挂起的说明 | 128 ms | 再打开正常，无迟到覆盖 |
| 底图配置 | 503，正文未结束 | 25 ms | 本机栅格图片恢复 |
| 底图配置 | 无响应头 | 14,998 ms | 同一地图实例及选中记录保留 |
| 底图配置 | 正文传输中断 | 15,004 ms | 同一地图实例及选中记录保留 |

全部九项恢复后地址不变。说明页读取 manifest 时故意令地图引导 manifest 失败，
核对说明能独立恢复；配色失败时仍有已加载版本说明和 OSM 署名。
底图测试在本机拦截声明域名的请求并返回有效 PNG，每项恢复 42 个本机响应，没有下载公共瓦片。
这不是在线底图服务可用性测试。页面异常、未声明外部请求均为零。

初次完整探测的栅格夹具 IDAT CRC 不正确，导致图片恢复失败；校验各 PNG chunk 后修正并重跑九项。
此失败保留为测试校准记录，不作为产品缺陷或通过证据。
更早准备测试时，WebGL 禁用后的页头说明按钮按产品布局隐藏，测试调整为实际地图引导失败入口；没有绕过隐藏按钮。

79 项单元/领域检查、严格 TS/checkJs 和生产构建通过；关于数据 8 项、安全/CSP 3 项回归通过。
构建 index-DDn1LNxy.js。历史冷启动、实际 200%、上下文丢失等报告仍对应其原构建，本轮未重新计时或作真机验收。
单浏览器、本机故障与夹具只能支持这些子路径；完整 R10/R11/R19、N07/N09、真实设备和独立审核保持开放。

运行 `node scripts/verify_auxiliary_transport.cjs`，指定 PLAYWRIGHT_MODULE、PREVIEW_URL 和独立 PREVIEW_EVIDENCE。
AUXILIARY_AUDIT_ONLY=1 仅观察旧构建；正常验收不设置该值。生产定时器没有加速，故障服务仅监听本机。

证据：[旧行为](evidence/auxiliary-transport-before.json)、[九项故障](evidence/auxiliary-transport-after.json)、
[关于页回归](evidence/auxiliary-transport-about.json)、[安全回归](evidence/auxiliary-transport-security.json)、
[夹具校准失败](evidence/auxiliary-transport-fixture-failure.json)、[构建指纹](evidence/auxiliary-transport-build.json)。
