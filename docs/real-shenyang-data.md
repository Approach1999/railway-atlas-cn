# 沈阳真实线路关系数据 · 2026-10-23

当前可运行快照 `shenyang-mvp-20261023` 来自同一份 Geofabrik 辽宁日期 PBF，
源数据截止 **2026-10-20T20:23:47Z**；构建日期不同于源数据时间。
完整运营线路或当前运营状态未得到承诺，仍以 OSM 源标注及覆盖说明为准。

## 来源与核验

- 提供方：[Geofabrik 辽宁下载页](https://download.geofabrik.de/asia/china/liaoning.html)，数据生产者 OpenStreetMap contributors。
- [日期文件](https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf)，28,536,638 bytes；
  [提供方 MD5](https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf.md5)：`c874eac87d81adaa5375c143656ef5f5`。
- 本地原件 SHA-256：`9ca145eb49d5913f9b92e320e5983c4d7439532d1c448a291692efc89dd74e83`。
- 数据许可 ODbL 1.0，显示 OpenStreetMap 署名并记录 Geofabrik 提供方。
  公开文件移除了贡献者身份和修改集编号，缺失字段保持未标注；对象版本与更新时间保留。

本次从下载中断处继续下载，校验提供方 MD5 后才提升为输入原件；没有将部分文件送入构建。
Overpass 主实例与备选的完整查询失败；备选计数返回 24 条方向关系仅用于发现可用线索。
正式地图没有合并不同来源日期，全部几何与关系均来自上述日期文件。

## 本机复现

工具链初始实测为 Windows、Python 3.14、pyosmium 4.3.0、Node 24、Rust 1.90。
2026-10-24 已迁移到 CPython 3.12.14 的项目内 `.venv`，固定全部 Python 依赖和 wheel 哈希；
同一保存 XML 的 PBF 转换结果逐字节一致，见 [依赖安全核对](dependency-security.md)。
先准备原件；已有并通过校验的原件可直接复用：

```powershell
curl.exe -fL -C - --connect-timeout 15 --max-time 300 https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf -o data/raw/liaoning-261020.osm.pbf.part
$checksum = (Get-FileHash -LiteralPath data/raw/liaoning-261020.osm.pbf.part -Algorithm MD5).Hash.ToLowerInvariant()
if ($checksum -ne 'c874eac87d81adaa5375c143656ef5f5') { throw 'Source checksum mismatch' }
if (Test-Path -LiteralPath data/raw/liaoning-261020.osm.pbf) { throw 'Input already exists; verify and reuse it' }
Move-Item -LiteralPath data/raw/liaoning-261020.osm.pbf.part -Destination data/raw/liaoning-261020.osm.pbf
python -m venv .venv
& .venv/Scripts/python.exe -m pip install --only-binary=:all: --require-hashes -r requirements-data.lock
& .venv/Scripts/python.exe -m pip check
npm ci --prefix apps/web/probe --ignore-scripts
npm ci --prefix apps/web/client --ignore-scripts
cargo fetch --locked
```

在需要代理的环境中，curl 可使用本机已有的 `HTTPS_PROXY` 或 `--proxy` 配置；不要把代理凭据写入仓库。
提取、转换与构建：

```powershell
& .venv/Scripts/python.exe scripts/extract_region.py --input data/raw/liaoning-261020.osm.pbf --output data/raw/shenyang-geofabrik-masters-20261020.osm --source-url https://download.geofabrik.de/asia/china/liaoning-261020.osm.pbf --expected-md5 c874eac87d81adaa5375c143656ef5f5
& .venv/Scripts/python.exe scripts/convert_osm.py --input data/raw/shenyang-geofabrik-masters-20261020.osm --output data/raw/shenyang-geofabrik-masters-20261020.osm.pbf
python scripts/build_mvp.py --input data/raw/shenyang-geofabrik-masters-20261020.osm.pbf --metadata data/raw/shenyang-geofabrik-masters-20261020.osm.metadata.json --source-manifest data/raw/shenyang-geofabrik-masters-20261020.source.json --output-dir data/processed/shenyang-mvp-20261023
python scripts/verify_snapshot.py data/processed/shenyang-mvp-20261023
python scripts/verify_real_relations.py data/processed/shenyang-mvp-20261023 --xml data/raw/shenyang-geofabrik-masters-20261020.osm
npm run build --prefix apps/web/client
python scripts/serve_probe.py --port 8766
```

脚本拒绝覆盖已有输出；重放到新快照名即可比较结果，不重写旧分享版本。
提取仅面向小于 256 MiB 的省级输入与 80 MiB 的城市 XML 预算，不能据此宣称支持全国规模。
原件、提取 XML/PBF、几何、详情和瓦片均在 Git 忽略目录，仓库只保留代码、配置和小型验收证据。

## 提取与身份依据

三遍流式读取省级文件：定位矩形内铁路/轨道 PT 对象；选中完整 way、城轨方向关系及其明确父关系、
铁路 stop_area/站区关系；递归补齐关系成员及全部 way 节点，再写出源身份与元数据。
跨过矩形但端点均在外的 way 也会被选中；返回完整源对象，不把裁剪端点冒充 OSM node。

方向记录有时缺 network/ref。只有明确 `route_master` 父子关系才能提供缺失身份：
保留全部源标签和父关系 ID，拒绝冲突的线路号/运营方，不按同名或邻近位置合并。
缺运营方时使用源父关系 typed ID 分组；地铁通过父关系的显式“沈阳地铁”网络与 ref 匹配配色配置。
轻轨/有轨电车采用制式色；共享/未确认片段保留回退色。颜色未写入 MVT。

站点 POI 与 route 的停靠位置记录可能不同。只有明确 stop_area 连接且制式一致时，
才关联站点到线路；直接归属的站台保持原线路，换乘站不会把一条线传播到另一线的站台。
沈阳北站地铁 POI 因两个明确站区关系关联 2/4 号线，国铁沈阳北源对象保持独立。

## 结果与证据

- 32,803 node、4,223 way、207 relation（24 方向 + 12 父关系 + 171 站区关联）。
- 10,216 个发布对象，541 个具名排除，207 个关系记录；零缺失节点/关系引用。
- 6 条地铁与 6 条有轨电车源线路身份；“成员齐备”不等于运营线路完整。
- 全部发布对象的原标签、版本和时间已与保存的 XML 独立逐项核对。
- 完整选中对象的标签、元数据、节点坐标、way 节点顺序与关系成员顺序，另与省级 PBF 核对；重放 XML 字节指纹一致。

证据：[构建对账](evidence/mvp-real-relations-build.json)、[源数据审计](evidence/mvp-real-source-audit.json)、
[浏览器](evidence/mvp-real-routes-browser.json)、[六种地铁轨道色像素检查](evidence/mvp-real-color-pixels.json)、
[实际地图截图](evidence/mvp-real-metro-map.png)、[当前瓦片体积](evidence/mvp-real-relations-tile-sizes.json)。
提取保真与重放证据：[省级原件对照](evidence/mvp-real-extraction-audit.json)、[重放指纹](evidence/mvp-real-extraction-replay.json)。
新数据三次首屏预检约 1.5–1.7 秒、传输约 0.645 MiB，见 [预检记录](evidence/mvp-real-data-performance-smoke.json)；
三次预检不替代正式三十次、真实设备或在线底图验收。
这些自动检查不替代独立人工抽检、真实移动设备或完整 MVP 验收。
