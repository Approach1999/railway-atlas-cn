"""Inventory the verified Windows data wheel and actual local toolchain.

Only loads the already installed, pinned wheel after byte-for-byte validation.
PE import tables are read without execution. No network or package updates.
"""
import argparse
import base64
import csv
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import ssl
import subprocess
import sys
import tarfile
import zipfile
from pe_imports import read_imports
from upstream_license_evidence import git_blob

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_wheel(wheel, packages, expected):
    if sha(wheel) != expected:
        raise ValueError('Wheel differs from recorded PyPI/lock hash')
    verified = []
    with zipfile.ZipFile(wheel) as archive:
        for name in archive.namelist():
            relative = PurePosixPath(name)
            if relative.is_absolute() or '..' in relative.parts or '\\' in name:
                raise ValueError('Unsafe wheel member path')
            if name.endswith('/') or name.endswith('.dist-info/RECORD'):
                continue
            path = (packages / name).resolve()
            if not path.is_relative_to(packages.resolve()) or path.read_bytes() != archive.read(name):
                raise ValueError('Installed wheel file differs from original: ' + name)
            verified.append(name)
    return verified


def verify_release_ref(record, version):
    ref = record['release_ref']
    tag_version = ref['ref'].rsplit('/', 1)[-1].removeprefix('v').removeprefix('R_').replace('_', '.')
    commit = record['upstream_commit']
    if tag_version != version:
        raise ValueError('Native license release tag differs from reported version')
    if ref['object']['type'] == 'commit':
        valid = ref['object']['sha'] == commit
    else:
        tag = record.get('tag_object') or {}
        valid = tag.get('sha') == ref['object']['sha'] and tag.get('object', {}).get('type') == 'commit' and tag['object']['sha'] == commit
    url = f'https://github.com/{record["repository"]}/blob/{commit}/{record["source_file"]}'
    if not valid or record['source_url'] != url:
        raise ValueError('Native license tag/commit/source URL mismatch')


def file_version(path):
    library = ctypes.WinDLL('version', use_last_error=True)
    library.GetFileVersionInfoSizeW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_uint32)]
    library.GetFileVersionInfoSizeW.restype = ctypes.c_uint32
    library.GetFileVersionInfoW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    library.VerQueryValueW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_uint32)]
    ignored = ctypes.c_uint32()
    size = library.GetFileVersionInfoSizeW(str(path), ctypes.byref(ignored))
    if not size:
        return None
    data = ctypes.create_string_buffer(size)
    if not library.GetFileVersionInfoW(str(path), 0, size, data):
        raise OSError('Cannot read native file version')
    pointer, length = ctypes.c_void_p(), ctypes.c_uint32()
    if not library.VerQueryValueW(data, '\\', ctypes.byref(pointer), ctypes.byref(length)) or length.value < 52:
        raise ValueError('Invalid native version resource')
    words = ctypes.cast(pointer, ctypes.POINTER(ctypes.c_uint32 * 13)).contents
    if words[0] != 0xfeef04bd:
        raise ValueError('Invalid native version signature')
    return '.'.join(str(value) for value in (words[2] >> 16, words[2] & 65535, words[3] >> 16, words[3] & 65535))


