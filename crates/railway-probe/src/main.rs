use osmpbfreader::{OsmId, OsmObj, OsmPbfReader};
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, fs, fs::File, io, time::Instant};

fn category(tags: &osmpbfreader::Tags) -> (&'static str, String) {
    let railway = tags.get("railway").map(|s| s.as_str()).unwrap_or_else(|| {
        match tags.get("public_transport").map(|v| v.as_str()) {
            Some("station") => "station",
            Some("platform") => "platform",
            Some("stop_position") => "stop",
            _ => "unknown",
        }
    });
    let statuses: Vec<_> = ["abandoned", "disused", "razed", "construction", "proposed"]
        .into_iter()
        .filter(|key| railway == *key || tags.contains_key(format!("{key}:railway").as_str()))
        .collect();
    let status = if statuses.len() > 1 {
        "conflict"
    } else {
        statuses.first().copied().unwrap_or("mapped")
    };
    let kind = if railway == "unknown" && statuses.len() == 1 {
        tags.get(format!("{}:railway", statuses[0]).as_str())
            .map(|v| v.as_str())
            .unwrap_or(railway)
    } else {
        railway
    };
    (status, kind.to_string())
}

fn relevant(tags: &osmpbfreader::Tags) -> bool {
    tags.contains_key("railway")
        || ["station", "platform", "stop_position", "stop_area"].contains(
            &tags
                .get("public_transport")
                .map(|v| v.as_str())
                .unwrap_or(""),
        )
        || ["subway", "light_rail", "tram"]
            .contains(&tags.get("route").map(|v| v.as_str()).unwrap_or(""))
        || ["subway", "light_rail", "tram"]
            .contains(&tags.get("route_master").map(|v| v.as_str()).unwrap_or(""))
        || ["abandoned", "disused", "razed", "construction", "proposed"]
            .iter()
            .any(|s| tags.contains_key(format!("{s}:railway").as_str()))
}

fn effective_mode(tags: &osmpbfreader::Tags, kind: &str) -> String {
    if kind == "subway_entrance" {
        return "subway".into();
    }
    if ["station", "halt", "tram_stop"].contains(&kind) {
        return match tags.get("station").map(|v| v.as_str()) {
            Some("subway") => "subway",
            Some("light_rail") => "light_rail",
            _ if kind == "tram_stop" => "tram",
            _ if tags.get("train").map(|v| v.as_str()) == Some("yes") => "rail",
            _ if tags.get("subway").map(|v| v.as_str()) == Some("yes") => "subway",
            _ if tags.get("tram").map(|v| v.as_str()) == Some("yes") => "tram",
            _ => "unknown",
        }
        .into();
    }
    for (tag, mode) in [("train", "rail"), ("subway", "subway"), ("tram", "tram")] {
        if tags.get(tag).map(|v| v.as_str()) == Some("yes") {
            return mode.into();
        }
    }
    if ["abandoned", "disused", "razed", "construction", "proposed"].contains(&kind) {
        return tags
            .get(format!("{kind}:railway").as_str())
            .or_else(|| tags.get(kind))
            .map(|v| v.to_string())
            .unwrap_or("unknown".into());
    }
    kind.into()
}

fn facility_kind(kind: &str) -> &'static str {
    match kind {
        "platform" => "platform",
        "stop" => "stop_position",
        "subway_entrance" => "entrance",
        "signal" => "signal",
        "switch" => "switch",
        "level_crossing" => "level_crossing",
        "buffer_stop" => "buffer_stop",
        "depot" => "depot",
        "yard" => "yard",
        "works" => "works",
        "maintenance" => "maintenance",
        "water_tower" => "water_tower",
        "turntable" => "turntable",
        "roundhouse" => "roundhouse",
        "wash" => "wash",
        "fuel" => "fuel",
        "loading_ramp" => "loading_ramp",
        _ => "other",
    }
}

fn typed_id(id: OsmId) -> String {
    match id {
        OsmId::Node(id) => format!("node/{}", id.0),
        OsmId::Way(id) => format!("way/{}", id.0),
        OsmId::Relation(id) => format!("relation/{}", id.0),
    }
}

