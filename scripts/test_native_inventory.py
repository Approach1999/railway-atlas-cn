import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from native_inventory import verify_wheel, verify_release_ref


class NativeWheelTests(unittest.TestCase):
    def fixture(self, folder, name='osmium/version.py'):
        wheel = folder / 'source.whl'
        with zipfile.ZipFile(wheel, 'w') as archive:
            archive.writestr(name, b'original source')
            archive.writestr('osmium-4.3.0.dist-info/RECORD', b'installer rewrites this list')
        return wheel, hashlib.sha256(wheel.read_bytes()).hexdigest()

    def test_compares_original_bytes_and_excludes_installer_rewritten_record(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wheel, digest = self.fixture(root)
            path = root / 'installed/osmium/version.py'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'original source')
            self.assertEqual(verify_wheel(wheel, root / 'installed', digest), ['osmium/version.py'])

    def test_archive_or_installed_byte_changes_are_rejected_before_native_loading(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wheel, digest = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'Wheel differs'):
                verify_wheel(wheel, root / 'installed', 'wrong')
            path = root / 'installed/osmium/version.py'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'changed executable source')
            with self.assertRaisesRegex(ValueError, 'differs from original'):
                verify_wheel(wheel, root / 'installed', digest)

    def test_traversal_in_wheel_names_is_rejected_without_extraction(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wheel, digest = self.fixture(root, '../outside.py')
            with self.assertRaisesRegex(ValueError, 'Unsafe wheel'):
                verify_wheel(wheel, root / 'installed', digest)

    def test_lightweight_and_annotated_tags_bind_to_exact_native_version(self):
        record = {'release_ref': {'ref': 'refs/tags/R_2_7_3', 'object': {'type': 'commit', 'sha': 'a' * 40}},
                  'upstream_commit': 'a' * 40, 'repository': 'owner/repo', 'source_file': 'COPYING',
                  'source_url': 'https://github.com/owner/repo/blob/' + 'a' * 40 + '/COPYING'}
        verify_release_ref(record, '2.7.3')
        record['release_ref']['object'] = {'type': 'tag', 'sha': 'b' * 40}
        record['tag_object'] = {'sha': 'b' * 40, 'object': {'type': 'commit', 'sha': 'a' * 40}}
        verify_release_ref(record, '2.7.3')
        with self.assertRaisesRegex(ValueError, 'reported version'):
            verify_release_ref(record, '2.7.4')
        record['tag_object']['object']['sha'] = 'c' * 40
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            verify_release_ref(record, '2.7.3')

    def test_native_source_urls_cannot_follow_a_moving_branch(self):
        record = {'release_ref': {'ref': 'refs/tags/v1.0.0', 'object': {'type': 'commit', 'sha': 'a' * 40}},
                  'upstream_commit': 'a' * 40, 'repository': 'owner/repo', 'source_file': 'LICENSE',
                  'source_url': 'https://github.com/owner/repo/blob/main/LICENSE'}
        with self.assertRaisesRegex(ValueError, 'source URL'):
            verify_release_ref(record, '1.0.0')


if __name__ == '__main__':
    unittest.main()
