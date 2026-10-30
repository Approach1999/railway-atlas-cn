"""Validate retained fixed-commit license evidence against current package locks."""
import hashlib
import json
import re


def git_blob(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def repository_name(value):
    if isinstance(value, dict):
        value = value.get('url')
    match = re.fullmatch(r'(?:git\+)?(?:https?|git)://github\.com/([\w.-]+/[\w.-]+?)(?:\.git)?/?', value or '')
    return match[1].lower() if match else None


def apply_upstream(root, components, texts, inputs):
    manifest_path = root / 'config/upstream-license-sources.json'
    if not manifest_path.is_file():
        return
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    inputs['config/upstream-license-sources.json'] = digest(manifest_path.read_bytes())
    by_id = {component['id']: component for component in components}

    def retained(record):
        path = (root / record['file']).resolve()
        if not path.is_relative_to((root / 'third_party').resolve()):
            raise ValueError('Upstream evidence path escapes third_party')
        raw = path.read_bytes()
        if digest(raw) != record['sha256']:
            raise ValueError('Upstream evidence file hash mismatch')
        inputs[record['file']] = record['sha256']
        if record.get('git_blob_sha') and git_blob(raw) != record['git_blob_sha']:
            raise ValueError('Upstream Git blob mismatch')
        return raw

    for identity, source in json.loads(manifest_path.read_text(encoding='utf-8'))['components'].items():
        component = by_id[identity]
        if any(source[key] != component[key] for key in ('ecosystem', 'name', 'version')):
            raise ValueError('Upstream evidence package identity mismatch')
        commit = source['upstream_commit']
        if not re.fullmatch('[0-9a-f]{40}', commit) or not re.fullmatch(r'[\w.-]+/[\w.-]+', source['repository']):
            raise ValueError('Invalid upstream repository/commit')
        proof = json.loads(retained(source['version_proof']).decode('utf-8'))
        if proof['upstream_commit'] != commit:
            raise ValueError('Upstream version proof commit mismatch')
        if source['kind'] == 'crate_vcs':
            if (source['checksum'] != component['checksum'] or proof['archive_sha256'] != component['checksum']
                    or proof['crate_vcs_info']['git']['sha1'] != commit
                    or repository_name(component.get('repository')) != source['repository'].lower()):
                raise ValueError('Crate version proof differs from lock/commit')
        else:
            metadata = proof['registry_metadata']
            if (metadata['name'] != component['name'] or metadata['version'] != component['version']
                    or metadata['dist']['integrity'] != component['integrity'] or source['integrity'] != component['integrity']
                    or repository_name(metadata.get('repository') or metadata.get('homepage')) != source['repository'].lower()):
                raise ValueError('npm version proof differs from lock')
            if source['kind'] == 'npm_git_head':
                if metadata['gitHead'] != commit:
                    raise ValueError('npm gitHead differs from retained commit')
            elif source['kind'] == 'npm_release_binding':
                release = proof['release_ref']
                package = json.loads(retained(proof['source_package']).decode('utf-8'))
                parent = proof['parent_registry_metadata']
                if (release['object']['sha'] != commit or release['object']['type'] != 'commit'
                        or release['ref'] != 'refs/tags/v' + component['version']
                        or parent['version'] != component['version']
                        or parent['optionalDependencies'].get(component['name']) != component['version']
                        or package['name'] != parent['name'] or package['version'] != component['version']
                        or not component['name'].startswith(package['napi']['packageName'] + '-')
                        or proof['target'] not in package['napi']['targets']
                        or package['license'] != component['license_declared']):
                    raise ValueError('Native binding release/source relationship mismatch')
            else:
                raise ValueError('Unsupported upstream version proof')
        records = []
        for record in source['license_files']:
            expected_url = f'https://github.com/{source["repository"]}/blob/{commit}/{record["source_file"]}'
            if record['source_url'] != expected_url or not record.get('git_blob_sha'):
                raise ValueError('License source URL/blob is not pinned to verified commit')
            raw = retained(record)
            texts.setdefault(record['sha256'], {'text': raw.decode('utf-8'), 'components': []})['components'].append(identity)
            records.append({'file': record['source_file'], 'project_file': record['file'], 'sha256': record['sha256'],
                            'upstream_url': record['source_url'], 'git_blob_sha': record['git_blob_sha']})
        if not records:
            raise ValueError('Upstream evidence has no original license text')
        component['license_files'].extend(records)
        component['upstream_license_evidence'] = {key: source[key] for key in ('kind', 'repository', 'upstream_commit', 'version_proof')}
