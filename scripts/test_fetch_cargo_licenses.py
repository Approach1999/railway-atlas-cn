import hashlib
import io
import tarfile
import unittest
from fetch_cargo_licenses import parse_archive


def fixture(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for name, value in entries:
            raw = value.encode()
            member = tarfile.TarInfo(name)
            member.size = len(raw)
            archive.addfile(member, io.BytesIO(raw))
    raw = stream.getvalue()
    return raw, {'name': 'example', 'version': '1.0.0', 'checksum': hashlib.sha256(raw).hexdigest()}


class CrateEvidenceTests(unittest.TestCase):
    def test_exact_checksum_and_metadata_identity_required(self):
        raw, package = fixture([('example-1.0.0/Cargo.toml', '[package]\nname="example"\nversion="1.0.0"\nlicense="MIT"'),
                                ('example-1.0.0/LICENSE', 'Actual upstream text')])
        metadata, digest, files = parse_archive(raw, package)
        self.assertEqual(metadata['license'], 'MIT')
        self.assertEqual(files, {'LICENSE': b'Actual upstream text'})
        self.assertEqual(len(digest), 64)
        with self.assertRaisesRegex(ValueError, 'checksum'):
            parse_archive(raw + b'different', package)
        raw, package = fixture([('example-1.0.0/Cargo.toml', '[package]\nname="other"\nversion="1.0.0"')])
        with self.assertRaisesRegex(ValueError, 'identity'):
            parse_archive(raw, package)

    def test_unsafe_and_duplicate_paths_rejected_without_extraction(self):
        for names in [['example-1.0.0/../LICENSE'], ['/absolute/LICENSE'],
                      ['example-1.0.0/LICENSE', 'example-1.0.0/LICENSE']]:
            raw, package = fixture([(name, 'text') for name in names])
            with self.subTest(names=names), self.assertRaises(ValueError):
                parse_archive(raw, package)

    def test_license_declaration_does_not_invent_missing_text(self):
        raw, package = fixture([('example-1.0.0/Cargo.toml', '[package]\nname="example"\nversion="1.0.0"\nlicense="MIT"')])
        metadata, _, files = parse_archive(raw, package)
        self.assertEqual(metadata['license'], 'MIT')
        self.assertEqual(files, {})


if __name__ == '__main__':
    unittest.main()
