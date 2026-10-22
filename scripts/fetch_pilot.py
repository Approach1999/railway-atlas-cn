"""Download a bounded Overpass pilot, not a national production data source."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/raw/shenyang-overpass.osm"))
    parser.add_argument("--endpoint", default="https://overpass-api.de/api/interpreter")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    config = json.loads((root / "config/shenyang.json").read_text(encoding="utf-8"))
    west, south, east, north = config["bbox"]
    bbox = f"({south},{west},{north},{east})"
    # Keep lifecycle prefixes in sync with config/shenyang.json filters.
    query = f'''[out:xml][timeout:120];(
      node[railway]{bbox};way[railway]{bbox};
      way[~"^(abandoned|disused|razed|construction|proposed):railway$"~"."]{bbox};
    );(._;>;);out body;'''
    if args.output.exists() or args.output.with_suffix(".source.json").exists():
        parser.error("Output exists; preserve the snapshot or choose another name")
    request = urllib.request.Request(args.endpoint,
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "railway-atlas-cn-feasibility/0.1"})
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=180) as response:
        content = response.read()
    document = ET.fromstring(content)
    if document.tag != "osm" or document.find("remark") is not None or not document.findall("way"):
        raise ValueError("Overpass returned an error or empty pilot; no snapshot saved")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(content)
    manifest = {"endpoint": args.endpoint, "query": query, "bbox": config["bbox"],
        "osm_base": document.find("meta").attrib if document.find("meta") is not None else {},
        "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
        "download_seconds": round(time.perf_counter() - start, 3),
        "nodes": len(document.findall("node")), "ways": len(document.findall("way")),
        "relations": len(document.findall("relation")),
        "scope": "Bounded pilot only; railway ways + railway nodes + referenced nodes; no route relations"}
    target = args.output.with_suffix(".source.json")
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
