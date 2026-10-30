"""Pure normalization rules for route membership, source evidence and station anchors."""
from collections import defaultdict
import re

MODES = {"subway": "subway", "light_rail": "light_rail", "tram": "tram"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def operator_key(tags, palettes):
    names = {tags.get("operator", ""), tags.get("network", "")}
    for key, operator in palettes["operators"].items():
        if names.intersection({operator["name"], *operator.get("aliases", [])}):
            return key
    return None


def line_identity(relation, palettes):
    tags = relation["tags"]
    operator = operator_key(tags, palettes)
    ref = tags.get("ref", "").strip()
    if operator:
        config = palettes["operators"][operator]
        ref = config.get("ref_aliases", {}).get(ref, ref)
    # A missing operator is not guessed from a geographic bbox or line number.
    key = f"{operator}/{ref}" if operator and ref else f"osm/{relation['feature_key']}"
    return key, operator, ref


def color_for(line, palettes):
    if line["mode"] != "subway":
        return palettes["fallbacks"].get(line["mode"], palettes["fallbacks"]["unknown"]), "fallback", "制式色（轻轨 / 有轨电车）"
    for override in palettes.get("overrides", []):
        relation_id = str(override.get("relation_id", ""))
        relation_key = relation_id if relation_id.startswith("relation/") else "relation/" + relation_id
        if override.get("line_key") == line["line_key"] or relation_key in line["relation_ids"] or relation_key in line.get("master_ids", []):
            return override["color"], "manual", override.get("source", "手工配置")
    configured = palettes["operators"].get(line["operator_key"], {}).get("lines", {}).get(line["ref"])
    if configured:
        operator = palettes["operators"][line["operator_key"]]
        return configured["color"], operator["confidence"], operator["source"]
    colors = {tags.get("colour") for tags in line["source_tags"] if HEX.fullmatch(tags.get("colour", ""))}
    if len(colors) == 1:
        return colors.pop(), "osm", "OSM colour 标注"
    return palettes["fallbacks"].get(line["mode"], palettes["fallbacks"]["unknown"]), "fallback", "制式回退色"


def normalize_relations(features, relations, palettes):
    by_key = {f["properties"]["osm_id"]: f for f in features}
    by_relation = {r["feature_key"]: r for r in relations}
    parents = defaultdict(list)
    for master in relations:
        tags = master["tags"]
        if tags.get("type") != "route_master" or tags.get("route_master") not in MODES: continue
        for member in master["members"]:
            child = by_relation.get(member["feature_key"])
            if child and member["present"] and child["tags"].get("route") == tags["route_master"]:
                parents[member["feature_key"]].append(master)
    lines, membership, stop_areas = {}, defaultdict(set), []
    for relation in relations:
        tags = relation["tags"]
        if tags.get("public_transport") == "stop_area":
            stop_areas.append(relation)
        if tags.get("route") not in MODES:
            continue
        identity_candidates = []
        for master in parents[relation["feature_key"]]:
            inherited = {**master["tags"], **tags}
            for field in ["operator", "network", "ref"]:
                if not str(tags.get(field, "")).strip() and master["tags"].get(field): inherited[field] = master["tags"][field]
            # Conflicting explicit refs/operators never select a parent by order.
            own_operator = operator_key(tags, palettes)
            parent_operator = operator_key(master["tags"], palettes)
            if own_operator and parent_operator and own_operator != parent_operator: continue
            aliases = palettes["operators"].get(parent_operator or own_operator, {}).get("ref_aliases", {})
            own_ref, parent_ref = tags.get("ref", "").strip(), master["tags"].get("ref", "").strip()
            if own_ref and parent_ref and aliases.get(own_ref, own_ref) != aliases.get(parent_ref, parent_ref): continue
            resolved = line_identity({"feature_key": master["feature_key"], "tags": inherited}, palettes)
            identity_candidates.append((resolved, master))
        identities = {candidate[0] for candidate in identity_candidates}
        chosen = identity_candidates if len(identities) == 1 else []
        key, operator, ref = chosen[0][0] if chosen else line_identity(relation, palettes)
        identity_source = "route_master relation" if chosen else "route relation"
        master_tags = chosen[0][1]["tags"] if chosen else {}
        configured = palettes["operators"].get(operator, {}).get("lines", {}).get(ref, {})
        line = lines.setdefault(key, {"line_key": key, "operator_key": operator,
            "ref": ref, "name": configured.get("name", master_tags.get("name:zh", master_tags.get("name", tags.get("name:zh", tags.get("name", "未命名线路"))))),
            "mode": MODES[tags["route"]], "relation_ids": [], "source_tags": [],
            "members": set(), "missing_members": set(), "rendered_tracks": set(), "master_ids": set(),
            "identity_source": identity_source, "identity_evidence": [], "identity_warnings": []})
        line["relation_ids"].append(relation["feature_key"])
        line["source_tags"].append(tags)
        if parents[relation["feature_key"]] and not chosen: line["identity_warnings"].append("父关系身份存在冲突，保留原 route 身份")
        for _, master in chosen:
            line["master_ids"].add(master["feature_key"])
            line["source_tags"].append(master["tags"])
            line["identity_evidence"].append({"route": relation["feature_key"], "master": master["feature_key"], "rule": "explicit route_master membership"})
            line["missing_members"].update(m["feature_key"] for m in master["members"] if not m["present"])
        for member in relation["members"]:
            member_key = member["feature_key"]
            line["members"].add(member_key)
            if not member["present"]:
                line["missing_members"].add(member_key)
                continue
            if member_key not in by_key:
                continue
            p = by_key[member_key]["properties"]
            # Relations can include walking links: never paint them as rail tracks.
            if p["feature_kind"] == "track" and p["rail_mode"] != line["mode"]:
                continue
            membership[member_key].add(key)
            if p["feature_kind"] == "track":
                line["rendered_tracks"].add(member_key)
    # A station POI is often not a direct route member: route members are stop
    # positions. Link it through explicit stop_area membership only. Read from
    # direct memberships so an interchange POI cannot spread one line into
    # another line's platforms through repeated stop-area processing.
    direct_membership = {key: set(values) for key, values in membership.items()}
    area_evidence = defaultdict(set)
    for area in stop_areas:
        known = [m["feature_key"] for m in area["members"] if m["present"] and m["feature_key"] in by_key]
        area_lines = set().union(*(direct_membership.get(key, set()) for key in known))
        for key in known:
            p = by_key[key]["properties"]
            if p["feature_kind"] == "track" or key in direct_membership: continue
            compatible = {line for line in area_lines if lines[line]["mode"] == p["rail_mode"]}
            if compatible:
                membership[key].update(compatible)
                area_evidence[key].add(area["feature_key"])
    for line in lines.values():
        line["completeness"] = "missing_references" if line["missing_members"] else "members_present"
        line["color"], line["confidence"], line["color_source"] = color_for(line, palettes)
        for name in ["members", "missing_members", "rendered_tracks", "master_ids"]:
            line[name] = sorted(line[name])
        line["relation_ids"].sort()
        line["note"] = "成员引用完整不等于运营线路完整；仅显示已取得的轨道成员"
    for key, feature in by_key.items():
        p = feature["properties"]
        line_keys = sorted(membership.get(key, []))
        p.update({"line_keys": line_keys, "line_key": line_keys[0] if len(line_keys) == 1 else "",
            "line_tokens": "".join(f"|{key}|" for key in line_keys),
            "line_complete": len(line_keys) == 1 and lines[line_keys[0]]["completeness"] == "members_present",
            "line_shared": len(line_keys) > 1, "line_membership_source": "stop_area relation" if area_evidence[key] else "route relation" if line_keys else "missing",
            "line_link_evidence": sorted(area_evidence[key])})
        modes = {lines[k]["mode"] for k in line_keys}
        if p["feature_kind"] != "track" and p["rail_mode"] == "unknown" and len(modes) == 1:
            p["rail_mode"] = modes.pop()
            p["mode_evidence"] = "明确的 route relation 成员关系"
        if len(line_keys) == 1 and lines[line_keys[0]]["completeness"] == "members_present":
            line = lines[line_keys[0]]
            p.update({"line_color": line["color"], "colour_source": line["color_source"],
                "colour_confidence": line["confidence"], "line_ref": line["ref"], "line_name": line["name"], "line_identity_source": line["identity_source"]})
        elif line_keys:
            p.update({"line_color": palettes["fallbacks"].get(p["rail_mode"], palettes["fallbacks"]["unknown"]),
                "colour_source": "共线 / 不完整关系回退", "colour_confidence": "fallback", "line_ref": "共线" if len(line_keys) > 1 else ""})
    # Explicit stop-area membership is evidence. Proximity never creates confirmed links.
    for area in stop_areas:
        known = [m["feature_key"] for m in area["members"] if m["feature_key"] in by_key]
        stations = [key for key in known if by_key[key]["properties"]["feature_kind"] in ["station", "station_area"]]
        for key in known:
            p = by_key[key]["properties"]
            p.setdefault("station_links", []).extend(k for k in stations if k != key)
            if stations:
                p["link_status"] = "confirmed"
                p.setdefault("link_evidence", []).append(area["feature_key"])
    for feature in features:
        p = feature["properties"]
        if "station_links" in p: p["station_links"] = sorted(set(p["station_links"]))
    return sorted(lines.values(), key=lambda line: (
        {"subway": 0, "light_rail": 1, "tram": 2}.get(line["mode"], 3),
        int(line["ref"]) if line["ref"].isdigit() else 9999, line["line_key"]))


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def station_anchor(geometry):
    if geometry["type"] == "Point":
        return geometry["coordinates"], "source_node"
    ring = geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"]
    if len(ring) < 3:
        return ring[0], "source_vertex"
    y = (min(c[1] for c in ring) + max(c[1] for c in ring)) / 2
    intersections = []
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y):
            intersections.append(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
    intersections.sort()
    spans = [(intersections[i + 1] - intersections[i], (intersections[i + 1] + intersections[i]) / 2)
        for i in range(0, len(intersections) - 1, 2)]
    if spans:
        return [max(spans)[1], y], "longest_midlatitude_interior_span_v1"
    return ring[0], "source_vertex_degenerate"
