# Limitless Nexus: Scarlet Peach — Catalog

**Branch: `scarlet-peach-catalog`. Keep Scarlet Peach catalog changes on this branch unless explicitly directed otherwise. Do not create custom, alternate, or per-user install links.**

## Install manifest

Use this canonical Nuvio addon URL:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Localhost is development-only: run `npm start`, then use `http://127.0.0.1:7001/manifest.json` for same-device testing.

## Schema v2 role

Scarlet Peach is now designed as a reusable adult-animation metadata core, not only a display catalog.

- Published snapshots are normalized to **schema v2**.
- Stable canonical IDs prefer `mal:` / `anilist:`; provider-only titles use `sp:<provider>:<slug>` until a safe canonical match is known.
- Canonical metadata and provider-specific claims are kept separate.
- Censorship supports `censored`, `uncensored`, `mixed`, and `unknown`.
- Language versions, subtitle languages, provider qualities, tags, exact provider slugs/IDs, episode mappings, and verification timestamps can be retained.
- Unknown values stay unknown; the pipeline does not invent metadata.
- Strong provider matches merge into canonical titles. Ambiguous matches remain separate `sp:` records rather than corrupting identity.

See [`SCHEMA.md`](./SCHEMA.md) for the full contract and generic provider import format.

## Reusable data endpoints

In addition to the Nuvio/Stremio manifest, catalog, and meta routes, the deployed Worker exposes:

- `/health` — schema version, generation timestamp, title count
- `/schema.json` — machine-readable schema descriptor
- `/dataset.json` — full normalized schema v2 dataset
- `/data/current.json` — alias of `/dataset.json`

These endpoints are intended to support future Scarlet Peach-derived catalogs, providers, audit tools, and metadata enrichment jobs without scraping Nuvio responses.

## Current source coverage

- Adult/hentai records only; validation rejects regular anime before publishing.
- Current canonical seed contains 86 verified MyAnimeList `Rx - Hentai` records.
- MAL supplies stable identity, canonical title metadata, studio, broad genres, artwork, year/release date, and episode count where available.
- MAL does **not** reliably supply provider availability, censorship, dub/sub variants, stream qualities, or detailed adult content tags. Those fields remain unknown/empty until a verified provider source supplies them.
- Hanime is the first working stream provider and is the first planned provider-fed catalog enrichment source.

## Build pipeline

- `npm test` — catalog routing and schema v2 normalization tests
- `npm run build:snapshot` — normalize `data/seed.json` to schema v2, validate it, and atomically publish `data/snapshots/current.json` plus bundled Worker snapshots
- `npm run migrate:v2` — explicitly rewrite the seed into schema v2 and rebuild
- `npm run import:mal` — refresh the curated verified MAL adult seed in schema v2
- `npm run refresh:mal` — import MAL then rebuild the snapshot
- `npm run merge:provider -- <provider-import.json>` — safely merge a provider intermediate dataset into the seed

A failed validation never promotes the candidate snapshot. The prior snapshot remains the last-known-good fallback.

## Deployment

GitHub Actions now runs tests, builds the normalized snapshot, deploys `scarlet-peach-catalog` to Cloudflare, and verifies that `/health` reports `schemaVersion: 2`.

The daily workflow follows the same validation/deploy/health sequence. Cloudflare credentials are stored as GitHub Actions repository secrets.

## Catalog surface

The Nuvio addon continues to expose the same simple catalogs:

- Scarlet Peach Search
- Scarlet Peach Latest
- Scarlet Peach All

Detailed meta responses now also carry Scarlet Peach extension fields such as aliases, tags, studio, censorship, languages, provider mappings, availability, content rating, and richer episode metadata. Clients that do not understand the extension fields can ignore them.

## Provider roadmap

Current working provider:

1. Hanime

Next provider candidates can feed the same schema/merger rather than creating isolated catalogs. HentaiTV remains parked due to its brittle current player chain.
