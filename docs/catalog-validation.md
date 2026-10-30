# 版本目录异常隔离与切换竞态检查

2026-10-25。本轮在检查版本切换稳定性时发现独立的目录边界缺口。
此前直接把 response.json 标成 Catalog，只检查了部分 ID 和数组；正则也可能把缺失的 ID 转成字符串后接受。
真实浏览器中，地区名称为对象的目录触发 React error #31，地图与目录一起消失。
空经度、字符串列表能力、重复/缺失快照 ID、不在列表中的推荐版本、对象日期也没有被明确拒绝。
这项可复现故障不是此前一次“已切换数据版本”等待超时的已证实原因。

## 修复

目录响应以 unknown 进入 `parseCatalog`，验证后才交给 React 或相机切换：

- schema=1、非空地区与版本列表；地区和版本 ID 是合规字符串、在相应列表内唯一，推荐版本确实存在。
- 地区名称为非空文本；默认经纬度、缩放为有限数字，范围沿用当前地图地址的限制。
- 要素列表能力必须是 boolean，避免把字符串 false 当成真。
- 缺失或 null 日期保持未标注；非空日期必须是带时区、可解析的日期时间文本。
- 输出新建对象和数组，不保留输入对象引用；只接收界面实际消费的字段。

无法读取、损坏 JSON 或校验失败时，仅在目录中显示中文错误及重试按钮。
不会发布损坏的版本选项，当前画布、视图和查询保持可用。
恢复正常目录并重试时保留相同画布、地址和已输入的搜索词。

三个实际目录快照的能力值来自各自 manifest：当前和 accessible 版本提供对象列表，progress 版本仅提供车站列表。
小型目录元数据夹具记录对应 manifest 的哈希，保留原构建/保留时间，不把旧版本一概当成相同能力。
单元测试不依赖被忽略的本机数据；浏览器重试另使用当前真实目录。
目录单测另在仅允许读取客户端目录的 Node 权限模式下通过（3 项），未开放 data 目录读取。

## 证据

70 项单元/领域检查及严格 TS/checkJs、生产构建通过。
新增纯函数检查包含 25 个变体、4 类根值，以及三个快照的元数据夹具；浏览器对上述 7 种损坏目录逐一检查异常隔离和真实目录重试。
目录原有 8 项回归通过，包括真实版本切换、失败保留、取消、前进/后退、到期入口和无 WebGL 列表恢复。

另有 3 项更换目标/取消的真实请求竞态检查：

1. 挂起 progress 版本 manifest 请求，改选 accessible 并成功提交，再释放早期请求，地址和成功提示保持新版本。
2. 打开关于数据，核对实际 manifest 的来源记录也是 accessible，避免只凭地址或选择器判断切换成功。
3. 再挂起当前版本请求并明确取消，释放请求后地图、查询及取消提示保持，重试仍可用。

两个被取消请求实际记录为 net::ERR_ABORTED。这证明测试场景中的请求确已取消，
不声称覆盖所有不可取消后台任务、所有响应先后组合或长时间断网。
本轮没有修改切换的取消/代次逻辑，新增的是验证证据。

[修复前浏览器记录](evidence/catalog-boundary-before.json)、[修复后隔离与重试](evidence/catalog-boundary-after.json)、
[目录回归](evidence/catalog-boundary-regression.json)、[目标更换与取消](evidence/catalog-boundary-races.json)、
[构建指纹](evidence/catalog-boundary-build.json)。
此前偶发超时继续见[原始稳定性记录](evidence/filter-performance-filter-timeout.json)，不标为已解决。
实际 200%、首屏和平移报告仍分别对应其原构建；本轮未重做这些验收。

```powershell
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
node scripts/verify_catalog_boundary.cjs
node scripts/verify_catalog_races.cjs
node scripts/verify_catalog.cjs
```

浏览器脚本使用独立本机预览，设置 `PLAYWRIGHT_MODULE`、`PREVIEW_URL` 和独立 `PREVIEW_EVIDENCE`；
故障只通过独立浏览器响应替换注入，没有修改正式目录或快照。
`CATALOG_AUDIT_ONLY=1` 用于旧构建的观察记录，正常验证必须保持未设置或为 0。
