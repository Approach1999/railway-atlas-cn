"""Offline inventory of locked dependencies and the license texts present locally.

Does not infer missing declarations, grant a code license, or substitute for an
online advisory audit or independent release review. No network requests.
"""
import argparse
from collections import Counter
from email.parser import Parser
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tomllib
from upstream_license_evidence import apply_upstream

ROOT = Path(__file__).resolve().parents[1]
PREFIXES = ('LICENSE', 'LICENCE', 'COPYING', 'NOTICE')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def license_paths(folder):
    found = [p for p in folder.iterdir() if p.is_file() and p.name.upper().startswith(PREFIXES)]
    for name in ('license', 'licenses', 'LICENSES'):
        directory = folder / name
        if directory.is_dir():
            found.extend(p for p in directory.rglob('*') if p.is_file())
    return sorted(set(found))


def build_inventory(cargo_cache, python_packages):
    components, texts, inputs, gaps = [], {}, {}, []
    source_file = ROOT / 'config/license-sources.json'
    supplements = {}
    if source_file.is_file():
        inputs[source_file.relative_to(ROOT).as_posix()] = sha(source_file)
        supplements = read_json(source_file)['components']
    embedded_file = ROOT / 'config/package-license-files.json'
    embedded = {}
    if embedded_file.is_file():
        inputs[embedded_file.relative_to(ROOT).as_posix()] = sha(embedded_file)
        embedded = read_json(embedded_file)['packages']

    def package_paths(component, folder):
        paths = license_paths(folder)
        key = component['ecosystem'] + ':' + component['name'] + '@' + component['version']
        for record in embedded.get(key, []):
            path = (folder / record['file']).resolve()
            if not path.is_relative_to(folder.resolve()) or sha(path) != record['sha256']:
                raise ValueError('Embedded license path/hash mismatch: ' + component['id'])
            paths.append(path)
        return sorted(set(paths))

    def archived_evidence(component):
        source = supplements.get(component['id'])
        if source is None:
            return False
        if (component['ecosystem'] != 'cargo' or source['ecosystem'] != 'cargo'
                or source['name'] != component['name'] or source['version'] != component['version']
                or source['archive_sha256'] != component['checksum']):
            raise ValueError('Supplement identity/checksum differs from lock: ' + component['id'])
        component['license_declared'] = source['license_declared']
        component['repository'] = source.get('repository')
        component['license_evidence_source'] = {key: source[key] for key in
            ('archive_url', 'archive_sha256', 'cargo_metadata_sha256', 'retrieved_utc')}
        records = []
        for record in source['license_files']:
            path = (ROOT / record['file']).resolve()
            if not path.is_relative_to((ROOT / 'third_party/licenses').resolve()) or sha(path) != record['sha256']:
                raise ValueError('Supplement license path/hash mismatch: ' + component['id'])
            inputs[record['file']] = record['sha256']
            text = path.read_bytes().decode('utf-8')
            texts.setdefault(record['sha256'], {'text': text, 'components': []})['components'].append(component['id'])
            records.append({'file': record['source_file'], 'project_file': record['file'], 'sha256': record['sha256']})
        component['license_files'] = records
        if not records:
            gaps.append({'component': component['id'], 'reason': 'license_text_not_present'})
        return True

    def evidence(component, folder, paths):
        records = []
        for path in paths:
            digest = sha(path)
            text = path.read_bytes().decode('utf-8', errors='replace')
            texts.setdefault(digest, {'text': text, 'components': []})['components'].append(component['id'])
            records.append({'file': path.relative_to(folder).as_posix(), 'sha256': digest})
        component['license_files'] = records
        if not records:
            gaps.append({'component': component['id'], 'reason': 'license_text_not_present'})

    for app in ('client', 'probe'):
        base = ROOT / 'apps/web' / app
        lockfile = base / 'package-lock.json'
        inputs[lockfile.relative_to(ROOT).as_posix()] = sha(lockfile)
        for key, package in sorted(read_json(lockfile)['packages'].items()):
            if not key:
                continue
            folder = base / key
            name = key.rsplit('node_modules/', 1)[-1]
            component = {'id': f'npm:{app}:{key}@{package["version"]}', 'ecosystem': 'npm', 'project': app,
                         'name': name, 'version': package['version'], 'license_declared': package.get('license'),
                         'scope': 'build' if package.get('dev') else 'runtime', 'optional': bool(package.get('optional')),
                         'integrity': package.get('integrity'), 'source': package.get('resolved'),
                         'installed': (folder / 'package.json').is_file(), 'license_files': []}
            if component['installed']:
                metadata = read_json(folder / 'package.json')
                if metadata['version'] != package['version'] or metadata['name'] != name:
                    raise ValueError('Installed package differs from lock: ' + component['id'])
                component['repository'] = metadata.get('repository')
                evidence(component, folder, package_paths(component, folder))
            elif not component['optional']:
                gaps.append({'component': component['id'], 'reason': 'required_package_not_installed'})
            if not component['license_declared']:
                gaps.append({'component': component['id'], 'reason': 'license_declaration_missing'})
            components.append(component)

    cargo_lock = ROOT / 'Cargo.lock'
    inputs['Cargo.lock'] = sha(cargo_lock)
    for package in tomllib.loads(cargo_lock.read_text(encoding='utf-8'))['package']:
        if not package.get('source'):
            continue
        component = {'id': f'cargo:{package["name"]}@{package["version"]}', 'ecosystem': 'cargo',
                     'name': package['name'], 'version': package['version'], 'source': package['source'],
                     'checksum': package.get('checksum'), 'scope': 'offline-tool-transitive', 'license_files': []}
        sources = sorted(cargo_cache.glob('*/' + package['name'] + '-' + package['version']))
        component['source_present'] = bool(sources)
        if archived_evidence(component):
            pass
        elif sources:
            folder = sources[0]
            metadata = tomllib.loads((folder / 'Cargo.toml').read_text(encoding='utf-8'))['package']
            if metadata['name'] != package['name'] or metadata['version'] != package['version']:
                raise ValueError('Cargo source differs from lock: ' + component['id'])
            component['license_declared'] = metadata.get('license')
            component['repository'] = metadata.get('repository')
            paths = package_paths(component, folder)
            if metadata.get('license-file'):
                candidate = (folder / metadata['license-file']).resolve()
                if not candidate.is_relative_to(folder.resolve()):
                    raise ValueError('License file escapes crate: ' + component['id'])
                if candidate.is_file():
                    paths = sorted(set(paths + [candidate]))
            evidence(component, folder, paths)
            if not component.get('license_declared') and not paths:
                gaps.append({'component': component['id'], 'reason': 'license_declaration_missing'})
        else:
            component['license_declared'] = None
            gaps.append({'component': component['id'], 'reason': 'locked_crate_not_in_local_source_cache'})
        components.append(component)

    if any(key not in {component['id'] for component in components} for key in supplements):
        raise ValueError('Supplement component absent from current locks')

    requirements = ROOT / 'requirements-data.txt'
    inputs['requirements-data.txt'] = sha(requirements)
    direct = dict(re.findall(r'^([A-Za-z0-9_-]+)==([^\s#]+)', requirements.read_text(), re.MULTILINE))
    lock = ROOT / 'requirements-data.lock'
    inputs['requirements-data.lock'] = sha(lock)
    locked = dict(re.findall(r'^([A-Za-z0-9_.-]+)==([^\s\\#]+)', lock.read_text(), re.MULTILINE))
    if not locked or any(locked.get(name) != version for name, version in direct.items()):
        raise ValueError('Python lock differs from direct requirements')
    for metadata_path in sorted(python_packages.glob('*.dist-info/METADATA')):
        folder = metadata_path.parent
        metadata = Parser().parsestr(metadata_path.read_text(encoding='utf-8'))
        name, version = metadata['Name'], metadata['Version']
        component = {'id': f'python:{name}@{version}', 'ecosystem': 'python', 'name': name, 'version': version,
                     'license_declared': metadata.get('License-Expression') or metadata.get('License'),
                     'scope': 'installer' if name == 'pip' else 'offline-data-tool',
                     'direct_pin': direct.get(name), 'metadata_sha256': sha(metadata_path),
                     'locked_pin': locked.get(name),
                     'requires_dist': metadata.get_all('Requires-Dist', [])}
        if name in direct and version != direct[name]:
            raise ValueError('Python direct pin differs: ' + component['id'])
        if locked.get(name) != version:
            raise ValueError('Python environment differs from lock: ' + component['id'])
        evidence(component, folder, license_paths(folder))
        if not component['license_declared']:
            gaps.append({'component': component['id'], 'reason': 'license_declaration_missing'})
        components.append(component)
    for name in locked:
        if not any(c['ecosystem'] == 'python' and c['name'] == name for c in components):
            raise ValueError('Required Python metadata absent: ' + name)

    font_tools = ROOT / 'config/font-build-tools.json'
    if font_tools.is_file():
        config = read_json(font_tools)
        lock = ROOT / 'requirements-fonts.lock'
        if sha(lock) != config['lock_sha256']:
            raise ValueError('Font build lock checksum differs')
        inputs['requirements-fonts.lock'] = sha(lock)
        inputs['config/font-build-tools.json'] = sha(font_tools)
        for record in config['components']:
            if not re.search(r'^' + re.escape(record['name']) + r'==' + re.escape(record['version']) + r'\s+--hash=sha256:' + record['sha256'] + r'$', lock.read_text(), re.M | re.I):
                raise ValueError('Font tool differs from hashed lock')
            component = {key: record[key] for key in ('id', 'ecosystem', 'name', 'version', 'license_declared')}
            metadata_path = (ROOT / record['metadata_file']).resolve()
            if not metadata_path.is_relative_to(ROOT.resolve()) or sha(metadata_path) != record['metadata_sha256']:
                raise ValueError('Font tool metadata checksum/path mismatch')
            metadata = Parser().parsestr(metadata_path.read_text(encoding='utf-8'))
            if metadata['Name'] != record['name'] or metadata['Version'] != record['version']:
                raise ValueError('Font tool metadata identity mismatch')
            component.update(metadata_sha256=record['metadata_sha256'], metadata_source=record['metadata_file'])
            inputs[record['metadata_file']] = record['metadata_sha256']
            component.update(scope='offline-font-subset', locked_pin=record['version'], checksum=record['sha256'], wheel_filename=record['filename'], source=record['source'])
            paths = []
            for license_file in record['license_files']:
                path = (ROOT / license_file['project_file']).resolve()
                if not path.is_relative_to((ROOT / 'third_party/licenses').resolve()) or sha(path) != license_file['sha256']:
                    raise ValueError('Font tool license checksum/path mismatch')
                paths.append(path); inputs[license_file['project_file']] = sha(path)
            evidence(component, ROOT, paths); components.append(component)

    apply_upstream(ROOT, components, texts, inputs)
    with_text = {component['id'] for component in components if component.get('license_files')}
    gaps = [gap for gap in gaps if not (gap['reason'] == 'license_text_not_present' and gap['component'] in with_text)]
    inputs['scripts/upstream_license_evidence.py'] = sha(Path(__file__).with_name('upstream_license_evidence.py'))

    assets_file = ROOT / 'config/third-party-assets.json'
    assets = read_json(assets_file)
    for asset in assets.get('assets', []):
        if 'font_file' in asset:
            font_path = (ROOT / asset['font_file']).resolve()
            if not font_path.is_relative_to(ROOT.resolve()) or sha(font_path) != asset['font_sha256']:
                raise ValueError('Font asset checksum/path mismatch')
            inputs[asset['font_file']] = sha(font_path)
            manifest_path = ROOT / asset['evidence_manifest']
            if read_json(manifest_path)['font_sha256'] != asset['font_sha256']:
                raise ValueError('Font manifest checksum differs')
            inputs[asset['evidence_manifest']] = sha(manifest_path)
        for license_file in asset.get('license_files', []):
            path = (ROOT / license_file['project_file']).resolve()
            if not path.is_relative_to(ROOT.resolve()) or sha(path) != license_file['sha256']:
                raise ValueError('Asset license checksum/path mismatch')
            inputs[license_file['project_file']] = sha(path)
            texts.setdefault(sha(path), {'text': path.read_text(encoding='utf-8'), 'components': []})['components'].append('asset:' + asset['id'])
    inputs[assets_file.relative_to(ROOT).as_posix()] = sha(assets_file)
    inputs['scripts/license_inventory.py'] = sha(Path(__file__))
    inventory = {'schema_version': 1, 'kind': 'project_dependency_and_license_evidence_inventory',
                 'code_license': 'unselected', 'inputs': inputs,
                 'components': sorted(components, key=lambda c: c['id']), 'assets': assets,
                 'gaps': sorted(gaps, key=lambda g: (g['component'], g['reason'])),
                 'limits': ['Local metadata, lock files and checksum-verified archive evidence; not an online security audit.',
                            'Missing license texts or cache entries are explicit gaps, not approval.',
                            'Python wheel hashes and exact versions are locked; CPython 3.12 Windows x64 validated, other targets need checks.',
                            'Native/tool evidence is separate; Microsoft runtime terms, native advisories/static closure and legacy tools remain under review.',
                            'Application code license remains unselected. Third-party texts do not license project code.']}
    return inventory, texts


