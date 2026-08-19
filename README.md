# Limitless Nuviostream

Limitless Nuviostream builds two clean provider feeds from one GitHub project:

1. **Limitless Nuviostream** — native Nuvio JavaScript providers.
2. **Limitless CloudStream** — filtered CloudStream `.cs3` extensions for NuvioTV's compatibility layer.

Both feeds remove duplicate provider entries and focus on English, Japanese, Korean, and Chinese content.

## Native Nuvio feed

The native builder:

- Pulls the upstream provider manifests listed in `sources.json`.
- Converts every provider's relative JavaScript filename into an absolute upstream URL.
- Deduplicates providers by normalized provider ID and provider name.
- Chooses the highest provider version when duplicates are found.
- Uses source priority as a tie-breaker when versions match.
- Filters providers to English, Japanese, Korean, or Chinese when language metadata is available.
- Writes duplicate and language decisions to audit files.

The actual JavaScript remains hosted by its original upstream repository.

### Install native providers

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/main/manifest.json
```

This replaces the eight separate Nuvio provider repositories used to build the master feed.

## CloudStream compatibility feed

CloudStream's MegaRepo normally installs a `MegaProvider.cs3` extension whose job is to add many CloudStream repositories inside CloudStream itself. NuvioTV does not need that installer plugin. Instead, this project performs the aggregation during the GitHub Action build.

The CloudStream builder:

- Reads CloudStream's public repository database.
- Follows each compatible `repo.json` and its `pluginLists` files.
- Collects the upstream `.cs3` extension metadata and preserves each original download URL.
- Excludes the MegaProvider repository-installer plugin itself.
- Removes inactive extensions by default.
- Filters languages to English, Japanese, Korean, and Chinese, while keeping explicitly multilingual extensions.
- Deduplicates by normalized `internalName`, then by normalized display name.
- Prefers newer plugin versions and verified repositories when duplicates overlap.
- Uses a metadata cache so a temporarily unavailable upstream repository does not immediately erase previously known providers.
- Generates reports for failed repositories, duplicates, language filtering, and cache use.

No `.cs3` binaries are copied into this repository. The generated feed points NuvioTV directly to the original upstream extension URLs.

### Install CloudStream providers

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/main/cloudstream-repo.json
```

**Platform note:** this feed targets NuvioTV's external DEX/CloudStream compatibility layer. Nuvio Mobile and Nuvio Desktop should be tested separately and should not be assumed to support CloudStream `.cs3` extensions in the same way.

## Included native upstream repositories

1. All-in-One-Nuvio
2. Asura Synthesis
3. CENSORED's Repo
4. Eclipsia
5. Michat88 Repo
6. Phisher's Repo
7. Ray's Plugins
8. Yoru's Repo

See `sources.json` for their live manifest URLs.

## Native provider overrides

Normally the newest provider version wins. If a particular implementation works better from another source, edit `overrides.json`.

- `prefer_source` pins the selected copy of a duplicate provider.
- `keep_separate` tells the builder not to merge that provider across repositories.
- `disable` keeps a provider in the manifest but makes it disabled by default.
- `exclude` removes a provider entirely from the generated manifest.
- `language_filter` controls the native language allow-list.

## CloudStream configuration

`cloudstream-config.json` controls the CloudStream aggregation. It currently:

- allows `en`, `ja`, `ko`, and `zh`;
- keeps explicitly multilingual providers;
- temporarily keeps providers with missing language metadata so they can be audited;
- excludes inactive extensions;
- excludes `MegaProvider` itself;
- excludes MegaRepo's installer repository from recursive aggregation.

## Generated files

### Native Nuvio

- `manifest.json` — generated Nuvio manifest.
- `duplicates.json` — duplicate-selection audit.
- `build-status.json` — native source-health summary.
- `language-filter-report.json` — native language audit.

### CloudStream

- `cloudstream-repo.json` — NuvioTV-installable CloudStream repository manifest.
- `cloudstream-plugins.json` — deduplicated CloudStream extension list.
- `cloudstream-duplicates.json` — CloudStream duplicate-selection audit.
- `cloudstream-build-status.json` — repository and provider-count summary.
- `cloudstream-language-filter-report.json` — CloudStream language audit.
- `cloudstream-source-cache.json` — last-known-good extension metadata for temporarily unavailable repos.

### Builder files

- `sources.json` — native upstream repositories.
- `overrides.json` — native manual rules.
- `cloudstream-config.json` — CloudStream aggregation rules.
- `scripts/build_manifest.py` — native manifest builder.
- `scripts/build_cloudstream.py` — CloudStream aggregation builder.
- `.github/workflows/update-manifest.yml` — daily and on-change automatic updater.

## Safety note

Reducing duplicate provider execution should lower unnecessary load, but it cannot guarantee that every upstream provider or extension is stable. The audit files make it possible to identify and remove troublesome providers without changing the public install URLs.
