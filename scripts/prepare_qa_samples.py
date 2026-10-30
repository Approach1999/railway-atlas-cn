"""Prepare deterministic real-source QA samples. Human review stays pending.

Only published objects are eligible. Compare original tags/version/time against
the preserved same-date XML; do not count source equality as visual or independent
human acceptance. No external requests, no geodata downloads.
"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FACILITIES = ['platform', 'stop_position', 'entrance', 'signal', 'switch', 'level_crossing', 'buffer_stop',
              'depot', 'yard', 'works', 'maintenance', 'water_tower', 'turntable', 'roundhouse',
              'wash', 'fuel', 'loading_ramp']
ANCHORS = ['node/6179162407', 'node/676578837', 'node/13028356638', 'node/11224161741']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data/processed/shenyang-mvp-20261023')
    parser.add_argument('--source-xml', type=Path, default=ROOT / 'data/raw/shenyang-geofabrik-masters-20261020.osm')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/qa/shenyang-samples.json')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest, index, lines = read(args.data_dir / 'dataset.json'), read(args.data_dir / 'objects.json'), read(args.data_dir / 'lines.json')
    snapshot = manifest['snapshot_id']
    if index['snapshot_id'] != snapshot or lines['snapshot_id'] != snapshot:
        raise ValueError('Mixed snapshot inputs')
    if digest(args.source_xml) != manifest['source']['sha256']:
        raise ValueError('Preserved source XML does not match immutable snapshot provenance')
    published = {p['osm_id'] for p in index['records']}
    full_features = {}
    for path in sorted((args.data_dir / 'details').glob('*.json')):
        for key, feature in read(path).items():
            if key in full_features or key != feature['properties']['osm_id'] or key not in published:
                raise ValueError('Detail identity differs from published index: ' + key)
            full_features[key] = feature
    if set(full_features) != published:
        raise ValueError('Published detail coverage is incomplete')
    # The light object index deliberately omits original tags and some colour/
    # relation evidence. Quota predicates must inspect full validated records.
    records = {key: feature['properties'] for key, feature in full_features.items()}
    selected, coverage = {}, []

    def choose(group, predicate, count, required=True):
        eligible = sorted((p for p in records.values() if predicate(p)),
                          key=lambda p: hashlib.sha256((snapshot + ':' + p['osm_id']).encode()).hexdigest())
        picked = eligible[:count]
        coverage.append({'group': group, 'required_target': count, 'available': len(eligible),
                         'selected': len(picked), 'ids': [p['osm_id'] for p in picked],
                         'coverage': 'target_met' if len(picked) == count else 'all_available' if eligible else 'no_published_source_records',
                         'required': required, 'human_review': 'pending'})
        for p in picked:
            selected.setdefault(p['osm_id'], []).append(group)

    for key in ANCHORS:
        choose('identity-anchor:' + key, lambda p, key=key: p['osm_id'] == key, 1)
    choose('station-areas', lambda p: p.get('feature_kind') == 'station_area', 4)
    for mode in ['rail', 'subway', 'tram']:
        choose('station-mode:' + mode, lambda p, mode=mode: p.get('feature_kind') == 'station' and p['rail_mode'] == mode, 2)
    choose('stations-20', lambda p: p.get('feature_kind') in ['station', 'station_area'], 20)
    choose('tracks-20', lambda p: p.get('feature_kind') == 'track', 20)
    for grade in ['high_speed', 'conventional_main', 'conventional_other', 'branch', 'industrial']:
        choose('track-grade:' + grade, lambda p, grade=grade: p.get('feature_kind') == 'track' and p.get('line_class') == grade, 5)
    for status in ['disused', 'abandoned']:
        choose('track-state:' + status, lambda p, status=status: p.get('feature_kind') == 'track' and p['status'] == status, 2)
    for attribute in ['bridge', 'tunnel']:
        choose('track-attribute:' + attribute, lambda p, attribute=attribute: p.get('feature_kind') == 'track' and p.get('tags', {}).get(attribute) not in [None, '', 'no'], 2)
    for kind in FACILITIES:
        choose('facility:' + kind, lambda p, kind=kind: p.get('feature_kind') == 'facility' and p.get('facility_kind') == kind, 5)
    for line in lines['lines']:
        if line['mode'] == 'subway':
            choose('metro-line:' + line['line_key'], lambda p, key=line['line_key']: p.get('feature_kind') == 'track' and key in p.get('line_keys', []), 1)
    choose('shared-track', lambda p: p.get('feature_kind') == 'track' and p.get('line_shared') is True, 1)
    choose('missing-line-colour', lambda p: p.get('feature_kind') == 'track' and p.get('rail_mode') in ['subway', 'tram', 'light_rail'] and p.get('colour_confidence') == 'fallback', 1)
    choose('light-colour-line', lambda p: p.get('feature_kind') == 'track' and any(key in p.get('line_keys', []) for key in ['shenyang-metro/2', 'shenyang-metro/3', 'shenyang-metro/10']), 1)

    originals = {}
    for event, element in ET.iterparse(args.source_xml, events=['end']):
        if element.tag not in ['node', 'way', 'relation']:
            continue
        key = element.tag + '/' + element.attrib['id']
        if key in selected:
            originals[key] = {'tags': {t.attrib['k']: t.attrib['v'] for t in element.findall('tag')},
                              'version': element.get('version'), 'timestamp': element.get('timestamp')}
        element.clear()
    samples, shard_hashes = [], {}
    for key, groups in sorted(selected.items()):
        shard = hashlib.sha256(key.encode()).hexdigest()[:2]
        if shard not in shard_hashes:
            shard_hashes[shard] = digest(args.data_dir / 'details' / (shard + '.json'))
        feature = full_features[key]
        p, original = feature['properties'], originals.get(key)
        if not original or p.get('tags', {}) != original['tags'] or str(p.get('osm_version')) != original['version'] or datetime.fromisoformat(p['osm_timestamp'].replace('Z', '+00:00')) != datetime.fromisoformat(original['timestamp'].replace('Z', '+00:00')):
            raise ValueError('Sample differs from preserved source: ' + key)
        anchor = p.get('anchor')
        if not anchor:
            geometry = feature['geometry']
            coordinates = geometry['coordinates']
            if geometry['type'] == 'Point':
                anchor = coordinates
            else:
                while isinstance(coordinates[0][0], list):
                    coordinates = coordinates[0]
                anchor = coordinates[len(coordinates) // 2]
        # Explicit filters make all reviewed lifecycle/mode/facility objects reachable.
        address = '/?snapshot=' + snapshot + '&feature=' + key + '&types=rail,subway,light_rail,tram,other,unknown&states=mapped,construction,proposed,disused,abandoned,razed,unknown,conflict&facilities=1#map=16.00/' + format(anchor[1], '.5f') + '/' + format(anchor[0], '.5f')
        samples.append({'osm_id': key, 'name': p.get('display_name'), 'groups': groups, 'feature_kind': p.get('feature_kind'),
                        'rail_mode': p.get('rail_mode'), 'line_class': p.get('line_class'), 'facility_kind': p.get('facility_kind'),
                        'classification_rule_id': p.get('class_rule_id'), 'classification_warnings': p.get('class_warnings', []),
                        'name_source': p.get('name_source'), 'colour_source': p.get('colour_source'), 'colour_confidence': p.get('colour_confidence'),
                        'line_identity_source': p.get('line_identity_source'), 'line_membership_source': p.get('line_membership_source'),
                        'status': p['status'], 'line_keys': p.get('line_keys', []), 'line_shared': p.get('line_shared'),
                        'geometry_type': feature['geometry']['type'], 'geometry_sha256': hashlib.sha256(json.dumps(feature['geometry'], sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                        'view': address, 'source_url': 'https://www.openstreetmap.org/' + key,
                        'source_tags': original['tags'], 'source_version': original['version'], 'source_timestamp': original['timestamp'],
                        'source_comparison': 'tags_version_and_timestamp_instant_equal_to_preserved_xml',
                        'map_display_review': None, 'classification_review': None, 'deviation': None,
                        'independent_reviewer_1': None, 'independent_reviewer_2': None})
    result = {'schema_version': 1, 'snapshot': snapshot, 'attribution': '© OpenStreetMap contributors; regional extract supplied by Geofabrik',
              'data_license': 'ODbL-1.0', 'license_url': 'https://www.openstreetmap.org/copyright',
              'source_xml_sha256': digest(args.source_xml), 'manifest_sha256': digest(args.data_dir / 'dataset.json'),
              'object_index_sha256': digest(args.data_dir / 'objects.json'), 'detail_shards_sha256': shard_hashes, 'lines_sha256': digest(args.data_dir / 'lines.json'),
              'generator_sha256': digest(Path(__file__)), 'classification_version': manifest['classification_version'],
              'palette_version': manifest['palette_version'], 'published_objects': len(records), 'sample_objects': len(samples),
              'coverage': coverage, 'samples': samples, 'human_review_complete': False,
              'limits': ['Deterministic sampling and saved-source equality are not classification correctness or visual acceptance.',
                         'Absent source categories remain explicit gaps; no synthetic objects fill a real-data quota.',
                         'Current online OSM pages may differ from the preserved date snapshot.',
                         'Map display, explanation/deviations and two independent reviewer signoffs remain pending.']}
    encoded = (json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode('utf-8')
    if args.check:
        if not args.output.is_file() or args.output.read_bytes() != encoded:
            raise ValueError('Sample packet is missing or stale')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encoded)
    print(json.dumps({'snapshot': snapshot, 'sample_objects': len(samples), 'groups': len(coverage),
                      'source_equal': len(samples), 'no_source_categories': [c['group'] for c in coverage if c['available'] == 0],
                      'human_review_complete': False, 'bytes': len(encoded)}, ensure_ascii=True))


if __name__ == '__main__':
    main()