def render_notices(inventory, texts):
    blocks = ['RAILWAY ATLAS — THIRD-PARTY LICENSE EVIDENCE\n\nApplication code license: UNSELECTED.\n'
              'This file contains observed upstream license texts; it does not grant a license to application code.\n'
              'Inventory and unresolved gaps: /dependency-inventory.json\n'
              'Data: OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright\n'
              'Basemap: https://tile.openstreetmap.org — https://operations.osmfoundation.org/policies/tiles/\n'
              'Fonts: device UI/fallback fonts; renamed Railway Atlas CJK map subset from Noto Sans CJK SC, OFL-1.1.\n'
              'Font provenance and license: /map-font-manifest.json and /map-font-license.txt\n']
    for digest, entry in sorted(texts.items()):
        blocks.append('\n' + '=' * 72 + '\n' + '\n'.join(sorted(entry['components'])) +
                      '\nSource text SHA-256: ' + digest + '\n' + '-' * 72 + '\n' + entry['text'])
    blocks.append('\n' + '=' * 72 + '\nUNRESOLVED LOCAL EVIDENCE GAPS\n' +
                  ('\n'.join(g['component'] + ': ' + g['reason'] for g in inventory['gaps']) if inventory['gaps'] else
                   'None in the recorded build package evidence. Optional platform/native tools and independent review remain subject to inventory limits.') + '\n')
    return '\n'.join(blocks).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cargo-cache', type=Path, default=Path(os.environ.get('CARGO_HOME', Path.home() / '.cargo')) / 'registry/src')
    parser.add_argument('--python-packages', type=Path, default=ROOT / '.venv/Lib/site-packages')
    parser.add_argument('--check', action='store_true', help='Check deterministic generated files without writing')
    args = parser.parse_args()
    inventory, texts = build_inventory(args.cargo_cache, args.python_packages)
    encoded = (json.dumps(inventory, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')
    outputs = {ROOT / 'docs/evidence/dependency-license-inventory.json': encoded,
               ROOT / 'apps/web/client/public/dependency-inventory.json': encoded,
               ROOT / 'apps/web/client/public/third-party-notices.txt': render_notices(inventory, texts)}
    for path, content in outputs.items():
        if args.check:
            if not path.is_file() or path.read_bytes() != content:
                raise ValueError('Generated file is missing or stale: ' + str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    print(json.dumps({'components': dict(Counter(c['ecosystem'] for c in inventory['components'])),
                      'license_texts': len(texts), 'explicit_gaps': len(inventory['gaps']),
                      'output_bytes': sum(len(c) for c in outputs.values()),
                      'generated_files_match': True, 'license_approval': False}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
