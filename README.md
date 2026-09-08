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
3. `scripts/build-snapshot.js` normalizes the seed, merges provider imports in memory, validates the result, and publishes the schema v2 snapshot.
4. The canonical seed is never permanently contaminated by provider-specific catalog data.
5. A failed harvest, merge, integrity check, or validation prevents deployment and leaves the previous Worker deployment as last known good.

This lets Hanime, HentaiSea, MuchoHentai, and future providers enrich the same catalog without turning provider data into canonical truth.

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

See [`SCHEMA.md`](./SCHEMA.md) for the full contract and generic provider import format.

## Reusable data endpoints

The deployed Worker exposes:

- `/health` — version, schema version, generation timestamp, title count, provider counts, censorship counts, mapped-title count, and `sp:` count
- `/schema.json` — machine-readable schema descriptor
- `/dataset.json` — full normalized schema v2 dataset
- `/data/current.json` — alias of `/dataset.json`
- normal Nuvio/Stremio `catalog` and `meta` routes

These endpoints are intended to support future Scarlet Peach-derived catalogs, providers, audit tools, and metadata enrichment jobs without scraping Nuvio responses.

## Current source coverage

### Canonical seed

- 86 curated MyAnimeList records explicitly verified as `Rx - Hentai`.
- MAL supplies stable identity, canonical title metadata, aliases where available, studio, broad genres, artwork, year/release date, and episode count.
- MAL is not treated as authoritative for provider availability, detailed adult tags, censorship, dub/sub variants, or stream quality.

### Hanime provider feed

The working Hanime resolver Worker now exposes a normalized read-only catalog feed:

`https://scarlet-peach-hanime.limitlessandre.workers.dev/catalog.json`

The first production harvest on 2026-09-08 reported:

- 3,393 raw Hanime video records
- 1,532 grouped Scarlet Peach provider records after conservative episode/season grouping
- 1,054 multi-episode grouped records
- provider-record censorship classification: 985 censored, 514 uncensored, 19 mixed, 14 unknown

The merged production snapshot remained at 1,556 titles after the conservative season pass:

- 62 Hanime records matched existing canonical records during that build
- 1,470 provider-only `sp:hanime:*` titles were created
- 1,524 published titles had a Hanime provider mapping
- title-level censorship distribution: 978 censored, 511 uncensored, 21 mixed, 46 unknown

These are observed build statistics, not hard-coded expected catalog sizes. Upstream data can change.

## Hanime grouping and identity rules

Hanime video names are not blindly converted into series.

- Explicit episode suffixes can group into one title.
- Bare trailing numbers group only when multiple distinct episodes provide evidence for the grouping.
- A lone title that merely ends in a number stays standalone.
- A lone `Season 1` can collapse to the base title when it is the only observed season, which allows cases such as Jimihen to merge into the canonical MAL record.
- When multiple explicit seasons exist, Scarlet Peach keeps those season identities separate rather than assuming they are episodes of one title.
- Romanization normalization handles conservative variants such as `wo` versus `o`, punctuation, and joined/split words without broad fuzzy merging.

## Metadata safety

Provider information can enrich canonical records but does not silently overwrite stronger canonical metadata.

For example, a title can retain a MAL canonical identity while Hanime supplies:

- exact provider series/video IDs and slugs
- provider title/aliases
- tags and brand/studio observations
- censorship status
- artwork not otherwise available
- release information
- exact episode-to-provider mapping
- language/subtitle/quality information when the provider feed actually verifies it

If different providers later disagree about censorship or other availability metadata, schema v2 can preserve the provider-specific claims and aggregate the canonical status as `mixed` rather than choosing one arbitrarily.

## Build pipeline

- `npm test` — routing, schema v2, provider merger, Hanime grouping, Jimihen romanization, Bible Black episode grouping, and season-safety tests
- `npm run import:hanime` — download the normalized Hanime Worker feed, reject suspiciously small responses, conservatively group videos, and stage `data/imports/providers/hanime.json`
- `npm run build:snapshot` — normalize the canonical seed, layer all staged provider imports, validate, and atomically publish the merged snapshot
- `npm run verify:snapshot` — require healthy Hanime coverage and exact Hanime episode mappings for the canonical Jimihen and Bible Black regression fixtures
- `npm run refresh:hanime` — harvest Hanime, build, then verify
- `npm run refresh:all` — current full provider refresh/build/verification pipeline
- `npm run import:mal` / `npm run refresh:mal` — refresh the curated MAL seed
- `npm run merge:provider -- <provider-import.json>` — stage a generic provider import; it does **not** modify `data/seed.json`

## Deployment

GitHub Actions runs:

1. tests
2. Hanime harvest
3. merged snapshot build
4. merged snapshot integrity verification
5. Cloudflare deploy
6. live `/health` verification

The daily workflow follows the same sequence. Cloudflare credentials are stored as GitHub Actions repository secrets.

The integrity gate currently requires the merged snapshot to preserve canonical Hanime mappings for:

- `mal:44044` — Jimihen
- `mal:368` — Bible Black

This catches regressions where the catalog still looks numerically healthy but important identity/episode mappings have silently broken.

## Catalog surface

The Nuvio addon continues to expose a deliberately small surface:

- Scarlet Peach Search
- Scarlet Peach Latest
- Scarlet Peach All

Detailed meta responses carry Scarlet Peach extension fields such as aliases, tags, studio, censorship, languages, provider mappings, availability, content rating, provenance-ready data, and richer episode metadata. Clients that do not understand the extension fields can ignore them.

## Provider roadmap

Working provider and catalog enrichment source:

1. Hanime

Next candidates can feed the same schema/merger instead of creating isolated catalogs. Current likely order:

2. MuchoHentai
3. HentaiSea
4. HStream
5. HentaiHaven
6. HentaiMama

HentaiTV remains parked due to its brittle current player chain.
