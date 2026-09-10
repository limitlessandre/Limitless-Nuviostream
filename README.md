# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless explicitly directed otherwise.**

## Install URLs

Catalog / metadata / subtitle addon:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Provider repository:

`https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

Use the catalog URL in Nuvio's addon installer. Use the provider repository URL in **Settings → General → Plugins → Add Repository**.

## Current production baseline

Provider repository: **0.7.0**

- **Hanime 0.2.8** — production
- **HentaiHaven 0.2.4** — production
- **HStream 0.2.0** — production

All three have been client-tested with their current playback paths. Treat those media transports as frozen unless a real site/client break requires a change.

## Hanime 0.2.8

Provider:

`providers/scarlet-peach-hanime-v9.js`

Worker:

`https://scarlet-peach-hanime.limitlessandre.workers.dev`

Current behavior:

- Scarlet Peach schema-v2 MAL/AniList/SP identities
- shared TMDB numeric / IMDb compatibility ingress
- exact Hanime mappings where available
- signed Hanime v11 search + AES-GCM handshake
- guest HLS playback at available qualities
- optional account settings for authenticated/premium qualities
- Nexus quality/audio/censorship labels

## HentaiHaven 0.2.4

Provider:

`providers/scarlet-peach-hentaihaven-v4.js`

Worker:

`https://scarlet-peach-hentaihaven.limitlessandre.workers.dev`

Current Worker transport baseline: **v0.5.4**.

Current behavior:

- `hentaihaven.com` primary backend
- `hentaihaven.vip` working fallback
- `hentaihaven.xxx` intentionally excluded while automated requests receive a Cloudflare challenge
- Romanization-aware matching
- secure player-token decode and player API extraction
- H.264 plus Octopus VP9 qualities, including 1080p where exposed
- provider-specific censorship detection
- conservative `[SUB]` / `[DUB]` semantics

### Important playback architecture

HentaiHaven's selected quality playlist contains video while audio is a separate HLS rendition. The stable solution is therefore:

1. the Worker returns a **minimal quality-scoped HLS master containing only the selected video rendition plus its separate audio group**;
2. that playback master contains **no subtitle directives**;
3. HentaiHaven WebVTT subtitles are exposed independently through the Scarlet Peach catalog addon's `subtitles` resource.

This exact separation restored video + audio + subtitles on both desktop and mobile. Do not fold subtitle groups back into the HentaiHaven playback master without a new client regression test.

## HStream 0.2.0

Provider:

`providers/scarlet-peach-hstream-v2.js`

Worker:

`https://scarlet-peach-hstream.limitlessandre.workers.dev`

Current Worker family: **v0.2.x**.

HStream is now production after desktop/mobile playback and subtitle validation.

Current behavior:

- Scarlet Peach MAL/AniList/SP metadata plus the shared TMDB/IMDb ingress bridge
- Romanization-aware title matching
- `e_id` + XSRF-protected player API handshake
- multi-CDN fallback
- native DASH/MPD playback
- live-proven **2160p / 4K, 1080p, and 720p** on supported titles
- 2160p/1080p AV1 with AVC fallback at 720p on the Deco x Deco fixture
- provider censorship/studio/frame-rate metadata when exposed
- English ASS subtitle discovery
- Android uses the clean MPD plus external subtitle attachment
- desktop uses the subtitle-compatible DASH transport validated in Nuvio

Current regression fixture:

```text
sp:hanime:deco-x-deco-the-animation
  HStream • 4K 2160p • [SUB] • Censored
  HStream • FHD 1080p • [SUB] • Censored
  HStream • HD 720p • [SUB] • Censored
```

## Catalog integration

All three production providers now contribute mappings to Scarlet Peach's schema-v2 catalog.

HStream catalog ingestion uses the site's public read-only endpoint:

`https://hstream.moe/v1/hentai-list`

Latest validated HStream harvest:

- 866 source series
- 2,026 exact episode slugs
- 861 published Scarlet Peach titles with an HStream mapping
- 649 HStream records merged into existing identities
- 217 HStream-only titles created

The bulk HStream feed does not claim censorship/languages/qualities when those fields are absent, so the catalog leaves them unknown rather than guessing.

Current merged Scarlet Peach catalog: **0.5.0**, with **2,055 titles** and Hanime + HentaiHaven + HStream mappings.

## Identity architecture

Scarlet Peach remains MAL/AniList/provider-centric. TMDB and IMDb are compatibility inputs only for titles opened from foreign/general catalogs.

```text
Scarlet Peach catalog
  MAL / AniList / sp: identities
          |
          +-----------------------------+
                                        |
foreign Nuvio catalog                   |
  TMDB / IMDb                           |
      |                                 v
      +--> Scarlet Peach Identity --> provider mappings
                                        |
                    +-------------------+-------------------+
                    |                   |                   |
                 Hanime            HentaiHaven           HStream
```

The external identity bridge does not decide catalog membership, censorship, tags, or availability.

## Stream metadata rules

Provider evidence wins for the individual stream. Scarlet Peach canonical metadata fills gaps.

Typical labels:

```text
HStream • 4K 2160p • [SUB] • Censored
HentaiHaven • FHD 1080p • [SUB] • Censored
Hanime • HD 720p • [SUB] • Uncensored
```

Unknown fields remain omitted rather than inferred.

## Validation

Provider CI protects:

- JavaScript syntax and manifest shape
- external-ID compatibility using KITE / TMDB `80219`
- HentaiHaven 1080p/720p/360p qualities, `[SUB]` semantics, video+audio HLS master transport, and absence of subtitle directives in that master
- HStream native DASH 2160p/1080p/720p and subtitle objects
- separate deploy/health/live extraction gates for Hanime, HentaiHaven, HStream, and the shared identity Worker

Catalog CI separately harvests all three provider catalogs, validates schema-v2 merging, verifies key exact episode mappings, and deploys only after the snapshot passes.

## Long-term direction

The target product is one **Scarlet Peach addon** that can be enabled or disabled as a single unit while exposing catalog, metadata, subtitles, and aggregated streams. The individual provider Workers should remain modular underneath it. The standalone provider repository remains the development/testing surface until that unified addon is ready.

## Provider roadmap

Production and frozen baseline:

1. Hanime
2. HentaiHaven
3. HStream

Next candidates, pending the user's questions and prioritization:

4. HentaiMama
5. MuchoHentai

HentaiSea remains deferred because its playback authorization is IP-bound/anti-hotlink sensitive and would require a much heavier media proxy. HentaiTV remains parked as reference work.
