# 复现本次沈阳探针

本次实测使用 Windows 11 + Rust 1.90.0、WSL Ubuntu + Osmium 1.16.0 + Tippecanoe 2.49.0。
下面统一使用 Linux/WSL shell 以避免跨系统路径；首次构建会下载锁定依赖。
需要 Python 3.10+、Rust、Node/npm、Osmium 和 Tippecanoe。普通依赖安装方式按各平台官方文档处理。

## 1. 获取小型真实样本

从仓库根目录执行：

```sh
python3 scripts/fetch_pilot.py
osmium cat data/raw/shenyang-overpass.osm -o data/raw/shenyang-overpass.osm.pbf
python3 scripts/extract_osm.py --input data/raw/shenyang-overpass.osm.pbf --source-url https://overpass-api.de/api/interpreter
```

这会再次查询当前数据，不保证与报告快照相同。
精确复现应使用本次保留的原始 XML/PBF，并核对
`docs/evidence/pilot-verification.json` 的 XML 指纹及 `data/manifests/shenyang.json` 的 PBF 指纹。
首次新样本的结果文件名已存在时脚本会拒绝覆盖；请使用独立目录/manifest，或在检查后归档旧实验。
禁止为获得“同样数字”修改真实结果。

## 2. 验证同一输入重跑

```sh
# 用 data/manifests/local/shenyang.json 中 input_sha256 的真实值替换占位符
python3 scripts/extract_osm.py --input data/raw/shenyang-overpass.osm.pbf --source-url https://overpass-api.de/api/interpreter --expected-sha256 SHA256_FROM_MANIFEST --output-dir data/processed/replay --manifest data/manifests/local/shenyang-replay.json
```

新实验记录默认放在被忽略的 `data/manifests/local/`，不会覆盖仓库保存的历史证据。
比较两份 manifest 的 outputs；本次两个文件的哈希均相同。
输入指纹错误时脚本必须拒绝执行；输出已存在时必须拒绝覆盖。

## 3. Rust 转换

```sh
cargo test --locked
cargo build --release --locked
mkdir -p data/processed/probe-v2
target/release/railway-probe data/processed/shenyang/railway.osm.pbf data/processed/probe-v2/railway.geojson data/manifests/local/rust-pilot-v2.json
```

探针保留完整原标签，生成点与线，station way 暂以 outline 形式输出。
这是研究工具，不能当作正式生产 schema；更不能将内存型读取直接用于全国文件。

## 4. 瓦片与浏览器

```sh
tippecanoe -Z8 -z14 --no-feature-limit --no-tile-size-limit --no-progress-indicator --exclude=tags -l railway -o data/processed/probe-v2/railway.pmtiles data/processed/probe-v2/railway.geojson
npm ci --prefix apps/web/probe --ignore-scripts
python3 scripts/serve_probe.py
```

打开 `http://127.0.0.1:8765`。验证：

1. 地图加载后搜索“沈阳”，区分铁路“沈阳/沈阳北”与地铁“沈阳站/沈阳北站”。
2. 选择沈阳北，核对 node/676578837 的原始标签与定位。
3. 切换 PMTiles，检查真实线路仍可显示，网络请求为 206。
4. 切换铁路/城轨，核对轨道筛选；探针站点筛选尚未与类型联动，正式实现按 R04 修正。

Tippecanoe 可能提示字符串 Feature ID 不能作为内建整数 ID；探针使用字符串 osm_id 属性与 promoteId。
这些无限制生成参数只适用于当前小样本，正式生成按瓦片预算与保留规则设计。

探针为比较格式及展示原始详情仍下载整份 GeoJSON；正式应用须改为索引/详情分片懒加载。
探针无生产底图、全国搜索、完整筛选/分享、React 界面与手机验收。

## 5. 机器验证与数据管理

```sh
python3 scripts/verify_pilot.py
```

它检查锚点、typed ID、坐标、PBF 重跑与三次 Rust 输出一致性，并在 data/manifests/local/ 生成新验证记录。
使用本次保留数据重验历史证据时，传入 `--manifest-dir data/manifests`。
新样本更新正式报告前需检查差异，不应无意替换本次基线证据。

原始 XML/PBF、GeoJSON、PMTiles、构建产物全部留在被忽略目录。
Git 仅保存源代码、配置、小型 manifest、统计与截图。
全国日期 PBF 的方案见 [原始数据指南](data-pipeline.md)，未在本次环境实测。
