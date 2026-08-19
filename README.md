# Limitless Nuviostream

A single Nuvio plugin repository that combines several upstream provider repositories, removes duplicate providers, and filters out providers that do not advertise English, Japanese, Korean, or Chinese content.

## What this does

- Pulls the upstream provider manifests listed in `sources.json`.
- Converts every provider's relative JavaScript filename into an absolute upstream URL.
- Deduplicates providers by normalized provider ID, ignoring capitalization and punctuation differences.
- Chooses the highest provider version when duplicate providers are found.
- Uses source priority as a tie-breaker when versions match.
- Writes every duplicate decision to `duplicates.json` so nothing is hidden.
- Filters providers to English, Japanese, Korean, or Chinese when language metadata is available.
- Keeps providers with missing language metadata for review rather than accidentally deleting useful sources.
- Records language removals and unknown-language providers in `language-filter-report.json`.
- Updates automatically once per day with GitHub Actions.
- Stops the automatic update if an upstream source fails instead of silently publishing a partial manifest.

The actual provider JavaScript remains hosted by its original upstream repository. This repository only generates the master manifest.

## Install in Nuvio

After the first GitHub Action finishes successfully, install:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/main/manifest.json
```

You only need this one repository in Nuvio. Remove the eight separate upstream repository entries after verifying the master repository works.

## Included upstream repositories

1. All-in-One-Nuvio
2. Asura Synthesis
3. CENSORED's Repo
4. Eclipsia
5. Michat88 Repo
6. Phisher's Repo
7. Ray's Plugins
8. Yoru's Repo

See `sources.json` for their live manifest URLs.

## Choosing a different duplicate

Normally the newest provider version wins. If a particular implementation works better from another source, edit `overrides.json`.

`prefer_source` pins the selected copy of a duplicate provider.

`keep_separate` tells the builder not to merge that provider across repositories.

`disable` keeps a provider in the manifest but makes it disabled by default.

`exclude` removes a provider entirely from the generated manifest.

The `language_filter` section is currently configured for `en`, `ja`, `ko`, and `zh`. A provider with declared language metadata must include at least one of those languages to stay in the master manifest. Providers that do not declare language metadata are temporarily kept and listed in `language-filter-report.json` so they can be reviewed manually.

## Files

- `manifest.json`: generated Nuvio manifest.
- `sources.json`: upstream repositories.
- `overrides.json`: manual duplicate/enable rules.
- `duplicates.json`: generated audit of duplicate decisions.
- `build-status.json`: generated source-health summary.
- `language-filter-report.json`: generated audit of language-based exclusions and unknown metadata.
- `scripts/build_manifest.py`: dependency-free manifest builder.
- `.github/workflows/update-manifest.yml`: automatic updater.

## Safety note

This project reduces duplicate provider execution, but it does not guarantee that every upstream provider itself is stable. If Nuvio still crashes with the deduplicated repository, `overrides.json` gives us a simple way to disable or exclude suspect providers while keeping one clean manifest URL.
