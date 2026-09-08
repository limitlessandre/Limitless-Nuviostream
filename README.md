# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless explicitly directed otherwise. Do not create custom, alternate, or per-user install links.**

## Install URLs

Scarlet Peach uses separate catalog-addon and provider-repository URLs because Nuvio treats them as different systems.

Catalog / metadata addon:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Provider repository:

`https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

Use the catalog URL in Nuvio's addon installer. Use the provider repository URL in **Settings → General → Plugins → Add Repository**.

## Active provider: Hanime 0.2.2

Hanime is the production Scarlet Peach provider. HentaiTV code remains parked in this branch as reference/debug work but is not exposed in the active manifest.

Why Hanime is first:

- Current AniYomi Hanime playback was independently verified working in September 2026.
- Current Hanime implementations were updated for the encrypted v11 website/API flow.
- Playback uses a signed v11 search dataset plus AES-256-GCM `/api/v11/handshake`, not brittle iframe scraping.
- Guest playback returns direct HLS sources without debrid/P2P.
- The Scarlet Peach catalog now ingests Hanime's current dataset and retains exact provider/episode mappings.

Protocol references include current Yuzono AniYomi Hanime code and `anime-src/hanime-stremio`.

## Architecture

```text
Nuvio
  -> Scarlet Peach schema v2 metadata
      -> canonical MAL/AniList/SP identity
      -> exact Hanime title + episode provider mapping when known
  -> Scarlet Peach - Hanime provider
      -> provider title / exact episode context preferred
      -> romanization-aware fallback when mapping is absent
  -> Scarlet Peach Hanime resolver Worker
      -> signed Hanime v11 search dataset
      -> encrypted Hanime v11 handshake
      -> guest HLS sources
  -> Nuvio stream rows
```

The Nuvio scraper intentionally stays small. Hanime signing and AES-GCM handshake logic live in the Worker so Nuvio's restricted plugin runtime is not responsible for crypto/browser-protocol behavior.

## Catalog-aware provider behavior

Provider file:

`providers/scarlet-peach-hanime-v3.js`

Version 0.2.2 understands:

- `mal:<id>` and episode forms such as `mal:368:1`
- `anilist:<id>` and episode forms
- nested Scarlet Peach provider-only IDs such as `sp:hanime:<slug>:1`
- compatible legacy `htv-...` title slugs as a fallback bridge

For Scarlet Peach metadata entries, the provider reads the detailed schema v2 meta response and prefers the episode-level Hanime mapping. This gives the resolver the provider's own title spelling instead of forcing it to rediscover every title from the canonical MAL spelling.

The catalog currently protects regression fixtures for:

- Jimihen `mal:44044`, including exact Hanime episode slug `jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1`
- Bible Black `mal:368`, currently mapped to six Hanime episodes

If the catalog has no Hanime mapping, the provider retains the proven romanization-aware title matching path.

## Hanime Worker

Worker source:

`workers/scarlet-peach-hanime/src/index.js`

Canonical base:

`https://scarlet-peach-hanime.limitlessandre.workers.dev`

Endpoints:

- `GET /health`
- `GET /catalog.json` — normalized read-only Hanime catalog feed used by the Scarlet Peach catalog pipeline
- `POST /resolve` — title/alias/year/episode playback resolver

The Worker is automatically deployed by GitHub Actions and verified after deployment. `/catalog.json` is also checked for a non-empty normalized dataset.

## Stream metadata

Returned stream rows preserve actual handshake quality/height. They include the playback headers Hanime currently requires:

- `Referer: https://player.hanime.tv/`
- `Origin: https://player.hanime.tv`

Version 0.2.2 also uses censorship/audio metadata from Scarlet Peach's verified provider mapping when available. Unknown values are not promoted into labels. Subtitle metadata is retained in the catalog, but the Nuvio stream object only exposes subtitle tracks when actual playable subtitle URLs are available.

## Validation

Provider branch changes now have two independent CI paths:

1. **Validate Scarlet Peach Providers**
   - `node --check` on every provider JS file
   - provider manifest JSON/shape validation

2. **Deploy Scarlet Peach Hanime Worker**
   - deploy Worker
   - verify `/health`
   - verify `/catalog.json` has a healthy normalized catalog feed

This is specifically intended to catch generated-JavaScript regressions before a manifest points Nuvio at a new provider file.

## Current handoff

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Provider manifest version: `0.2.2`  
Active provider: `Scarlet Peach - Hanime`  
Provider file: `providers/scarlet-peach-hanime-v3.js`  
Resolver Worker: `workers/scarlet-peach-hanime/`  
Provider manifest: `https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`  
Catalog manifest: `https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

## Provider roadmap

Current:

1. Hanime

Likely next providers for the same schema/Worker pattern:

2. MuchoHentai
3. HentaiSea
4. HStream
5. HentaiHaven
6. HentaiMama

HentaiTV remains parked until its player chain is worth revisiting.
