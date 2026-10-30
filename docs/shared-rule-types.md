# 共享筛选与搜索规则的实现检查

2026-10-25。`apps/web/shared/model.mjs` 现在由客户端生产构建直接进行严格类型检查。
移除同名手写声明 `model.d.mts`，开启 allowJs/checkJs，并明确将共享实现和客户端 TS/TSX 纳入检查。
共享文件用 JSDoc 引入统一领域类型、MapLibre 表达式类型及泛型搜索记录约束，保留浏览器可直接导入的 .mjs 格式。
产品地图、列表和早期探针继续调用同一份实现；未增加依赖或运行时请求。
探针主体、独立数据构建脚本和 JS 测试文件不据此宣称已接受严格类型检查。

状态样式要求覆盖所有生命周期，制式/等级/预设名称要求覆盖领域枚举；搜索要求字符串身份和名称，
地图过滤表达式在实际返回处接受检查。原先遗漏的 `MODE_LABELS.other` 已补为“其他轨道”，
实际记录 `way/1434300102`（沈阳铁路陈列馆小火车线）的地图、列表和 WebGL 失败路径验证了这一显示。
这项显示修正没有改变其来源身份、其他轨道分类或等级未标注状态。

## 类型门槛的证据

`npm run test:types --prefix apps/web/client` 先检查真实项目，再核对编译输入确实包含共享实现且没有同名声明。
随后只在忽略目录中的副本注入三种错误：错误的过滤返回值、字符串透明度、缺失 other 类别名。
三个副本均产生 TS2322；原项目检查通过。没有临时破坏实际服务源码，也未使用 any、ts-ignore 或 ts-nocheck。
这验证了检查门槛确实生效，不代表所有铁路领域规则正确。
[编译门槛记录](evidence/shared-types-compiler-guard.json)。

## 行为和实际数据

[迁移对照](evidence/shared-rules-migration.json)比较[保存的原共享实现](evidence/history/shared-model-before.mjs)：
144 个有效筛选变体、792 组属性（含缺失属性），覆盖 798,336 次可见性判断和 3,024 个表达式输出，结果一致。
当前 361 个车站的九种搜索查询排序也一致，源记录未被修改；唯一预期元数据变化是补齐 other 的中文名称。
这是有限网格对照，不是所有筛选组合的真实渲染证明，也不是独立分类验收。

63 项单元/领域检查及严格类型构建通过。
[真实记录与原生模块](evidence/shared-rules-browser.json)验证构建后的产品和未经转译的探针模块均可执行共享规则。
现有浏览器回归通过：筛选 8 组、搜索 9 组、列表/失败恢复 5 组、真实线路 4 组，以及 12 个真实对象的地图/列表字段对照。
全部关闭公共底图请求，无页面异常；没有使用这些模拟结果替代真实设备或读屏。
三份快照共 782 份配置/索引/详情文件、30,550 份详情记录重新通过客户端契约检查，源数据未重建。

```powershell
npm run typecheck --prefix apps/web/client
npm run test:types --prefix apps/web/client
npm test --prefix apps/web/client
npm run build --prefix apps/web/client
node scripts/verify_shared_rules.mjs docs/evidence/history/shared-model-before.mjs data/processed/shenyang-mvp-20261023/stations.geojson data/manifests/local/shared-rules-replay.json
node scripts/verify_client_contracts.mjs data/processed/shenyang-mvp-20261023 data/processed/shenyang-mvp-accessible-20261022 data/processed/shenyang-mvp-progress-20261022
# 本机预览运行后，设置 PLAYWRIGHT_MODULE；统一 PREVIEW_URL=http://127.0.0.1:8766
node scripts/verify_shared_rules_browser.cjs
node scripts/verify_react_filters.cjs
node scripts/verify_react_search.cjs
node scripts/verify_accessibility.cjs
node scripts/verify_real_routes.cjs
node scripts/verify_detail_fields.cjs
```

证据：[构建与文件指纹](evidence/shared-rule-types-build.json)、[数据契约](evidence/shared-rules-client-contracts.json)、
[筛选](evidence/shared-rules-filters.json)、[搜索](evidence/shared-rules-search.json)、
[列表](evidence/shared-rules-accessibility.json)、[线路](evidence/shared-rules-routes.json)、
[字段](evidence/shared-rules-fields.json)。
渲染器整理、真实设备/读屏、独立人工、完整性能和原生依赖等原有 MVP 未完成项继续保留。

后续[样式修复](track-style-validation.md)将两种旧常量筛选改为 literal 布尔表达式。
上文迁移记录保留当时的指纹与结果；当前对照脚本会先规范化这两种常量写法再比较表达式，
并继续逐项比较可见性结果，不把新旧 AST 写成逐字节相同。
