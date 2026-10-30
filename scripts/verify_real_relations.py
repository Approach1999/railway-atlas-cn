"""Audit published relation identities and metadata against preserved source XML."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def read(path): return json.loads(path.read_text(encoding="utf-8"))
def tags(obj): return {entry.attrib["k"]: entry.attrib["v"] for entry in obj.findall("tag")}
def stamp(value): return datetime.fromisoformat(value.replace("Z", "+00:00"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--xml", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    manifest = read(args.folder / "dataset.json")
    source = args.xml.read_bytes()
    assert hashlib.sha256(source).hexdigest() == manifest["source"]["sha256"]
    objects = {obj.tag + "/" + obj.attrib["id"]: obj for obj in ET.fromstring(source) if obj.tag in {"node", "way", "relation"}}
    records = {}
    for file in (args.folder / "details").glob("*.json"): records.update(read(file))
    for key, feature in records.items():
        obj, p = objects[key], feature["properties"]
        assert p["tags"] == tags(obj), key
        assert p.get("osm_version") == int(obj.attrib["version"]), key
        assert stamp(p["osm_timestamp"]) == stamp(obj.attrib["timestamp"]), key
        source_changeset = int(obj.attrib.get("changeset", "0"))
        assert (p.get("osm_changeset") or 0) == source_changeset, key
    lines = read(args.folder / "lines.json")["lines"]
    expected_track_lines = defaultdict(set)
    direct_members = {}
    route_count = 0
    for line in lines:
        assert len(line["master_ids"]) == 1
        master_key = line["master_ids"][0]
        master = objects[master_key]
        assert tags(master)["type"] == "route_master"
        assert tags(master)["route_master"] == line["mode"]
        master_children = {entry.attrib["type"] + "/" + entry.attrib["ref"] for entry in master.findall("member")}
        originals = [tags(master)]
        all_members = set()
        expected_tracks = set()
        for route_key in line["relation_ids"]:
            route_count += 1
            assert route_key in master_children
            route = objects[route_key]
            assert tags(route)["route"] == line["mode"]
            originals.append(tags(route))
            members = {entry.attrib["type"] + "/" + entry.attrib["ref"] for entry in route.findall("member")}
            assert members.issubset(objects)
            all_members.update(members)
            for key in members:
                p = records.get(key, {}).get("properties", {})
                if p.get("feature_kind") == "track" and p["rail_mode"] == line["mode"]:
                    expected_tracks.add(key);expected_track_lines[key].add(line["line_key"])
        assert all(entry in originals for entry in line["source_tags"])
        assert set(line["members"]) == all_members
        assert set(line["rendered_tracks"]) == expected_tracks
        direct_members[line["line_key"]] = all_members
        if line["mode"] == "subway":
            assert tags(master)["network"] == "沈阳地铁"
            assert line["line_key"] == "shenyang-metro/" + tags(master)["ref"]
    for key, feature in records.items():
        p = feature["properties"]
        if p["feature_kind"] == "track": assert set(p["line_keys"]) == expected_track_lines[key]
        if p.get("line_membership_source") == "stop_area relation":
            for line_key in p["line_keys"]:
                confirmed = False
                for area_key in p["line_link_evidence"]:
                    area = objects[area_key]
                    assert tags(area)["public_transport"] == "stop_area"
                    members = {entry.attrib["type"] + "/" + entry.attrib["ref"] for entry in area.findall("member")}
                    assert key in members
                    if members.intersection(direct_members[line_key]): confirmed = True
                assert confirmed, key
    assert len(lines) == 12 and route_count == 24
    result = {"date": datetime.now(timezone.utc).isoformat(), "snapshot": manifest["snapshot_id"],
        "source_xml_sha256": manifest["source"]["sha256"], "source_time": manifest["source"]["source_time"],
        "published_objects_checked": len(records), "route_directions": route_count, "route_masters": len(lines),
        "stop_areas": sum(tags(obj).get("public_transport") == "stop_area" for obj in objects.values() if obj.tag == "relation"),
        "checks": ["all published original tags and object version/timestamp/changeset match preserved XML", "every line identity has explicit parent-child source membership", "all direct route references and rendered track memberships reconcile", "all inherited stop-area line links have source relation evidence"],
        "scope": "Source fidelity and graph membership audit; not proof of current operating completeness, independent human QA, or full MVP acceptance"}
    if args.report: args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
