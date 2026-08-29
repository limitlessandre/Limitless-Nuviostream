# Limitless Nexus

Limitless Nexus is the focused, hand-maintained provider branch of Limitless Nuviostream. Providers are added one at a time, compared with their strongest maintained upstream implementations, cleaned up for Nuvio, and tested before the next provider is introduced.

The goal is not to collect the largest possible provider list. The goal is a smaller repository of dependable providers with clear stream labels, useful mirrors, accurate language information, and maintainable fallback paths.

## Why this branch exists

Nexus began as a clean restart after the earlier test branch became difficult to reason about. It was created directly from `main`, the inherited native provider set was removed from the active Nexus manifest, and provider development restarted with Re:ANIME as Provider #1.

The branch follows several decisions made during the original Nexus planning work:

- Keep the final repository near **20 carefully selected providers**, rather than accumulating every available scraper.
- Aim for roughly **five useful choices or fallbacks per major content category**, with strategic crossover providers covering more than one category.
- Cover anime, Western animation, movies, live-action television, Asian drama, and donghua without building a separate maintenance-heavy list for every category.
- Favor structured APIs and authoritative TMDB, IMDb, MAL, AniList, or provider IDs over aggressive title rewriting.
- Prefer providers with clean titles, explicit seasons and episodes, and reliable language metadata.
- Use a small core of strong providers plus independent fallbacks. Twenty providers should be a ceiling, not a requirement or a set that must all be queried blindly.
- Complete and document one provider before introducing the next, so matching, extraction, and playback problems remain isolated.

In short, Nexus is intended to be a compact, well-rounded toolbox—not a mirror of the much larger aggregated `main` feed.

## Install in Nuvio

