# Limitless Nexus: Scarlet Peach — Catalog

**Branch: `scarlet-peach-catalog`. Keep Scarlet Peach catalog changes on this branch unless explicitly directed otherwise. Do not create alternate or per-user install links.**

## Install manifest

Canonical Nuvio addon URL:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Localhost is development-only: run `npm start`, then use `http://127.0.0.1:7001/manifest.json` for same-device testing.

## Current architecture

Scarlet Peach is the shared adult-animation metadata and subtitle core. Canonical metadata and provider observations remain separate:

1. `data/seed.json` contains curated canonical metadata such as verified MAL `Rx - Hentai` records.
2. Provider harvesters write replaceable observations under `data/imports/providers/*.json`.
3. `scripts/build-snapshot.js` normalizes the seed, merges provider imports, validates schema v2, and publishes the snapshot atomically.
4. Provider observations enrich canonical titles without silently becoming canonical truth.
5. Failed harvests or validation leave the previous Worker deployment as last known good.

Current production catalog sources are **Hanime, HentaiHaven, and HStream**.

## Schema v2

- Stable IDs prefer `mal:` / `anilist:`; provider-only titles use `sp:<provider>:<slug>` until a safe canonical match is known.
- Canonical metadata and provider-specific claims remain separate.
- Censorship supports `censored`, `uncensored`, `mixed`, and `unknown`.
- Provider IDs/slugs, exact episode mappings, language observations, tags, qualities, and verification timestamps can be retained.
- Unknown data stays unknown. Provider importers do not invent metadata.
- Strong provider matches merge into existing identities; ambiguous title-only matches remain separate.
- When duplicate title candidates exist, an exact series/provider slug can safely break the tie only after the title itself already matches.

See `SCHEMA.md` for the full contract.

## Reusable endpoints

The deployed Worker exposes:

- `/health`
- `/schema.json`
- `/dataset.json`
- `/data/current.json`
- normal `catalog` and `meta` routes
- `/subtitles/series/<video-id>.json`
- `/subtitle-proxy.vtt`

The subtitle resource currently exposes HentaiHaven WebVTT tracks independently from HentaiHaven playback. This separation is deliberate: video + audio remain in the provider transport while subtitles are delivered through Nuvio's addon subtitle resource.

## Current production snapshot

Catalog version: **0.5.0**

Validated build on 2026-09-09/10:

- **2,055 published titles**
- **2,034 titles with at least one provider mapping**
- **1,524 titles with Hanime availability**
- **1,036 titles with HentaiHaven availability**
- **861 titles with HStream availability**
- **1,969 provider-only `sp:` titles** across the merged dataset
- censorship: **1,195 censored / 548 uncensored / 42 mixed / 270 unknown**

Counts are observed build statistics, not hard-coded catalog sizes.

## Canonical seed

- 86 curated MyAnimeList records explicitly verified as `Rx - Hentai`.
- MAL supplies stable identity and broad canonical metadata where available.
- MAL is not authoritative for provider availability, detailed adult tags, censorship, dub/sub variants, or stream quality.

## Hanime catalog source

Feed:

`https://scarlet-peach-hanime.limitlessandre.workers.dev/catalog.json`

Latest harvest characteristics:

- 3,393 raw video records
- 1,532 conservatively grouped provider records
- 1,054 multi-episode groups
- 1,524 published titles with a Hanime mapping
- 1,470 `sp:hanime:*` provider-only titles
- provider censorship: 985 censored / 514 uncensored / 19 mixed / 14 unknown

Grouping is conservative and does not blindly convert every trailing number into an episode.

## HentaiHaven catalog source

HentaiHaven is harvested independently from playback using its public read-only WordPress/Madara interfaces on `hentaihaven.vip`.

Latest harvest characteristics:

- **1,053 title records**
- **2,594 numeric episode mappings**
- 18 non-numeric special/bonus episode URLs intentionally skipped because schema v2 episode numbers are integers
- 65 genre terms
- 381 tag terms
- 112 studio/author terms
- 35 release/year terms
- provider censorship: 820 censored / 186 uncensored / 6 mixed / 41 unknown
- 771 records merged into existing identities
- 282 HentaiHaven-only titles created
- 1,036 published titles with a HentaiHaven mapping

Title-level censorship comes from the matched title's taxonomy/classes, never global navigation text.

## HStream catalog source

HStream exposes a compact public read-only API:

`https://hstream.moe/v1/hentai-list`

Scarlet Peach consumes that endpoint directly rather than crawling playback pages.

Latest harvest characteristics:

- **866 HStream series records**
- **2,026 exact episode mappings**
- **0 skipped episode mappings**
- 649 records merged into existing Scarlet Peach identities
- 217 HStream-only titles created
- **861 published titles with an HStream mapping**

The bulk endpoint supplies title, Japanese title, series slug, and exact episode slugs. It does not reliably supply censorship, audio language, subtitle language, quality, studio, or artwork, so those fields deliberately remain unknown unless another trusted source already provides them.

HStream's exact series slug is also used as a safe identity tie-breaker when multiple existing Scarlet Peach records share the same normalized title. For example, `deco-x-deco-the-animation` now merges into the existing Deco identity instead of creating a duplicate.

## Metadata safety

A single canonical title can retain independent observations from all three providers. For example, Deco x Deco currently carries Hanime, HentaiHaven, and HStream mappings under the same Scarlet Peach ID.

If providers disagree, individual claims remain provider-specific and aggregate metadata can become `mixed` rather than arbitrarily choosing a winner.

## Build pipeline

Useful commands:

- `npm test`
- `npm run import:hanime`
- `npm run import:hentaihaven`
- `npm run import:hstream`
- `npm run refresh:providers`
- `npm run build:snapshot`
- `npm run verify:snapshot`
- `npm run refresh:all`
- `npm run import:mal` / `npm run refresh:mal`
- `npm run merge:provider -- <provider-import.json>`

Both push deployment and the daily snapshot workflow run tests, harvest **all three production provider catalogs**, build the normalized snapshot, verify exact mappings/coverage, deploy to Cloudflare, and require Hanime + HentaiHaven + HStream in live health checks.

## Regression fixtures

Deployment is blocked unless key mappings survive:

- `mal:44044` — Jimihen: Hanime + HentaiHaven exact episode mappings
- `mal:368` — Bible Black: Hanime + HentaiHaven exact episode mappings
- `sp:hanime:deco-x-deco-the-animation` — HStream exact series mapping and episode slug `deco-x-deco-the-animation-1`

Coverage gates also require healthy mapped-title counts for all three providers.

## Catalog surface

The visible catalog remains intentionally small:

- Scarlet Peach Search
- Scarlet Peach Latest
- Scarlet Peach All

Detailed metadata carries schema-v2 extension fields such as aliases, tags, studio, censorship, languages, provider mappings, availability, content rating, provenance, and richer episode metadata.

## Long-term direction

Scarlet Peach is intended to become a **single user-facing addon** exposing catalog, metadata, subtitles, and aggregated streams while keeping each site resolver modular internally. The standalone provider repository remains the development/testing path until that unified addon is proven.
