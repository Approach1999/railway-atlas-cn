# 第二批预览：可隐藏底图与 React 入口

2026-10-26 补充：本地底图配置也有完整读取期限与失败重试，修复响应挂起时无限加载；
真实本机故障及栅格夹具恢复记录见 [说明与底图读取](auxiliary-transport.md)。以下保留原预览记录。

2026-10-22。本批在 `apps/web/client` 建立 React + TypeScript + Vite 应用入口，
保留上一批已验证的地图行为。默认服务现在打开构建后的 client，旧探针通过 `--app probe` 打开。

## 已实现

- 地图右上方独立“显示底图”开关，默认开启；关闭恢复暖灰纯色背景。
- 独立 raster source/layer 放在铁路下面，淡化为 opacity 0.48、saturation -0.85、contrast -0.15。
- 开关只添加/移除底图来源和图层，不调用 setStyle、fitBounds 或重建地图；
  轨道、线路名、站名、相机、筛选和当前选中不受影响。
- 关闭时移除 source，停止后续瓦片请求；已经发出的请求可能完成。
  刷新读取 `localStorage['railway-atlas:basemap:v1']`，关闭偏好下不创建外部底图来源。
  浏览器存储不可用时仍可切换，本次选择无法跨刷新保存。
- 底图加载错误/超时回退纯色，独立提示与重试，不把铁路数据误报为失败。
- 可访问开关状态、44 px 触摸目标；移动端保留底图/铁路署名，详情不遮挡。

## 来源、坐标与服务边界

来源配置为 [config/basemap.json](../config/basemap.json)，记录域名、URL、日期和显示参数。
使用 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`，署名和版权页链接始终可见。
铁路源坐标为 WGS84，底图为标准 XYZ / Web Mercator，由 MapLibre 统一投影；
没有对其中一层单独施加坐标偏移。区域截图中沈阳/沈阳北站与铁路走廊视觉叠合；
这不是测量级精度证明。

核对的第一方来源：

- [OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)：
  可供正常按视野交互浏览，服务不保证可用；不得批量预取、打包或提供离线底图。
  浏览器保留默认请求 UA、有效 Referer 和服务方缓存策略。
- [OSM 版权与许可](https://www.openstreetmap.org/copyright)：数据与底图署名/使用条件的入口。

底图直接由浏览器请求，不代理、不下载进仓库，不设置绕过缓存的查询参数或请求头。
页面使用 `Referrer-Policy: strict-origin-when-cross-origin`，保留来源站点信息。
“关于数据”说明 `tile.openstreetmap.org` 会接收 IP、请求瓦片编号与来源站点；
不请求设备定位，不引入外部字体或分析脚本。
铁路快照时间与在线底图更新时间分开，底图不绑定本机铁路 snapshot_id。
此选择用于当前本机交互预览；公开发布前仍须完成既有底图/许可/地图发布与容量验收。

## 前端结构与迁移边界

| 位置 | 职责 |
| --- | --- |
| client/src/App.tsx | React 页面结构、数据说明与地图宿主 |
| client/src/BasemapControl.tsx | 开关、偏好、状态与重试的 React 状态 |
| client/src/basemap.ts | 有类型的配置、图层生命周期、错误隔离与清理 |
| client/src/map-controller.ts | 铁路渲染、搜索、筛选与详情控制器；2026-10-23 迁移为严格 TS |
| shared/model.mjs | 探针和 React client 共用的领域规则，避免双份分类/搜索逻辑 |
| client/vite.config.ts | 本机构建与开发代理 |

保留控制器有 mount/destroy、事件解绑、请求取消和延迟响应保护。
React 的结果/详情空槽由控制器管理，不由 React 同时写入；未把整套既有交互重写。
最初入口与新增底图模块通过严格 TypeScript 检查，旧控制器采用 allowJs/checkJs=false。
2026-10-23 已将铁路控制器迁移为严格 TS、禁用客户端 allowJs 并补齐运行时数据边界，
见 [迁移与验证](frontend-types.md)。后续[筛选与图例](react-filters.md)已交由 React 管理，
搜索也已[迁移](react-search.md)；共享规则实现仍为有声明契约的 JS，[详情/候选](react-details.md)和[分享](react-share.md)已由 React 接管，通知/状态等 DOM 尚由控制器管理；
不能将此次迁移等同于完整 React 状态/组件拆分或全部 P2 功能完成。
构建显式输出 MapLibre module worker，避免只把主入口打包而造成空白地图。
Vite 对主地图包给出大于 500 kB 的体积提示；本次没有做弱网/真实移动设备性能验收。

## 启动与验证

先按 [第一批指南](preview-v1.md) 准备 `data/processed/shenyang-map-20261022`。
本次工具链 Node 24.15.0，依赖均写入 client/package-lock.json。

```sh
npm ci --prefix apps/web/client --ignore-scripts
npm run build --prefix apps/web/client
python scripts/serve_probe.py --port 8766 --data-dir data/processed/shenyang-map-20261022
```

打开本机 `http://127.0.0.1:8766/`。修改 client 源码后重新 build；
开发时也可在数据服务运行后执行 `npm run dev --prefix apps/web/client`。
旧原生探针使用 `python scripts/serve_probe.py --app probe --port 8767 --data-dir data/processed/shenyang-map-20261022`。

```sh
npm test --prefix apps/web/client
npm run typecheck --prefix apps/web/client
node --test apps/web/probe/model.test.mjs
```

浏览器测试：在独立 Playwright 环境执行 `node scripts/verify_client.cjs`，
PLAYWRIGHT_MODULE / PREVIEW_URL / PREVIEW_EVIDENCE 的设置方式同第一批。
回归流程截获底图请求并使用生成的 PNG 测试夹具，不向公共瓦片服务驱动自动平移/缩放。
另做一次固定初始视野的真实底图加载检查，未进行自动扫图或瓦片归档。
真实截图和测试夹具截图分开保存；手机截图仅为 390 px 模拟，不是实际手机验收。

保留证据：[构建页面回归](evidence/basemap-browser.json)、[真实底图加载](evidence/basemap-live.json)、
[真实叠合截图](evidence/basemap-desktop.png)、[依赖审计](evidence/client-dependency-audit.json)。
6 项底图生命周期/偏好测试、3 项共享规则测试、7 项浏览器流程通过；
类型检查与生产构建通过，审计报告未发现漏洞。真实底图检查仅覆盖当前桌面初始视野，
不作为服务可用性保证或大范围精度验收。

未在本批实现：地铁线路关系/按线路配色、设施细节、全国目录、分享 URL，
以及既有实施计划中的完整错误状态、独立用户测试和公开发布流程。

关于数据及配色核对日期现见 [实现与版本上下文](about-data.md)。
