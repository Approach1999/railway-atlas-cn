"""Build a bounded local map bundle; never overwrite an existing snapshot.

python scripts/build_preview.py --input INPUT.pbf --source-manifest SOURCE.json --output-dir OUTPUT
Uses the pinned native Node tile builder; no WSL or external tile service is needed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    args = parser.parse_args()
    source = args.input.resolve(strict=True)
    target = args.output_dir.resolve()
    if target.exists():
        parser.error("Output exists; choose a new snapshot directory")
    provenance = json.loads(args.source_manifest.read_text(encoding="utf-8"))
    if provenance.get("bbox") != [123.0, 41.5, 123.8, 42.1]:
        parser.error("This preview configuration only covers the documented Shenyang pilot bbox")
    subprocess.run(["cargo", "build", "--release", "--locked", "--offline"], cwd=ROOT, check=True)
    folder = target.with_name(target.name + ".building-" + uuid.uuid4().hex[:8])
    folder.mkdir(parents=True)
    binary = ROOT / "target/release" / ("railway-probe.exe" if os.name == "nt" else "railway-probe")
    subprocess.run([str(binary), str(source), str(folder / "railway.geojson"), str(folder / "report.json")], check=True)
    data = json.loads((folder / "railway.geojson").read_text(encoding="utf-8"))
    config = json.loads((ROOT / "config/map-preview.json").read_text(encoding="utf-8"))
    palette = json.loads((ROOT / "config/line-colors.json").read_text(encoding="utf-8"))
    stations, tracks, shards = [], [], {}
    class_counts = {}
    for f in data["features"]:
        p = f["properties"]
        key = p["osm_id"]
        if p["feature_kind"] == "station" and f["geometry"]["type"] == "Point":
            override = config["station_mode_overrides"].get(key)
            if override:
                if p["tags"].get("railway:ref") != override["expected_ref"]:
                    raise ValueError(f"Station override evidence changed: {key}")
                p["rail_mode"] = override["mode"]
                p["mode_evidence"] = override["evidence"]
            p["label_priority"] = 0 if key in config["major_station_keys"] else 1
            p["aliases"] = [v for k in ["name", "name:zh", "alt_name", "old_name", "official_name"] for v in p["tags"].get(k, "").split(";") if v]
            stations.append({**f, "properties": {k: v for k, v in p.items() if k not in ["tags", "class_warnings"]}})
        elif p["feature_kind"] == "track":
            class_counts[p["line_class"]] = class_counts.get(p["line_class"], 0) + 1
            tracks.append({**f, "properties": {k: v for k, v in p.items() if k not in ["tags", "class_warnings"]}})
        else:
            continue
        bucket = hashlib.sha256(key.encode()).hexdigest()[:2]
        shards.setdefault(bucket, {})[key] = f
    write(folder / "stations.geojson", {"type": "FeatureCollection", "features": stations})
    write(folder / "tracks.geojson", {"type": "FeatureCollection", "features": tracks})
    (folder / "details").mkdir()
    for bucket, features in shards.items():
        write(folder / "details" / f"{bucket}.json", features)

    subprocess.run(["node", str(ROOT / "apps/web/probe/build-tiles.mjs"), str(folder / "tracks.geojson"), str(folder / "tiles")], check=True)
    write(folder / "palette.json", palette)
    manifest = {
        "schema_version": 1, "snapshot_id": target.name,
        "input_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "config_version": config["version"], "source": provenance,
        "scope": "沈阳试验矩形；有界本机预览，不代表完整行政区或全国",
        "bbox": [123.0, 41.5, 123.8, 42.1], "class_counts": class_counts,
        "station_records": len(stations), "classification_version": "display-v1.3",
        "palette_version": palette["palette_version"], "tile_format": "mvt-directory",
        "tiles": {k: v for k, v in json.loads((folder / "tiles/build.json").read_text(encoding="utf-8")).items() if k != "files"},
        "tile_index_sha256": hashlib.sha256((folder / "tiles/build.json").read_bytes()).hexdigest(),
        "files": {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in folder.glob("*") if p.is_file()},
    }
    write(folder / "dataset.json", manifest)
    folder.rename(target)
    print(json.dumps({"output": str(target), "classes": class_counts, "station_records": len(stations)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
