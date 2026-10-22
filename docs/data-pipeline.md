# 沈阳 OSM PBF 提取

## 环境

需要 Python 3.10+ 和 Osmium Tool（命令名 `osmium`，不是 Python 的同名库）。
Windows 可在 WSL Ubuntu 中运行整个流程，仓库位于 `/mnt/c/...`；
在同一环境安装 Python 与工具：

```sh
sudo apt-get update
sudo apt-get install python3 osmium-tool curl
osmium --version
```

## 下载一次，保留快照

从仓库根目录运行。中国 PBF 较大，先检查下载页大小、磁盘和内存。
以下命令在 WSL / Linux 使用；脚本本身也支持原生 Windows + 原生 Osmium。

```sh
mkdir -p data/raw
curl --fail --location --retry 3 https://download.geofabrik.de/asia/china-latest.osm.pbf --output data/raw/china-snapshot.osm.pbf.part
# 只有 curl 成功后才执行下一条；失败时重新下载 .part。
mv -n data/raw/china-snapshot.osm.pbf.part data/raw/china-snapshot.osm.pbf
python3 scripts/extract_osm.py --input data/raw/china-snapshot.osm.pbf --source-url https://download.geofabrik.de/asia/china-latest.osm.pbf
```

首次运行计算指纹并生成溯源记录，并不意味着完成了上游可信校验。
保留输入快照；再次下载的 `latest` 不保证相同。
复现时复制 manifest 中的输入指纹，使用空的独立输出目录：

```sh
python3 scripts/extract_osm.py --input data/raw/china-snapshot.osm.pbf --source-url https://download.geofabrik.de/asia/china-latest.osm.pbf --expected-sha256 <manifest中的input_sha256> --output-dir data/processed/replay --manifest data/manifests/local/shenyang-replay.json
```

比较两份 manifest 的输入、配置、版本和输出指纹；跨工具版本不保证二进制一致。
首次运行的 `data/manifests/local/shenyang.json` 为本地小型记录，审核后另存为带快照标识的文件再提交。
local 目录被忽略；仓库中的 shenyang.json / shenyang-replay.json 是本次历史实验记录。
配置变更会改变 `config_sha256`；历史 manifest 保留原样，不复算、不覆盖，新批次使用新配置记录。

## 处理语义与限制

- 区域：`config/shenyang.json`，WGS84，西/南/东/北 = 123.0 / 41.5 / 123.8 / 42.1。
  这是便于验证的城区及周边矩形，不是沈阳市行政边界。当前配置为 `config_version: 2`，
  在 v1 过滤基础上补入 `proposed:railway`。
- 先 `osmium extract -s complete_ways`，再 `osmium tags-filter`。
- 保留所有 `railway=*`，以及 `abandoned/disused/razed/construction/proposed:railway`
  生命周期前缀；初始结果包含地铁、专用线、站点、站台、信号、机务段等设施，
  后续按产品范围分类。不是“仅国铁运营主线”的最终数据集。
- v1 的 lifecycle 前缀过滤目前只作用于 way；node/relation 上的前缀标签待正式 schema 扩展，
  不静默宣称已覆盖。`railway=proposed` 仍由 `nwr/railway` 捕获。
- 城市轨道线路身份需在 P1 增加 `route=subway/light_rail/tram` 关系及其成员提取；
  当前探针样本没有 route relation，不能据此宣称线路色/线路号已覆盖。
- 线路色是前端配置，不写入 PBF/PMTiles；配置见
  [`config/line-colors.json`](../config/line-colors.json)，校验见
  [`docs/line-colors.md`](line-colors.md)。
- 默认保留筛选对象的引用；不使用 `--omit-referenced`。
- `osmium check-refs` 验证 way 的节点引用；不宣称跨区域 relation 完整。
- `fetch_pilot.py` 的 Overpass 查询需与 `config/shenyang.json` 同步；本次已补 `proposed:railway`。
- 脚本拒绝覆盖已有输出和 manifest；失败的中间文件需检查后移走再运行。
- 已用真实沈阳 Overpass 样本转换的 PBF 跑通提取、引用检查、Rust 转换和浏览器展示，
  并验证同输入重跑指纹一致。全国日期 PBF 的吞吐量与内存仍未实测。
  详见 [可行性报告](feasibility.md) 与 [样本复现指南](reproduce-pilot.md)。

## 官方工具说明

- https://docs.osmcode.org/osmium/latest/osmium-extract.html
- https://docs.osmcode.org/osmium/latest/osmium-tags-filter.html
- https://docs.osmcode.org/osmium/latest/osmium-check-refs.html
