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
