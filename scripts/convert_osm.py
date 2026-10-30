"""Convert a preserved XML snapshot to PBF using pyosmium; retain source metadata.

Install the pinned osmium==4.3.0 in an isolated Python environment if needed.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    import osmium
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    metadata_path = args.output.with_suffix(".metadata.json")
    if args.output.exists() or metadata_path.exists():
        parser.error("Output exists; preserve the snapshot and choose a new path")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    records, counts = {}, {"node": 0, "way": 0, "relation": 0}
    writer = osmium.SimpleWriter(str(args.output))

    class Copier(osmium.SimpleHandler):
        def save(self, obj, kind):
            counts[kind] += 1
            record = {}
            if obj.version > 0: record["osm_version"] = obj.version
            if obj.changeset > 0: record["osm_changeset"] = obj.changeset
            if obj.timestamp.year > 1970: record["osm_timestamp"] = str(obj.timestamp)
            records[f"{kind}/{obj.id}"] = record
            getattr(writer, "add_" + kind)(obj)

        def node(self, obj): self.save(obj, "node")
        def way(self, obj): self.save(obj, "way")
        def relation(self, obj): self.save(obj, "relation")

    try:
        Copier().apply_file(str(args.input))
    finally:
        writer.close()
    metadata = {"xml_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
        "pbf_sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "counts": counts, "records": records}
    with metadata_path.open("x", encoding="utf-8") as stream:
        json.dump(metadata, stream, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps({k: v for k, v in metadata.items() if k != "records"}))


if __name__ == "__main__":
    main()
