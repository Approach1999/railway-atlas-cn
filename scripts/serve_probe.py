"""Loopback preview: built React client by default, legacy probe via --app probe."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import json
from catalog import build_catalog, read_manifest, expired
from http_payload import gzip_payload, COMPRESSIBLE

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps/web/probe"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/processed/shenyang-mvp-geometry-20261027")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--app", choices=["client", "probe"], default="client")
    args = parser.parse_args()
    args.data_dir = args.data_dir.resolve()
    security = json.loads((ROOT / 'config/security-headers.json').read_text(encoding='utf-8'))
    if security.get('schema_version') != 1 or not isinstance(security.get('headers'), dict):
        parser.error('Invalid security header configuration')
    security_headers = dict(security['headers'])
    if any(not isinstance(key, str) or not isinstance(value, str) or '\r' in key + value or '\n' in key + value
           for key, value in security_headers.items()):
        parser.error('Invalid security header value')
    if args.app == 'probe':
        # The historical probe uses MapLibre's blob worker; the client uses a same-origin worker asset.
        security_headers['Content-Security-Policy'] = security_headers['Content-Security-Policy'].replace(
            "worker-src 'self'", "worker-src 'self' blob:")
    routes = {
        "/": (ROOT / "apps/web/client/dist/index.html" if args.app == "client" else APP / "index.html", "text/html; charset=utf-8"),
        "/third-party-notices.txt": (ROOT / "apps/web/client/dist/third-party-notices.txt", "text/plain; charset=utf-8"),
        "/dependency-inventory.json": (ROOT / "apps/web/client/dist/dependency-inventory.json", "application/json; charset=utf-8"),
        "/map-font-manifest.json": (ROOT / "apps/web/client/dist/map-font-manifest.json", "application/json; charset=utf-8"),
        "/map-font-license.txt": (ROOT / "apps/web/client/dist/map-font-license.txt", "text/plain; charset=utf-8"),
        "/basemap.json": (ROOT / "config/basemap.json", "application/json"),
        "/app.js": (APP / "app.js", "text/javascript; charset=utf-8"),
        "/model.mjs": (APP / "model.mjs", "text/javascript; charset=utf-8"),
        "/shared/model.mjs": (ROOT / "apps/web/shared/model.mjs", "text/javascript; charset=utf-8"),
        "/style.css": (APP / "style.css", "text/css; charset=utf-8"),
        "/dataset.json": (args.data_dir / "dataset.json", "application/json"),
        "/palette.json": (args.data_dir / "palette.json", "application/json"),
        "/stations.geojson": (args.data_dir / "stations.geojson", "application/geo+json"),
        "/lines.json": (args.data_dir / "lines.json", "application/json"),
        "/objects.json": (args.data_dir / "objects.json", "application/json"),
        "/vendor/maplibre-gl.mjs": (APP / "node_modules/maplibre-gl/dist/maplibre-gl.mjs", "text/javascript"),
        "/vendor/maplibre-gl-shared.mjs": (APP / "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", "text/javascript"),
        "/vendor/maplibre-gl-worker.mjs": (APP / "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "text/javascript"),
        "/vendor/maplibre-gl.css": (APP / "node_modules/maplibre-gl/dist/maplibre-gl.css", "text/css"),
        "/vendor/pmtiles.js": (APP / "node_modules/pmtiles/dist/pmtiles.js", "text/javascript"),
        "/railway.geojson": (args.data_dir / "railway.geojson", "application/geo+json"),
        "/railway.pmtiles": (args.data_dir / "railway.pmtiles", "application/octet-stream"),
    }
    if not routes["/"][0].is_file():
        parser.error("Client build missing. Run: npm run build --prefix apps/web/client")

    class Handler(BaseHTTPRequestHandler):
        def end_headers(self):
            # Include successful, empty, range, catalog and all error responses.
            for name, value in security_headers.items():
                self.send_header(name, value)
            super().end_headers()

        def do_GET(self):
            request_path = self.path.split("?")[0]
            if request_path == "/catalog.json":
                try:
                    config = json.loads((ROOT / "config/catalog.json").read_text(encoding="utf-8"))
                    content = json.dumps(build_catalog(config, args.data_dir.parent, args.data_dir.name), ensure_ascii=False).encode("utf-8")
                except (OSError, ValueError, KeyError):
                    self.send_error(503, "Catalog unavailable")
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(content)
                return
            selected_data = args.data_dir
            snapshot = re.fullmatch(r"/snapshots/([A-Za-z0-9_-]{1,80})(/.*)", request_path)
            if snapshot:
                selected_data = (args.data_dir.parent / snapshot[1]).resolve()
                if not selected_data.is_relative_to(args.data_dir.parent.resolve()) or not (selected_data / "dataset.json").is_file():
                    self.send_error(404, "Snapshot unavailable")
                    return
                try:
                    if expired(read_manifest(args.data_dir.parent, snapshot[1])):
                        self.send_error(410, "Snapshot retention period ended")
                        return
                except (OSError, ValueError):
                    self.send_error(503, "Snapshot metadata unavailable")
                    return
                request_path = snapshot[2]
                if not re.fullmatch(r"/(dataset\.json|palette\.json|stations\.geojson|lines\.json|objects\.json|details/[0-9a-f]{2}\.json|tiles/\d{1,2}/\d{1,6}/\d{1,6}\.pbf)", request_path):
                    self.send_error(404)
                    return
            route = routes.get(request_path)
            if snapshot and request_path in ["/dataset.json", "/palette.json", "/stations.geojson", "/lines.json", "/objects.json"]:
                route = (selected_data / request_path[1:], "application/json")
            if args.app == "client" and re.fullmatch(r"/assets/[A-Za-z0-9_.-]+\.(js|css|woff2)", request_path):
                mime = "font/woff2" if request_path.endswith(".woff2") else "text/javascript; charset=utf-8" if request_path.endswith(".js") else "text/css; charset=utf-8"
                route = (ROOT / "apps/web/client/dist/assets" / request_path.rsplit("/", 1)[1], mime)
            if re.fullmatch(r"/details/[0-9a-f]{2}\.json", request_path):
                route = (selected_data / "details" / request_path.rsplit("/", 1)[1], "application/json")
            tile = re.fullmatch(r"/tiles/(\d{1,2})/(\d{1,6})/(\d{1,6})\.pbf", request_path)
            if tile:
                path = selected_data / "tiles" / tile[1] / tile[2] / (tile[3] + ".pbf")
                if not path.is_file():
                    self.send_response(204)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                route = (path, "application/vnd.mapbox-vector-tile")
            if not route or not route[0].is_file():
                self.send_error(404)
                return
            path, mime = route
            size = path.stat().st_size
            start, end = 0, size - 1
            range_header = self.headers.get("Range")
            compressed = gzip_payload(path, self.headers.get("Accept-Encoding", ""), range_header)
            if range_header:
                match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header)
                if not match:
                    self.send_error(416)
                    return
                start = int(match[1])
                end = min(int(match[2]) if match[2] else end, end)
                if start > end:
                    self.send_error(416)
                    return
            self.send_response(206 if range_header else 200)
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(compressed) if compressed is not None else end-start+1))
            if path.suffix.lower() in COMPRESSIBLE:
                self.send_header("Vary", "Accept-Encoding")
            if compressed is not None:
                self.send_header("Content-Encoding", "gzip")
            self.send_header("Cache-Control", "no-cache")
            if range_header:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with path.open("rb") as stream:
                stream.seek(start)
                try:
                    self.wfile.write(compressed if compressed is not None else stream.read(end-start+1))
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass  # A map pan may cancel an in-flight range request.

    print(f"Probe: http://127.0.0.1:{args.port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
