# Limitless Nexus: Scarlet Peach — Catalog

**Branch: `scarlet-peach-catalog`. Keep Scarlet Peach catalog changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Reinstall manifest

Scarlet Peach is a live addon server, so GitHub alone is not the install endpoint. Start the catalog server with:

`npm start`

Then install the manifest that points to the running server:

- Nuvio on the same PC: `http://127.0.0.1:7001/manifest.json`
- Nuvio on another device on the same network: `http://<PC-LAN-IP>:7001/manifest.json`

For TV, phone, or other-device testing, use the PC's current LAN IPv4 address in place of `<PC-LAN-IP>`. Keep port `7001` unless the server configuration is intentionally changed.

A raw GitHub `manifest.json` URL is not a valid replacement because Nuvio also needs the live `/catalog/...` and `/meta/...` routes from this server. If Scarlet Peach is later deployed to an approved host, record exactly one canonical hosted `/manifest.json` URL here and use that for reinstalls.

## MVP scope

- Adult/hentai records only; validation rejects regular anime before publishing.
- `catalog` and `meta` resources; no stream resource and no runtime MAL/AniList calls.
- Stable `mal:`, `anilist:`, or `sp:` IDs; aliases, studio, year, tags, genres, language versions, censor status, episodes, and optional provider mappings are retained.
- `npm run build:snapshot` validates a candidate and atomically promotes `data/snapshots/current.json`; if it fails, the previous current snapshot remains the last known good data.
- The included item is a non-production fixture. Add only verified adult records through the importer/builder path.

## Handoff / next session

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-catalog`  
Current status: catalog/meta/search MVP runnable locally.  
Known limitation: source importers and hosted deployment are intentionally not configured; provide approved sources and a host before enabling real ingestion or a permanent remote reinstall URL.  
Provider roadmap: HentaiTV, HentaiMama, MuchoHentai, HStream, HentaiHaven.
