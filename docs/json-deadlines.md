# 挂起 JSON 请求的超时与恢复

## 2026-10-26 补充：拒绝 HTTP 状态后关闭错误正文

### 列表独立线路名称读取

随后检查地图不可用的独立列表路径，发现线路名称仍使用独立 fetch/定时器，
HTTP 503 后清除定时器却保留未读正文，直到关闭/重试才会取消。真实 HTTP 服务确认错误显示后 300 ms 连接仍开着。
现在 AccessibleExplorer 的线路名称也使用 listJson，复用同一读取预算和失败释放机制，
保留真实源线路编号回退、名称独立重试及焦点返回，不依赖地图控制器。

在 WebGL 禁用、真实地铁沈阳北站 node/11224161741 的列表视图，四项本机 HTTP 验证通过：
503 未完成正文 4 ms 关闭；无响应头 15,004 ms 关闭；正文中断 15,009 ms 关闭；关闭列表取消 124 ms。
各项恢复后均显示实际 2号线 / 4号线名称，选中身份、查询和地址不变；重试焦点回到列表记录详情。
关闭后重新打开没有迟到错误；页面异常与第三方请求均为零。
79 项共享领域/单元测试、严格类型生产构建及键盘/列表/详情/分享等 5 项浏览器回归通过。
没有新增领域逻辑的重复单测，新增真实 HTTP 端到端验证用于覆盖此调用路径。

当前构建 index-DnV9PvjI.js。下文 index-C8EflA5L.js 及历史性能/实际缩放证据保留各自构建；
本轮仅核对该列表请求路径及相关回归，不关闭全部 R11/N09、读屏或真机门槛。
运行 `node scripts/verify_list_lines_transport.cjs`，指定 PLAYWRIGHT_MODULE、PREVIEW_URL、独立 PREVIEW_EVIDENCE；
LIST_LINES_AUDIT_ONLY=1 只观察旧 HTTP 错误行为，正常验收不设置此值。
证据：[旧行为](evidence/list-lines-transport-before.json)、[四项故障](evidence/list-lines-transport-after.json)、
[列表回归](evidence/list-lines-transport-accessibility.json)、[构建指纹](evidence/list-lines-transport-build.json)。

### 共享 JSON HTTP 状态拒绝

此前 requestJson 在非成功状态下立即抛出业务错误并清除定时器，却没有中止未读的响应正文。
本机真实 HTTP 503 服务发送响应头及部分 chunked 正文后不结束，连续四次目录重试中，
每次错误提示出现 300 ms 后，服务器观察到旧请求仍未关闭；成功恢复目录也不能证明旧连接已释放。
这可能累积连接，现已在失败分支中止子控制器，再原样传递 HTTP/解析错误或父取消原因。
成功读取仍保留完成信号，不改变缓存、状态码提示及 15 秒预算。

同一服务和四次操作复测，连接分别在 296/9/7/6 ms 关闭，最后重试恢复真实目录。
同一地图画布、沈阳北选中详情、查询与 URL 保留；没有页面异常或第三方请求。
新增两项单测检查 410 错误对象身份、未读取正文、解析错误身份及请求关闭；79 项单元/领域检查、
严格类型与生产构建、目录 8 项和资源恢复 10 项回归通过。

构建为 index-C8EflA5L.js；前一节及其他历史性能报告仍对应各自构建，本轮未重测性能或真实设备。
此证据只覆盖本机真实错误正文及相关回归，不关闭完整 R11、真实长期断网或浏览器矩阵。
测试命令：`node scripts/verify_json_error_body.cjs`，设置 PLAYWRIGHT_MODULE、PREVIEW_URL、独立 PREVIEW_EVIDENCE；
JSON_ERROR_BODY_AUDIT_ONLY=1 仅记录旧行为，正常验收不设置此值。
证据：[修复前](evidence/json-error-body-before.json)、[修复后](evidence/json-error-body-after.json)、
[目录](evidence/json-error-body-catalog.json)、[资源](evidence/json-error-body-resources.json)、[构建](evidence/json-error-body-build.json)。

## 2026-10-25 首次读取期限

