# Limitless Nexus: Scarlet Peach — Catalog

**Branch: `scarlet-peach-catalog`. Keep Scarlet Peach catalog changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Reinstall manifest

Copy this one canonical manifest URL into Nuvio:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Do not use a GitHub raw-file URL or create custom/alternate install links.

Localhost is development-only: run `npm start`, then use `http://127.0.0.1:7001/manifest.json` for same-device testing.

## MVP scope

- Adult/hentai records only; validation rejects regular anime before publishing.
- `catalog` and `meta` resources; no stream resource and no runtime MAL/AniList calls.
- Stable `mal:`, `anilist:`, or `sp:` IDs; aliases, studio, year, tags, genres, language versions, censor status, episodes, and optional provider mappings are retained.
- `npm run build:snapshot` validates a candidate and atomically promotes `data/snapshots/current.json`; if it fails, the previous current snapshot remains the last known good data. The Worker bundles the validated snapshot and its fallback, so it has no runtime MAL/AniList or external catalog dependency.
- The included item is a non-production fixture. Add only verified adult records through the importer/builder path.

## Handoff / next session

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-catalog`  
Current status: Worker deployment configuration and bundled snapshot are ready; local Node server is development-only.
Known limitation: source importers are intentionally not configured; add only approved adult-source ingestion through the validated snapshot build.
Provider roadmap: HentaiTV, HentaiMama, MuchoHentai, HStream, HentaiHaven.
