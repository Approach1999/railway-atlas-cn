"""Compare embedded npm README terms with the exact lock-verified package archive."""
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    archive = ROOT / 'data/manifests/local/license-archives/murmurhash-js-1.0.0.tgz'
    raw = archive.read_bytes()
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
    configured = json.loads((ROOT / 'config/package-license-files.json').read_text(encoding='utf-8'))['packages']['npm:murmurhash-js@1.0.0'][0]
    with tarfile.open(archive, 'r:gz') as source:
        original = source.extractfile('package/README.md').read()
        package = json.load(source.extractfile('package/package.json'))
    assert package['name'] == 'murmurhash-js' and package['version'] == '1.0.0'
    assert hashlib.sha256(original).hexdigest() == configured['sha256']
    checks = []
    for app in ('client', 'probe'):
        folder = ROOT / 'apps/web' / app
        lock = json.loads((folder / 'package-lock.json').read_text(encoding='utf-8'))['packages']['node_modules/murmurhash-js']
        assert lock['version'] == '1.0.0' and lock['integrity'] == integrity
        assert (folder / 'node_modules/murmurhash-js/README.md').read_bytes() == original
        checks.append({'project': app, 'integrity': integrity, 'original_readme_sha256': configured['sha256'], 'original_bytes_equal': True})
    report = {'date': datetime.now(timezone.utc).isoformat(), 'package': 'murmurhash-js@1.0.0',
              'archive_sha256': hashlib.sha256(raw).hexdigest(), 'source_url': lock['resolved'], 'checks': checks,
              'scope': 'Actual published archive matches both npm lock integrities and installed complete README terms; not independent legal approval'}
    (ROOT / 'docs/evidence/embedded-license-archive-checks.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'projects_checked': len(checks), 'result': 'passed'}))


if __name__ == '__main__':
    main()
