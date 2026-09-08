# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Install URLs

Scarlet Peach uses two separate manifests because Nuvio treats metadata addons and plugin repositories as different systems.

Catalog / metadata addon:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Provider repository:

`https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

Use the catalog URL in Nuvio's addon installer. Use the provider repository URL in **Settings → General → Plugins → Add Repository**.

## Current provider scope

- Nuvio plugin repository manifest with one provider: `Scarlet Peach - HentaiTV`.
- The provider is a standalone Nuvio-compatible `getStreams(inputId, mediaType, season, episode)` module.
- Stable `mal:`, `anilist:`, and `sp:` IDs only. HentaiStream-private IDs are rejected.
- The provider obtains Scarlet Peach metadata from the deployed catalog addon, then uses HentaiTV's WordPress `episodes` API for title/episode discovery.
- HentaiTV playback resolution checks media URLs exposed on the episode page and then uses the known direct HentaiTV CDN slug fallback when necessary.
- Stream labels include quality/container details only when verifiable from the returned URL. Language, dub/sub, and censor status are not guessed.
- HentaiStream remains comparison/reference material only and is not a runtime dependency.

## Development checks

Library/regression tests:

`npm test`

Live HentaiTV diagnostic (defaults to Bible Black episode 1 / `mal:368`):

`npm run diag:hentaitv`

Custom diagnostic:

`node scripts/diagnose-hentaitv.js "Bible Black" 1 mal:368`

## Handoff / next session

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Current status: first installable Scarlet Peach Nuvio plugin repository is present with the HentaiTV provider.  
Provider manifest: `https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`  
Catalog manifest: `https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`  
Known limitation: HentaiTV's player/CDN behavior can change, so live playback must be verified in Nuvio before treating extraction as production-stable.  
Next recommended provider after HentaiTV is stable in Nuvio: HentaiMama, followed by MuchoHentai, HStream, and HentaiHaven.
