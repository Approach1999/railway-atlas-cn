"""Preflight, build and start the existing railway atlas preview; stdlib only."""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data/processed/shenyang-mvp-geometry-20261027"
LAN_RANGES = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def check_data(folder):
    missing = [name for name in ("dataset.json", "stations.geojson", "lines.json", "objects.json", "palette.json")
               if not (folder / name).is_file()]
    missing += [name for name in ("tiles", "details") if not (folder / name).is_dir()]
    if missing:
        raise ValueError("试用数据不完整：" + ", ".join(missing) + "。请阅读 docs/trial-guide.md 的数据准备说明；不会自动下载或覆盖数据。")
    data = (folder / "dataset.json").read_bytes()
    manifest = json.loads(data)
    if manifest.get("schema_version") != 2 or manifest.get("snapshot_id") != folder.name:
        raise ValueError("数据版本或目录名称不匹配，请先验证快照。")
    return data


def check_build():
    index = ROOT / "apps/web/client/dist/index.html"
    if not index.is_file():
        raise ValueError("页面尚未构建，请取消 --no-build 后重试。")
    assets = re.findall(r'(?:src|href)="(/assets/[^"?#]+)"', index.read_text(encoding="utf-8"))
    if not assets or any(not (index.parent / asset.lstrip("/")).is_file() for asset in assets):
        raise ValueError("页面构建产物不完整，请取消 --no-build 后重试。")


def require_free_port(host, port):
    message = f"端口 {port} 不可用，现有服务已保留。若已有本项目预览，请使用它；否则使用 --port 8767 重试。"
    try:
        connection = socket.create_connection(("127.0.0.1", port), timeout=.5)
    except (ConnectionRefusedError, TimeoutError):
        # Closed loopback ports can time out on Windows. Verify bind/listen
        # below rather than misreporting the timeout as an occupied port.
        pass
    except OSError as error:
        raise ValueError(message) from error
    else:
        connection.close()
        raise ValueError(message)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        # Windows can allow a loopback bind over a wildcard SO_REUSEADDR
        # listener. Ask the kernel for an exclusive bind; do not infer port
        # availability from a connection timeout (closed ports can time out).
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind((host, port))
            probe.listen(1)
        except OSError as error:
            raise ValueError(message) from error


def wait_ready(process, url, expected, timeout=10):
    # Ignore ambient proxy settings for this loopback-only readiness request.
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise ValueError("预览进程已退出，请查看上方错误信息。")
        try:
            with opener.open(url + "dataset.json", timeout=1) as response:
                actual = response.read(len(expected) + 1)
            with opener.open(url, timeout=1) as response:
                available = response.status == 200
            if available and actual == expected:
                return
        except OSError:
            pass
        time.sleep(.1)
    raise ValueError("预览未在10秒内就绪，未打开浏览器；请查看上方信息。")


def lan_addresses():
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}
    except OSError:
        return []
    return sorted(address for address in addresses
                  if any(ipaddress.ip_address(address) in network for network in LAN_RANGES))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan", action="store_true", help="允许同一可信局域网中的设备试用")
    parser.add_argument("--basemap-proxy", action="store_true", help="由电脑转发当前视野的底图请求，保留署名与HTTP缓存")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--no-build", action="store_true", help="复用已有构建，适合不改代码的试用")
    parser.add_argument("--check-only", action="store_true", help="只检查准备条件，不构建、不启动服务")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口须在1到65535之间。")
    process = None
    try:
        if sys.version_info < (3, 10):
            raise ValueError("需要Python 3.10或更新版本，项目推荐3.12。")
        data_dir = args.data_dir.resolve()
        expected = check_data(data_dir)
        npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
        if args.no_build:
            check_build()
        elif not npm or not (ROOT / "apps/web/client/node_modules/vite/package.json").is_file():
            raise ValueError("需要 Node.js/npm 和前端依赖。请先运行 npm ci --prefix apps/web/client --ignore-scripts；详见 docs/trial-guide.md。")
        print("准备条件检查通过；数据：" + data_dir.name, flush=True)
        if args.check_only:
            return 0
        host = "0.0.0.0" if args.lan else "127.0.0.1"
        require_free_port(host, args.port)
        if not args.no_build:
            result = subprocess.run([npm, "--prefix", str(ROOT / "apps/web/client"), "run", "build"], cwd=ROOT)
            if result.returncode:
                raise ValueError("页面构建失败，未启动预览。请查看上方错误。")
            check_build()
        # The stdlib-only server needs no venv packages. Invoke the base Python
        # directly on Windows so terminate/wait owns the server, not a venv
        # redirector that could otherwise leave its child running after failure.
        server_python = Path(sys.base_prefix) / "python.exe" if sys.platform == "win32" else Path(sys.executable)
        process = subprocess.Popen([str(server_python), str(ROOT / "scripts/serve_probe.py"),
                                    "--app", "client", "--host", host, "--port", str(args.port),
                                    "--data-dir", str(data_dir), *(["--basemap-proxy"] if args.basemap_proxy else [])], cwd=ROOT)
        url = f"http://127.0.0.1:{args.port}/"
        wait_ready(process, url, expected)
        print("\n试用已就绪：" + url, flush=True)
        if args.basemap_proxy:
            print("底图由电脑按当前视野转发；来源仍为OpenStreetMap，不预取或打包离线数据。", flush=True)
        if args.lan:
            print("候选局域网地址（可能含虚拟网卡）；手机请使用电脑实际Wi-Fi的IPv4地址：", flush=True)
            for address in lan_addresses():
                print(f"  http://{address}:{args.port}/", flush=True)
            print("若没有列出正确地址，请用 ipconfig 查看；不要在手机输入127.0.0.1。\n局域网HTTP仅供试用，不能作为正式HTTPS验收。", flush=True)
        else:
            print("当前仅本机可访问；手机试用请关闭本窗口服务后使用 --lan。", flush=True)
        print("保持此窗口开启；按 Ctrl+C 停止。验收步骤：docs/trial-guide.md", flush=True)
        if not args.no_open and not webbrowser.open(url):
            print("未能自动打开浏览器，请手动打开上方地址。", flush=True)
        return process.wait()
    except (ValueError, OSError) as error:
        print("无法启动试用：" + str(error), file=sys.stderr, flush=True)
        return 1
    except KeyboardInterrupt:
        print("\n已停止试用。", flush=True)
        return 0
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
