# Limitless Nexus: Scarlet Peach — Catalog

**Branch: `scarlet-peach-catalog`. Keep Scarlet Peach catalog changes on this branch unless explicitly directed otherwise. Do not create custom, alternate, or per-user install links.**

## Install manifest

Use this canonical Nuvio addon URL:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Localhost is development-only: run `npm start`, then use `http://127.0.0.1:7001/manifest.json` for same-device testing.

## Current architecture

Scarlet Peach is a reusable adult-animation metadata core, not only a display catalog.

The canonical seed and provider observations are intentionally separate:

1. `data/seed.json` contains curated canonical metadata such as verified MAL `Rx - Hentai` records.
2. Provider harvesters write replaceable observations under `data/imports/providers/*.json`.
3. `scripts/build-snapshot.js` normalizes the seed, merges all provider imports in memory, validates the result, and publishes the schema v2 snapshot.
4. Provider data can enrich a canonical title without becoming canonical truth itself.
5. A failed harvest, merge, integrity check, or validation prevents deployment and leaves the previous Worker deployment as last known good.

Current production provider catalog sources are **Hanime** and **HentaiHaven**. Future sources plug into the same provider-import contract.

## Schema v2

Published snapshots use **schema v2**.

- Stable canonical IDs prefer `mal:` / `anilist:`; provider-only titles use `sp:<provider>:<slug>` until a safe canonical match is known.
- Canonical metadata and provider-specific claims are kept separate.
- Censorship supports `censored`, `uncensored`, `mixed`, and `unknown`.
- Language versions, subtitle languages, provider qualities, tags, exact provider slugs/IDs, episode mappings, and verification timestamps can be retained.
- Episode metadata supports title, date, thumbnail, overview, runtime, censorship/languages, and exact provider mappings.
- Unknown values stay unknown; the pipeline does not invent metadata.
- Strong provider matches merge into canonical titles. Ambiguous matches remain separate `sp:` records rather than corrupting identity.
- Provenance is retained so later enrichment/auditing can distinguish MAL claims from provider observations.

See `SCHEMA.md` for the full contract and generic provider import format.

## Reusable data endpoints

The deployed Worker exposes:

- `/health` — version, schema version, generation timestamp, title count, provider counts, censorship counts, mapped-title count, and `sp:` count
- `/schema.json` — machine-readable schema descriptor
- `/dataset.json` — full normalized schema v2 dataset
- `/data/current.json` — alias of `/dataset.json`
- normal Nuvio/Stremio `catalog` and `meta` routes

These endpoints are intended to support future Scarlet Peach-derived catalogs, providers, audit tools, and the planned unified Scarlet Peach addon without scraping Nuvio responses.

## Current production snapshot

Catalog version: **0.4.0**

Latest validated build on 2026-09-09:

- **1,838 published titles**
- **1,811 titles with at least one provider mapping**
- **1,524 titles with Hanime availability**
- **1,036 titles with HentaiHaven availability**
- **1,752 provider-only `sp:` titles** across the merged dataset
- title-level censorship: 1,195 censored, 548 uncensored, 42 mixed, 53 unknown

These are observed build statistics, not hard-coded expected catalog sizes. Upstream catalogs can change.

## Canonical seed

- 86 curated MyAnimeList records explicitly verified as `Rx - Hentai`.
- MAL supplies stable identity, canonical title metadata, aliases where available, studio, broad genres, artwork, year/release date, and episode count.
- MAL is not treated as authoritative for provider availability, detailed adult tags, censorship, dub/sub variants, or stream quality.

## Hanime provider feed

The Hanime resolver Worker exposes a normalized read-only feed:

`https://scarlet-peach-hanime.limitlessandre.workers.dev/catalog.json`

Current harvest characteristics:

- 3,393 raw Hanime video records
- 1,532 conservatively grouped provider records
- 1,054 multi-episode grouped records
- provider-record censorship: 985 censored, 514 uncensored, 19 mixed, 14 unknown
- 1,524 published titles currently carry a Hanime mapping
- 1,470 `sp:hanime:*` provider-only titles remain after conservative canonical merging

Hanime grouping does not blindly convert trailing numbers into episodes. Explicit episode evidence, season safety, and conservative Romanization normalization are used to avoid false merges.

## HentaiHaven provider feed

HentaiHaven is harvested directly from its public read-only WordPress/Madara interfaces on `hentaihaven.vip`. Catalog ingestion is deliberately independent from the playback resolver.

Bulk sources:

