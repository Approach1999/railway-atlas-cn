# 原生依赖与实际工具链 · 2026-10-25

本记录补充包清单没有展开的 pyosmium Windows wheel 原生库，以及本机实际使用的构建工具。
不将 Python/npm 包的无已知漏洞结果自动延伸到内嵌 C/C++ 库，也不将开发工具记录当作发布许可批准。

## 原件与版本证据

当前 `osmium-4.3.0-cp312-cp312-win_amd64.whl` 已从本地下载缓存恢复，SHA-256
`0d65ddbe5f7038713efe58e0b09dd05944cc0ad697e7f1fd7160670fb14a1499`
同时对应 PyPI 原元数据和 requirements-data.lock。
除安装器重写的 RECORD 外，45 个原始文件逐字节比较一致；另验证安装后 RECORD 的 49 条哈希。
先完成此验证，才导入已安装模块并调用其版本查询函数，没有执行新下载的源代码或可执行工具。

| 组件 | 实际版本 | 版本依据 | 许可原文 |
| --- | --- | --- | --- |
| bzip2 | 1.0.8 | DLL 的 BZ2_bzlibVersion，含原始发布日期字符串 | 官方对应版本源归档 LICENSE，逐字节保留 |
| Expat | 2.7.3 | DLL 的 XML_ExpatVersion | 对应发布提交 expat/COPYING |
| LZ4 | 1.10.0 | DLL 的 LZ4_versionString | 对应发布提交 lib/LICENSE，限库许可，不套用 CLI 的不同许可 |
| zlib | 1.3.1 | DLL 的 zlibVersion | 对应发布提交 LICENSE |
| Microsoft C++ runtime | 14.40.33810.0 | 随 wheel 的 msvcp140 DLL 版本资源 | **条款与再分发核对仍未完成** |
| libosmium | 2.23.0 | 已验证 wheel 中 version.py 的生产者声明 | 固定提交 Boost Software License 原文 |
| protozero | 1.8.1 | 同上 | 固定提交 LICENSE.md 及 LICENSE.from_folly 原文都保留 |
| pybind11 | 3.0.1 | 同上 | 固定提交 LICENSE 原文 |

后三项是 wheel 生产者声明，不能说成从 DLL 独立查询出的静态链接版本。
13 个 wheel 原生二进制均读取 PE 普通/延迟导入表，记录每个文件的 SHA-256 与导入 DLL 名称；
解析器不执行二进制。结果区分随 wheel 的压缩/XML/运行时 DLL 和非捆绑的 Python/Windows API 契约引用。
wheel 元数据同时记录 cp312 Windows x64、scikit-build-core 0.11.6 和 delvewheel 1.12.0；
它们是生产者构建信息，不是本机已安装这些构建工具的证明。

## 原文与工具链

GitHub 原文按发布标签解析到实际 commit，保留原文件字节、Git blob ID 与 SHA-256。
查询器核对版本、轻量/附注标签指向、固定源 URL 和文件内容。
bzip2 1.0.8 从 [官方发布入口](https://sourceware.org/bzip2/downloads.html) 对应版本获取，
保存归档哈希并直接比较归档中的 LICENSE；没有声称已完成发布者 PGP 签名验证。
原文索引位于 `config/native-license-sources.json`，文件保存在 `third_party/licenses/native/`。

实际工具链为 CPython 3.12.14、Node 24.15.0、npm 11.12.1、rustc/cargo 1.90.0。
记录执行文件哈希、rustc 完整版本/目标与 Node 各内嵌库的自报版本；Python 使用的 OpenSSL 实际报告为 3.5.8。
保留当前 CPython、npm、Rust 随附许可，以及与 Node 实际版本对应的完整上游 LICENSE（含第三方说明）。
Rust 大型 COPYRIGHT 文档保留原安装路径别名/大小/哈希，没有复制十二兆级工具文档或整个工具链进仓库。

## 检查与开放范围

八项测试覆盖正常/延迟导入、错误签名/截断/地址/文件名、原件或安装文件篡改、越界 wheel 路径，
以及错误标签版本、附注标签指向和移动分支 URL。实际清单可在当前项目隔离环境重建：

```powershell
& .venv/Scripts/python.exe -m unittest discover -s scripts -p test_pe_imports.py
& .venv/Scripts/python.exe -m unittest discover -s scripts -p test_native_inventory.py
& .venv/Scripts/python.exe scripts/native_inventory.py
```

原 wheel 和 bzip2 源归档留在忽略目录；从新环境重建前先按锁获取对应 wheel 并保留原件。
Rust 不在本机默认位置时通过 `--rustc`、`--cargo` 指定。
证据：[原生/工具清单与输入指纹](evidence/native-tool-inventory.json)。

当前清单有三个明确开放项：Microsoft runtime 条款、原生/工具的厂商安全公告与静态传递闭包，
以及历史 Osmium/Tippecanoe 发行物核对。这些历史便携工具保留在工作目录，用于早期探针；
当前真实沈阳流程使用 pyosmium，不自动宣称旧工具已经通过。
OS/驱动、其他平台 wheel 和从源码独立重建也没有取得完整证据。
原生 DLL 和开发工具不由地图服务开放，也不进入 client/dist；仍未完成完整 N08 或整个 MVP 验收。
