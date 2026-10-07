# Limitless Nexus

**Limitless Nexus** is the active custom-provider development branch for Limitless Nuviostream. Providers are researched, rebuilt, tested, and cleaned up here before their production implementation is promoted individually to `Limitless-Master-Nexus`.

Nexus is intentionally not a mirror of Master. It may contain newer provider implementations, test providers, diagnostic scripts, and branch-specific production filenames.

## Install

Nuvio development manifest:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/manifest.json
```

The root `manifest.json` is the active Nexus manifest.

## Branch model

- **`Limitless-Provider-Lab`**: historical provider bench, old ports, broad experiments, alternate architectures, and unfinished research.
- **`Limitless-nexus`**: focused development and device-testing branch.
- **`Limitless-Master-Nexus`**: stable day-to-day catalog containing only individually promoted provider implementations.

### Promotion is provider-by-provider

Do **not** merge Nexus wholesale into Master merely to promote a completed provider. The branches intentionally have unrelated/divergent history.

For a promotion:

1. finish the provider here;
2. device-test its identity, episode, playback, audio, subtitles, quality, and naming behavior;
3. copy only the tested production implementation into the corresponding Master provider file;
4. update only that provider's Master manifest entry and the Master repository version as appropriate;
5. synchronize relevant canonical documentation;
6. leave unrelated Nexus experiments and diagnostics here.

Master and Nexus provider files are not expected to be byte-identical. Same-version providers can legitimately have different filenames, SHAs, comments, or branch packaging. Compare **provider version and actual promotion state**, not blob size alone.

## Canonical naming

The root `NAMING_STANDARDS.md` is authoritative.

General grammar:

```text
Provider • Quality • [TAG] • Optional Mirror/Disambiguator
```

Evidence priority is:

```text
actual stream/audio metadata
→ provider/source evidence
→ content metadata such as TMDB original language
→ [UNK]
```

TMDB original language is a fallback, not proof that a particular returned stream uses that language. `[DUAL]` is reserved for media with genuinely selectable multiple audio tracks, not separate original/dub encodes.

Do not add redundant suffixes such as `English Dub` or `Original` when the canonical tag already communicates the distinction.

## Current Nexus providers

The active manifest is authoritative for exact versions. Current checkpoint:

| Provider | Version | State |
|---|---:|---|
| Re:ANIME | 1.8.0 | Established |
| WCO | 2.7.1 | Established |
| AsiaFlix Test | 0.3.6 | Active development/test provider |
| Tubi | 1.3.1 | Established |
| NetMirror | 2.0.2 | Complete and promoted to Master |
| Vidlink | 1.2.0 | Newer than Master; next clear promotion-review candidate |
| KissKH | 1.1.1 | Established |

Repository version: **2.3.14**

Re:ANIME, WCO, Tubi, and KissKH currently share their advertised provider versions with Master. Their branch files differ by design and should **not** be treated as unpromoted solely because the blobs differ.

## NetMirror checkpoint

NetMirror **2.0.2** is complete on Nexus and has been promoted individually to Master.

The fast production route uses Net27 plus Aoneroom subject topology. It resolves verified English-dub and original encodes separately, fails closed on subject/episode mismatch, preserves selectable subtitles, and keeps only the **two highest distinct qualities per audio lane**.

Production names rely on canonical tags rather than redundant `English Dub` / `Original` suffixes. TMDB `original_language` is used as a fallback for original-language classification when stronger stream evidence is unavailable.

A separate slow session-based NetMirror route can expose genuine multi-audio masters. Its cold bootstrap remains too slow for production, so that implementation is parked in Provider Lab as **NetMirror Multi-Audio Lab**. Future work on true `[DUAL]` NetMirror should resume there rather than complicating the fast production resolver.

## Current next steps

At this checkpoint:

1. **Vidlink** is the obvious stable-vs-development version gap: Nexus 1.2.0 vs Master 1.0.0. Review/test it before promotion.
2. **AsiaFlix Test** remains Nexus-only and should get its own development cycle next rather than being promoted just because it is absent from Master.
3. Re:ANIME, WCO, Tubi, and KissKH should be considered version-synchronized unless provider history shows a post-promotion change.
4. Provider Lab should be reviewed separately when choosing new provider candidates.

## Provider development principles

Nexus aims for a compact catalog, roughly twenty or fewer maintainable providers, with useful independent overlap across anime, Western animation, Asian drama, movies, and live-action television.

Prefer providers with reliable identity paths, explicit episode structure, useful language metadata, and extraction paths that work directly in Nuvio. Independent fallbacks are more valuable than several frontends backed by the same source.

Identity resolution and extraction are separate concerns. Preserve a working matching layer while debugging playback. Likewise, a playable URL is not considered finished until the returned media's quality, audio, subtitle, and mirror labels are evidence-based.

Site labels are clues, not proof of media tracks.

## Notes for future chats

When continuing work in a new conversation:

- Start by reading this README, the Master README, `NAMING_STANDARDS.md`, and the active manifests.
- Assume `Limitless-nexus` is the working branch unless the user explicitly asks for promotion.
- Never promote the whole Nexus branch to Master for a single provider.
- Fetch current files before GitHub writes and update using the current blob SHA.
- Keep production changes isolated from unrelated providers.
- Bump provider/cache revisions when necessary to defeat stale Nuvio caching.
- Preserve episode/title identity safeguards.
- Do not infer audio language from a dub/source label when stronger media evidence contradicts it.
- Keep diagnostic providers out of Master.
- After device testing succeeds, promote only the finished provider's production code and manifest metadata.

The point of Nexus is to make provider work understandable one source at a time, rather than turning the repository back into a single giant experiment.
