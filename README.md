# Limitless Master Nexus

**Limitless Master Nexus** is the stable promotion branch for the custom Limitless Nuviostream provider repository. It is the branch intended for normal day-to-day use and broader testing after provider work has been proven on `Limitless-nexus`.

The Master branch is deliberately small and conservative. It contains the providers that have reached a useful, working state in the development branch without carrying the temporary diagnostics, domain experiments, or large legacy provider collection kept elsewhere in the repository.

## Install

Nuvio manifest:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Master-Nexus/manifest.json
```

[Open the Limitless Master Nexus manifest](https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Master-Nexus/manifest.json)

A branch-local copy is also maintained at `custom/manifest.json`.

## Purpose

This branch is the promotion target for work completed on `Limitless-nexus`. Provider versions in the Master manifest intentionally begin at **1.0.0** so the stable catalog has its own clean version history independent of the development branch.

The repository is being built around a compact provider set rather than an enormous scraper list. The long-term goal is roughly twenty or fewer maintainable providers with enough overlap to give several useful choices or fallbacks across anime, Western animation, Asian drama, movies, and live-action television.

Providers are favored when they have clean title and episode conventions, reliable identity mapping, useful language information, and extraction paths that do not require excessive title rewriting. Independent fallbacks are more valuable than several frontends that ultimately depend on exactly the same backend.

## Current stable providers

| Provider | Master version | Role |
|---|---:|---|
| Re:ANIME | 1.0.0 | Anime series and movies with direct FlixCloud media, including separate and shared SUB/DUB files, dual audio, and embedded subtitle tracks. |
| WCO | 1.0.0 | Anime and Western animation, movies, and Season 0 specials with proven WCO frontend fallback coverage. |
| AnikotoTV | 1.0.0 | Working anime provider promoted for casual real-world testing before its deeper Nexus rebuild. |

Repository version: **1.0.0**

## WCO reference state

WCO was the second provider completed in the Nexus rebuild and is considered stable enough for Master. Its production frontend order is:

```text
wcostream.tv → wcoflix.tv → wcoforever.net
```

Those three sites were tested as useful frontend fallbacks. Other WCO-branded frontends investigated during development did not add enough reliable coverage to justify maintaining them separately.

The production provider includes normal episodes, movies, Season 0 specials, Episode 0 and fractional-special handling, corrected Dub/Sub/original audio classification, and explicit-only mirror numbering. WCO entries that represent an entire bundled season rather than an individual episode are not treated as ordinary episode matches.

WCO Premium was also investigated with an authenticated account. The premium player successfully reaches `embed.wcopremium.tv`, but playback is produced through a dynamic `getvid?evid=...` flow that depends on browser-side token generation plus authenticated request context. That experiment is intentionally **not** part of the production provider.

## Re:ANIME reference state

Re:ANIME is the first completed Nexus provider. It uses TMDB/IMDb identity information with MAL/AniList mapping and Re:ANIME's structured Flix data. Direct media files are preferred over unnecessary proxying.

A key behavior preserved in the provider is the distinction between genuinely separate SUB and DUB files and a single MKV that already contains multiple audio or subtitle tracks. Shared media is labeled according to the tracks it actually represents rather than duplicated under misleading source labels.

## AnikotoTV reference state

AnikotoTV is currently the known-working implementation inherited from the earlier provider lab. It has been promoted to Master so it can be used casually alongside Re:ANIME and WCO while the provider is evaluated in normal viewing.

The deeper cleanup and modernization of AnikotoTV belongs on `Limitless-nexus`. Master should receive those changes only after they have been tested there.

## Branch family

- **`Limitless-Master-Nexus`**: stable promotion and day-to-day testing branch.
- **`Limitless-nexus`**: active custom-provider development branch where providers are investigated and rebuilt one at a time.
- **`Limitless-Provider-Lab`**: preserved legacy/provider laboratory containing the larger historical provider set and experiments that are useful as references but are not assumed production-ready.

Master is meant to stay boring in the best possible way: small, understandable, and dependable enough that experimental work elsewhere cannot silently change it. Provider sites and embeds can still change without notice, so a provider remaining in Master means it has a known-good Limitless implementation, not that the upstream site can never break.
