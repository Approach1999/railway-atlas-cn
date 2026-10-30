"""Independently compare retained original texts with checksum-locked crate bytes.

Needs the ignored downloaded archives, but no network, extraction or package execution.
"""
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def main():
    sources = json.loads((ROOT / 'config/license-sources.json').read_text(encoding='utf-8'))['components']
    packages = {f'cargo:{p["name"]}@{p["version"]}': p for p in
                tomllib.loads((ROOT / 'Cargo.lock').read_text(encoding='utf-8'))['package']}
    checks = []
    for identity, source in sorted(sources.items()):
        package = packages[identity]
        raw = (ROOT / 'data/manifests/local/license-archives' / (package['name'] + '-' + package['version'] + '.crate')).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        assert digest == package['checksum'] == source['archive_sha256'], identity
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
            prefix = package['name'] + '-' + package['version'] + '/'
            metadata_raw = archive.extractfile(prefix + 'Cargo.toml').read()
            assert hashlib.sha256(metadata_raw).hexdigest() == source['cargo_metadata_sha256'], identity
            metadata = tomllib.loads(metadata_raw.decode('utf-8'))['package']
            assert metadata['name'] == package['name'] and metadata['version'] == package['version'], identity
            assert metadata.get('license') == source['license_declared'], identity
            for record in source['license_files']:
                member = archive.getmember(prefix + record['source_file'])
                assert member.isfile(), identity
                original = archive.extractfile(member).read()
                retained = (ROOT / record['file']).read_bytes()
                assert original == retained and hashlib.sha256(retained).hexdigest() == record['sha256'], identity
        checks.append({'component': identity, 'archive_sha256': digest, 'original_texts_compared': len(source['license_files'])})
    inventory = json.loads((ROOT / 'docs/evidence/dependency-license-inventory.json').read_text(encoding='utf-8'))
    audit = json.loads((ROOT / 'docs/evidence/dependency-audit-current.json').read_text(encoding='utf-8'))
    current = {(c['ecosystem'], c['name'], c['version']) for c in inventory['components']}
    ecosystems = {'npm': 'npm', 'crates.io': 'cargo', 'PyPI': 'python'}
    audited = {(ecosystems[p['query']['package']['ecosystem']], p['query']['package']['name'], p['query']['version'])
               for p in audit['osv']['packages']}
    assert current == audited, 'Dependencies changed since recorded advisory queries'
    report = {'date': datetime.now(timezone.utc).isoformat(), 'checks': checks,
              'archives_checked': len(checks), 'archives_with_original_texts': sum(c['original_texts_compared'] > 0 for c in checks),
              'license_gaps': inventory['gaps'], 'advisory_package_set_unchanged': current == audited,
              'advisory_query_finished_utc': audit['finished_utc'],
              'scope': 'Retained crate evidence and unchanged advisory package versions only; no new online advisory query, legal approval or full N08 acceptance'}
    (ROOT / 'docs/evidence/cargo-license-archive-checks.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'archives_checked': report['archives_checked'], 'with_original_texts': report['archives_with_original_texts'],
                      'remaining_gaps': len(report['license_gaps']), 'advisory_package_set_unchanged': True}))


if __name__ == '__main__':
    main()
