"""Retain GitHub connector file results and version proofs supplied as JSON on stdin.

No network or package execution. Verifies Git blobs, current lock anchors and
crate VCS records before retaining evidence; inventory validates relationships.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile
import tomllib
from upstream_license_evidence import git_blob

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ROOT / 'data/manifests/local/license-archives'


def write_file(relative, raw):
    path = ROOT / relative
    if not path.resolve().is_relative_to((ROOT / 'third_party').resolve()):
        raise ValueError('Retained evidence must remain in third_party')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return {'file': relative, 'sha256': hashlib.sha256(raw).hexdigest()}


def metadata(filename):
    path = (ARCHIVES / filename).resolve()
    if not path.is_relative_to(ARCHIVES.resolve()):
        raise ValueError('Registry metadata must remain in local archive directory')
    value = json.loads(path.read_text(encoding='utf-8'))
    result = {key: value.get(key) for key in ('name', 'version', 'license', 'repository', 'gitHead', 'homepage')}
    result['dist'] = {key: value['dist'].get(key) for key in ('integrity', 'shasum', 'tarball')}
    if 'optionalDependencies' in value:
        result['optionalDependencies'] = value['optionalDependencies']
    return result


def main():
    payload = json.load(sys.stdin)
    destination = ROOT / 'config/upstream-license-sources.json'
    manifest = json.loads(destination.read_text(encoding='utf-8')) if destination.is_file() else {'schema_version': 1, 'components': {}}
    cargo = {(p['name'], p['version']): p for p in tomllib.loads((ROOT / 'Cargo.lock').read_text(encoding='utf-8'))['package']}
    for entry in payload['sources']:
        name, version, ecosystem = entry['name'], entry['version'], entry['ecosystem']
        stem = ecosystem + '-' + re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '-' + version
        commit, license_file = entry['upstream_commit'], entry['license']
        raw = license_file['content'].encode('utf-8')
        if git_blob(raw) != license_file['sha']:
            raise ValueError('Connector license text does not match Git blob: ' + name)
        record = {key: entry[key] for key in ('kind', 'ecosystem', 'name', 'version', 'repository', 'upstream_commit')}
        proof = {'kind': entry['kind'], 'upstream_commit': commit}
        if ecosystem == 'cargo':
            package = cargo[(name, version)]
            archive_file = ARCHIVES / (name + '-' + version + '.crate')
            assert hashlib.sha256(archive_file.read_bytes()).hexdigest() == package['checksum']
            with tarfile.open(archive_file, 'r:gz') as archive:
                vcs = json.load(archive.extractfile(name + '-' + version + '/.cargo_vcs_info.json'))
            assert vcs['git']['sha1'] == commit
            proof.update(archive_sha256=package['checksum'], crate_vcs_info=vcs)
            record['checksum'] = package['checksum']
            identity = f'cargo:{name}@{version}'
        else:
            package = json.loads((ROOT / 'apps/web' / entry['project'] / 'package-lock.json').read_text(encoding='utf-8'))['packages']['node_modules/' + name]
            registry = metadata(entry['registry_metadata_file'])
            assert registry['name'] == name and registry['version'] == version and registry['dist']['integrity'] == package['integrity']
            proof['registry_metadata'] = registry
            record['integrity'] = package['integrity']
            identity = f'npm:{entry["project"]}:node_modules/{name}@{version}'
            if entry['kind'] == 'npm_release_binding':
                source = entry['source_package']
                source_raw = source['content'].encode('utf-8')
                assert git_blob(source_raw) == source['sha']
                source_record = write_file('third_party/license-provenance/' + stem + '.source-package.json', source_raw)
                source_record['git_blob_sha'] = source['sha']
                proof.update(source_package=source_record, target=entry['target'], release_ref=entry['release_ref'],
                             parent_registry_metadata=metadata(entry['parent_registry_metadata_file']))
            else:
                assert registry['gitHead'] == commit
        proof_record = write_file('third_party/license-provenance/' + stem + '.json', (json.dumps(proof, sort_keys=True, indent=2) + '\n').encode('utf-8'))
        text_record = write_file('third_party/licenses/upstream/' + stem + '.LICENSE', raw)
        text_record.update(git_blob_sha=license_file['sha'], source_file='LICENSE',
                           source_url=f'https://github.com/{entry["repository"]}/blob/{commit}/LICENSE')
        record.update(version_proof=proof_record, license_files=[text_record], retrieved_utc=datetime.now(timezone.utc).isoformat())
        manifest['components'][identity] = record
    destination.write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'retained_components': len(manifest['components'])}))


if __name__ == '__main__':
    main()
