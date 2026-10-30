"""Acquire a bounded railway snapshot with route/stop-area members and OSM metadata.

Keep the resulting XML and source manifest; --date can replay a recorded OSM base time.
This is a pilot acquisition tool, not a national Overpass downloader.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import os
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def query_for(bbox, date=None):
    west, south, east, north = bbox
    region = f"({south},{west},{north},{east})"
    historical = f'[date:"{date}"]' if date else ""
    return f'''[out:xml][timeout:180]{historical};(
      nwr[railway]{region};
      way[~"^(abandoned|disused|razed|construction|proposed):railway$"~"."]{region};
      nwr[public_transport~"^(station|platform|stop_position)$"][train=yes]{region};
      nwr[public_transport~"^(station|platform|stop_position)$"][subway=yes]{region};
      nwr[public_transport~"^(station|platform|stop_position)$"][tram=yes]{region};
      relation[route~"^(subway|light_rail|tram)$"]{region};
      relation[public_transport=stop_area][train=yes]{region};
      relation[public_transport=stop_area][subway=yes]{region};
      relation[public_transport=stop_area][tram=yes]{region};
    );(._;>>;);out meta;'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "data/raw/shenyang-mvp.osm")
    parser.add_argument("--endpoint", default="https://overpass-api.de/api/interpreter")
    parser.add_argument("--date")
    parser.add_argument("--method", choices=["GET", "POST"], default="GET")
    parser.add_argument("--transport", choices=["urllib", "curl"], default="urllib")
    args = parser.parse_args()
    manifest_path = args.output.with_suffix(".source.json")
    if args.output.exists() or manifest_path.exists():
        parser.error("Snapshot already exists; preserve it and choose a new output name")
    if args.date:
        datetime.fromisoformat(args.date.replace("Z", "+00:00"))
    config = json.loads((ROOT / "config/shenyang.json").read_text(encoding="utf-8"))
    query = query_for(config["bbox"], args.date)
    encoded = urllib.parse.urlencode({"data": query})
    request = urllib.request.Request(args.endpoint + ("?" + encoded if args.method == "GET" else ""),
        data=encoded.encode() if args.method == "POST" else None,
        headers={"User-Agent": "railway-atlas-cn-mvp/0.2 (+https://github.com/Approach1999/railway-atlas-cn)"})
    begin = time.perf_counter()
    if args.transport == "curl":
        partial = args.output.with_suffix(args.output.suffix + ".part")
        if partial.exists(): parser.error("Partial download exists; choose a new path or inspect it first")
        partial.parent.mkdir(parents=True, exist_ok=True)
        command = ["curl.exe" if os.name == "nt" else "curl", "-fL", "--silent", "--show-error",
            "--connect-timeout", "15", "--max-time", "240", "--max-filesize", str(80 * 1024 * 1024),
            "--user-agent", request.headers["User-agent"], "--output", str(partial)]
        if args.method == "POST": command += ["--data", encoded, args.endpoint]
        else: command += [request.full_url]
        subprocess.run(command, check=True)
        content = partial.read_bytes()
    else:
        partial = None
        with urllib.request.urlopen(request, timeout=240) as response:
            content = response.read(80 * 1024 * 1024 + 1)
    if len(content) > 80 * 1024 * 1024:
        raise ValueError("Snapshot exceeds the bounded-pilot 80 MiB acquisition budget")
    document = ET.fromstring(content)
    if document.tag != "osm" or document.find("remark") is not None:
        raise ValueError("Overpass returned an error; no snapshot saved")
    counts = {kind: len(document.findall(kind)) for kind in ["node", "way", "relation"]}
    if not counts["way"] or not counts["relation"]:
        raise ValueError("Missing tracks or route relations; no MVP snapshot saved")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as stream:
        stream.write(content)
    if partial is not None: partial.unlink()
    metadata = {"endpoint": args.endpoint, "method": args.method, "transport": args.transport, "query": query, "bbox": config["bbox"],
        "osm_base": document.find("meta").attrib if document.find("meta") is not None else {},
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content),
        "download_seconds": round(time.perf_counter() - begin, 3), **counts,
        "scope": "Bounded Shenyang railway/rail-context PT and urban routes; recursive relation members; out meta"}
    with manifest_path.open("x", encoding="utf-8") as stream:
        json.dump(metadata, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: value for key, value in metadata.items() if key != "query"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
