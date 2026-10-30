# 前端类型与数据边界

2026-10-23。客户端 `src/map-controller.ts` 已由当前铁路控制器迁移为严格 TypeScript，
App 直接导入此文件，不再保留绕开检查的同名 JS 入口。首次迁移时客户端 `allowJs=false`，
开启未使用变量/参数检查；未添加 `any`、`@ts-ignore` 或 `@ts-nocheck` 规避迁移。
MapLibre worker 仍显式构建，不改变按视野加载瓦片、按需读取详情的方式。
[迁移记录与源文件指纹](evidence/mvp-typescript-migration.json)。

`shared/atlas-types.ts` 统一制式、等级、状态、筛选、几何、车站、线路、配色与版本模型。
首次迁移用 `shared/model.d.mts` 为共享 JS 规则提供调用契约，尚未检查实现自身。
2026-10-25 已移除此声明，通过 allowJs/checkJs 将 `shared/model.mjs` 实现直接纳入严格检查，
补齐枚举名称与样式覆盖约束，并用故障副本验证编译器确实拒绝错误。详见[共享规则实现检查](shared-rule-types.md)。
原生探针主体与独立数据构建器继续使用 JS，不包含在这次严格类型检查声明中。
GeoJSON 类型依赖固定为 `@types/geojson@7946.0.16`，仅构建时使用，没有新增运行时请求。

## 数据入口

- 索引、版本、配色、要素列表与详情读取为 `unknown`，经运行时校验后才进入状态。
- 校验枚举、中文名称/别名形状、重复来源身份、原始标签、元数据、坐标和闭合多边形环；
  列表与版本身份一致，详情的来源 ID 必须与分片键及当前选中记录一致。
- 未识别运营方允许 `null`。真实电车记录缺运营方配置时保留缺失与回退色，不为了类型而补造身份。
- 瓦片与源 JSON 有不同的线格式：当前 MVT writer 将数组属性编码为 JSON 字符串。
  `tile-feature.ts` 仅在点击边界解码声明的数组字段（线路键、关联车站、代表点等），
  然后作完整校验；不把这种转换用于严格的索引或原始详情。
- 瓦片裁剪可能把单一站区面拆成 MultiPolygon；点击解码、代表点、命中距离与选中面支持这种几何。
  原始 node/way 详情仍按源契约检查，默认不接受裁剪产物 MultiPolygon。
- 损坏详情或列表走已有提示/重试入口，保留查询、筛选与视图；错误记录不能作为完整详情显示。
- 搜索缩放后仍在途的旧瓦片失败会归入同一次显式重试，每个新失败 ID 最多追加重试一次；
  成功加载事件会清除该 ID 的失败记录，避免迟到错误覆盖恢复结果，也不重下其他成功瓦片。

## 复现

```powershell
npm run typecheck --prefix apps/web/client
npm run build --prefix apps/web/client
npm test --prefix apps/web/client
node scripts/verify_client_contracts.mjs data/processed/shenyang-mvp-20261023 data/processed/shenyang-mvp-accessible-20261022 data/processed/shenyang-mvp-progress-20261022
python -X utf8 scripts/serve_probe.py --port 8766
```

设置已安装的 `PLAYWRIGHT_MODULE`、`PREVIEW_URL=http://127.0.0.1:8766`，运行
`scripts/verify_typed_boundary.cjs`、`verify_resource_recovery.cjs`、`verify_real_routes.cjs`、
`verify_accessibility.cjs`、`verify_share.cjs`、`verify_catalog.cjs`、`verify_mvp_work.cjs` 与 `verify_client.cjs`。
设施脚本默认使用当前真实快照，并核对浏览器与检查源来自同一版本；旧源仍可通过 `MVP_DATA_DIR` 指定。
公共底图回归使用本地夹具或关闭请求，不自动批量访问公共瓦片。

当前三份实际快照共 782 份配置、索引与详情 JSON 文件（含 30,550 份详情记录）通过客户端契约及分片身份核对，
包括当前快照 10,216 份详情、361 份车站记录与 12 条城市轨道身份。
证据：[客户端文件契约](evidence/mvp-client-contracts.json)、[损坏记录恢复](evidence/mvp-typed-boundary.json)。
编译与领域测试、真实设施/线路、列表、分享、版本、底图和分项失败恢复分别留有本机回归记录。

后续[筛选与交互图例](react-filters.md)、[车站搜索](react-search.md)、[地图详情/候选](react-details.md)、[分享面板](react-share.md)和[地图提示/恢复入口](map-feedback.md)已由 React 和明确状态管理；面板收起与复位事件也迁入 React。控制器继续负责地图、相机、选中布局和焦点协调。
本节源文件指纹为严格类型迁移当时记录，后续 React 改动见其独立证据。
此文档不宣称完整 P2、探针/构建脚本全面类型检查、独立人工审查、真实移动设备、读屏或公开发布验收完成。

关于数据及配色核对日期现见 [实现与版本上下文](about-data.md)。
