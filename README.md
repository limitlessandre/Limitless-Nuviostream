# Limitless Provider Lab

**Limitless Provider Lab** is the preserved research and experimentation branch for Limitless Nuviostream. It is the continuation of the earlier `Limitless-Nuviotest` work and intentionally keeps the larger historical provider set, frozen imports, older ports, and exploratory implementations that are still useful as references.

This branch is not the production catalog. Its value is breadth, history, and comparison. A provider existing here does **not** mean it is currently healthy, fully tested, or ready to be promoted into the smaller Nexus branches.

## Install

Nuvio lab manifest:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Provider-Lab/manifest.json
```

[Open the Limitless Provider Lab manifest](https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Provider-Lab/manifest.json)

## Purpose

The original test branch accumulated a wide range of anime-focused providers while the project was learning which source architectures translated well into Nuvio. That work eventually became too broad to serve as the main development line, but it remains extremely useful as a provider bench.

The lab exists to preserve that work instead of throwing it away. It provides known starting points, old extraction routes, source-lock information, naming experiments, and examples of providers that may be worth revisiting later.

When a provider from this branch is selected for serious development, the preferred destination is `Limitless-nexus`, where it can be isolated, reviewed against current site behavior, and rebuilt without dragging the entire historical catalog along with it.

## Historical provider set

The lab manifest contains a broad anime-first collection that has included:

- 123Anime and the experimental 123Anime NEXT rebuild;
- AllAnime / MKissa research;
- All-Wish;
- AniDB;
- AniNeko;
- AnikotoTV;
- AnimeKai;
- AnimePahe;
- AnimeZeY;
- Animetsu;
- AniZone;
- HiAnime;
- KissKH Anime;
- Kurage;
- TokyoInsider;
- Vidnest Anime;
- WCoflix / WCO-related work.

Some of these providers were imported from existing Nuvio implementations, some were adapted from AniYomi or other maintained extensions, and some received Limitless-specific fixes or labeling changes. Their presence here should be read as **research inventory**, not a guarantee that every endpoint remains live.

## Why the lab is separate

The project now deliberately separates three different jobs:

- a large historical source bench;
- focused provider development;
- a small stable promotion catalog.

That separation prevents an experimental provider or upstream change from destabilizing the day-to-day repository while still keeping earlier work available for comparison.

The lab is especially useful when evaluating a new provider because it may already contain an older implementation, identity-mapping approach, extractor, domain list, or stream-label normalizer that can save research time. Those pieces can be reused selectively rather than promoting an entire old provider unchanged.

## Stream-labeling history

One of the useful conventions developed in the earlier branch was behavior-based stream labeling. Historical providers may use compact tags such as:

- `[DUB]` for dubbed audio without selectable subtitles;
- `[HARDSUB]` for subtitles burned into the video;
- `[SOFTSUB]` for selectable subtitle tracks;
- `[DUB+SUBS]` for dubbed audio with selectable subtitles;
- `[HARDSUB+SUBS]` for burned subtitles plus additional selectable tracks.

The later Nexus branches use more human-readable labels where appropriate, but the same underlying principle remains: do not guess subtitle or audio behavior merely from a site's generic `SUB` or `DUB` label.

## Current role of AnikotoTV

AnikotoTV is a good example of how the lab is meant to feed Nexus development. The lab already contained a working AnikotoTV implementation with TMDB, MAL, AniList, TVDB, and episode-number fallback logic. Because it works well enough for normal use, that implementation has now been copied into both `Limitless-nexus` and `Limitless-Master-Nexus` for real-world testing.

The lab copy remains valuable as the historical baseline. Deeper cleanup and modernization will happen on `Limitless-nexus`, while Master will receive only the version considered ready for stable use.

## Frozen baseline and provenance

This branch retains the earlier baseline structure, including locally stored provider JavaScript and source-lock/provenance files where available. The older design intentionally avoided blindly following upstream changes after import, because a provider that updates automatically can break without any corresponding Nuvio-side testing.

That philosophy still informs Nexus development today: upstream implementations are references, not automatic truth. Current site behavior and actual media output matter more than whether a newer upstream commit exists.

## Branch family

- **`Limitless-Master-Nexus`**: stable, small promotion branch for day-to-day use and broader testing.
- **`Limitless-nexus`**: focused active development branch where providers are rebuilt and validated one at a time.
- **`Limitless-Provider-Lab`**: this branch, preserving the broad historical provider collection and experimental work for future research.

The Provider Lab is the attic with labeled boxes rather than the living room. It is allowed to be crowded, because its job is to preserve useful experiments and forgotten adapters that may become valuable again when a source changes or a new provider is selected for development.
