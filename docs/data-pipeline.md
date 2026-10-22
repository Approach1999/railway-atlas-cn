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
python3 scripts/extract_osm.py --input data/raw/china-snapshot.osm.pbf --source-url https://download.geofabrik.de/asia/china-latest.osm.pbf --expected-sha256 <manifest中的input_sha256> --output-dir data/processed/replay --manifest data/manifests/shenyang-replay.json
```

比较两份 manifest 的输入、配置、版本和输出指纹；跨工具版本不保证二进制一致。
首次运行的 `data/manifests/shenyang.json` 为小型记录，可提交版本控制。

## 处理语义与限制

- 区域：`config/shenyang.json`，WGS84，西/南/东/北 = 123.0 / 41.5 / 123.8 / 42.1。
  这是便于验证的城区及周边矩形，不是沈阳市行政边界。
- 先 `osmium extract -s complete_ways`，再 `osmium tags-filter`。
- 保留所有 `railway=*`，以及部分生命周期前缀；初始结果包含地铁、专用线、站点等，
  后续按产品范围分类。不是“仅国铁运营主线”的最终数据集。
- 默认保留筛选对象的引用；不使用 `--omit-referenced`。
- `osmium check-refs` 验证 way 的节点引用；不宣称跨区域 relation 完整。
- 脚本拒绝覆盖已有输出和 manifest；失败的中间文件需检查后移走再运行。
- 当前初始化只检查脚本语法、参数入口与配置；真实中国 PBF 的耗时、内存与结果仍需实测。

## 官方工具说明

- https://docs.osmcode.org/osmium/latest/osmium-extract.html
- https://docs.osmcode.org/osmium/latest/osmium-tags-filter.html
- https://docs.osmcode.org/osmium/latest/osmium-check-refs.html
