# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless explicitly directed otherwise.**

## Install URLs

Catalog / metadata addon:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Provider repository:

`https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

Use the catalog URL in Nuvio's addon installer. Use the provider repository URL in **Settings → General → Plugins → Add Repository**.

## Production providers

### Hanime 0.2.8

- Scarlet Peach schema v2 MAL/AniList/SP identities and exact Hanime mappings
- compatible TMDB numeric / IMDb ingress through the shared identity bridge
- signed Hanime v11 search + AES-GCM handshake
- guest HLS playback at available qualities
- optional account settings for authenticated/premium qualities
- Nexus quality/audio/censorship stream labels

Provider:

`providers/scarlet-peach-hanime-v9.js`

Worker:

`https://scarlet-peach-hanime.limitlessandre.workers.dev`

### HentaiHaven 0.2.3

- `hentaihaven.com` primary backend
- `hentaihaven.vip` working mirror fallback
- Romanization-aware title/slug matching
- secure `x-secure-token` decode + player API extraction
- normal H.264 HLS plus Octopus VP9 playlist support
- 1080p where the VP9 playlist exposes it
- direct per-quality source HLS playback on desktop and Android; the resolver no longer inserts a generated quality-scoped `/play.m3u8` master between Nuvio and HentaiHaven
- selectable subtitles are forwarded separately through Nuvio's subtitle sidecar contract, so subtitle support does not rewrite the video/audio transport
- one stream row per quality, preferring H.264 at equal resolutions and retaining VP9 when needed for higher quality
- provider-specific censored/uncensored detection from the matched title post
- live HLS/JWPlayer audio and subtitle metadata
- Nexus `[SUB]`, `[DUB]`, `[DUB+SUB]`, `[DUAL]` presentation
- shared TMDB/IMDb compatibility bridge for titles opened from foreign Nuvio catalogs

Provider:

`providers/scarlet-peach-hentaihaven-v4.js`

Worker:

`https://scarlet-peach-hentaihaven.limitlessandre.workers.dev`

`hentaihaven.xxx` is intentionally disabled in the normal resolver path because automated requests currently receive a Cloudflare challenge.

## Experimental providers

### HStream 0.1.1

HStream has passed server-side extraction and desktop Nuvio playback/subtitle validation. It remains experimental until a broader title sample is confirmed.

- Scarlet Peach MAL/AniList/SP metadata and shared TMDB/IMDb ingress bridge
- direct Romanization-aware episode slug probing with `/search?search=` fallback
- live `e_id` + XSRF-protected `/player/api` handshake
- multi-CDN fallback
- native MPEG-DASH / MPD playback; no media conversion proxy
- live-proven **2160p / 4K**, 1080p, and 720p manifests on Deco x Deco The Animation episode 1
- 2160p/1080p are currently AV1 on the tested title; 720p provides AVC fallback
- frame-rate metadata parsed from the MPD
- provider-level censorship and studio metadata
- English `.ass` subtitle discovery forwarded as Nuvio stream-provided selectable subtitles with playback headers
- HStream's optional machine-translated subtitle languages are forwarded when exposed by the API
- Cloudflare `global_fetch_strictly_public` compatibility enabled because HStream itself is fronted by a Worker

Provider:

`providers/scarlet-peach-hstream-v2.js`

Worker:

`https://scarlet-peach-hstream.limitlessandre.workers.dev`

Current live regression fixture:

```text
sp:hanime:deco-x-deco-the-animation
  HStream • 4K 2160p • [SUB] • Censored
  HStream • FHD 1080p • [SUB] • Censored
  HStream • HD 720p • [SUB] • Censored
  + English ASS subtitle track on every stream row
```

HStream has **not** been added to Scarlet Peach catalog ingestion yet. Catalog harvesting/mappings come after the current client validation pass so an incomplete player integration cannot become a production catalog dependency.

## Identity architecture

Scarlet Peach remains MAL/AniList/provider-centric. TMDB and IMDb are **compatibility inputs only**, used when Nuvio opens an adult title from a foreign/general catalog and hands the provider a numeric or IMDb ID.

```text
Scarlet Peach catalog
  MAL / AniList / sp: identities
          |
          +-----------------------------+
                                        |
foreign Nuvio catalog                   |
  TMDB / IMDb                           |
      |                                 |
      v                                 v
Scarlet Peach Identity Worker --> normalized title + aliases
                                        |
                         +--------------+--------------+--------------+
                         |                             |              |
                      Hanime                      HentaiHaven       HStream
```

Identity Worker:

`https://scarlet-peach-identity.limitlessandre.workers.dev`

The identity Worker uses external IDs as a translation layer. It does not decide Scarlet Peach catalog membership, censorship, tags, episode structure, or provider availability.

## Stream metadata rules

Provider evidence wins for the individual stream. Scarlet Peach canonical metadata fills gaps.

For example, a title may be canonically `mixed`, while one provider stream is explicitly `Censored` and another is `Uncensored`. The stream rows keep those provider-specific facts separate.

Quality labels follow the Nexus convention, for example:

```text
HStream • 4K 2160p • [SUB] • Censored
HentaiHaven • FHD 1080p • [SUB] • Censored
Hanime • HD 720p • [SUB] • Uncensored
```

Resolvers preserve richer subtitle/audio metadata when the sites expose it. HentaiHaven keeps video/audio on the direct source HLS and forwards discovered WebVTT subtitles as separate Nuvio subtitle objects. HStream forwards its discovered subtitle tracks directly in Nuvio's stream subtitle object contract instead of only using them for labels.

## Validation

Provider changes have separate CI gates:

1. **Validate Scarlet Peach Providers**
   - JavaScript syntax validation for provider files
   - manifest validation
   - TMDB compatibility regression using KITE / `80219` for stable providers
   - HentaiHaven Deco regression for 1080p/720p/360p, `[SUB]` semantics, direct source-media URLs, unique qualities, and English subtitle sidecars
   - HStream Deco x Deco regression for native MPD, 2160p/1080p/720p, `[SUB]`, censorship, English ASS subtitle objects, and subtitle playback headers

2. **Deploy Scarlet Peach Hanime Worker**
   - deploy + health checks
   - live catalog/resolve smoke tests

3. **Deploy Scarlet Peach HentaiHaven Worker**
   - deploy + version/health check
   - `.com` production extraction probe
   - `.vip` Jimihen fallback probe
   - direct-source HLS transport assertion (no generated `/play.m3u8` in new resolve rows)
   - 1080p and subtitle-sidecar metadata assertions

4. **Deploy Scarlet Peach HStream Worker**
   - deploy + version/health check
   - live Deco x Deco player API extraction
   - native 2160p/1080p/720p MPD assertions
   - English subtitle metadata assertion

5. **Deploy Scarlet Peach Identity Worker**
   - deploy + health checks
   - TMDB/IMDb cross-reference regression

## Current handoff

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Provider manifest: `0.6.4`  
Hanime: `0.2.8`  
HentaiHaven: `0.2.3`  
HStream: `0.1.1` experimental  
Catalog manifest: `https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`  
Provider manifest: `https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

## Provider roadmap

Production:

1. Hanime
2. HentaiHaven

Experimental / current:

3. HStream

Likely after HStream promotion:

4. HentaiMama
5. MuchoHentai

HentaiSea is deferred because its media authorization is IP-bound/anti-hotlink sensitive and would require a much heavier media-proxy design. HentaiTV remains parked as reference work until its player chain is worth revisiting.
