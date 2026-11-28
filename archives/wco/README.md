# Frozen WCO archives

These are disabled historical Provider Lab entries, not production releases. Existing Lab entries, including WCoflix, remain unchanged.

| Archive | Lab ID | Frozen JavaScript closure |
|---|---|---|
| Master WCO 2.7.1 | limitless-wco-master-271-archive-lab | 15 source files: entry + 14 dependencies |
| Nexus WCO 2.8.1 | limitless-wco-nexus-281-archive-lab | 13 source files: entry + 12 dependencies |
| Unified WCO TEST 0.1.3 | limitless-wco-unified-013-archive-lab | Exact published standalone; reproducible source archive includes 30 frozen snapshots and development modules/tests/fixtures |

Master entry captured at `110123fecd66eba6c19091ecb0bb84a64bfeac36`; Nexus at `38f0d64b5558a93ea0e9074ad056f5321ed7c6d9`. The original Master entry pins an intermediate wrapper at `e076be0a4c4f9df8753338f192672bd7196ec97b`, but that wrapper loads mutable Nexus dependencies. All mutable references were resolved once at the captured Nexus head and frozen. This is a reproducible snapshot of the actual deployed dependency graph at archival time, not a claim that all transitive files were historically pinned when Master was released.

`master-2.7.1.json` and `nexus-2.8.1.json` preserve original source bytes, exact original code URLs, resolved commit refs, SHA-256 and Git blob hashes, and every transitive dependency edge. Standalone archive wrappers serve code requests only from those embedded maps. Unknown code URLs fail closed. Website, TMDB and player/media requests still use the network; these are data dependencies, not executable JavaScript dependencies.

Reproduce legacy standalones from the repository root:

```sh
node archives/wco/build-archives.js --check
```

Without `--check`, the builder writes the two historical providers under `providers/`. No network is used. Differential tests compared each archive against its original frozen dependency graph: identical stream rows and HTTP data request sequence in the ordinary-episode fixture. Settings load was also verified without remote code.

Unified standalone is byte-for-byte TEST 0.1.3, SHA-256 `313efd7892b77fb7cca702856ccd9d0f0a8346df9c41ac0ec7951bc239e0fc61`. Reproduce it with `node archives/wco/build-unified.js --check`. The source-only `unified-test-0.1.3.json` preserves the implementation modules, original builder, provenance and all 30 frozen snapshots. It contains no development reports, fixtures, media URL captures or cookies. The full development/test/fixture/report archive remains local at `/workspace/wco-unified-0.1.3-source.tar.gz`. File hashes are listed in `inventory.json`.

Original manifest entries are retained in `original-manifest-entries.json`. Archive IDs are unique and disabled by default. Historical source behavior—including permissive identity rules, source-advertised quality, empty failures or HTTP-icon diagnostics—is preserved intentionally, not endorsed for autoplay or production use. Unified's hashless diagnostic sentinel is unchanged. Each standalone is independently instantiated; the unique Lab IDs keep settings/provider identity separate.

No active Nexus or Master manifest/provider was changed by archival. Rollback references are the captured branch commits above; the archive provides independently loadable sources if mutable historical dependencies subsequently change. Restore only the necessary WCO manifest entry/file, with a new manifest/cache revision, rather than resetting or merging entire branches.
