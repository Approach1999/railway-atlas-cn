"""Independently compare every extracted object to the dated provincial PBF."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


if __name__ == "__main__":
    import osmium
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--xml", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    expected = {obj.tag+"/"+obj.attrib["id"]:obj for obj in ET.parse(args.xml).getroot() if obj.tag in {"node","way","relation"}}
    seen = set()

    class Compare(osmium.SimpleHandler):
        def common(self, obj, kind):
            key = f"{kind}/{obj.id}"
            if key not in expected: return None
            assert key not in seen
            seen.add(key)
            original = expected[key]
            assert dict(obj.tags) == {t.attrib["k"]:t.attrib["v"] for t in original.findall("tag")}, key
            assert obj.version == int(original.attrib["version"]), key
            assert obj.timestamp == datetime.fromisoformat(original.attrib["timestamp"].replace("Z", "+00:00")), key
            assert obj.changeset == int(original.attrib.get("changeset", "0")), key
            return original

        def node(self, obj):
            original = self.common(obj, "node")
            if original is not None:
                assert abs(obj.lon-float(original.attrib["lon"])) < 5e-8
                assert abs(obj.lat-float(original.attrib["lat"])) < 5e-8

        def way(self, obj):
            original = self.common(obj, "way")
            if original is not None: assert [ref.ref for ref in obj.nodes] == [int(ref.attrib["ref"]) for ref in original.findall("nd")]

        def relation(self, obj):
            original = self.common(obj, "relation")
            if original is not None:
                kinds = {"n":"node", "w":"way", "r":"relation"}
                assert [(kinds[m.type],m.ref,m.role) for m in obj.members] == [(m.attrib["type"],int(m.attrib["ref"]),m.attrib.get("role", "")) for m in original.findall("member")]

    Compare().apply_file(str(args.input))
    assert seen == set(expected)
    result = {"date":datetime.now(timezone.utc).isoformat(),"source_pbf_sha256":hashlib.sha256(args.input.read_bytes()).hexdigest(),
        "xml_sha256":hashlib.sha256(args.xml.read_bytes()).hexdigest(),"compared_objects":len(seen),"types":dict(Counter(key.split('/')[0] for key in seen)),
        "checks":["all selected identities, tags, versions, timestamps and changesets match the provincial source", "node coordinates match at OSM precision", "way node order and relation member type/id/role order remain unchanged"],
        "scope":"Preserved-object fidelity; does not establish completeness of OSM mapping or actual operating status"}
    if args.report: args.report.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result))