// Versioned display policy: specific track function precedes corridor usage.
fn line_class(tags: &osmpbfreader::Tags, mode: &str) -> (&'static str, &'static str, Vec<String>) {
    let value = |key: &str| tags.get(key).map(|v| v.as_str()).unwrap_or("");
    if mode != "rail" {
        return (
            match mode {
                "subway" => "metro",
                "light_rail" => "light_rail",
                "tram" => "tram",
                _ => "unknown",
            },
            "mode-v1",
            vec![],
        );
    }
    if ["highspeed", "usage", "service"]
        .iter()
        .any(|key| value(key).contains(';'))
    {
        return (
            "unknown",
            "ambiguous-values-v1",
            vec!["字段含多值，需复核".into()],
        );
    }
    let mut warnings = Vec::new();
    let service = value("service");
    let usage = value("usage");
    let highspeed = value("highspeed");
    if !["", "yes", "no"].contains(&highspeed) {
        warnings.push("高速标签值未识别".into());
    }
    if ![
        "",
        "main",
        "branch",
        "industrial",
        "military",
        "test",
        "tourism",
    ]
    .contains(&usage)
    {
        warnings.push("用途标签值未识别".into());
    }
    if !["", "spur", "siding", "crossover", "yard", "industrial"].contains(&service) {
        warnings.push("服务标签值未识别".into());
    }
    let (class, rule) = if ["spur", "siding", "crossover", "yard"].contains(&service) {
        if highspeed == "yes" || usage == "main" {
            warnings.push("站场功能优先，保留走廊标签供复核".into());
        }
        ("branch", "service-v1")
    } else if usage == "industrial" || service == "industrial" {
        if highspeed == "yes" {
            warnings.push("工业用途与高速证据需复核".into());
        }
        ("industrial", "industrial-v1")
    } else if highspeed == "yes" {
        ("high_speed", "explicit-highspeed-v1")
    } else if usage == "branch" {
        ("branch", "branch-v1")
    } else if usage == "main" {
        ("conventional_main", "main-v1")
    } else {
        ("conventional_other", "rail-fallback-v1")
    };
    (class, rule, warnings)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 4 {
        return Err("usage: railway-probe INPUT.osm.pbf OUTPUT.geojson REPORT.json".into());
    }
    if std::path::Path::new(&args[2]).exists() || std::path::Path::new(&args[3]).exists() {
        return Err("outputs exist; use fresh paths".into());
    }
    let start = Instant::now();
    let mut reader = OsmPbfReader::new(File::open(&args[1])?);
    // This holds a bounded pilot in memory. Do not feed a country extract directly.
    let objects = reader.get_objs_and_deps(|obj| relevant(obj.tags()))?;
    let mut features = Vec::new();
    let mut classes: BTreeMap<String, usize> = BTreeMap::new();
    let mut status_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut missing_refs = 0;
    let mut named_stations = Vec::new();
    let mut way_count = 0;
    let mut named_way_count = 0;
    let mut tagged_speed_count = 0;
    let mut tagged_electrified_count = 0;
    let mut line_classes: BTreeMap<String, usize> = BTreeMap::new();
    let mut relations = Vec::new();
    let mut missing_relation_refs = 0;
    let mut rejected = Vec::new();
    let mut candidate_objects = 0;
    for object in objects.values().filter(|o| relevant(o.tags())) {
        candidate_objects += 1;
        let tags = object.tags();
        let (status, kind) = category(tags);
        let (id, geometry) = match object {
            OsmObj::Node(n) => {
                if ["station", "halt"].contains(&kind.as_str()) {
                    named_stations.push(json!({"id": format!("node/{}", n.id.0), "name": tags.get("name").map(|s|s.as_str()), "railway": kind}));
                }
                (
                    format!("node/{}", n.id.0),
                    json!({"type":"Point", "coordinates":[n.lon(),n.lat()]}),
                )
            }
            OsmObj::Way(w) => {
                let coords: Vec<_> = w
                    .nodes
                    .iter()
                    .filter_map(|id| match objects.get(&OsmId::Node(*id)) {
                        Some(OsmObj::Node(n)) => Some(json!([n.lon(), n.lat()])),
                        _ => {
                            missing_refs += 1;
                            None
                        }
                    })
                    .collect();
                if coords.len() != w.nodes.len() || coords.len() < 2 {
                    rejected.push(json!({"feature_key":format!("way/{}",w.id.0),"rule":"missing_refs_or_degenerate_way"}));
                    continue;
                }
                way_count += 1;
                named_way_count += usize::from(tags.contains_key("name"));
                tagged_speed_count += usize::from(tags.contains_key("maxspeed"));
                tagged_electrified_count += usize::from(tags.contains_key("electrified"));
                let area = w.is_closed()
                    && w.nodes.len() >= 4
                    && [
                        "station",
                        "platform",
                        "depot",
                        "yard",
                        "works",
                        "maintenance",
                        "water_tower",
                        "roundhouse",
                    ]
                    .contains(&kind.as_str())
                    && tags.get("area").map(|v| v.as_str()) != Some("no");
                (
                    format!("way/{}", w.id.0),
                    if area {
                        json!({"type":"Polygon", "coordinates":[coords]})
                    } else {
                        json!({"type":"LineString", "coordinates":coords})
                    },
                )
            }
            OsmObj::Relation(r) => {
                let raw: BTreeMap<_, _> = tags
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect();
                let members: Vec<_> = r.refs.iter().map(|member| {
                    let present = objects.contains_key(&member.member);
                    missing_relation_refs += usize::from(!present);
                    json!({"feature_key":typed_id(member.member),"role":member.role.as_str(),"present":present})
                }).collect();
                relations.push(json!({"feature_key":format!("relation/{}", r.id.0),"tags":raw,"members":members}));
                continue;
            }
        };
        *classes.entry(kind.clone()).or_default() += 1;
        *status_counts.entry(status.to_string()).or_default() += 1;
        let raw: BTreeMap<_, _> = tags
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let track = geometry["type"] == "LineString"
            && [
                "rail",
                "subway",
                "light_rail",
                "tram",
                "narrow_gauge",
                "miniature",
                "abandoned",
                "disused",
                "razed",
                "construction",
                "proposed",
            ]
            .contains(&kind.as_str());
        let mode = effective_mode(tags, &kind);
        let (class, rule, warnings) = if track {
            line_class(tags, &mode)
        } else {
            ("unknown", "not-track-v1", vec![])
        };
        if track {
            *line_classes.entry(class.into()).or_default() += 1;
        }
        let display_name = raw
            .get("name:zh")
            .or_else(|| raw.get("name"))
            .cloned()
            .unwrap_or_default();
        // JSON encoding keeps source text inert; the viewer must also use textContent.
        features.push(json!({"type":"Feature", "id":id, "geometry":geometry,
            "properties":{"osm_id":id,"name":raw.get("name"),"railway":kind,"status":status,
                "display_name":display_name,"name_source":if raw.contains_key("name:zh") {"name:zh"} else if raw.contains_key("name") {"name"} else {"missing"},
                "feature_key":id,"feature_kind":if track {"track"} else if ["station", "halt", "tram_stop"].contains(&kind.as_str()) {if geometry["type"] == "Polygon" {"station_area"} else {"station"}} else {"facility"},
                "facility_kind":facility_kind(&kind),
                "rail_mode":mode,"line_class":class,"class_rule_id":rule,"class_warnings":warnings,
                "station":raw.get("station"),"service":raw.get("service"),"usage":raw.get("usage"),
                "highspeed":raw.get("highspeed"),"maxspeed":raw.get("maxspeed"),
                "electrified":raw.get("electrified"),"tags":raw}}));
    }
    if missing_refs > 0 {
        return Err(format!("{missing_refs} missing way-node references").into());
    }
    let dataset: Value = json!({"type":"FeatureCollection","features":features,"relations":relations,"excluded":rejected});
    let output = serde_json::to_vec(&dataset)?;
    let report = json!({"objects_loaded":objects.len(),"candidate_objects":candidate_objects,"excluded_objects":rejected.len(),"features":features.len(),
        "way_features":way_count,"named_way_features":named_way_count,
        "ways_with_maxspeed":tagged_speed_count,"ways_with_electrified":tagged_electrified_count,
        "classes":classes,"line_classes":line_classes,"classification_version":"display-v1.3","statuses":status_counts,"stations":named_stations,
        "missing_way_node_refs":missing_refs,"relations":relations.len(),"missing_relation_member_refs":missing_relation_refs,"geojson_bytes":output.len(),
        "processing_seconds":start.elapsed().as_secs_f64(),
        "scope":"Bounded pilot only; mapped means OSM tag, not confirmed operational status; route memberships and source station polygons preserved"});
    // create_new prevents accidental overwrite of either artifact.
    use std::io::Write;
    let mut out = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&args[2])?;
    out.write_all(&output)?;
    let mut out = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&args[3])?;
    out.write_all(serde_json::to_string_pretty(&report)?.as_bytes())?;
    println!(
        "{} features, {} ways, {} missing refs; {} bytes; {:.3}s",
        features.len(),
        way_count,
        missing_refs,
        output.len(),
        start.elapsed().as_secs_f64()
    );
    io::stdout().flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tags(pairs: &[(&str, &str)]) -> osmpbfreader::Tags {
        pairs
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect()
    }
    #[test]
    fn urban_route_masters_are_preserved_as_identity_evidence() {
        assert!(relevant(&tags(&[
            ("type", "route_master"),
            ("route_master", "subway")
        ])));
        assert!(relevant(&tags(&[
            ("type", "route_master"),
            ("route_master", "tram")
        ])));
        assert!(!relevant(&tags(&[
            ("type", "route_master"),
            ("route_master", "bus")
        ])));
    }
    #[test]
    fn lifecycle_prefix_is_not_lost_when_railway_is_present() {
        assert_eq!(
            category(&tags(&[("railway", "rail"), ("disused:railway", "rail")])),
            ("disused", "rail".into())
        );
    }
    #[test]
    fn missing_tags_do_not_imply_operational_status() {
        assert_eq!(category(&tags(&[])), ("mapped", "unknown".into()));
        assert!(!relevant(&tags(&[("highway", "service")])));
        assert!(relevant(&tags(&[("abandoned:railway", "rail")])));
    }

    #[test]
    fn proposed_prefix_is_preserved_for_filtering() {
        assert_eq!(
            category(&tags(&[("railway", "rail"), ("proposed:railway", "rail")])),
            ("proposed", "rail".into())
        );
        assert!(relevant(&tags(&[("proposed:railway", "rail")])));
    }

    #[test]
    fn track_function_precedes_corridor_usage() {
        for (pairs, expected) in [
            (vec![("usage", "main"), ("service", "siding")], "branch"),
            (
                vec![("highspeed", "yes"), ("service", "crossover")],
                "branch",
            ),
            (vec![("usage", "industrial"), ("service", "spur")], "branch"),
            (
                vec![("highspeed", "yes"), ("usage", "industrial")],
                "industrial",
            ),
            (vec![("highspeed", "yes"), ("usage", "main")], "high_speed"),
            (
                vec![("highspeed", "no"), ("usage", "main")],
                "conventional_main",
            ),
            (vec![], "conventional_other"),
            (vec![("highspeed", "yes;no")], "unknown"),
        ] {
            assert_eq!(line_class(&tags(&pairs), "rail").0, expected);
        }
    }

    #[test]
    fn missing_station_mode_is_not_inferred_from_proximity() {
        assert_eq!(effective_mode(&tags(&[]), "station"), "unknown");
        assert_eq!(
            effective_mode(&tags(&[("train", "yes")]), "station"),
            "rail"
        );
        assert_eq!(
            effective_mode(&tags(&[("construction", "rail")]), "construction"),
            "rail"
        );
    }

    #[test]
    fn prefix_only_tracks_and_conflicting_lifecycles_remain_distinct() {
        assert_eq!(
            category(&tags(&[("disused:railway", "rail")])),
            ("disused", "rail".into())
        );
        assert_eq!(
            category(&tags(&[
                ("railway", "rail"),
                ("abandoned:railway", "rail"),
                ("construction:railway", "rail")
            ])),
            ("conflict", "rail".into())
        );
    }
}
