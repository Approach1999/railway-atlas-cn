# 首次轨道瓦片读取的超时与恢复

2026-10-26 整理。此前只有显式重试后的 15 秒提示，首次 MVT 请求没有应用层读取上限。
旧构建的真实 HTTP 全阻断探测中，等待 16.5 秒后仍没有轨道瓦片重试入口，地图状态却已经显示就绪。
本轮补齐二进制读取期限，保留已加载车站、详情及其他瓦片，不把故障误当成没有铁路。

## 实现与边界

通过 MapLibre 6.15 的公开 addProtocol 接口，将轨道瓦片交给受限读取器，再返回原 ArrayBuffer。
内部地址只用于 MapLibre 调度；真正网络请求仍是相同版本化 HTTP(S) MVT 地址。
读取器只允许当前 origin 下合法快照的 tiles/z/x/y.pbf，限制坐标范围，拒绝外部地址、凭证 URL、片段及越界路径。
不改 MVT 字节、图层/要素身份、解码器或分类规则，不放宽 CSP。

每个请求的 15 秒预算同时覆盖响应头和完整正文。
超时转换为非 AbortError 的可显示错误，进入原有 failed-tile 重试流程；
真正由 MapLibre 取消的请求保留取消原因，避免报成超时。
HTTP 失败中止未读正文；结束时清除定时器和父信号监听。
保留 cache/referrerPolicy/credentials 及 Cache-Control、Expires 元数据，显式重试仍只刷新失败瓦片。
底图继续走原有独立路径，没有把公共底图纳入此读取器。

## 真实故障验证

故障服务只监听本机临时端口，正常流量代理预览，底图关闭。
从已选中的沈阳北记录进入同一视图，避免测试准备阶段的聚焦动画影响基准。

| 场景 | 服务器观察到请求关闭 | 结果 |
| --- | ---: | --- |
| 首屏 6 个瓦片都无响应头 | 15,002–15,017 ms | 出现超时/重试；实际重新取回失败文件，恢复 242 个渲染片段 |
| 一个瓦片正文传一半停住 | 15,008 ms | 其余内容保留；恢复后当前渲染计数从 114 到 242 |
| 挂起一个瓦片时切换版本 | 471 ms | 旧连接被取消，新版本无瓦片错误，搜索词保留 |

恢复验证不只检查旧的 first-usable 标记：同时确认原失败路径实际返回完整 11,134 字节 HTTP 正文，
再通过文字开关更新后读取新的源就绪 render/idle 诊断；恢复文字开关后地址与选中详情仍一致。
切换测试只挂起一个请求以独立检查源移除取消；早期全连接占用探测不能用来判断“源移除后”的取消延迟。
不据此承诺所有连接耗尽时版本切换即时完成，也不认定此前偶发版本提示超时已查明原因。

77 项单元/领域检查、严格 TS/checkJs 与生产构建通过。
新增读取器单测覆盖精确字节/缓存元数据、非法地址零请求、头与正文超时、取消原因和 HTTP 错误关闭正文。
资源故障恢复 10 项、真实线路关系与分享 4 项、安全/CSP 3 项浏览器回归通过。

## 新构建冷启动

构建 `index-CfMfsslN.js`，同一真实快照，默认 Intel Arc / D3D11、Chrome 155.0.8059.85、Windows、1440×1000，
10 Mbps / 100 ms、关闭底图与 HTTP 缓存，30 个独立上下文串行冷启动：

- 首个铁路视图 median / p95 / max：1834.4 / 1945.4 / 2038.6 ms。
- 车站索引就绪 p95：1318.0 ms。
- 首屏自有响应体与 HTTP 头合计：690,893 B，约 675 KiB；页面第三方请求为 0。
- 每次核对全部 37 个预期轨道/描边/警示图层存在，搜索框可聚焦。

这补充当前读取路径的桌面预算证据，没有逐次点击全部首屏轨道，不关闭完整 N01/N04。
本轮未重做热查询、连续平移、在线底图总传输、真实 200% 与手机/平板验收；旧报告继续对应原构建。
真实长时间断网、浏览器矩阵和其余 R11/N07 门槛保持开放。

证据：[旧首次阻断](evidence/tile-deadlines-before.json)、[头/正文/切换](evidence/tile-deadlines-browser.json)、
[资源恢复](evidence/tile-deadlines-resources.json)、[真实线路](evidence/tile-deadlines-routes.json)、
[安全检查](evidence/tile-deadlines-security.json)、[30 次冷启动](evidence/tile-deadlines-cold.json)、[版本指纹](evidence/tile-deadlines-build.json)。

```powershell
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
# 设置 PLAYWRIGHT_MODULE、PREVIEW_URL、独立 PREVIEW_EVIDENCE
node scripts/verify_tile_timeouts.cjs
```

正常验收不设置 TILE_TIMEOUT_AUDIT_ONLY 或 TILE_TIMEOUT_ONLY_SWITCH；前者仅观察旧构建，后者仅作独立取消诊断。
测试不修改快照，不批量请求公共底图，结束后关闭故障服务。
