# 依赖安全核对 · 2026-10-25

当前客户端与探针的 npm audit 均返回零已知漏洞。OSV 对 202 项组件去重为 177 个
生态/名称/版本组合查询，覆盖所有锁定 npm/Cargo 项及实际 Python 环境，包含构建依赖和平台可选包。
查询完整处理分页，并保存完整 advisory；失败、不完整响应或过时清单不能算作通过。
依据 [OSV 批量接口规范](https://google.github.io/osv.dev/post-v1-querybatch/)。

## 发现与修复

最初观察到的 Python pip 26.0.1 命中 8 个数据库记录，按 CVE/alias 对应四组问题，
不是八个独立漏洞：CVE-2026-3219、CVE-2026-6357、CVE-2026-13346、CVE-2026-8643。
旧 `feasibility-env` 依赖的 Python 3.14 启动路径也已失效。
该环境保留为历史证据，当前工具与许可/审计脚本改用项目内 `.venv`（CPython 3.12.14 Windows x64）。

新环境使用 pip 26.2；`requirements-data.lock` 固定 osmium 4.3.0、requests 2.34.2、
certifi 2026.10.19、charset-normalizer 3.5.2、idna 3.20、urllib3 2.8.0 及 pip 26.2，
全部 wheel 哈希来自 PyPI 对应版本元数据。安装要求 `--require-hashes --only-binary=:all:`；
不允许自动转成未锁定的源码构建。锁中包含其他平台 wheel 的哈希，但尚未验证其他平台。
`pip check` 通过；当前 Python 查询不再命中上述 advisory。

新环境重放保存的沈阳 XML，生成 32,803 node / 4,223 way / 207 relation，
PBF SHA-256 与原 Python 3.14 转换结果相同；原对象元数据也比较一致。
当前 10,216 发布对象的原标签/版本/时间和真实关系成员审计重新通过。
这证明本次环境迁移保留已有转换结果，不等同独立人工数据分类验收。

## 保持开放的维护问题

`smartstring 1.0.1` 由 `osmpbfreader 0.19.1` 间接引入，命中
[RUSTSEC-2026-0249](https://osv.dev/vulnerability/RUSTSEC-2026-0249)，类型为 **unmaintained**，
无修复版本、无 CVSS 严重度。它是离线 Rust 数据工具的维护警告，仍未处置；
未将未知严重度写成 low，也未使用无 owner/到期日的例外跳过。
应评估上游移除该依赖的版本或替代读取实现，并重放实际数据后再变更。
当前审计总状态仍为 `findings_require_review`。

## 2026-10-25 读取库替换实验：未采用

实际核对 crates.io 发行记录与两个上游的当前 Cargo.toml：`osmpbfreader 0.19.1`
仍依赖 smartstring；候选 `osmpbf 0.3.8` 不依赖它，Rust 1.88 最低要求也与本机 1.90 兼容。
候选 crate SHA-256 为 `5d689d6e9f254bbd63893ce00a27147e41fe94bf3abca70f85b5345afb3cb728`，
下载的全部依赖归档逐份匹配候选锁文件。其余共同依赖版本没有变化。

隔离适配后，真实沈阳 PBF 的 GeoJSON 完整字节一致，质量报告除处理耗时外一致；
普通/压缩节点两种夹具还验证了负坐标、中文标签/角色、成员顺序、嵌套循环关系、
无关对象排除及缺失关系成员。缺失 way 节点与截断 PBF 均失败且不发布输出。
候选 8 项 Rust 测试通过。这些只证明数据兼容，不构成安全批准或全国规模验收。

随后对候选 195 项组件、170 个去重版本完成在线 npm/OSV 查询，发现新传递依赖
`memmap2 0.5.10` 命中 [RUSTSEC-2026-0186](https://rustsec.org/advisories/RUSTSEC-2026-0186.html)。
公告涉及内存映射范围操作中的未检查指针偏移，修复版本为 0.9.11；候选和上游当前主分支
仍要求 0.5 系列，不能通过更新锁文件选择 0.9.11。本实验使用流式读取，没有据此宣称
已触发相关函数；但也没有为通过审计而忽略记录、伪造包版本或加入未经维护的本地替代包。

**候选被拒绝，未进入当前实现。** 原读取器、Cargo.lock 和许可配置已恢复，旧原文保留。
对恢复后的当前 202 项组件/177 个去重版本重新完成查询，仍仅命中原 smartstring 维护警告，
无查询错误；两份 npm audit 均无已知漏洞。中途一次接口断连的报告单独保留为 incomplete。
后续应选择能使用已修复依赖的受维护发行版，并重复相同的数据、许可和安全检查。

- [候选数据比较与拒绝决定](evidence/rust-reader-migration.json)
- [候选完整安全查询](evidence/history/dependency-audit-osmpbf-candidate.json)
- [候选锁文件](evidence/history/osmpbf-candidate.Cargo.lock)与[实验补丁](evidence/history/osmpbf-candidate.patch)，仅用于复查，未应用
- [中断查询](evidence/history/dependency-audit-reader-restore-interrupted.json)，不作为通过证据

比较脚本为 `scripts/verify_rust_reader.py`，接收旧/候选可执行文件、原 PBF 和全新工作目录。
原始数据、依赖归档及实验二进制均位于忽略目录；证据不提交这些大文件。

## 复现与证据

```powershell
python -m venv .venv
& .venv/Scripts/python.exe -m pip install --only-binary=:all: --require-hashes -r requirements-data.lock
& .venv/Scripts/python.exe -m pip check
& .venv/Scripts/python.exe scripts/license_inventory.py
& .venv/Scripts/python.exe scripts/license_inventory.py --check
& .venv/Scripts/python.exe -m unittest discover -s scripts -p test_audit_dependencies.py
& .venv/Scripts/python.exe scripts/audit_dependencies.py
```

Cargo 源缓存不在默认位置时，为许可生成器传 `--cargo-cache`；当前机器使用 `D:/.cargo/registry/src`。
在线审计需要网络，仅读取公开依赖元数据，不执行升级；默认报告进入忽略目录。
审计脚本退出码 0 表示查询完成且无命中，1 表示有待审查命中，2 表示查询不完整。
更新锁前先审查明确版本，`scripts/lock_data_environment.py` 只重取既定版本的公开 wheel 哈希。

- [修复前完整审计](evidence/dependency-audit-before.json)
- [当前完整审计](evidence/dependency-audit-current.json)
- [Python wheel 哈希来源](evidence/python-lock-sources.json)
- [新环境及转换重放](evidence/python-environment-replay.json)
- [源对象与关系复查](evidence/mvp-source-recheck-python312.json)

已知漏洞数据库的当前无命中不代表没有漏洞。OS/浏览器/编译器、wheel 内嵌原生库与外部可执行工具
未被这些包版本查询完整覆盖；许可证据在 2026-10-25 补齐归档、README/AUTHORS 与固定提交原文后，当前构建包已知原文缺口为 0，但其他平台/原生工具范围仍待核对，独立审核也未完成。
不据此宣称 N08 或整个 MVP 已验收。
