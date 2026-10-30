"""Retain exact upstream native/tool license bytes from connector JSON results."""
import argparse
import hashlib
import json
from pathlib import Path
from upstream_license_evidence import git_blob

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    args = parser.parse_args()
    sources = json.loads(args.input.read_text(encoding='utf-8'))['sources']
    destination = ROOT / 'config/native-license-sources.json'
    manifest = json.loads(destination.read_text(encoding='utf-8')) if destination.is_file() else {'schema_version': 1, 'components': {}}
    for source in sources:
        ref, commit = source['release_ref'], source['commit']
        if ref['object']['type'] == 'commit':
            assert ref['object']['sha'] == commit
        else:
            assert source['tag_object']['sha'] == ref['object']['sha']
            assert source['tag_object']['object'] == {'sha': commit, 'type': 'commit', 'url': source['tag_object']['object']['url']}
        raw = source['file']['content'].encode('utf-8')
        assert git_blob(raw) == source['file']['sha']
        relative = 'third_party/licenses/native/' + source['name'] + '-' + source['version'] + '-' + source['path'].replace('/', '_')
        path = (ROOT / relative).resolve()
        if not path.is_relative_to((ROOT / 'third_party/licenses/native').resolve()):
            raise ValueError('License path escapes native evidence directory')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        key = source.get('component', source['name'])
        record = manifest['components'].setdefault(key, {'version': source['version'], 'license_files': []})
        assert record['version'] == source['version']
        evidence = {'file': relative, 'sha256': hashlib.sha256(raw).hexdigest(), 'git_blob_sha': source['file']['sha'],
                    'repository': source['repo'], 'upstream_commit': commit, 'source_file': source['path'],
                    'source_url': f'https://github.com/{source["repo"]}/blob/{commit}/{source["path"]}',
                    'release_ref': ref, 'tag_object': source.get('tag_object')}
        record['license_files'] = [file for file in record['license_files'] if file['file'] != relative] + [evidence]
    destination.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({'native_or_tool_license_components': len(manifest['components'])}))


if __name__ == '__main__':
    main()
