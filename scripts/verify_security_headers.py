"""Check actual HTTP security headers on HTML, data, empty, range and errors."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8781')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/manifests/local/security/headers.json')
    args = parser.parse_args()
    expected = json.loads((ROOT / 'config/security-headers.json').read_text(encoding='utf-8'))['headers']
    checks = []
    for path, headers, status in [('/', {}, 200), ('/catalog.json', {}, 200), ('/dataset.json', {}, 200),
                                  ('/third-party-notices.txt', {}, 200), ('/tiles/0/0/0.pbf', {}, 204),
                                  ('/dataset.json', {'Range': 'bytes=0-9'}, 206),
                                  ('/dataset.json', {'Range': 'bytes=999999999-'}, 416),
                                  ('/unpublished-file', {}, 404)]:
        try:
            response = urllib.request.urlopen(urllib.request.Request(args.base + path, headers=headers), timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == status, (path, response.status)
            for name, value in expected.items():
                assert response.headers.get_all(name) == [value], (path, name, response.headers.get_all(name))
            assert response.headers.get('Set-Cookie') is None
            checks.append({'path': path, 'status': status, 'security_headers': 'exactly once, matching configuration'})
    report = {'date': datetime.now(timezone.utc).isoformat(), 'base': args.base, 'checks': checks,
              'headers': expected, 'scope': 'Loopback HTTP security configuration; not HTTPS/deployment or full N07 acceptance'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'checks': len(checks), 'result': 'passed'}))


if __name__ == '__main__':
    main()
