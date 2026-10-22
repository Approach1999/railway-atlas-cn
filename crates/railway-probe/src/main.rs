use osmpbfreader::{OsmId, OsmObj, OsmPbfReader};
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, fs, fs::File, io, time::Instant};

fn category(tags: &osmpbfreader::Tags) -> (&'static str, String) {
    let railway = tags.get("railway").map(|s| s.as_str()).unwrap_or("unknown");
    let status = ["abandoned", "disused", "razed", "construction", "proposed"]
        .into_iter()
        .find(|key| railway == *key || tags.contains_key(format!("{key}:railway").as_str()))
        .unwrap_or("mapped");
    (status, railway.to_string())
}

fn relevant(tags: &osmpbfreader::Tags) -> bool {
    tags.contains_key("railway")
        || ["abandoned", "disused", "razed", "construction", "proposed"]
            .iter()
            .any(|s| tags.contains_key(format!("{s}:railway").as_str()))
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
    for object in objects.values().filter(|o| relevant(o.tags())) {
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
                    continue;
                }
                way_count += 1;
                named_way_count += usize::from(tags.contains_key("name"));
                tagged_speed_count += usize::from(tags.contains_key("maxspeed"));
                tagged_electrified_count += usize::from(tags.contains_key("electrified"));
                (
                    format!("way/{}", w.id.0),
                    json!({"type":"LineString", "coordinates":coords}),
                )
            }
            _ => continue,
        };
        *classes.entry(kind.clone()).or_default() += 1;
        *status_counts.entry(status.to_string()).or_default() += 1;
        let raw: BTreeMap<_, _> = tags
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        // JSON encoding keeps source text inert; the viewer must also use textContent.
        features.push(json!({"type":"Feature", "id":id, "geometry":geometry,
            "properties":{"osm_id":id,"name":raw.get("name"),"railway":kind,"status":status,
                "station":raw.get("station"),"service":raw.get("service"),"usage":raw.get("usage"),
                "highspeed":raw.get("highspeed"),"maxspeed":raw.get("maxspeed"),
                "electrified":raw.get("electrified"),"tags":raw}}));
    }
    if missing_refs > 0 {
        return Err(format!("{missing_refs} missing way-node references").into());
    }
    let dataset: Value = json!({"type":"FeatureCollection","features":features});
    let output = serde_json::to_vec(&dataset)?;
    let report = json!({"objects_loaded":objects.len(),"features":features.len(),
        "way_features":way_count,"named_way_features":named_way_count,
        "ways_with_maxspeed":tagged_speed_count,"ways_with_electrified":tagged_electrified_count,
        "classes":classes,"statuses":status_counts,"stations":named_stations,
        "missing_way_node_refs":missing_refs,"geojson_bytes":output.len(),
        "processing_seconds":start.elapsed().as_secs_f64(),
        "scope":"Bounded pilot only; mapped means OSM tag, not confirmed operational status; way station areas remain outlines"});
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
}
