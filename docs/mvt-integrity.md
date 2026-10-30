# 瓦片几何修订与不可变快照

2026-10-27。默认预览现在使用 shenyang-mvp-geometry-20261027，应用仍为 index-Dv8VHl6p.js。
原 PBF、源日期 2026-10-20、全部原始详情和分类规则不变，详情仅更新所属 snapshot_id。
这是切片产物修订，不是新一轮 OSM 数据更新或完整 MVP 验收。

## 发现与修复

逐个解码旧版全部 2,251 个 MVT、98,715 个瓦片内要素实例，发现 124 处零长边、
57 个零面积环，以及 52 次最少点数不足断言。几种计数可以落在同一实例上，不能相加当作问题对象数。
完整源详情没有这些问题，它们出现在切片、简化、整数坐标转换之后。
根据 [MVT 2.1 几何规则](https://github.com/mapbox/vector-tile-spec/tree/master/2.1#43-geometry-encoding)，
线与环有最少命令/顶点要求，环方向区分外环与洞，闭合前不应重复起点；本次没有宣称完成所有 MVT 规范检查。

生成器现在在编码前消除连续相同的整数坐标；已经退化为单点的线段、零面积环不再编码。
原始完整几何和可查看的详情保留，剩余整数顶点不移动、不吸附，也不把不同源对象按名称合并。
每次处理保存 tile/layer/typed ID 与计数；无法确认退化环后续洞归属时停止构建，不把洞提升或填成外环。
保留 GeoJSONVT 缓存对象原状，不修改库内部代码或依赖版本。

旧输入的独立候选切片中只有 64 个瓦片发生变化，2,187 个逐字节相同。
97 个已经退化的瓦片实例不再编码，存续 98,618 个实例的坐标序列与属性逐个比较通过。
97 是跨瓦片/缩放的实例数，不是删除 97 个原始对象。
z11–15 仍覆盖全部 9,859 个应进入 MVT 的源对象；车站点另由 GeoJSON 索引提供。
z8/9/10 分别有 85/29/1 个源对象未形成可绘制几何，报告保留明细，不充作所有缩放均覆盖全部源对象。

## 新快照与默认预览

从同一固定 PBF 完整执行离线锁定 Cargo/Rust → Python 规范化 → MVT 构建，生成新目录。
10,216 个 typed ID、全部详情几何/属性与旧快照逐条相同，唯一允许差异是 snapshot_id；
候选、发布、排除、关系仍为 10,964 = 10,216 + 541 + 207。
新数据没有覆盖旧快照；旧路径与旧分享继续恢复原记录。

新快照全部 2,251 个 MVT 的文件长度/哈希、源身份和关键语义字段、整数边界、最少顶点、
零长边/面积、基本环顺序检查通过，并与旧版完整解码对照，除快照编号和上述几何规范化没有意外变动。
MVT 原始总量 11,575,162 bytes；全部瓦片 gzip(level 6) 最大 177,982 bytes，小于 500 KiB。
全部几何仍与详情同源；不把顶点/环检查扩大为自相交、洞包含或现实位置的完整证明。

当前构建器另外加入独立解码器发布门禁，位于写入 manifest 后、最终目录重命名前。
新快照是在加此自动门禁前完成构建，随后已手动执行完全相同的全量解码校验并通过；
不能将其说成最初构建已经自动执行该门禁。真实 main 路径的受控子进程测试确认：
解码器失败时发布目录不存在、后续发布停止。原始旧瓦片在正式校验模式会失败退出。

## 产品与配套验证

专用候选服务上 Chrome/Edge 六组功能各 43 项、合计 86 项通过，覆盖搜索、筛选、列表、分享、资源故障及字体。
三份旧驱动中的固定快照改为读取所测服务实际 manifest，避免测新快照时错误标记为旧版。
字体和依赖许可元数据更新后再次构建，应用 JS/index 和字体二进制逐字节不变，矩阵构建指纹仍匹配。
默认 8766 服务已明确重启到新数据；另外五项真实操作确认当前目录、瓦片请求、源日期、新分享接收页及旧分享正常。
首次迁移驱动错误地在原始来源仍折叠时读取可见文本，断言失败；改为显式打开来源后重跑通过，未当作产品数据问题。

正常前端测试入口加入量化几何用例，共 113 项通过；另有七项详情几何与一项 MVT 发布阻断测试通过。
字体名集仍为 501 codepoints，129,992-byte WOFF2 指纹不变，输入清单已包含新快照。
许可清单确定性核对通过，仍为 npm 120/Cargo 75/Python 9、116 份文本、包文本已知缺口零；不是许可批准或新一轮完整漏洞审计。
[新人工包](qa/shenyang-geometry-20261027.md)有 115 个实际对象/45 组，同日期原件对账通过，人工字段仍为空。

本轮不重新测首屏/平移性能，历史测量保持原快照；没有完成真实设备、读屏、完整版本矩阵、独立审核、
生产 HTTPS/保留期/回滚等其余门槛。保留完整 R01–R19、D01–D10、N01–N09 目标。

## 复现

不要复用已有输出目录；构建器会拒绝覆盖已存在的快照。新 snapshot ID 下执行：

```powershell
python scripts/build_mvp.py --input data/raw/shenyang-geofabrik-masters-20261020.osm.pbf --source-manifest data/raw/shenyang-geofabrik-masters-20261020.source.json --metadata data/raw/shenyang-geofabrik-masters-20261020.osm.metadata.json --output-dir data/processed/NEW_IMMUTABLE_SNAPSHOT_ID
python scripts/verify_snapshot.py data/processed/NEW_IMMUTABLE_SNAPSHOT_ID
node scripts/verify_mvt_integrity.mjs data/processed/NEW_IMMUTABLE_SNAPSHOT_ID --report data/manifests/local/NEW_IMMUTABLE_SNAPSHOT_ID-mvt.json
```

当前/历史对照可加 `--compare data/processed/shenyang-mvp-20261023/tiles`；仅允许预期快照 ID 差异，
其余属性和幸存顶点必须一致。`--observe` 仅观察并保留失败，正式模式不加此参数。
原始 PBF、详情、大 GeoJSON/MVT 和构建候选仍在忽略目录，没有提交大文件或推送。

[构建/验证与代码指纹](evidence/mvt-integrity.json)、[旧版被拒绝](evidence/mvt-integrity-before.json)、
[新 MVT 全量对照](evidence/mvt-integrity-after.json)、[功能矩阵](evidence/mvt-integrity-browser-matrix.json)、
[默认与旧分享](evidence/mvt-integrity-promotion.json)。
