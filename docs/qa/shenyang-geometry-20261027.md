# 几何修订快照人工抽查包

默认快照 shenyang-mvp-geometry-20261027，源日期仍为 2026-10-20。
[115 条样本](shenyang-geometry-20261027-samples.json)从 10,216 个真实发布对象确定性取样，覆盖 45 组检查。
快照标识参与抽样排序，所以总去重样本数与旧版 106 条不同，不是增加了源对象或修改验收额度。

全部样本的原标签、版本和时间瞬间与保留的同日期 XML 一致；生成包保存 manifest、索引、线路与所用详情分片指纹。
地图显示、分类判断、偏差和两名独立审核者字段均未填写，human_review_complete=false。
这不替代独立人工审核，不将旧包或自动对账算作新快照验收。

按[原人工复查步骤](README.md#人工复查步骤)执行，将本包复制为审核记录后再填写，保留原包指纹。
样本 view 相对链接已指向新快照，可接到 http://127.0.0.1:8766 后打开。
缺少实际源记录的类别仍保留明确缺口，没有合成设施补齐信号、机务段等额度。

```powershell
python scripts/prepare_qa_samples.py --data-dir data/processed/shenyang-mvp-geometry-20261027 --output docs/qa/shenyang-geometry-20261027-samples.json --check
```

OSM 数据 © OpenStreetMap contributors；区域文件由 Geofabrik 提供；ODbL 1.0。
