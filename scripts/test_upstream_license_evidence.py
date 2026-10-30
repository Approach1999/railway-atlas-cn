import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from upstream_license_evidence import apply_upstream, git_blob


class UpstreamEvidenceTests(unittest.TestCase):
    def fixture(self, root):
        commit = 'a' * 40
        text = root / 'third_party/licenses/upstream/example.LICENSE'
        text.parent.mkdir(parents=True)
        text.write_bytes(b'Exact upstream terms\n')
        proof = root / 'third_party/proof.json'
        proof.write_text(json.dumps({'upstream_commit': commit, 'registry_metadata': {
            'name': 'example', 'version': '1', 'gitHead': commit, 'repository': 'https://github.com/owner/repo.git', 'dist': {'integrity': 'locked'}}}))
        record = lambda path: {'file': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        license_record = {**record(text), 'source_file': 'LICENSE', 'source_url': f'https://github.com/owner/repo/blob/{commit}/LICENSE', 'git_blob_sha': git_blob(text.read_bytes())}
        source = {'kind': 'npm_git_head', 'ecosystem': 'npm', 'name': 'example', 'version': '1', 'integrity': 'locked',
                  'repository': 'owner/repo', 'upstream_commit': commit, 'version_proof': record(proof), 'license_files': [license_record]}
        (root / 'config').mkdir()
        manifest = root / 'config/upstream-license-sources.json'
        component = {'id': 'example', 'ecosystem': 'npm', 'name': 'example', 'version': '1', 'integrity': 'locked', 'license_files': []}
        def save():
            manifest.write_text(json.dumps({'components': {'example': source}}))
        save()
        return component, source, text, proof, save

    def test_correct_version_commit_and_blob_attach_original_terms(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            component, source, *_ = self.fixture(root)
            texts, inputs = {}, {}
            apply_upstream(root, [component], texts, inputs)
            self.assertEqual(component['license_files'][0]['git_blob_sha'], source['license_files'][0]['git_blob_sha'])
            self.assertEqual(next(iter(texts.values()))['text'], 'Exact upstream terms\n')
            self.assertIn('third_party/proof.json', inputs)

    def test_changed_license_and_wrong_locked_integrity_are_rejected(self):
        for mutation in ['text', 'lock', 'git_blob', 'commit', 'repository']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                component, source, text, _, save = self.fixture(root)
                if mutation == 'text':
                    text.write_bytes(b'Tampered')
                elif mutation == 'lock':
                    component['integrity'] = 'different package'
                elif mutation == 'git_blob':
                    source['license_files'][0]['git_blob_sha'] = 'b' * 40
                elif mutation == 'commit':
                    source['upstream_commit'] = 'b' * 40
                else:
                    source['repository'] = 'unrelated/project'
                save()
                with self.assertRaises(ValueError):
                    apply_upstream(root, [component], {}, {})

    def test_source_url_and_retained_paths_cannot_escape_the_bound_source(self):
        for mutation in ['url', 'path']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                component, source, _, _, save = self.fixture(root)
                if mutation == 'url':
                    source['license_files'][0]['source_url'] = 'https://github.com/owner/repo/blob/latest/LICENSE'
                else:
                    source['version_proof']['file'] = '../elsewhere'
                save()
                with self.assertRaises(ValueError):
                    apply_upstream(root, [component], {}, {})

    def test_binding_license_requires_tag_target_and_exact_parent_dependency(self):
        for mutation in [None, 'tag', 'target', 'dependency']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                component, source, _, proof_file, save = self.fixture(root)
                component.update(name='@example/binding-win32-x64-msvc', license_declared='MIT')
                source.update(name=component['name'], kind='npm_release_binding')
                proof = json.loads(proof_file.read_text())
                proof['registry_metadata']['name'] = component['name']
                source_package = root / 'third_party/source.json'
                source_package.write_text(json.dumps({'name': 'parent', 'version': '1', 'license': 'MIT',
                    'napi': {'packageName': '@example/binding', 'targets': ['x86_64-pc-windows-msvc']}}))
                proof.update(target='x86_64-pc-windows-msvc', release_ref={'ref': 'refs/tags/v1', 'object': {'sha': 'a' * 40, 'type': 'commit'}},
                    parent_registry_metadata={'name': 'parent', 'version': '1', 'optionalDependencies': {component['name']: '1'}},
                    source_package={'file': 'third_party/source.json', 'sha256': hashlib.sha256(source_package.read_bytes()).hexdigest(), 'git_blob_sha': git_blob(source_package.read_bytes())})
                if mutation == 'tag':
                    proof['release_ref']['object']['sha'] = 'b' * 40
                elif mutation == 'target':
                    proof['target'] = 'unrelated-platform'
                elif mutation == 'dependency':
                    proof['parent_registry_metadata']['optionalDependencies'][component['name']] = '2'
                proof_file.write_text(json.dumps(proof))
                source['version_proof']['sha256'] = hashlib.sha256(proof_file.read_bytes()).hexdigest()
                save()
                if mutation:
                    with self.assertRaisesRegex(ValueError, 'relationship'):
                        apply_upstream(root, [component], {}, {})
                else:
                    apply_upstream(root, [component], {}, {})
                    self.assertEqual(len(component['license_files']), 1)


if __name__ == '__main__':
    unittest.main()
