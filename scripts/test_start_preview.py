"""Check real readiness HTTP responses and startup failure boundaries."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from types import SimpleNamespace

import start_preview
from serve_probe import PreviewHTTPServer


class PreviewStartTests(unittest.TestCase):
    def test_incomplete_bundle_cannot_pass_preflight(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary) / "test-snapshot"
            folder.mkdir()
            (folder / "dataset.json").write_text(json.dumps({"schema_version": 2, "snapshot_id": folder.name}))
            with self.assertRaisesRegex(ValueError, "试用数据不完整"):
                start_preview.check_data(folder)

    def test_occupied_port_is_preserved(self):
        with ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler) as existing:
            port = existing.server_port
            with self.assertRaisesRegex(ValueError, "现有服务已保留"):
                start_preview.require_free_port("127.0.0.1", port)
            self.assertEqual(existing.socket.getsockname()[1], port)
            self.assertGreaterEqual(existing.socket.fileno(), 0)

    def test_unused_port_is_not_mistaken_for_busy(self):
        with ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler) as reservation:
            port = reservation.server_port
        start_preview.require_free_port("127.0.0.1", port)

    def test_preview_server_cannot_share_wildcard_port(self):
        with PreviewHTTPServer(("0.0.0.0", 0), BaseHTTPRequestHandler) as original:
            with self.assertRaises(OSError):
                with PreviewHTTPServer(("127.0.0.1", original.server_port), BaseHTTPRequestHandler):
                    pass

    def readiness_service(self, payload):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = payload if self.path == "/dataset.json" else b"<!doctype html><title>Trial</title>"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}/"

    def test_wildcard_listener_also_blocks_loopback_start(self):
        with ThreadingHTTPServer(("0.0.0.0", 0), BaseHTTPRequestHandler) as existing:
            with self.assertRaisesRegex(ValueError, "现有服务已保留"):
                start_preview.require_free_port("127.0.0.1", existing.server_port)

    def test_other_snapshot_is_not_declared_ready(self):
        url = self.readiness_service(b'{"snapshot_id":"other"}')
        with self.assertRaisesRegex(ValueError, "未在10秒内就绪"):
            start_preview.wait_ready(SimpleNamespace(poll=lambda: None), url,
                                     b'{"snapshot_id":"expected"}', timeout=.15)

    def test_matching_snapshot_and_page_are_ready(self):
        expected = b'{"snapshot_id":"expected"}'
        url = self.readiness_service(expected)
        start_preview.wait_ready(SimpleNamespace(poll=lambda: None), url, expected, timeout=1)

    def test_exited_child_is_not_declared_ready(self):
        with self.assertRaisesRegex(ValueError, "进程已退出"):
            start_preview.wait_ready(SimpleNamespace(poll=lambda: 1), "http://127.0.0.1:1/", b"{}")


if __name__ == "__main__":
    unittest.main()
