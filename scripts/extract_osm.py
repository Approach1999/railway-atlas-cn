#!/usr/bin/env python3
"""Extract a configured railway pilot from a preserved OSM snapshot."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--source-url", required=True, help="Provenance URL, not a download action")
    parser.add_argument("--expected-sha256", help="Required for replay of a recorded snapshot")
    parser.add_argument("--config", type=Path, default=ROOT / "config/shenyang.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/processed/shenyang")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/manifests/local/shenyang.json")
    args = parser.parse_args()
    if not args.input.is_file():
        parser.error("Input snapshot does not exist")
    if not shutil.which("osmium"):
        parser.error("Install Osmium Tool and place osmium on PATH; see docs/data-pipeline.md")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    bbox = config["bbox"]
    if len(bbox) != 4 or not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90):
        parser.error("Invalid WGS84 west,south,east,north bounding box")
    region = args.output_dir / "region.osm.pbf"
    railway = args.output_dir / "railway.osm.pbf"
    if any(p.exists() for p in (region, railway, args.manifest)):
        parser.error("Output or manifest exists; use a fresh output directory and manifest path")
    input_hash = sha256(args.input)
    if args.expected_sha256 and input_hash != args.expected_sha256.lower():
        parser.error("Input SHA-256 mismatch; no output written")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    version = subprocess.check_output(["osmium", "--version"], text=True).strip()
    header = subprocess.check_output(["osmium", "fileinfo", "-j", str(args.input)], text=True)
    commands = [
        ["osmium", "extract", "--bbox", ",".join(map(str, bbox)), "--strategy", config["strategy"], str(args.input), "-o", str(region)],
        ["osmium", "tags-filter", str(region), *config["filters"], "-o", str(railway)],
        ["osmium", "check-refs", str(railway)],
    ]
    for command in commands:
        subprocess.run(command, check=True)
    # Use logical names to avoid committing machine-specific absolute paths.
    replacements = {str(args.input): "INPUT", str(region): "REGION", str(railway): "RAILWAY"}
    manifest = {
        "schema_version": 1,
        "source_url": args.source_url,
        "input_sha256": input_hash,
        "input_bytes": args.input.stat().st_size,
        "input_header": json.loads(header).get("header", {}),
        "osmium_version": version,
        "config": config,
        "config_sha256": sha256(args.config),
        "commands": [[replacements.get(part, part) for part in cmd] for cmd in commands],
        "outputs": {p.name: {"sha256": sha256(p), "bytes": p.stat().st_size} for p in (region, railway)},
        "validation": {"way_node_references": "passed", "relation_completeness": "not_checked"},
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    with args.manifest.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"Complete: {railway}; provenance: {args.manifest}")


if __name__ == "__main__":
    main()
