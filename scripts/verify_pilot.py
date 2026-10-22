"""Check actual pilot artifacts and produce a small auditable evidence report."""
import gzip
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-dir", type=Path, default=ROOT / "data/manifests/local")
    parser.add_argument("--report", type=Path, default=ROOT / "data/manifests/local/pilot-verification.json")
    args = parser.parse_args()
    folder = ROOT / "data/processed/probe-v2"
    dataset = folder / "railway.geojson"
    data = read(dataset)
    one = read(args.manifest_dir / "shenyang.json")
    two = read(args.manifest_dir / "shenyang-replay.json")
    assert one["input_sha256"] == two["input_sha256"]
    assert one["outputs"] == two["outputs"]
    ids = [f["id"] for f in data["features"]]
    assert len(ids) == len(set(ids)), "Duplicate typed OSM IDs"
    by_id = {f["id"]: f for f in data["features"]}
    for osm_id, name in [("node/676578837", "沈阳北"), ("node/6179162407", "沈阳")]:
        assert by_id[osm_id]["properties"]["name"] == name
        assert by_id[osm_id]["geometry"]["type"] == "Point"
    for f in data["features"]:
        g = f["geometry"]
        coords = [g["coordinates"]] if g["type"] == "Point" else g["coordinates"]
        assert g["type"] in ("Point", "LineString")
        assert coords and (g["type"] == "Point" or len(coords) >= 2)
        assert all(-180 <= lon <= 180 and -90 <= lat <= 90 for lon, lat in coords)
    binary = ROOT / "target/release" / ("railway-probe.exe" if platform.system() == "Windows" else "railway-probe")
    times = []
    for i in range(3):
        target = ROOT / f"data/processed/benchmark-{time.time_ns()}-{i}"
        target.mkdir()
        begin = time.perf_counter()
        subprocess.run([str(binary), str(ROOT / "data/processed/shenyang/railway.osm.pbf"),
            str(target / "railway.geojson"), str(target / "report.json")], check=True, capture_output=True)
        elapsed = time.perf_counter() - begin
        assert hashlib.sha256((target / "railway.geojson").read_bytes()).hexdigest() == hashlib.sha256(dataset.read_bytes()).hexdigest()
        times.append({"process_wall_seconds":round(elapsed,4),
            "internal_processing_seconds":read(target / "report.json")["processing_seconds"]})
    tile_bytes = (folder / "railway.pmtiles").read_bytes()
    assert tile_bytes[:8] == b"PMTiles\x03"
    report = {"scope":"Real bounded Shenyang Overpass pilot; no national throughput claim",
        "source":read(ROOT / "data/raw/shenyang-overpass.source.json"),
        "python":platform.python_version(),"os":platform.platform(),
        "rust":subprocess.check_output(["rustc","--version"],text=True).strip(),
        "cargo_lock_sha256":hashlib.sha256((ROOT / "Cargo.lock").read_bytes()).hexdigest(),
        "features":len(ids),"geojson_bytes":dataset.stat().st_size,
        "geojson_gzip_bytes":len(gzip.compress(dataset.read_bytes(),mtime=0)),
        "geojson_sha256":hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "pmtiles_bytes":len(tile_bytes),"pmtiles_sha256":hashlib.sha256(tile_bytes).hexdigest(),
        "rust_runs":times,"exact_extraction_replay":True,"exact_geojson_replay":True,
        "unique_typed_ids":True,"valid_coordinate_ranges":True,
        "anchor_stations":{"node/676578837":"沈阳北","node/6179162407":"沈阳"},
        "not_measured":["peak RAM","cold WAN browser load","national dataset","mobile hardware","complete route relations"]}
    output = args.report
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k not in ("source",)},ensure_ascii=False,indent=2))


if __name__ == "__main__":
    main()
