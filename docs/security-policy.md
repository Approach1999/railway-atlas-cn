# 页面安全策略 · 2026-10-25

本机正式客户端通过 `config/security-headers.json` 统一设置响应头，覆盖 HTML、目录、数据、空瓦片、
分段响应和错误页。预览服务在公共 `end_headers` 路径应用，不以页面 meta 替代 HTTP 响应头。

脚本与 MapLibre worker 仅允许同源地址，不允许内联脚本或 eval。网络连接仅允许同源和已声明的
`https://tile.openstreetmap.org`；图像额外允许本机 data/blob 解码路径。字体限同源，实际仍使用设备字体。
禁止嵌入框架、修改页面 base、表单提交与插件对象；Referrer-Policy 保留跨源站点 origin，去掉路径及查询。
同时设置 nosniff、X-Frame-Options DENY，Permissions-Policy 禁止位置、摄像头和麦克风。

`style-src` 保留 `unsafe-inline`，用于 MapLibre 的布局定位与 React 线路颜色样式；这不放开内联 JavaScript。
旧 `--app probe` 兼容入口单独允许 blob worker；当前客户端使用构建后的同源 worker 文件，不需要该例外。
如更换底图来源，需同时审查配置、声明域名与安全头，不能加通配符绕过校验。

## 实际验证

`scripts/verify_security_headers.py` 对 200 / 204 / 206 / 404 / 416 共八条实际 HTTP 路径检查
所有响应头与配置逐项一致、没有重复值且没有 Set-Cookie。
`scripts/verify_security_browser.cjs` 验证：

- 真正的 MapLibre worker 启动，地图、搜索、详情、分享、关于页面无 CSP 违规。
- 测试详情中带 HTML/onerror 的源名称显示为文字，没有生成 img 或执行事件；夹具不写入真实数据。
- 允许的底图域名使用本地拦截响应，收到的 Referer 只有 origin，不带 feature/query/view 参数。
- 浏览器以 enforce 模式阻止测试内联脚本、未声明地址连接和 base 修改；没有请求到被禁止的域名。
- 必需的内联 CSS 仍可用，位置/摄像头/麦克风能力被浏览器策略关闭。

另执行当前客户端八组回归，涵盖底图开/关/503 恢复、筛选/搜索、临时显示、撤销、署名、390px 布局及
不可变快照路径；重新验证 gzip 与 Range，不因增加响应头改变数据传输。
浏览器中故意触发的三条策略违规单独记作测试探针，不当成正常页面的错误。

```powershell
& .venv/Scripts/python.exe scripts/serve_probe.py --port 8781
# 另一个终端，先配置 PLAYWRIGHT_MODULE
& .venv/Scripts/python.exe scripts/verify_security_headers.py --base http://127.0.0.1:8781
node scripts/verify_security_browser.cjs
$env:PREVIEW_URL='http://127.0.0.1:8781'
node scripts/verify_client.cjs
& .venv/Scripts/python.exe scripts/verify_transport.py --base http://127.0.0.1:8781
```

证据：[HTTP 头](evidence/mvp-security-headers.json)、[浏览器执行](evidence/mvp-security-browser.json)、
[客户端回归](evidence/mvp-security-client.json)、[传输回归](evidence/mvp-security-transport.json)。
原 8766 入口重载后的 [响应头复查](evidence/mvp-security-current-entry.json) 与
[配置/脚本指纹](evidence/mvp-security-build.json) 同时保留；浏览器执行报告也已在 8766 入口复跑。

## 尚未证明的范围

此策略目前由本机预览服务强制执行。Vite 开发服务器没有自动应用它；对外静态托管必须把同一策略
映射到全部资源和错误路径，并重新检查。当前 loopback HTTP 不能证明公开 HTTPS、证书、HSTS 或托管配置通过；
不为本机 HTTP 伪造 HSTS 验收。还需目标浏览器、真实设备及独立安全审核。
因此本轮不标记完整 N07 或整个 MVP 验收完成。
