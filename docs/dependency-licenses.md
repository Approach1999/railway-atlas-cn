# 依赖、来源与许可证据

2026-10-27 补记：[地图字体子集](map-font.md)新增 OFL 字体及两个固定轮子的隔离构建工具；
中央清单现为 204 项组件、116 份许可文本。原许可和元数据按校验值归档，原生工具层/应用代码许可等既有审查缺口不因此关闭。

2026-10-25。此清单记录锁文件和本机安装/缓存中的实际声明及许可文件，**不是许可批准或在线安全审计**。
应用代码许可保持“未选定”，不因附上第三方 MIT/BSD 文本而变更项目代码授权。

## 当前覆盖

| 范围 | 锁定/观察项 | 证据 |
| --- | ---: | --- |
| 当前 React 客户端 npm 锁 | 93 | 49 项本机安装，44 项平台可选包未安装；各项保留锁中的声明/完整性值 |
| 原生探针与瓦片构建 npm 锁 | 27 | 全部本机安装，单独标记项目和运行/构建范围 |
| Rust 离线工具及传递依赖 | 75 | 61 项本机源缓存，另有 15 份已校验 crate（含一项缓存交叉验证）；补充固定提交原文与 AUTHORS 内嵌条款 |
| Python 数据环境及安装器 | 7 | requirements-data.lock 固定全部版本和 wheel 哈希，含 osmium 4.3.0 / pip 26.2；当前验证 CPython 3.12 Windows x64 |
| 字体/底图/地理数据/配色/应用标识 | 5 类 | config/third-party-assets.json；系统字体未打包/无字体下载，外部请求配置仅 OSM 底图 |

共 202 项组件，112 份去重后的实际文本。许可正文保留内含的版权、声明和第三方内容，不将多许可表达式擅自选择为单一许可。
同一文本只保存一份并列出全部使用组件；清单保留其原文件相对路径和 SHA-256。
每次生成检查已安装 npm/Python 版本是否对应固定版本；不匹配即停止，不能用另一版本的许可冒充当前证据。
Rust 缺本机源缓存时可使用已核验的归档证据；仍无证据时保留锁中版本/checksum 和显式缺口；可选平台包未安装与必需包缺失分别记录。

## 入口和复现

“关于数据”提供 `/third-party-notices.txt` 和 `/dependency-inventory.json`，随 Vite public 静态资源进入构建；
预览服务只开放这两个明确路径，未开放 node_modules 或本机源码目录。开发服务器原生支持 public 文件。
页面不会自动请求这两份较大清单，用户打开链接时才读取；未新增第三方运行请求。

```powershell
python scripts/license_inventory.py
python scripts/license_inventory.py --check
python -m unittest discover -s scripts -p test_license_inventory.py
npm run build --prefix apps/web/client
# 启动预览并设置 PLAYWRIGHT_MODULE 后
node scripts/verify_license_inventory.cjs
```

脚本无网络请求。非 Windows 环境可显式传入 `--cargo-cache` 与 `--python-packages`；缺缓存会如实形成待核对项，
不会自动下载或换成其他版本。`--check` 比较全部生成字节，证明当前锁/环境和保存证据一致，不表示所有许可已满足。
当前确定性生成及检查通过，获取/清单/上游证据共 12 项测试通过；浏览器检查通过 UI 入口、text/plain 正文、JSON 清单及未选定状态。
该项目自定义 JSON 不标作经过 CycloneDX/SPDX 模式验证的 SBOM。

## 已关闭的六项记录

当前构建包证据的已知缺口为 **0**，不是许可批准。44 项未安装的其他平台可选 npm 包仍只记录锁文件声明，未声称审阅所有平台发行物。

| 组件 | 对应原文与版本证据 |
| --- | --- |
| flat_map 0.0.10 | 已匹配 Cargo.lock 的 crate VCS 提交 ae34e34d206182cb474d4a4304575afbbe532ada；该提交的 Apache LICENSE 原文件 |
| r-efi 6.0.0 | 固定 crate 中 AUTHORS 已包含版权、完整 MIT 条款及多许可说明；原先“没有正文”的结论是标准文件名扫描漏检，现更正 |
| murmurhash-js 1.0.0（client/probe） | 发布包 README.md 的完整 MIT 正文；压缩包 sha512 匹配两份锁文件，安装文件逐字节一致 |
| pmtiles 4.5.0 | npm gitHead 3b10e67edb65c6b04549f74c0279cef8328d859c 的根 LICENSE；保留对参考实现、规范及样本数据的不同适用说明 |
| @rolldown/binding-win32-x64-msvc 1.2.15 | 正式 v1.2.15 提交 89d821ca07cf9ccd84dd92bd3f48af0f579ab21a 的根 MIT 原文；源 package.json 明确绑定包名前缀与 Windows x64 target，发布主包明确依赖同版本绑定；绑定元数据完整性值匹配锁文件 |

原 README/AUTHORS 保留完整内容，不改写版权人、不把多许可表达式替换为单一选择。`config/package-license-files.json` 精确限定文件、版本和 SHA-256，避免把任意说明文档当作许可。

`config/license-sources.json` 记录 15 份固定 crate 的来源/校验及原文。`config/upstream-license-sources.json` 记录三个固定提交原文件与版本证明；`third_party/license-provenance/` 保留 crate VCS、npm 元数据和原生绑定的发布/源包关系。上游原文件同时核对 Git blob ID 和 SHA-256。离线生成器拒绝身份、锁完整性、仓库、提交、路径或文本哈希不一致；不采用“同样声明 MIT 的另一个包”作为替代证据。

实际校验包括 15 份 crate 中的原文件、murmurhash-js 的 npm 原压缩包，以及关于页面返回的正文/清单与生成文件一致。获取、清单和上游证明共 12 项测试覆盖篡改、错误版本/提交/仓库、错误绑定目标/父依赖和路径越界。

- [crate 原件比较](evidence/cargo-license-archive-checks.json)，脚本 `scripts/verify_cargo_licenses.py`
- [README 发布包比较](evidence/embedded-license-archive-checks.json)，脚本 `scripts/verify_embedded_licenses.py`
- 上游证据离线校验：`scripts/license_inventory.py --check`；证据记录入口 `scripts/record_upstream_licenses.py` 读取连接器返回的原文件/固定提交 JSON，不联网或执行包代码。

Python wheel 内嵌 C++ 库、外部 Osmium/编译器/运行时发行物仍需工具层清单。安全查询与 Rust 维护警告见 [依赖安全核对](dependency-security.md)。包原文缺口清零不代表工具层清单、许可合规或完整 N08 已验收。

原始及生成地理大文件仍被忽略；数据署名/ODbL、底图服务条款、配色转引来源和代码许可状态继续独立展示。
公开发布、真实设备、独立审核及完整 N08 验收保持进行中。

证据：[完整清单](evidence/dependency-license-inventory.json)、[本机浏览器入口检查](evidence/license-inventory-browser.json)。
