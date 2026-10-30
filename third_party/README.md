# Retained upstream license evidence

`licenses/cargo/` holds original texts selected from exact crate archives.
`config/license-sources.json` records package/version, archive URL, Cargo.lock
checksum, Cargo.toml hash, original text paths and retained text hashes.
Missing texts remain gaps; no generic templates substitute for upstream files.

`scripts/fetch_cargo_licenses.py` downloads missing locked-cache entries, verifies
checksums and metadata identity, and reads regular tar members without extracting
or executing package code. Archives stay ignored under
`data/manifests/local/license-archives/`. `scripts/license_inventory.py` consumes
the retained texts offline and rejects stale identities/checksums or changed texts.

These third-party files do not select a license for the application's code or
constitute legal approval. See `docs/dependency-licenses.md` and the separate
`docs/dependency-security.md` advisory review.

`licenses/upstream/` additionally retains exact GitHub file bytes, verified by
Git blob ID and SHA-256. `license-provenance/` binds these to crate VCS records,
npm gitHead, or a release commit and explicit native binding target/dependency.
`config/upstream-license-sources.json` indexes those proofs; the offline generator
checks identity, lock integrity, commit, repository and all retained file hashes.
README/AUTHORS files with complete embedded terms are explicitly version/hash
scoped in `config/package-license-files.json`; they are not generic templates.
