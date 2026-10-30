# 当前依赖、许可与本机安全策略复查

2026-10-28，产品仍为 index-DQDm9VWe.js。没有安装、升级或修改任何依赖，也没有修改产品代码。

许可生成器只读--check通过：204组件（npm120/Cargo75/Python9）、116份许可文本，生成内容与当前锁和元数据一致，包级明确文本缺口0。此结果不是许可批准，原生工具与Microsoft runtime等独立开放项不被包清单覆盖。

当前client/probe两份npm官方audit各返回0条；OSV对锁定版本去重后179项查询完成，没有查询错误或未完成分页。
唯一公告仍为RUSTSEC-2026-0249，内容为smartstring停止维护，未提供severity评分；保留findings_require_review状态。不能把缺少评分解释为无风险，也不把本轮报告标为完全干净。

恢复后的8766预览：HTML、目录、数据、许可文本、空瓦片、206/416、404共8条路径的安全头均仅一次且匹配配置，无Set-Cookie；既有Chrome浏览器CSP/恶意详情及底图响应夹具检查通过。
[完整查询原件、响应头与浏览器报告](evidence/dependency-current-recheck.json)。不把一次Chrome或loopback HTTP延伸为公开HTTPS、全浏览器、原生DLL公告或独立渗透测试结论。

Rust维护提示、Microsoft runtime条款/原生安全与传递闭包、历史便携工具核对、公开托管及独立审核继续开放；完整N07/N08和MVP没有据此完成。
