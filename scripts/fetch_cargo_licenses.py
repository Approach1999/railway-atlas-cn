"""Fetch missing locked crate evidence, verify Cargo checksums, retain license files.

Never extracts tar archives to disk or installs/executes package code. Complete
archives stay in ignored local storage; selected original texts and provenance
are reviewable project files. Re-run the offline inventory after fetching.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PREFIXES = ('LICENSE', 'LICENCE', 'COPYING', 'NOTICE')


def parse_archive(raw, package, embedded=()):
    if hashlib.sha256(raw).hexdigest() != package['checksum']:
        raise ValueError('Crate checksum does not match Cargo.lock')
    prefix = package['name'] + '-' + package['version']
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = {}
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or '\\' in member.name or not path.parts or path.parts[0] != prefix:
                raise ValueError('Unsafe archive path')
            if member.isfile():
                relative = PurePosixPath(*path.parts[1:]).as_posix()
                if relative in members:
                    raise ValueError('Duplicate archive path')
                members[relative] = member

        def read(name):
            member = members[name]
            if member.size > 4 * 1024 * 1024:
                raise ValueError('Evidence file exceeds size budget')
            return archive.extractfile(member).read()

        metadata_raw = read('Cargo.toml')
        metadata = tomllib.loads(metadata_raw.decode('utf-8'))['package']
        if metadata['name'] != package['name'] or metadata['version'] != package['version']:
            raise ValueError('Crate metadata identity mismatch')
        names = [name for name in members if (len(PurePosixPath(name).parts) == 1 and name.upper().startswith(PREFIXES))
                 or PurePosixPath(name).parts[0] in ('license', 'licenses', 'LICENSES')]
        if metadata.get('license-file'):
            license_file = metadata['license-file']
            if license_file not in members:
                raise ValueError('Declared license-file absent or unsafe')
            names.append(license_file)
        for record in embedded:
            raw_text = read(record['file'])
            if hashlib.sha256(raw_text).hexdigest() != record['sha256']:
                raise ValueError('Embedded crate license hash mismatch')
            names.append(record['file'])
        return metadata, hashlib.sha256(metadata_raw).hexdigest(), {name: read(name) for name in sorted(set(names))}


def fetch(package):
    name, version = package['name'], package['version']
    url = f'https://static.crates.io/crates/{name}/{name}-{version}.crate'
    cache = ROOT / 'data/manifests/local/license-archives' / f'{name}-{version}.crate'
    if cache.is_file():
        raw = cache.read_bytes()
    else:
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                raw = response.read(32 * 1024 * 1024 + 1)
        except OSError:
            # Bounded alternate transport for local TLS/DNS failures; same exact URL/checksum.
            cache.parent.mkdir(parents=True, exist_ok=True)
            part = cache.with_suffix('.crate.part')
            result = subprocess.run(['curl.exe' if os.name == 'nt' else 'curl', '-fL',
                '--connect-timeout', '10', '--max-time', '30', '--max-filesize', str(32 * 1024 * 1024),
                '--output', str(part), url], capture_output=True, timeout=40)
            if result.returncode:
                raise OSError('Both download transports failed: ' + result.stderr.decode('utf-8', errors='replace')[-500:])
            raw = part.read_bytes()
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('Crate archive exceeds size budget')
    if hashlib.sha256(raw).hexdigest() != package['checksum']:
        raise ValueError('Crate checksum does not match Cargo.lock')
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(raw)
    embedded_file = ROOT / 'config/package-license-files.json'
    embedded = json.loads(embedded_file.read_text(encoding='utf-8'))['packages'] if embedded_file.is_file() else {}
    metadata, metadata_hash, texts = parse_archive(raw, package, embedded.get(f'cargo:{name}@{version}', []))
    record = {'ecosystem': 'cargo', 'name': name, 'version': version,
              'archive_url': url, 'archive_sha256': package['checksum'],
              'cargo_metadata_sha256': metadata_hash, 'license_declared': metadata.get('license'),
              'repository': metadata.get('repository'), 'license_files': []}
    return record, texts


def main():
    inventory = json.loads((ROOT / 'docs/evidence/dependency-license-inventory.json').read_text())
    missing = {gap['component'] for gap in inventory['gaps'] if gap['component'].startswith('cargo:') and gap['reason'] in
               ('locked_crate_not_in_local_source_cache', 'license_text_not_present')}
    packages = [package for package in tomllib.loads((ROOT / 'Cargo.lock').read_text())['package']
                if f'cargo:{package["name"]}@{package["version"]}' in missing]
    destination = ROOT / 'config/license-sources.json'
    saved = json.loads(destination.read_text()) if destination.is_file() else {'schema_version': 1, 'components': {}}
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {pool.submit(fetch, package): package for package in packages}
        for future in as_completed(tasks):
            package = tasks[future]
            component = f'cargo:{package["name"]}@{package["version"]}'
            try:
                record, texts = future.result()
                for source, raw in texts.items():
                    path = ROOT / 'third_party/licenses/cargo' / (record['name'] + '-' + record['version']) / source
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(raw)
                    record['license_files'].append({'source_file': source, 'file': path.relative_to(ROOT).as_posix(),
                                                    'sha256': hashlib.sha256(raw).hexdigest()})
                record['retrieved_utc'] = datetime.now(timezone.utc).isoformat()
                saved['components'][component] = record
            except (OSError, ValueError, tarfile.TarError, KeyError, subprocess.TimeoutExpired) as error:
                errors.append({'component': component, 'error': str(error)})
    if saved['components']:
        destination.write_text(json.dumps(saved, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'requested': len(packages), 'saved_components': len(saved['components']), 'errors': errors}))
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
