"""Refresh exact wheel hashes from PyPI for the reviewed data environment pins.

This never selects newer package versions or installs anything. Review changed
pins and advisory results before regenerating. Install with --only-binary=:all:.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PINS = {'osmium': '4.3.0', 'requests': '2.34.2', 'certifi': '2026.10.19',
        'charset-normalizer': '3.5.2', 'idna': '3.20', 'urllib3': '2.8.0', 'pip': '26.2'}


def release(item):
    name, version = item
    url = f'https://pypi.org/pypi/{name}/{version}/json'
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read()
    value = json.loads(raw)
    if value['info']['version'] != version:
        raise ValueError('PyPI version mismatch: ' + name)
    wheels = [{'filename': file['filename'], 'url': file['url'], 'sha256': file['digests']['sha256']}
              for file in value['urls'] if file['packagetype'] == 'bdist_wheel' and not file.get('yanked')]
    if not wheels or any(len(file['sha256']) != 64 for file in wheels):
        raise ValueError('No usable wheel hashes: ' + name)
    return {'name': name, 'version': version, 'metadata_url': url,
            'metadata_sha256': hashlib.sha256(raw).hexdigest(), 'wheels': sorted(wheels, key=lambda f: f['filename'])}


def main():
    with ThreadPoolExecutor(max_workers=4) as pool:
        packages = list(pool.map(release, sorted(PINS.items())))
    lines = ['# Exact data-tool and installer versions; wheel-only hashes from PyPI.',
             '# Install: python -m pip install --only-binary=:all: --require-hashes -r requirements-data.lock',
             '# Supported here: CPython 3.12, Windows x64; other wheel targets need validation.']
    for package in packages:
        hashes = sorted({file['sha256'] for file in package['wheels']})
        lines.append(package['name'] + '==' + package['version'] + ' \\\n' +
                     ' \\\n'.join('    --hash=sha256:' + digest for digest in hashes))
    content = ('\n'.join(lines) + '\n').encode('utf-8')
    (ROOT / 'requirements-data.lock').write_bytes(content)
    evidence = {'queried_utc': datetime.now(timezone.utc).isoformat(), 'packages': packages,
                'lock_sha256': hashlib.sha256(content).hexdigest(), 'source': 'https://pypi.org',
                'scope': 'Wheel-only exact pins, including pip; CPython 3.12 Windows x64 validated separately'}
    (ROOT / 'docs/evidence/python-lock-sources.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'packages': len(packages), 'lock_sha256': evidence['lock_sha256']}))


if __name__ == '__main__':
    main()
