"""Build a renamed, reproducible OFL font subset for all catalogued map names.

Original font and pinned wheel downloads remain outside versioned assets.
Run using the isolated requirements-fonts.lock environment, not the data venv.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
import brotli

ROOT = Path(__file__).resolve().parents[1]
COMMIT = '523d033d6cb47f4a80c58a35753646f5c3608a78'
SOURCE_SHA = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'
LICENSE_SHA = '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2'
FAMILY = 'Railway Atlas CJK'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def collect_map_names(root):
    catalog_bytes = (root / 'config/catalog.json').read_bytes()
    catalog = json.loads(catalog_bytes)
    inputs = {'config/catalog.json': sha(catalog_bytes)}
    # Printable ASCII, separators and all fixed map-symbol/mode suffix strings.
    characters = set(chr(n) for n in range(32, 127)) | set('铁路地铁轻轨有轨电车未知制式未标注岔信出挡道口停设施号线共线·？！（）—−')
    counts = {}
    for region in catalog['regions']:
        for snapshot in region['snapshots']:
            counts[snapshot] = {}
            for filename, key in [('features.geojson', 'features'), ('stations.geojson', 'features'), ('lines.json', 'lines')]:
                path = root / 'data/processed' / snapshot / filename
                data = path.read_bytes(); inputs[path.relative_to(root).as_posix()] = sha(data)
                records = json.loads(data)[key]
                for record in records:
                    p = record['properties'] if key == 'features' else record
                    for field in ['display_name', 'name', 'label_name', 'line_ref', 'line_name', 'ref']:
                        value = p.get(field)
                        if isinstance(value, str): characters.update(c for c in value if c.isprintable())
                counts[snapshot][filename] = len(records)
    return sorted(map(ord, characters)), inputs, counts

def make(source, license_file):
    assert fontTools.__version__ == '4.67.0' and brotli.__version__ == '1.2.1', 'Use locked font build tools'
    source_bytes, license_bytes = source.read_bytes(), license_file.read_bytes()
    assert sha(source_bytes) == SOURCE_SHA and sha(license_bytes) == LICENSE_SHA, 'Pinned upstream checksum mismatch'
    codes, inputs, counts = collect_map_names(ROOT)
    for name in ['scripts/build_map_font.py', 'requirements-fonts.lock', 'config/font-build-tools.json']:
        inputs[name] = sha((ROOT / name).read_bytes())
    font = TTFont(io.BytesIO(source_bytes), recalcTimestamp=False)
    missing = sorted(set(codes) - set(font.getBestCmap()))
    if missing:
        raise ValueError('Upstream does not cover requested names: ' + ','.join(f'U+{n:04X}' for n in missing))
    options = subset.Options()
    options.recalc_timestamp = False
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    options.name_legacy = True
    options.name_languages = ['*']
    sub = subset.Subsetter(options=options); sub.populate(unicodes=codes); sub.subset(font)
    names = {1: FAMILY, 2: 'Regular', 3: 'RailwayAtlasCJK-Subset-v1', 4: FAMILY + ' Regular', 6: 'RailwayAtlasCJK-Regular', 16: FAMILY, 17: 'Regular'}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    if 'CFF ' in font:
        cff = font['CFF '].cff; cff.fontNames = ['RailwayAtlasCJK-Regular']
        cff.topDictIndex[0].FamilyName = FAMILY; cff.topDictIndex[0].FullName = FAMILY + ' Regular'
    font.flavor = 'woff2'; output = io.BytesIO(); font.save(output); payload = output.getvalue()
    decoded = TTFont(io.BytesIO(payload)); assert set(codes).issubset(decoded.getBestCmap())
    copyright_text = font['name'].getDebugName(0)
    manifest = {'schema_version': 1, 'family': FAMILY, 'kind': 'renamed-map-name-subset',
                'upstream_family': 'Noto Sans CJK SC Regular', 'upstream_commit': COMMIT,
                'upstream_source': f'https://raw.githubusercontent.com/notofonts/noto-cjk/{COMMIT}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
                'upstream_sha256': SOURCE_SHA, 'license': 'OFL-1.1', 'license_sha256': LICENSE_SHA,
                'copyright': copyright_text, 'fonttools': fontTools.__version__, 'brotli': brotli.__version__,
                'font_sha256': sha(payload), 'font_bytes': len(payload), 'codepoints': codes,
                'snapshot_feature_counts': counts, 'inputs': inputs,
                'limits': 'Covers fixed map symbols and names in catalogued local snapshots, not arbitrary future names or every UI/detail string. Regenerate and check before publishing a new catalog.'}
    notices = ((copyright_text or '') + '\n\nRenamed and subset for Railway Atlas; derived from Noto Sans CJK SC.\n\n').encode() + license_bytes
    return {ROOT / 'apps/web/client/src/assets/map-cjk.woff2': payload,
            ROOT / 'apps/web/client/src/map-font-data.ts': ("// Generated by scripts/build_map_font.py; do not edit.\nexport const MAP_FONT_FAMILY=" + json.dumps(FAMILY) + ";\nexport const MAP_FONT_INTEGRITY=" + json.dumps('sha256-' + base64.b64encode(hashlib.sha256(payload).digest()).decode()) + ";\n").encode(),
            ROOT / 'apps/web/client/public/map-font-manifest.json': (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode(),
            ROOT / 'apps/web/client/public/map-font-license.txt': notices}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'data/manifests/local/font-build/source.otf')
    parser.add_argument('--license', type=Path, default=ROOT / 'data/manifests/local/font-build/OFL.txt')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    for path, content in make(args.source, args.license).items():
        if args.check:
            assert path.read_bytes() == content, 'Stale font output: ' + str(path)
        else:
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
        print(path.relative_to(ROOT), len(content), sha(content))

if __name__ == '__main__':
    main()
