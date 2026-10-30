"""Fetch verified official packages and extract them without an installation.

Uses Windows' existing libarchive/tar. Does not execute installer stubs, change
the default browser or overwrite an existing extracted runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import subprocess
import urllib.request
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def embedded_archive(data):
    position = 0; matches = []
    while True:
        index = data.find(bytes.fromhex('377abcaf271c'), position)
        if index < 0:
            break
        position = index + 1
        if index + 32 > len(data):
            continue
        crc, offset, size, next_crc = struct.unpack('<IQQI', data[index + 8:index + 32])
        low = index + 32 + offset; high = low + size
        if zlib.crc32(data[index + 12:index + 32]) == crc and high <= len(data) and zlib.crc32(data[low:high]) == next_crc:
            matches.append(index)
    if len(matches) != 1:
        raise ValueError('Expected one CRC-validated embedded 7z archive')
    return data[matches[0]:]

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--version', required=True)
    parser.add_argument('--fetch', action='store_true', help='Download missing packages from pinned URLs')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'config/firefox-test-runtimes.json').read_text())
    chosen = next(p for p in manifest['packages'] if p['file'] == 'firefox-' + args.version + '.exe')
    driver = next(p for p in manifest['packages'] if p['file'] == 'geckodriver.zip')
    folder = ROOT / 'data/manifests/local/firefox-runtime'; folder.mkdir(parents=True, exist_ok=True)
    for package in [chosen, driver]:
        path = folder / package['file']
        if not path.is_file():
            if not args.fetch:
                raise FileNotFoundError('Use --fetch for ' + package['file'])
            with urllib.request.urlopen(package['source'], timeout=60) as response:
                content = response.read()
            if hashlib.sha256(content).hexdigest() != package['sha256']:
                raise ValueError('Download checksum differs: ' + package['file'])
            path.write_bytes(content)
        if digest(path) != package['sha256']:
            raise ValueError('Cached package checksum differs: ' + package['file'])
    target = (folder / args.version).resolve()
    if not target.is_relative_to(folder.resolve()) or target.exists():
        raise ValueError('Extraction requires a new directory within the runtime folder')
    archive = folder / (args.version + '-payload.7z')
    archive.write_bytes(embedded_archive((folder / chosen['file']).read_bytes()))
    names = subprocess.check_output(['tar', '-tf', str(archive)], text=True).splitlines()
    for name in names:
        part = PurePosixPath(name.replace('\\', '/'))
        if part.is_absolute() or '..' in part.parts or ':' in name or part.parts[0] not in ['core', 'setup.exe']:
            raise ValueError('Unsafe archive path: ' + name)
    target.mkdir(); subprocess.run(['tar', '-xf', str(archive), '-C', str(target)], check=True)
    with zipfile.ZipFile(folder / driver['file']) as zipped:
        content = zipped.read('geckodriver.exe')
    driver_path = folder / 'geckodriver.exe'
    if driver_path.is_file() and digest(driver_path) != hashlib.sha256(content).hexdigest():
        raise ValueError('Existing driver differs from the verified archive')
    driver_path.write_bytes(content)
    print(json.dumps({'directory': str(target), 'binary_sha256': digest(target / 'core/firefox.exe'), 'driver_sha256': digest(driver_path)}))

if __name__ == '__main__':
    main()
