import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import license_inventory as inventory


class LicenseInventoryTests(unittest.TestCase):
    def fixture(self, root):
        for app in ('client', 'probe'):
            folder = root / 'apps/web' / app
            folder.mkdir(parents=True)
            packages = {'': {'name': app}, 'node_modules/example': {'version': '1.0.0', 'license': 'MIT'},
                        'node_modules/optional-platform': {'version': '1.0.0', 'license': 'MIT', 'optional': True}}
            (folder / 'package-lock.json').write_text(json.dumps({'packages': packages}))
            package = folder / 'node_modules/example'
            package.mkdir(parents=True)
            (package / 'package.json').write_text(json.dumps({'name': 'example', 'version': '1.0.0'}))
            (package / 'LICENSE').write_text('Copyright Example\nObserved upstream text.\n')
        (root / 'Cargo.lock').write_text('version = 4\n[[package]]\nname="missing-crate"\nversion="1.0.0"\nsource="registry+fixture"\nchecksum="fixture"\n')
        (root / 'requirements-data.txt').write_text('osmium==4.3.0\n')
        (root / 'requirements-data.lock').write_text('osmium==4.3.0 --hash=sha256:fixture\n')
        (root / 'config').mkdir()
        (root / 'config/third-party-assets.json').write_text('{"assets":[]}')
        packages = root / 'python'
        metadata = packages / 'osmium-4.3.0.dist-info'
        metadata.mkdir(parents=True)
        (metadata / 'METADATA').write_text('Name: osmium\nVersion: 4.3.0\nLicense: BSD-2-Clause\n')
        (metadata / 'LICENSE').write_text('BSD source text\n')
        return packages

    def test_missing_cache_is_explicit_and_optional_platforms_are_distinct(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packages = self.fixture(root)
            with patch.object(inventory, 'ROOT', root):
                data, texts = inventory.build_inventory(root / 'cargo', packages)
                again, again_texts = inventory.build_inventory(root / 'cargo', packages)
            self.assertEqual(data, again)
            self.assertEqual(texts, again_texts)
            self.assertEqual(data['code_license'], 'unselected')
            self.assertEqual(data['gaps'], [{'component': 'cargo:missing-crate@1.0.0', 'reason': 'locked_crate_not_in_local_source_cache'}])
            self.assertEqual(len(texts), 2)
            notice = inventory.render_notices(data, texts).decode('utf-8')
            self.assertIn('npm:client:node_modules/example@1.0.0', notice)
            self.assertIn('npm:probe:node_modules/example@1.0.0', notice)
            self.assertIn('UNRESOLVED LOCAL EVIDENCE GAPS', notice)
            self.assertEqual(notice.count('Observed upstream text.'), 1)

    def test_installed_version_drift_stops_inventory_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packages = self.fixture(root)
            (root / 'apps/web/client/node_modules/example/package.json').write_text('{"name":"example","version":"2.0.0"}')
            with patch.object(inventory, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'differs from lock'):
                    inventory.build_inventory(root / 'cargo', packages)

    def test_python_transitive_version_drift_stops_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packages = self.fixture(root)
            (root / 'requirements-data.lock').write_text('osmium==4.3.0\npip==26.2\n')
            metadata = packages / 'pip-26.0.1.dist-info'
            metadata.mkdir()
            (metadata / 'METADATA').write_text('Name: pip\nVersion: 26.0.1\nLicense: MIT\n')
            with patch.object(inventory, 'ROOT', root), self.assertRaisesRegex(ValueError, 'environment differs from lock'):
                inventory.build_inventory(root / 'cargo', packages)

    def test_archive_evidence_is_bound_to_lock_and_original_text_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packages = self.fixture(root)
            license_file = root / 'third_party/licenses/cargo/example/LICENSE'
            license_file.parent.mkdir(parents=True)
            license_file.write_bytes(b'Exact original license')
            record = {'ecosystem': 'cargo', 'name': 'missing-crate', 'version': '1.0.0',
                      'archive_sha256': 'fixture', 'archive_url': 'https://example.test/exact.crate',
                      'cargo_metadata_sha256': 'metadata', 'retrieved_utc': 'fixture', 'license_declared': 'MIT',
                      'license_files': [{'source_file': 'LICENSE', 'file': license_file.relative_to(root).as_posix(),
                                         'sha256': hashlib.sha256(license_file.read_bytes()).hexdigest()}]}
            config = root / 'config/license-sources.json'
            config.write_text(json.dumps({'components': {'cargo:missing-crate@1.0.0': record}}))
            with patch.object(inventory, 'ROOT', root):
                data, _ = inventory.build_inventory(root / 'cargo', packages)
                self.assertEqual(data['gaps'], [])
                license_file.write_bytes(b'Changed')
                with self.assertRaisesRegex(ValueError, 'path/hash'):
                    inventory.build_inventory(root / 'cargo', packages)
                record['archive_sha256'] = 'wrong'
                config.write_text(json.dumps({'components': {'cargo:missing-crate@1.0.0': record}}))
                with self.assertRaisesRegex(ValueError, 'identity/checksum'):
                    inventory.build_inventory(root / 'cargo', packages)

    def test_embedded_readme_terms_are_version_scoped_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packages = self.fixture(root)
            package = root / 'apps/web/client/node_modules/example'
            (package / 'LICENSE').unlink()
            readme = package / 'README.md'
            readme.write_bytes(b'Actual package documentation and full original terms')
            (root / 'config/package-license-files.json').write_text(json.dumps({'packages': {'npm:example@1.0.0': [
                {'file': 'README.md', 'sha256': hashlib.sha256(readme.read_bytes()).hexdigest()}]}}))
            # The same version in probe must also carry the configured exact source text.
            (root / 'apps/web/probe/node_modules/example/README.md').write_bytes(readme.read_bytes())
            with patch.object(inventory, 'ROOT', root):
                data, _ = inventory.build_inventory(root / 'cargo', packages)
                component = next(c for c in data['components'] if c['id'] == 'npm:client:node_modules/example@1.0.0')
                self.assertEqual(component['license_files'][0]['file'], 'README.md')
                readme.write_bytes(b'Changed')
                with self.assertRaisesRegex(ValueError, 'Embedded license'):
                    inventory.build_inventory(root / 'cargo', packages)


    def test_font_asset_license_and_payload_are_bound_to_fingerprints(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); packages = self.fixture(root)
            font = root / 'font.woff2'; font.write_bytes(b'fixture-font')
            license_file = root / 'font-license.txt'; license_file.write_text('Exact font terms')
            manifest = root / 'font.json'; manifest.write_text(json.dumps({'font_sha256': inventory.sha(font)}))
            assets = {'assets': [{'id': 'font-fixture', 'font_file': 'font.woff2', 'font_sha256': inventory.sha(font),
                                 'evidence_manifest': 'font.json', 'license_files': [{'project_file': 'font-license.txt', 'sha256': inventory.sha(license_file)}]}]}
            (root / 'config/third-party-assets.json').write_text(json.dumps(assets))
            with patch.object(inventory, 'ROOT', root):
                data, texts = inventory.build_inventory(root / 'cargo', packages)
                self.assertIn('asset:font-fixture', texts[inventory.sha(license_file)]['components'])
                font.write_bytes(b'changed-font')
                with self.assertRaisesRegex(ValueError, 'Font asset checksum'):
                    inventory.build_inventory(root / 'cargo', packages)

    def test_font_tool_lock_and_archived_metadata_are_verified(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); packages = self.fixture(root)
            lock = root / 'requirements-fonts.lock'; lock.write_text('fonttools==1.2.3 --hash=sha256:fixture\n')
            metadata = root / 'font.METADATA'; metadata.write_text('Name: fonttools\nVersion: 1.2.3\n')
            license_file = root / 'third_party/licenses/font/LICENSE'; license_file.parent.mkdir(parents=True); license_file.write_text('Original terms')
            config = {'lock_sha256': inventory.sha(lock), 'components': [{'id': 'python:fonttools@1.2.3', 'ecosystem': 'python', 'name': 'fonttools', 'version': '1.2.3',
                      'license_declared': 'MIT', 'sha256': 'fixture', 'filename': 'fixture.whl', 'source': 'https://example.test/exact.whl',
                      'metadata_file': 'font.METADATA', 'metadata_sha256': inventory.sha(metadata),
                      'license_files': [{'project_file': 'third_party/licenses/font/LICENSE', 'sha256': inventory.sha(license_file)}]}]}
            (root / 'config/font-build-tools.json').write_text(json.dumps(config))
            with patch.object(inventory, 'ROOT', root):
                data, _ = inventory.build_inventory(root / 'cargo', packages)
                self.assertEqual(next(c for c in data['components'] if c['name'] == 'fonttools')['scope'], 'offline-font-subset')
                metadata.write_text('Name: fonttools\nVersion: 9.9.9\n')
                with self.assertRaisesRegex(ValueError, 'Font tool metadata'):
                    inventory.build_inventory(root / 'cargo', packages)
                lock.write_text('fonttools==9.9.9\n')
                with self.assertRaisesRegex(ValueError, 'Font build lock'):
                    inventory.build_inventory(root / 'cargo', packages)

if __name__ == '__main__':
    unittest.main()
