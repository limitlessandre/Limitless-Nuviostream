# Limitless Master Nexus

**Limitless Master Nexus** is the stable promotion branch for the custom Limitless Nuviostream provider repository. It is intended for normal day-to-day use after provider work has been isolated, developed, and device-tested on `Limitless-nexus`.

The stable branch is deliberately small and conservative. Experimental providers, diagnostic probes, topology investigations, and the larger historical provider collection belong on Nexus or Provider Lab instead of being merged wholesale into Master.

## Install

Nuvio manifest:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Master-Nexus/manifest.json
```

A branch-local copy may also exist at `custom/manifest.json`, but the root `manifest.json` is the active stable manifest.

## Branch workflow

The repository deliberately separates three jobs:

- **`Limitless-Provider-Lab`** is the research bench and historical archive. Old ports, broad provider collections, experiments, and useful failed approaches can live there without being considered production-ready.
- **`Limitless-nexus`** is the active development branch. Providers are investigated and rebuilt one at a time, then tested in Nuvio using the Nexus manifest.
- **`Limitless-Master-Nexus`** is the stable promotion branch. Only the tested production implementation for a provider should be promoted here.

### Important promotion rule

**Do not merge the entire Nexus branch into Master just to promote one provider.**

Nexus and Master intentionally diverge and can contain unrelated branch-specific history. Promotion is provider-by-provider:

1. finish and device-test the provider on `Limitless-nexus`;
2. copy/promote only that provider's production code into the corresponding Master provider file;
3. update only that provider's Master manifest entry and the Master repository version as needed;
4. synchronize any canonical documentation that materially changed for that provider;
5. leave unrelated Nexus providers, tests, probes, and diagnostics untouched.

A provider may therefore have different filenames and different blob contents between Nexus and Master while representing the **same tested provider version**. For example, Nexus may use a development-oriented filename such as `wco-production-v5.js` while Master uses `wco-master.js`. **Do not treat different SHAs, file lengths, or filenames alone as evidence that Master is behind.** Compare provider version, promotion history, behavior, and relevant changes instead.

Likewise, do not force-push or overwrite Master merely because a whole-branch Git comparison reports that Nexus is ahead or the branches have diverged. Whole-branch commit counts are not the promotion model.

## Canonical stream naming

The root `NAMING_STANDARDS.md` is the canonical naming specification. Production providers should follow it rather than inventing provider-specific display conventions.

General stream grammar:

```text
Provider • Quality • [TAG] • Optional Mirror/Disambiguator
```

Quality and audio/subtitle tags should be evidence-based. Actual stream/audio metadata outranks provider labels; provider/source evidence outranks content metadata; TMDB original language is a fallback when stronger stream evidence is unavailable. Unknown cases should remain `[UNK]` rather than being guessed.

A disambiguator should only be shown when it adds information not already expressed by the canonical tag. For example, separate English-dub and original encodes do not need redundant `English Dub` / `Original` suffixes when `[DUB+SUB]`, `[DUB]`, or `[SUB]` already communicates the distinction.

## Current stable providers

The active root manifest is authoritative for exact versions. As of the current stable state:

| Provider | Master version | Role |
|---|---:|---|
| Re:ANIME | 1.8.0 | Anime series and movies with direct media, language-aware stream handling, and subtitle preservation. |
| WCO | 2.7.1 | Anime and Western animation, movies, specials, and proven WCO frontend fallbacks. |
| Tubi | 1.3.1 | Broad movie/TV fallback using Tubi's direct playback path. |
| NetMirror | 2.0.2 | Fast movie/TV resolver with separately verified English/original encodes, subtitles, and top-quality filtering. |
| Vidlink | 1.0.0 | Stable Master Vidlink implementation. Nexus currently has newer development work and should be reviewed separately before promotion. |
| KissKH | 1.1.1 | Asian drama/movie provider with the tested Master implementation. |

Repository version: **1.1.5**

If this table becomes stale, trust `manifest.json` and update this README when promoting the next provider.

## NetMirror reference state

NetMirror **2.0.2** is the current promoted implementation.

The main resolver uses the fast Net27/Aoneroom subject path rather than the slow mobile-session bootstrap. It resolves English-dub and original subjects independently, verifies that Net27 actually returned the requested subject/detail path, preserves selectable subtitles, and keeps only the **two highest distinct qualities per audio lane**.

The canonical tag carries the audio distinction, so production rows do not append redundant `English Dub` or `Original` text. TMDB `original_language` is used only as a fallback when stronger audio evidence is unavailable. This allows English-original content to be classified correctly without overriding actual stream evidence.

The slower session-based implementation can expose genuine selectable multi-audio masters, but its cold session bootstrap is roughly tens of seconds and is not suitable for the main provider yet. That implementation is parked as **NetMirror Multi-Audio Lab** on `Limitless-Provider-Lab` for future work. Separate English/original MP4 encodes are not called `[DUAL]`; `[DUAL]` is reserved for media that genuinely exposes multiple selectable audio tracks.

## WCO reference state

WCO's proven production frontend order is:

```text
wcostream.tv → wcoflix.tv → wcoforever.net
```

The production provider includes normal episodes, movies, Season 0 specials, Episode 0 and fractional-special handling, corrected audio classification, explicit-only mirror numbering, direct-series-page fallback, and protection against matching full-season bundles as individual episodes.

WCO Premium was investigated separately. Its dynamic authenticated player/token flow is intentionally not part of the production provider.

## Re:ANIME reference state

Re:ANIME uses TMDB/IMDb identity information with MAL/AniList mapping and structured Flix data. A key behavior is the distinction between genuinely separate SUB/DUB files and shared media that already contains multiple audio or subtitle tracks. Site labels are clues, not proof of the tracks inside a file.

## Provider comparison checklist

When a future chat asks what is on Nexus but not Master, use this order:

1. read this README and the README on `Limitless-nexus`;
2. compare the two active manifests by **provider ID and version**;
3. do not flag same-version providers merely because their branch-specific files differ;
4. for a genuine version difference, inspect that provider's relevant history/code before promoting;
5. treat Nexus-only entries marked Test/experimental as development work, not missing stable providers;
6. inspect Provider Lab separately when looking for future provider candidates.

At the current checkpoint, **Vidlink is the clear version-gap candidate**: Master is 1.0.0 while Nexus is 1.2.0. **AsiaFlix Test** is Nexus-only development work and should not be promoted until its own testing/development cycle is complete.

## Maintenance notes for future chats

- Work on `Limitless-nexus` unless the user explicitly asks to promote a tested provider.
- Promote to `Limitless-Master-Nexus` **one provider at a time**.
- Keep `Limitless-Provider-Lab` for experiments, historical providers, and unfinished alternate architectures.
- Fetch the current file before updating it so the latest blob SHA is used.
- When changing a provider URL/content in a manifest, bump its provider version/cache revision as appropriate so Nuvio does not silently reuse stale code.
- Preserve known identity and episode safeguards when refactoring extraction.
- Do not weaken evidence-based audio/subtitle labeling just to make autoplay labels look nicer.
- Temporary diagnostics should not remain enabled in Master.
- After promotion, verify the Master manifest points to the Master branch provider file, not the Nexus branch.
- The root `NAMING_STANDARDS.md` is canonical for stream labels.

Master should remain boring in the useful sense: a compact set of providers whose promoted state is understood and reproducible.