- `wp-json/wp/v2/wp-manga` for published title records
- WordPress genre, tag, studio/author, and release taxonomies
- Yoast title sitemaps for title URLs and artwork
- four chapter sitemaps for exact episode URLs

Current harvest characteristics:

- **1,053 published HentaiHaven title records**
- **2,594 numeric episode mappings** discovered from chapter sitemaps
- **18 non-numeric special/bonus episode URLs** detected and intentionally skipped for now because schema v2 episode numbers are integers
- 65 genre terms
- 381 tag terms
- 112 studio/author terms
- 35 release/year terms
- provider-record censorship: 820 censored, 186 uncensored, 6 mixed, 41 unknown

During the validated merge:

- 771 HentaiHaven records merged into existing canonical/Hanime-backed records
- 282 HentaiHaven-only records were created
- 1,036 published Scarlet Peach titles ended with a HentaiHaven provider mapping

HentaiHaven title-level censorship is derived from the title's own taxonomy/classes, not from global navigation text. Provider slugs are retained as conservative aliases so display-title quirks can still merge safely when the stable slug clearly matches an existing canonical title.

## Metadata safety

Provider information can enrich canonical records but does not silently overwrite stronger canonical metadata.

For example, one canonical MAL title can simultaneously retain:

- MAL identity and canonical title metadata
- Hanime exact series/video IDs and episode slugs
- HentaiHaven WordPress/series IDs and exact episode URLs
- separate provider censorship claims
- separate provider tags/studios/artwork
- provider-specific language, subtitle, and quality observations when actually verified

If providers disagree about censorship or other availability metadata, schema v2 preserves the individual claims and can aggregate the title status as `mixed` rather than choosing one arbitrarily.

## Build pipeline

Useful commands:

- `npm test` — routing, schema v2, provider merger, Hanime grouping, HentaiHaven normalization/slug aliases, and regression tests
- `npm run import:hanime` — harvest and stage `data/imports/providers/hanime.json`
- `npm run import:hentaihaven` — harvest WordPress/taxonomy/sitemap data and stage `data/imports/providers/hentaihaven.json`
- `npm run refresh:providers` — harvest both current production provider catalogs
- `npm run build:snapshot` — normalize the canonical seed, layer all staged provider imports, validate, and atomically publish the merged snapshot
- `npm run verify:snapshot` — verify provider coverage plus canonical exact-mapping fixtures
- `npm run refresh:all` — harvest Hanime + HentaiHaven, build, then verify
- `npm run import:mal` / `npm run refresh:mal` — refresh the curated MAL seed
- `npm run merge:provider -- <provider-import.json>` — stage a generic provider import; it does **not** modify `data/seed.json`

## Regression fixtures

Deployment is blocked unless the merged snapshot preserves healthy provider coverage and exact mappings for key canonical titles.

Current cross-provider fixtures include:

- `mal:44044` — Jimihen
  - Hanime exact episode mapping
  - HentaiHaven exact `jimihen-jimiko-o-kae-chau-jun-isei-kouyuu/episode-1` mapping
- `mal:368` — Bible Black
  - Hanime episode mappings
  - HentaiHaven exact `bible-black-1/episode-1` mapping

Coverage gates currently require healthy Hanime and HentaiHaven mapped-title/provider-only counts so a numerically valid but partially harvested dataset cannot deploy silently.

## Deployment

Both push deployment and the daily snapshot workflow run:

1. tests
2. Hanime harvest
3. HentaiHaven harvest
4. merged snapshot build
5. integrity verification
6. Cloudflare deployment
7. live `/health` verification requiring both `hanime` and `hentaihaven`

Cloudflare credentials are stored as GitHub Actions repository secrets. Failed harvests or validation never replace the last known good deployment.

## Catalog surface

The Nuvio addon intentionally keeps the visible catalog surface small:

- Scarlet Peach Search
- Scarlet Peach Latest
- Scarlet Peach All

Detailed meta responses carry Scarlet Peach extension fields such as aliases, tags, studio, censorship, languages, provider mappings, availability, content rating, provenance-ready data, and richer episode metadata. Clients that do not understand the extension fields can ignore them.

## Roadmap

Production catalog/provider sources:

1. Hanime
2. HentaiHaven

Likely next provider:

3. HStream

Later, once the provider lineup is mature, Scarlet Peach is intended to become a **single user-facing addon** exposing catalog, metadata, and aggregated streams while keeping each provider/resolver modular internally. The standalone provider repository remains useful as the development and testing path until that unified addon is proven.