Copy this manifest URL into Nuvio's repository manager:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/manifest.json
```

Direct manifest link: [Limitless Nexus manifest](https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/manifest.json)

## Current status

| Provider | Version | Status | Coverage |
|---|---:|---|---|
| Re:ANIME | 1.5.0 | Complete | Anime movies and series; direct MKV; Japanese, English dub, dual audio, and embedded subtitles |
| WCO | 1.0.0 | Active testing | Anime and cartoons; English dub, Japanese sub, legacy MP4, and premium HLS |

Repository version: **1.7.0**

## Coverage plan and candidate roadmap

The original Nexus discussions produced a working shortlist. It is a research roadmap, not a promise that every name will be added: each candidate must still have a maintainable implementation and pass Nuvio playback testing.

### Anime core and fallbacks

- Re:ANIME
- animepahe
- KickAssAnime
- AniZone
- AniNeko
- Miruro
- Anikoto
- Anime Nexus or another independent specialist fallback

### Animation specialists

- WCO
- ToonHub4u
- B98 or another classic-cartoon archive
- DonghuaStream or another dedicated donghua source

### Drama and cross-media coverage

- KissKH
- DramaCool
- FrameX
- NowHDTime
- Cineby
- Rive
- PlayIMDb
- CineFreak or another independent movie/TV fallback

The strategic preference is for crossover providers such as FrameX, NowHDTime, Cineby, Rive, and KissKH when one maintainable provider can strengthen several categories. New or unofficial clone sites may be researched on the bench, but they should not enter the core list merely because a familiar brand name reappears.

The intended end state is approximately:

- Five or more effective anime paths.
- Five or more Western-animation paths when crossover providers are included.
- Several independent Asian-drama paths.
- Several TMDB-based movie and live-action TV paths.
- At least one dedicated donghua path.

Actual reliability matters more than reaching a numeric quota.

## Re:ANIME

Re:ANIME is the first completed Nexus provider.

It uses TMDB/IMDb metadata, MAL episode mapping, and AniList identity resolution to locate the correct Re:ANIME title and episode. Playback uses FlixCloud's direct MKV downloads and does not require a proxy.

Current behavior:

- Preserves both real HD-2 mirrors when two distinct files exist.
- Deduplicates SUB and DUB server entries that resolve to the same MKV.
- Labels a shared SUB+DUB file as `Dual Audio + Subs`.
- Labels SUB-only files as `Japanese + Subs`.
- Labels DUB-only files as `English Dub`.
- Keeps genuinely separate SUB and DUB files as separate streams.
- Leaves embedded MKV audio and subtitle tracks available to Nuvio's player.

Reference tests:

- **One Piece Episode 1:** two HD-2 mirrors sharing dual-audio MKVs with embedded subtitles.
- **The Saga of Tanya the Evil:** SUB-only behavior with Japanese audio and subtitles.

Important debugging lesson: when differently labelled sources appear to play the same language, inspect the actual audio tracks inside the media file before changing extraction logic. A direct MKV may already contain multiple audio tracks even when the surrounding site exposes separate SUB and DUB server labels.

The experimental FlixCloud Worker and proxy code remain in `proxy/flixcloud/` for future providers that genuinely require protected HLS. Re:ANIME itself does not use it.

## WCO

WCO is the second Nexus provider and is currently in active playback testing.

The implementation was rebuilt by comparing the earlier `main` branch provider with the current Yuzono/AniYomi WCO theme. It combines the WCO mirror family into one Nuvio provider instead of publishing several near-identical entries.

Supported site fallbacks:

1. WCOFlix
2. WCOStream
3. WCOForever
4. WCO.tv
5. WCOAnimeSub
6. WCOAnimeDub

Current behavior:

- Searches alternate TMDB titles and ranks results before selecting a series or movie.
- Handles multiple current and legacy episode-list layouts.
- Preserves season and episode matching, with a season-one fallback for older pages lacking season metadata.
- Processes every recognized iframe instead of using only the first embed.
- Supports WCO's modern ad-verification/player initialization flow.
- Falls back to the legacy `getvidlink.php` extractor where appropriate.
- Decodes older obfuscated iframe pages used by some WCO mirrors.
- Supports standard WCO MP4 qualities up to 1080p when supplied.
- Supports the premium `vhs.watchanimesub` HLS host and exposes its individual playlist qualities.
- Labels streams as English Dub, Japanese + Subs, Original Audio, or premium multi-audio/soft-sub content according to the source path.
- Deduplicates identical streams returned through mirrored pages.

WCO's modern embed verification includes an intentional anti-bot delay. Source discovery can therefore take roughly 12 seconds per modern embed before playable links appear.

Recommended WCO tests:

- An anime episode with both SUB and DUB releases.
- An English-language Western cartoon.
- An anime movie.
- A `Premium` result to verify HLS quality selection and available internal tracks.

## Provider workflow

Each new Nexus provider should follow the same process:

1. Inspect any existing Limitless implementation.
2. Compare it with current maintained upstream extensions and the live site's behavior.
3. Identify useful domains, mirrors, embeds, extractors, language variants, and fallbacks.
4. Port only the behavior that fits Nuvio's provider model.
5. Use precise language and format labels; do not infer tracks the source does not provide.
6. Deduplicate aliases without removing genuinely distinct files or mirrors.
7. Test representative SUB-only, DUB-only, dual-audio, movie, series, and fallback cases as applicable.
8. Mark the provider complete before moving to the next source.

Identity and extraction should be treated as separate layers. If the correct title and episode are found but playback fails, preserve the working identity path and debug only the embed or media transport. Likewise, a playable file is not proof that its displayed SUB/DUB label matches the tracks inside it.

## Branch layout

- `custom/manifest.json` — the installable Limitless Nexus manifest.
- `custom/providers/` — active Nexus JavaScript providers.
- `proxy/flixcloud/` — retained experimental FlixCloud Worker and tests.
- `manifest.json` and the large aggregation reports — inherited project files; they are not the Nexus install manifest.

## Scope

Limitless Nexus currently focuses on English, Japanese, Korean, and Chinese movie, television, animation, and anime coverage. A provider is included because it adds reliable coverage—not merely because an upstream implementation exists.

Provider sites and embeds can change without notice. When something breaks, reproduce the issue with a known title and episode, record the exact stream label and language behavior, and compare it with the current upstream extension before changing the provider.

