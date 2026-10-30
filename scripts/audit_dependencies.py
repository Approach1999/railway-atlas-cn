"""Read-only online advisory checks of the current recorded JS/Rust/Python versions.

No package updates. Failed, malformed, stale or paginated-incomplete checks never
count as a clean audit. This is advisory evidence, not a security certification.
"""
import argparse
from datetime import datetime, timezone
from email.parser import Parser
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OSV = 'https://api.osv.dev/v1/'
ECOSYSTEMS = {'npm': 'npm', 'cargo': 'crates.io', 'python': 'PyPI'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def online_json(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json', 'User-Agent': 'railway-atlas-dependency-audit/1'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def query_osv(queries, request=online_json):
    results = [[] for _ in queries]
    pending = [(i, query) for i, query in enumerate(queries)]
    pages = []
    seen = set()
    while pending:
        response = request(OSV + 'querybatch', {'queries': [query for _, query in pending]})
        pages.append(response)
        if not isinstance(response, dict) or not isinstance(response.get('results'), list) or len(response['results']) != len(pending):
            raise ValueError('OSV response count/shape does not match queries')
        next_pending = []
        for (index, query), result in zip(pending, response['results']):
            if not isinstance(result, dict) or result.get('error'):
                raise ValueError('OSV query result is invalid or failed')
            vulns = result.get('vulns', [])
            if not isinstance(vulns, list) or any(not isinstance(v, dict) or not isinstance(v.get('id'), str) for v in vulns):
                raise ValueError('OSV vulnerability list is invalid')
            results[index].extend(vulns)
            token = result.get('next_page_token')
            if token:
                if not isinstance(token, str) or (index, token) in seen or len(pages) >= 100:
                    raise ValueError('OSV pagination did not finish')
                seen.add((index, token))
                next_pending.append((index, {**queries[index], 'page_token': token}))
        pending = next_pending
    return results, pages


def inventory_inputs(path, python_packages):
    inventory = json.loads(path.read_text(encoding='utf-8-sig'))
    for relative, expected in inventory['inputs'].items():
        if digest(ROOT / relative) != expected:
            raise ValueError('Inventory is stale: ' + relative)
    observed = {}
    for path in python_packages.glob('*.dist-info/METADATA'):
        metadata = Parser().parsestr(path.read_text(encoding='utf-8'))
        observed[(metadata['Name'], metadata['Version'])] = digest(path)
    for component in inventory['components']:
        if component.get('scope') == 'offline-font-subset':
            if digest(ROOT / component['metadata_source']) != component['metadata_sha256']:
                raise ValueError('Font tool metadata differs from inventory: ' + component['id'])
            continue
        if component['ecosystem'] == 'python' and observed.get((component['name'], component['version'])) != component['metadata_sha256']:
            raise ValueError('Python metadata differs from inventory: ' + component['id'])
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/manifests/local/dependency-audit/report.json')
    parser.add_argument('--python-packages', type=Path, default=ROOT / '.venv/Lib/site-packages')
    args = parser.parse_args()
    inventory_path = ROOT / 'docs/evidence/dependency-license-inventory.json'
    inventory = inventory_inputs(inventory_path, args.python_packages)
    report = {'started_utc': datetime.now(timezone.utc).isoformat(), 'inventory_sha256': digest(inventory_path),
              'script_sha256': digest(Path(__file__)), 'inputs': inventory['inputs'], 'npm': {}, 'osv': {},
              'limits': ['Known advisory databases at query time only; not proof of absence of vulnerabilities.',
                         'Python covers locked wheel versions observed on CPython 3.12 Windows x64, not every platform.',
                         'Embedded native libraries, OS, browser and toolchain are outside these package queries.',
                         'License evidence gaps and independent release review remain separate.']}
    errors = []
    findings = False
    for app in ('client', 'probe'):
        try:
            result = subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'audit', '--json', '--cache',
                                     str(ROOT / 'data/manifests/local/npm-audit-cache')],
                                    cwd=ROOT / 'apps/web' / app, capture_output=True, text=True, encoding='utf-8', timeout=90)
            value = json.loads(result.stdout)
            report['npm'][app] = {'exit_code': result.returncode, 'response': value}
            if value.get('error') or value.get('auditReportVersion') != 2 or not isinstance(value.get('vulnerabilities'), dict) or result.returncode not in (0, 1):
                raise ValueError('npm audit failed or returned an unsupported response')
            counts = value.get('metadata', {}).get('vulnerabilities', {})
            if not isinstance(counts.get('total'), int):
                raise ValueError('npm audit totals missing')
            findings |= bool(value['vulnerabilities']) or counts['total'] > 0
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            errors.append({'check': 'npm:' + app, 'error': str(error)})
    try:
        packages = {}
        for component in inventory['components']:
            key = (ECOSYSTEMS[component['ecosystem']], component['name'], component['version'])
            packages.setdefault(key, []).append(component['id'])
        keys = sorted(packages)
        queries = [{'package': {'ecosystem': ecosystem, 'name': name}, 'version': version} for ecosystem, name, version in keys]
        report['osv']['queries'] = queries
        results, pages = query_osv(queries)
        report['osv']['responses'] = pages
        report['osv']['packages'] = [{'query': query, 'components': packages[key], 'vulnerabilities': result}
                                     for key, query, result in zip(keys, queries, results)]
        ids = sorted({v['id'] for result in results for v in result})
        findings |= bool(ids)
        report['osv']['advisories'] = {}
        for advisory in ids:
            # Quote advisory IDs as a single URL segment, never a server-provided URL.
            from urllib.parse import quote
            value = online_json(OSV + 'vulns/' + quote(advisory, safe=''))
            if not isinstance(value, dict) or value.get('id') != advisory:
                raise ValueError('OSV full advisory identity mismatch')
            report['osv']['advisories'][advisory] = value
    except (OSError, ValueError) as error:
        errors.append({'check': 'osv', 'error': str(error)})
    report.update(finished_utc=datetime.now(timezone.utc).isoformat(), errors=errors,
                  status='incomplete' if errors else 'findings_require_review' if findings else 'no_known_advisories')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'errors': errors, 'output': str(args.output),
                      'osv_packages': len(report['osv'].get('packages', [])),
                      'advisories': list(report['osv'].get('advisories', {}))}, ensure_ascii=False))
    return 2 if errors else 1 if findings else 0


if __name__ == '__main__':
    raise SystemExit(main())
