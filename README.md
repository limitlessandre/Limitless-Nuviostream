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

### HentaiHaven 0.2.0

- `hentaihaven.com` primary backend
- `hentaihaven.vip` working mirror fallback
- Romanization-aware title/slug matching
- secure `x-secure-token` decode + player API extraction
- normal H.264 HLS plus Octopus VP9 playlist support
- 1080p where the VP9 playlist exposes it
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
                         +--------------+--------------+
                         |                             |
                      Hanime                      HentaiHaven
```

Identity Worker:

`https://scarlet-peach-identity.limitlessandre.workers.dev`

The identity Worker uses external IDs as a translation layer. It does not decide Scarlet Peach catalog membership, censorship, tags, episode structure, or provider availability.

## Stream metadata rules

Provider evidence wins for the individual stream. Scarlet Peach canonical metadata fills gaps.

For example, a title may be canonically `mixed`, while one provider stream is explicitly `Censored` and another is `Uncensored`. The stream rows keep those provider-specific facts separate.

Quality labels follow the Nexus convention, for example:

```text
HentaiHaven • FHD 1080p • [DUB+SUB] • Censored
HentaiHaven • HD 720p • [DUB+SUB] • Censored
HentaiHaven • SD-Low 360p • [DUB+SUB] • Censored
```

HentaiHaven's Worker also preserves the subtitle tracks/languages exposed by the live player. The provider label uses that metadata immediately; the full track list remains available for future catalog/player integration.

## Validation

Provider changes have separate CI gates:

1. **Validate Scarlet Peach Providers**
   - JavaScript syntax validation for provider files
   - manifest validation
   - TMDB compatibility regression using KITE / `80219`
   - HentaiHaven Jimihen regression for 1080p, censorship, audio/sub label and duplicate-quality prevention

2. **Deploy Scarlet Peach Hanime Worker**
   - deploy + health checks
   - live catalog/resolve smoke tests

3. **Deploy Scarlet Peach HentaiHaven Worker**
   - deploy + version/health check
   - `.com` production extraction probe
   - `.vip` Jimihen fallback probe
   - 1080p and metadata assertions

4. **Deploy Scarlet Peach Identity Worker**
   - deploy + health checks
   - TMDB/IMDb cross-reference regression

## Current handoff

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Provider manifest: `0.5.0`  
Hanime: `0.2.8`  
HentaiHaven: `0.2.0`  
Catalog manifest: `https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`  
Provider manifest: `https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

## Provider roadmap

Current production:

1. Hanime
2. HentaiHaven

Likely next:

3. HStream
4. HentaiMama
5. MuchoHentai

HentaiSea is deferred because its media authorization is IP-bound/anti-hotlink sensitive and would require a much heavier media-proxy design. HentaiTV remains parked as reference work until its player chain is worth revisiting.
