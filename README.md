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
- The MVP snapshot contains 86 verified MAL `Rx - Hentai` records, including Bible Black. The former demo fixture is removed.
- `npm run refresh:mal` reads curated MAL candidates, verifies each live public title page, rejects every classification except `Rx - Hentai`, and then runs the validated snapshot build. A failed source request leaves the active bundled snapshot unchanged. AniList is not used by the runtime and is used by the build only when its API is available and explicitly marks a record adult.

## Handoff / next session

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-catalog`  
Current status: Worker deployment configuration and bundled snapshot are ready; local Node server is development-only.
Known limitation: language variants and censor status remain unknown unless a verified source supplies them. The importer deliberately excludes all non-`Rx - Hentai` MAL entries, ambiguous titles, and records without a verified adult classification; AIOMetadata remains responsible for regular anime.
Provider roadmap: HentaiTV, HentaiMama, MuchoHentai, HStream, HentaiHaven.
