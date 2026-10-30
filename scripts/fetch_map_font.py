"""Fetch checksum-pinned upstream font/license and optional build wheels only.

Downloads stay under ignored data/manifests/local/font-build. Does not install
or execute the downloads. Font build script independently verifies its inputs.
"""
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def main():
    manifest = json.loads((ROOT / 'apps/web/client/public/map-font-manifest.json').read_text(encoding='utf-8'))
    tools = json.loads((ROOT / 'config/font-build-tools.json').read_text())['components']
    commit = manifest['upstream_commit']
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Expected fixed upstream commit')
    base = f'https://raw.githubusercontent.com/notofonts/noto-cjk/{commit}/'
    downloads = [(base + 'Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf', 'source.otf', manifest['upstream_sha256']),
                 (base + 'LICENSE', 'OFL.txt', manifest['license_sha256'])]
    for tool in tools:
        if not re.fullmatch(r'[A-Za-z0-9_.-]+\.whl', tool['filename']) or not tool['source'].startswith('https://files.pythonhosted.org/'):
            raise ValueError('Unexpected wheel source/name')
        downloads.append((tool['source'], tool['filename'], tool['sha256']))
    output = ROOT / 'data/manifests/local/font-build'; output.mkdir(parents=True, exist_ok=True)
    for url, filename, expected in downloads:
        target = output / filename
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            print('verified cache:', filename); continue
        with urllib.request.urlopen(url, timeout=60) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != expected:
            raise ValueError('Download checksum mismatch: ' + filename)
        target.write_bytes(content); print('verified download:', filename, len(content))

if __name__ == '__main__':
    main()