2026-10-25。R11/R14 核对发现：列表已有超时，但地区目录与版本预加载使用裸 fetch。
修复前在真实本机 HTTP 连接挂起后，目录与版本请求 16.5 秒后仍未取消，
目录没有重试入口，版本仍显示“正在准备所选版本”。这是一项独立可复现缺口，
不证明此前一次未保存页面状态的版本提示超时与它同因。

## 行为

`requestJson` 将响应头与整个 JSON 正文纳入 15 秒读取上限，结束后清理定时器与父信号监听。
主动取消保留调用方原因，超时使用中文提示和独立错误类别；HTTP 状态错误继续保留原有类别和状态码。
列表保留原导入入口，复用相同实现。地图说明、配色、车站、线路及详情 JSON 读取也使用此实现，
替代原先的 AbortSignal.any/timeout 组合，未改变文件路径、缓存或校验规则。

版本预加载另设一个整体 15 秒预算：manifest、palette、stations 与后续 lines 共用，
不会在进入线路索引时重新获得 15 秒。任一资源失败或调用方取消时，中止仍在等待的同批请求。
只有全部资源读取、校验成功且未取消后才返回 bundle，当前地图的替换顺序不变。

目录超时提供“重试数据目录”；版本超时恢复可操作状态，说明原地图、视图和选中记录保留，
可再次使用所选版本或改选其他版本。主动取消显示取消说明，迟到请求不再覆盖状态。
本轮没有改变底图/MVT 传输；数据说明对话框仍保留其已有 15 秒机制，不宣称 R11 所有路径已验收。

## 验证

73 项单元/领域检查、严格 TS/checkJs 与生产构建通过。
其中使用受控时钟证明：前一阶段用掉 20/30 ms 后，后续线路读取只能再等待剩余 10 ms，
不会重置整体预算；另测头/正文/线路挂起、失败取消兄弟请求、原取消原因、完成后定时器释放。
这些短时钟单测之外，浏览器保留生产 15 秒参数，没有加速或缩短时钟。

测试服务只监听 127.0.0.1 的临时端口，正常请求代理现有预览；
故障请求真实保持 HTTP 响应头不发送，或发送 chunked JSON 前缀后停止正文，
并在服务器端记录客户端实际关闭连接的时间。

| 场景 | 挂起请求关闭时间 | 恢复 |
| --- | ---: | --- |
| 目录无响应头 | 15,000 ms | 目录重试成功，画布/地址/查询不变 |
| 目录正文停住 | 15,005 ms | 同上 |
| 版本 manifest 无响应头 | 15,014 ms | 保留当前地图与选中，重试切换成功 |
| 后续线路索引正文停住 | 14,961 ms | 共享预算起点稍早于此请求；重试成功 |
| 主动取消未完成正文 | 92 ms | 显示取消，重试仍成功 |

五类均核对真实请求已到达故障服务。目录/版本超时保持当前画布、地址、搜索词与详情，
没有静默换成空图。列表真实 15 秒超时/关闭取消 3 项、目录与导航 8 项、资源恢复 10 项、
快速目标替换/取消 3 项回归通过，页面错误为零。

证据：[修复前](evidence/json-deadlines-before.json)、[真实头/正文故障与恢复](evidence/json-deadlines-browser.json)、
[列表](evidence/json-deadlines-list.json)、[目录](evidence/json-deadlines-catalog.json)、
[资源恢复](evidence/json-deadlines-resources.json)、[竞态](evidence/json-deadlines-races.json)、[构建指纹](evidence/json-deadlines-build.json)。
此前偶发超时继续见[原稳定性记录](evidence/filter-performance-filter-timeout.json)。
新构建为 `index-DB4aNY2X.js`；既有性能、真实 200% 与其他浏览器/设备记录仍对应各自原构建。

```powershell
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
# 设置 PLAYWRIGHT_MODULE、PREVIEW_URL、独立 PREVIEW_EVIDENCE
node scripts/verify_catalog_timeouts.cjs
node scripts/verify_list_timeouts.cjs
```

`CATALOG_TIMEOUT_AUDIT_ONLY=1` 仅用于旧构建观察，正常验收必须未设置或为 0。
故障服务随脚本结束关闭；测试不修改正式快照，不请求公共底图，不代替真实长时间断网或真机验收。
