# 数据来源与许可

## OpenStreetMap / Geofabrik

- 数据生产者：OpenStreetMap contributors。
- 下载页：https://download.geofabrik.de/asia/china.html
- 滚动下载地址：https://download.geofabrik.de/asia/china-latest.osm.pbf
- 数据许可：[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。
- 官方说明：https://www.openstreetmap.org/copyright
- 署名要求：https://osmfoundation.org/wiki/Licence/Attribution_Guidelines

地图界面应显示可访问的 `© OpenStreetMap contributors`，链接到版权页，
并明确数据使用 ODbL。发布提取或衍生数据库前，应依据 ODbL 及官方指南
落实署名、许可声明和适用的共享要求。应用代码许可证另行选择。

Geofabrik 是提取文件提供方；溯源信息同时保留其来源链接。
每次处理记录输入 SHA-256、PBF 头信息、Osmium 版本、配置、命令及输出指纹。
`latest` 内容会变化；URL 本身不能锁定数据版本。
保留所用快照；有对应日期归档时优先记录归档 URL，但仍核对 SHA-256。

OSM 覆盖与标签可能不完整。线路状态需要核验，不从其他地图服务复制数据。
原始与派生数据留在本地或专用数据存储，不进入 Git。

当前沈阳日期快照使用 [Geofabrik 辽宁 2026-10-20 原件](https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf)，
来源、提供方校验值、元数据缺失及复现见 [真实关系数据指南](real-shenyang-data.md)。
该公开文件保留对象版本与时间，不提供贡献者身份/修改集编号；不从其他来源补造缺失属性。
来源与 ODbL 说明同时保存在本机 manifest 和“关于数据”界面。

## 底图与第三方请求

本机预览已接入可关闭的 OpenStreetMap 标准 raster 底图并做淡化处理，
配置、坐标、隐私与启动见 [第二批预览](basemap-preview.md)。
请求域名为 `tile.openstreetmap.org`；只按当前视野加载，保留浏览器缓存及有效 Referer，
不预取、不打包、不提供离线瓦片。关闭后不再创建新的底图请求，已发出请求可能完成。
底图与铁路数据持续显示 OSM 署名和版权页入口；在线底图更新时间不等于铁路快照时间。
核对日期 2026-10-22；按 [瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/) 使用。
该服务不保证可用性；公开发布前仍须核对实际容量/许可/适用的发布条件，并完成 CSP 等发布配置。

## 线路色值

线路色属于显示配置，不是 OSM 数据。来源、核对日期与置信度记录在
[`config/line-colors.json`](../config/line-colors.json)，规则见 [线路配色](line-colors.md)。
官方公布标准色值时优先使用；未公布时使用运营方线路图取色或人工覆盖，并标记
`operator-map`/`manual`，不能写成“官方色值”。线路名称、标志和 logo 可能受商标保护，
不随地图复制 logo；运营方线路图只用于取色与核对。

## 软件依赖与抽查记录

实际版本、许可文本与未核对项见 [依赖与许可证据](dependency-licenses.md)。代码许可未选定状态保持不变。
真实对象的同日期原件对账与待人工审核样本见 [抽查包](qa/README.md)，不以抽样或自动核对替代独立验收。
