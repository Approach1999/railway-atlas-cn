"""Loopback-only feasibility server, with byte ranges for PMTiles; not production."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps/web/probe"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/processed/probe-v2")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    routes = {
        "/": (APP / "index.html", "text/html; charset=utf-8"),
        "/app.js": (APP / "app.js", "text/javascript; charset=utf-8"),
        "/vendor/maplibre-gl.mjs": (APP / "node_modules/maplibre-gl/dist/maplibre-gl.mjs", "text/javascript"),
        "/vendor/maplibre-gl-shared.mjs": (APP / "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", "text/javascript"),
        "/vendor/maplibre-gl-worker.mjs": (APP / "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "text/javascript"),
        "/vendor/maplibre-gl.css": (APP / "node_modules/maplibre-gl/dist/maplibre-gl.css", "text/css"),
        "/vendor/pmtiles.js": (APP / "node_modules/pmtiles/dist/pmtiles.js", "text/javascript"),
        "/railway.geojson": (args.data_dir / "railway.geojson", "application/geo+json"),
        "/railway.pmtiles": (args.data_dir / "railway.pmtiles", "application/octet-stream"),
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            route = routes.get(self.path.split("?")[0])
            if not route or not route[0].is_file():
                self.send_error(404)
                return
            path, mime = route
            size = path.stat().st_size
            start, end = 0, size - 1
            range_header = self.headers.get("Range")
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
            self.send_header("Content-Length", str(end-start+1))
            if range_header:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with path.open("rb") as stream:
                stream.seek(start)
                self.wfile.write(stream.read(end-start+1))

    print(f"Probe: http://127.0.0.1:{args.port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
