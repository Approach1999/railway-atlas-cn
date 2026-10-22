# Rust 工程

`railway-probe` 已验证 PBF 依赖读取、点/线几何、属性保留和基本生命周期判别。
在仓库根目录运行 `cargo test --locked` 和 `cargo build --release --locked`。
此工具仅处理已经裁剪的城市样本，不实现生产全部 schema、站区面与全国资源控制。
正式数据 CLI、可选 API 与 WASM 的边界见 [技术架构](../docs/architecture.md)。