def main():
    if os.name != 'nt' or Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        raise SystemExit('Run with the pinned project Windows .venv Python')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cargo', default='D:/.cargo/bin/cargo.exe')
    parser.add_argument('--rustc', default='D:/.cargo/bin/rustc.exe')
    args = parser.parse_args()
    packages = ROOT / '.venv/Lib/site-packages'
    sources = json.loads((ROOT / 'docs/evidence/python-lock-sources.json').read_text(encoding='utf-8'))
    wheel_record = next(w for package in sources['packages'] if package['name'] == 'osmium'
                        for w in package['wheels'] if w['filename'] == 'osmium-4.3.0-cp312-cp312-win_amd64.whl')
    lock = (ROOT / 'requirements-data.lock').read_text(encoding='utf-8')
    if '--hash=sha256:' + wheel_record['sha256'] not in lock:
        raise ValueError('Original wheel hash absent from data lock')
    wheel = ROOT / 'data/manifests/local/license-archives' / wheel_record['filename']
    original_files = verify_wheel(wheel, packages, wheel_record['sha256'])
    record_files = 0
    with (packages / 'osmium-4.3.0.dist-info/RECORD').open(encoding='utf-8') as stream:
        for name, encoded, _ in csv.reader(stream):
            if not encoded:
                continue
            path = (packages / name).resolve()
            if not path.is_relative_to((ROOT / '.venv').resolve()) or not encoded.startswith('sha256='):
                raise ValueError('Unexpected installed RECORD entry')
            actual = base64.urlsafe_b64encode(hashlib.sha256(path.read_bytes()).digest()).decode().rstrip('=')
            if actual != encoded.split('=', 1)[1]:
                raise ValueError('Installed RECORD mismatch: ' + name)
            record_files += 1
    # Import only after verifying Python sources and native bytes against the pinned wheel.
    import osmium.version
    native_sources = json.loads((ROOT / 'config/native-license-sources.json').read_text(encoding='utf-8'))['components']
    def licenses(name, version):
        source = native_sources.get(name)
        if not source:
            return []
        if source['version'] != version:
            raise ValueError('Native license evidence version differs: ' + name)
        for record in source['license_files']:
            path = (ROOT / record['file']).resolve()
            if not path.is_relative_to((ROOT / 'third_party/licenses').resolve()) or sha(path) != record['sha256']:
                raise ValueError('Native license file hash/path mismatch')
            if record.get('git_blob_sha') and git_blob(path.read_bytes()) != record['git_blob_sha']:
                raise ValueError('Native license Git blob mismatch')
            if record.get('git_blob_sha'):
                verify_release_ref(record, version)
            if record.get('archive_file'):
                archive_path = (ROOT / record['archive_file']).resolve()
                if not archive_path.is_relative_to((ROOT / 'data/manifests/local').resolve()) or sha(archive_path) != record['archive_sha256']:
                    raise ValueError('Native license archive hash/path mismatch')
                with tarfile.open(archive_path, 'r:gz') as archive:
                    if archive.extractfile(record['source_file']).read() != path.read_bytes():
                        raise ValueError('Native license differs from original archive')
        return source['license_files']
    symbols = {'bz2': ('bzip2', 'BZ2_bzlibVersion'), 'libexpat': ('expat', 'XML_ExpatVersion'),
               'lz4': ('lz4', 'LZ4_versionString'), 'zlib1': ('zlib', 'zlibVersion')}
    native, binaries = [], []
    for name in original_files:
        path = packages / name
        if path.suffix.lower() not in ('.pyd', '.dll'):
            continue
        binary = {'file': name, 'sha256': sha(path), **read_imports(path.read_bytes())}
        binaries.append(binary)
        if path.suffix.lower() != '.dll':
            continue
        prefix = path.name.split('-', 1)[0]
        if prefix in symbols:
            component, symbol = symbols[prefix]
            library = ctypes.CDLL(str(path.resolve()))
            function = getattr(library, symbol)
            function.argtypes, function.restype = [], ctypes.c_char_p
            reported = function().decode('ascii')
            version = reported.split(',', 1)[0].removeprefix('expat_')
            evidence = {'kind': 'runtime_export', 'symbol': symbol, 'reported': reported}
        else:
            component, version = prefix, file_version(path)
            evidence = {'kind': 'PE_file_version_resource'}
        native.append({'name': component, 'version': version, 'version_evidence': evidence,
                       'file': name, 'sha256': binary['sha256'], 'license_files': licenses(component, version)})
    for name, attribute in [('libosmium', 'libosmium_version'), ('protozero', 'protozero_version'), ('pybind11', 'pybind11_version')]:
        version = getattr(osmium.version, attribute)
        native.append({'name': name, 'version': version, 'version_evidence': {'kind': 'wheel_producer_declaration',
            'file': 'osmium/version.py', 'sha256': sha(packages / 'osmium/version.py'), 'attribute': attribute},
            'license_files': licenses(name, version)})
    bundled = {Path(binary['file']).name.lower() for binary in binaries}
    external = sorted({name for binary in binaries for name in binary['imports'] + binary['delay_imports'] if name.lower() not in bundled}, key=str.lower)
    def command(arguments):
        return subprocess.run(arguments, check=True, capture_output=True, text=True, encoding='utf-8', timeout=15).stdout.strip()
    node = json.loads(command(['node', '-p', 'JSON.stringify({version:process.version,versions:process.versions,executable:process.execPath})']))
    rust_root = Path(command([args.rustc, '--print', 'sysroot']))
    toolchains = {'python': {'version': sys.version, 'executable_sha256': sha(Path(sys.executable)),
                    'runtime_dll_sha256': sha(Path(sys.base_prefix) / 'python312.dll'), 'openssl': ssl.OPENSSL_VERSION},
                 'node': {'version': node['version'], 'executable_sha256': sha(Path(node['executable'])),
                          'embedded_versions': node['versions'], 'license_files': licenses('node', node['versions']['node'])},
                 'npm': {'version': command(['npm.cmd', '--version'])},
                 'rustc': {'version': command([args.rustc, '-Vv']), 'executable_sha256': sha(rust_root / 'bin/rustc.exe')},
                 'cargo': {'version': command([args.cargo, '-V']), 'executable_sha256': sha(rust_root / 'bin/cargo.exe')}}
    # These are observed installed notices, not a claim to have licensed every toolchain component.
    for tool, files in [('python', [Path(sys.base_prefix) / 'LICENSE.txt']),
                        ('rustc', [rust_root / 'share/doc/rust/licenses/MIT.txt', rust_root / 'share/doc/rust/licenses/Apache-2.0.txt']),
                        ('npm', [Path(node['executable']).parent / 'node_modules/npm/LICENSE'])]:
        notices = []
        for source in files:
            target = ROOT / 'third_party/licenses/toolchain' / (tool + '-' + source.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            notices.append({'file': target.relative_to(ROOT).as_posix(), 'sha256': sha(target)})
        toolchains[tool]['license_files'] = notices
    for filename in ('COPYRIGHT.html', 'COPYRIGHT-library.html'):
        path = rust_root / 'share/doc/rust' / filename
        toolchains['rustc'].setdefault('installed_copyright_fingerprints', []).append({'file': '<rust-sysroot>/share/doc/rust/' + filename, 'sha256': sha(path), 'bytes': path.stat().st_size})
    gaps = [{'component': component['name'], 'reason': 'native_terms_not_retained_or_reviewed'} for component in native if not component['license_files']]
    gaps.extend([{'component': 'native-and-toolchain', 'reason': 'vendor_advisory_checks_and_static_transitive_closure_not_complete'},
                 {'component': 'historical-external-tools', 'reason': 'legacy_osmium_tippecanoe_distribution_review_pending'}])
    report = {'date': datetime.now(timezone.utc).isoformat(), 'platform': 'CPython 3.12 Windows x64',
              'inputs': {name: sha(ROOT / name) for name in ('requirements-data.lock', 'config/native-license-sources.json',
                  'docs/evidence/python-lock-sources.json', 'scripts/native_inventory.py', 'scripts/pe_imports.py')},
              'wheel': {'filename': wheel_record['filename'], 'sha256': wheel_record['sha256'], 'source_url': wheel_record['url'],
                        'original_files_compared': len(original_files), 'installed_record_hashes_checked': record_files,
                        'wheel_metadata': (packages / 'osmium-4.3.0.dist-info/WHEEL').read_text(encoding='utf-8'),
                        'repair_tool_version': (packages / 'osmium-4.3.0.dist-info/DELVEWHEEL').read_text(encoding='utf-8').splitlines()[0],
                        'repair_metadata_sha256': sha(packages / 'osmium-4.3.0.dist-info/DELVEWHEEL')},
              'native_components': native, 'binaries': binaries, 'nonbundled_import_names': external,
              'toolchains': toolchains, 'review_gaps': gaps,
              'limits': ['Exact wheel bytes and import graph, not an independent rebuild or proof of every statically linked dependency.',
                         'Header library versions are wheel-producer declarations, distinct from queried DLL exports.',
                         'Nonbundled imports include Python/Windows runtime contracts; OS/driver provenance is not certified.',
                         'Development tools and wheel DLLs are not served by the map preview or copied into client dist.',
                         'License text retention is not redistribution/legal approval or a completed native vulnerability audit.']}
    output = ROOT / 'docs/evidence/native-tool-inventory.json'
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'original_files_compared': len(original_files), 'binaries': len(binaries),
                      'native_components': len(native), 'toolchains': len(toolchains), 'review_gaps': gaps}))


if __name__ == '__main__':
    main()
