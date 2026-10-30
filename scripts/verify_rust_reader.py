"""Compare a reader migration against a preserved executable and real PBF snapshot.

Uses the locked pyosmium environment to create both dense and ordinary node fixtures.
All generated data stays in a fresh ignored directory; existing snapshots are never replaced.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import zlib


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fields(raw):
    def varint(pos):
        value = shift = 0
        while True:
            byte = raw[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, pos
            shift += 7
            if shift > 63:
                raise ValueError('Invalid protobuf varint')
    pos = 0
    while pos < len(raw):
        key, pos = varint(pos)
        wire = key & 7
        if wire == 0:
            value, pos = varint(pos)
        elif wire == 2:
            size, pos = varint(pos)
            value = raw[pos:pos + size]
            if len(value) != size:
                raise ValueError('Truncated protobuf field')
            pos += size
        else:
            raise ValueError('Unexpected fixture wire type')
        yield key >> 3, value


def node_encodings(path):
    """Independently inspect protobuf group fields so fixture options are verified."""
    kinds = set()
    with path.open('rb') as stream:
        while prefix := stream.read(4):
            size, = struct.unpack('>I', prefix)
            header = dict(fields(stream.read(size)))
            blob = dict(fields(stream.read(header[3])))
            if header[1] != b'OSMData':
                continue
            raw = blob[1] if 1 in blob else zlib.decompress(blob[3])
            for number, group in fields(raw):
                if number == 2:
                    for kind, _ in fields(group):
                        if kind in (1, 2):
                            kinds.add('ordinary' if kind == 1 else 'dense')
    return sorted(kinds)


FIXTURE = '''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="railway-atlas-reader-regression">
 <node id="1" lat="-12.3456789" lon="-45.1234567" version="1"/>
 <node id="2" lat="-12.3456788" lon="-45.1234566" version="1"/>
 <node id="3" lat="1.0" lon="2.0" version="1"><tag k="name" v="无关对象"/></node>
 <node id="4" lat="0.0000001" lon="-0.0000001" version="1"><tag k="railway" v="station"/><tag k="name" v="测试站 &amp; &lt;source&gt;"/></node>
 <way id="20" version="1"><nd ref="1"/><nd ref="2"/><tag k="railway" v="tram"/><tag k="name" v="测试线"/></way>
 <way id="21" version="1"><nd ref="2"/><nd ref="1"/></way>
 <relation id="10" version="1"><member type="way" ref="20" role="forward"/><member type="relation" ref="11" role="嵌套"/><member type="node" ref="99" role="缺失"/><member type="way" ref="20" role="backward"/><tag k="type" v="route"/><tag k="route" v="tram"/></relation>
 <relation id="11" version="1"><member type="relation" ref="10" role="cycle"/><member type="way" ref="21" role=""/></relation>
 <relation id="12" version="1"><member type="node" ref="3" role=""/></relation>
</osm>'''


def convert(xml, dest, dense):
    import osmium
    writer = osmium.SimpleWriter(osmium.io.File(str(dest), 'pbf,pbf_dense_nodes=' + str(dense).lower()))
    class Copy(osmium.SimpleHandler):
        def node(self, obj): writer.add_node(obj)
        def way(self, obj): writer.add_way(obj)
        def relation(self, obj): writer.add_relation(obj)
    try:
        Copy().apply_file(str(xml))
    finally:
        writer.close()


def run(exe, source, folder, name, success=True):
    geo, report = folder / (name + '.geojson'), folder / (name + '.json')
    result = subprocess.run([str(exe), str(source), str(geo), str(report)], capture_output=True, text=True, timeout=120)
    if success:
        assert result.returncode == 0, result.stderr
        data = json.loads(report.read_text(encoding='utf-8'))
        data.pop('processing_seconds')
        return geo.read_bytes(), data
    assert result.returncode != 0, 'Invalid input unexpectedly succeeded'
    assert not geo.exists() and not report.exists(), 'Invalid input published partial outputs'
    return {'returncode': result.returncode, 'no_output': True, 'stderr': result.stderr.strip()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=False)
    checks = []
    before, before_report = run(args.before.resolve(), args.input, args.work, 'real-before')
    after, after_report = run(args.after.resolve(), args.input, args.work, 'real-after')
    assert before == after, 'Real GeoJSON changed'
    assert before_report == after_report, 'Real quality report changed'
    checks.append({'case': 'real-snapshot', 'identical_geojson_bytes': True, 'identical_report_except_duration': True,
                   'geojson_sha256': hashlib.sha256(after).hexdigest(), 'report': after_report})
    xml = args.work / 'fixture.osm'
    xml.write_text(FIXTURE, encoding='utf-8')
    for dense in (False, True):
        name = 'dense' if dense else 'ordinary'
        source = args.work / (name + '.osm.pbf')
        convert(xml, source, dense)
        encodings = node_encodings(source)
        assert encodings == [name], encodings
        original, original_report = run(args.before.resolve(), source, args.work, name + '-before')
        migrated, migrated_report = run(args.after.resolve(), source, args.work, name + '-after')
        assert original == migrated and original_report == migrated_report, name
        assert migrated_report['objects_loaded'] == 7 and migrated_report['features'] == 2
        assert migrated_report['missing_relation_member_refs'] == 1
        data = json.loads(migrated)
        assert [m['role'] for m in data['relations'][0]['members']] == ['forward', '嵌套', '缺失', 'backward']
        assert data['features'][0]['properties']['name'] == '测试站 & <source>'
        checks.append({'case': name, 'actual_node_encodings': encodings, 'identical_geojson_bytes': True,
                       'recursive_cycle_terminates': True, 'missing_relation_reported': True,
                       'unrelated_objects_excluded': True, 'member_order_and_unicode_preserved': True})
    missing_xml = args.work / 'missing.osm'
    missing_xml.write_text(FIXTURE.replace('<nd ref="2"/>', '<nd ref="999"/>'), encoding='utf-8')
    missing = args.work / 'missing.osm.pbf'
    convert(missing_xml, missing, True)
    checks.append({'case': 'missing-way-node', **run(args.after.resolve(), missing, args.work, 'missing-after', False)})
    truncated = args.work / 'truncated.osm.pbf'
    raw = args.input.read_bytes()
    truncated.write_bytes(raw[:len(raw) // 2])
    checks.append({'case': 'truncated-pbf', **run(args.after.resolve(), truncated, args.work, 'truncated-after', False)})
    report = {'date': datetime.now(timezone.utc).isoformat(), 'source_pbf_sha256': sha(args.input),
              'before_executable_sha256': sha(args.before), 'after_executable_sha256': sha(args.after),
              'checks': checks, 'limits': ['Bounded pilot and fixtures only; not country-scale memory/performance acceptance or independent data classification review.']}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'checks': len(checks), 'identical_real_output': True, 'report': str(args.report)}))


if __name__ == '__main__':
    main()
