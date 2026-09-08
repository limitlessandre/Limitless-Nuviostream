# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Canonical Scarlet Peach install URL

Scarlet Peach is installed through the catalog addon:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

This provider branch is not independently installable yet and must not publish a second manifest URL.

## Current provider scope

- Shared request contract: `id`, `type`, `title`, `aliases`, `year`, `episode`.
- Stable `mal:`, `anilist:`, and `sp:` IDs only. HentaiStream-private IDs are rejected.
- HentaiTV now has a live provider client using the site's WordPress `episodes` API for discovery, normalized title/alias matching, requested-episode selection, bounded HTTP requests, page media extraction, and a direct CDN fallback when the interstitial/player page does not expose a source.
- Stream labels only include quality/container details when those details are visible in the returned URL. Language, dub/sub, and censor status are never guessed.
- HentaiStream remains comparison/reference material only and is not a runtime dependency.

## Development checks

Run unit/regression tests:

`npm test`

Run the live HentaiTV diagnostic (defaults to Bible Black episode 1 / `mal:368`):

`npm run diag:hentaitv`

Custom diagnostic:

`node scripts/diagnose-hentaitv.js "Bible Black" 1 mal:368`

The diagnostic exits with code 2 when title/episode resolution succeeds but no playable stream is found.

## Handoff / next session

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Current status: HentaiTV live client/resolver checkpoint implemented; matching, episode resolution, timeout/error isolation, extraction helpers, and diagnostics are present.  
Known limitation: this branch is still a provider library. Nuvio does not call it yet because no Scarlet Peach provider runtime/stream manifest wrapper has been connected. HentaiTV may also change its interstitial/player/CDN behavior, so live diagnostics should be rerun before publishing.  
Next recommended provider after HentaiTV is stable in Nuvio: HentaiMama, followed by MuchoHentai, HStream, and HentaiHaven.  
Next integration step: expose the provider resolver through the Nuvio/Scarlet Peach stream-provider runtime while keeping the catalog addon metadata-only.
