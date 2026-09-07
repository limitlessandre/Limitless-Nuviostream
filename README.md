# Limitless Nexus: Scarlet Peach — Catalog

**Branch: `test/scarlet-peach`. This is the only branch for Scarlet Peach testing. Keep future changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Reinstall manifest

Run `npm start`, then copy this single test manifest URL into Nuvio:

`http://127.0.0.1:7001/manifest.json`

For a hosted test deployment, use its one canonical `/manifest.json` URL only; record the real URL here after deployment. No hosted target or repository remote was supplied, so none is invented in this repository.

## MVP scope

- Adult/hentai records only; validation rejects regular anime before publishing.
- `catalog` and `meta` resources; no stream resource and no runtime MAL/AniList calls.
- Stable `mal:`, `anilist:`, or `sp:` IDs; aliases, studio, year, tags, genres, language versions, censor status, episodes, and optional provider mappings are retained.
- `npm run build:snapshot` validates a candidate and atomically promotes `data/snapshots/current.json`; if it fails, the previous current snapshot remains the last known good data.
- The included item is a non-production fixture. Add only verified adult records through the importer/builder path.

## Handoff / next session

Repository: `nexus-scarlet-peach-catalog`  
Branch: `test/scarlet-peach`  
Current status: catalog/meta/search MVP runnable locally.  
Known limitation: source importers and hosted deployment are intentionally not configured; provide the approved sources and host before enabling real ingestion.  
Provider roadmap: HentaiTV, HentaiMama, MuchoHentai, HStream, HentaiHaven.
