# Limitless Nexus Naming Standards

This file is the canonical reference for user-facing stream names in **Limitless Nexus**. When a future development chat is asked to "use the naming standards", "follow the Nexus naming scheme", or similar, inspect this file before changing provider labels.

These rules apply to presentation only. They must not be used to invent media properties that the provider, returned tracks, or prior manual verification do not establish.

## Stream-card grammar

Use this order:

```text
Provider • Quality • [TAG] • Optional Mirror/Disambiguator
```

Examples:

```text
WCO • FHD 1080p • [DUB] • Mirror 2
WCO • HD 720p • [HSUB] • Mirror 1
KissKH • HD 720p • [HSUB]
Re:ANIME • FHD 1080p • [SUB]
Vidlink • HD 720p • [DUB]
NetMirror • SD 480p • [DUB]
```

Diagnostics are not normal stream classifications and keep their diagnostic form, for example:

```text
KissKH • DIAG NO SOURCE FOUND
```

## Audio/subtitle tag decision tree

Tags are evidence-based. Apply them in this priority order.

### 1. `[DUAL]`

Use when the source explicitly identifies dual/multiple audio, or the returned media metadata exposes more than one selectable audio track.

`[DUAL]` takes priority whether selectable subtitle tracks are present or not.

### 2. Selectable subtitle tracks

A subtitle is considered selectable only when the returned stream exposes actual subtitle/caption track entries, normally through fields such as `subtitles`, `subtitleTracks`, `captions`, or `tracks`, with a usable track URL/source.

If selectable subtitle tracks exist:

```text
English/default-English audio + selectable subtitles → [DUB+SUB]
otherwise                                           → [SUB]
```

`[SUB]` and `[DUB+SUB]` must **not** be inferred from a site saying "subbed" or from the audio language alone. They specifically mean selectable/soft subtitle tracks are exposed to Nuvio.

### 3. No selectable subtitle tracks

When no selectable subtitle tracks are exposed:

```text
verified dub      → [DUB]
verified hard-sub → [HSUB]
anything else     → [UNK]
```

`[DUB]` requires explicit dub evidence such as a provider/source label saying Dub/English Dub or equivalent verified metadata. English language by itself is not enough.

`[HSUB]` requires explicit hard-sub evidence from the source/provider or a provider/stream class that has been manually verified in playback. Japanese/original audio by itself is not enough.

`[UNK]` means the stream is playable but its audio/subtitle class has not been verified well enough for one of the other tags. It is intentionally actionable: a `[UNK]` row is a candidate for manual site/playback verification.

## Current provider-specific verification

### KissKH

The current first-party Japanese KissKH stream class was manually verified during the September 2026 Nexus investigation as hard-subbed when no selectable subtitle tracks are exposed. Therefore current Japanese KissKH first-party rows with no selectable subtitle tracks may use `[HSUB]`.

Do not generalize that rule to other languages or providers. If KissKH changes its playback model, re-verify this assumption.

### Vidlink

The standalone Vidlink rebuild reproducing the confirmed control contract does not currently expose selectable subtitle tracks to Nuvio. Playback testing also shows a single audio track for the current stream class.

Use content-aware labeling for this provider:
- English-original/default-English content from TMDB `original_language: en` → `[DUB]`
- Non-English content with no selectable subtitles → retain the manually verified `[HSUB]` fallback for the current Vidlink stream class

Den-O S1E1 remains the manual verification baseline for the non-English hard-sub fallback. If Vidlink begins exposing selectable captions, multiple audio tracks, or explicit audio-language metadata, prefer that stream evidence and re-run the normal decision tree.

### WCO

WCO source labels can explicitly identify English Dub and Japanese/English Hard Subs. Those explicit labels are valid evidence for `[DUB]` and `[HSUB]` when no selectable subtitle tracks are returned. If a WCO row merely says Sub/Subbed without proving hard subs and exposes no selectable tracks, use `[UNK]` until verified.

## Quality labels

Use the canonical quality tier before the audio/subtitle tag:

```text
>= 4320p → 2x4K 8K 4320p
>= 2160p → 4K 2160p
>= 1440p → Enhanced QHD 1440p
>= 1080p → FHD 1080p
>= 720p  → HD 720p
>= 540p  → HD-Low 540p
>= 480p  → SD 480p
>= 360p  → SD-Low 360p
< 360p   → SD-Very Low <height>p
unknown/adaptive without a known height → Unknown Auto
```

Use the actual detected height in the label rather than forcing the examples above when a source reports a different resolution in the same tier.

## Mirrors and other disambiguators

Mirror labels follow the audio/subtitle tag:

```text
Provider • Quality • [TAG] • Mirror N
```

Only call something a mirror when the provider/source actually distinguishes it as a mirror or there is verified independent fallback value. Do not manufacture mirror numbers merely because two CDN hostnames differ.

Service names or other disambiguators should be hidden unless they are needed to distinguish otherwise equivalent rows. For example, NetMirror should not display `Netflix` merely as decoration; show a service name only when two otherwise equivalent rows would collide and the service distinction is useful.

## Language field versus classification tag

Nuvio may separately show a language line such as:

```text
720p • Japanese
```

That language field is evidence about the stream audio when it comes from the returned stream/provider metadata. Content-level language metadata such as TMDB original language is a lower-priority fallback and must not override contradictory stream metadata.

Examples:

```text
English stream audio + selectable subtitle tracks → [DUB+SUB]
English stream audio + no selectable subtitles → [DUB]
English-original content + no stream audio metadata → [DUB] fallback
English-original content + selectable subtitles + no stream audio metadata → [DUB+SUB] fallback
Japanese + selectable subtitle tracks → [SUB]
Japanese + verified hard subs, no selectable tracks → [HSUB]
Japanese + subtitle behavior unverified → [UNK]
Japanese-original anime + explicit English Dub → [DUB]
```

## Implementation rule for future providers

When adding or refining a provider:

1. Preserve extraction/playback behavior first.
2. Inspect the raw row metadata before normalizing the visible name.
3. Detect multiple audio tracks before all other tag logic.
4. Detect real selectable subtitle tracks from returned track arrays.
5. Treat English/default-English audio as the `[DUB]` bucket, whether English-original or an English dub.
6. Prefer actual stream/provider audio evidence over content metadata.
7. When stream audio metadata is absent, use trusted content metadata such as TMDB original language only as a fallback for English-original content.
8. Never infer subtitle type from Japanese/original language alone.
9. Fall back to `[UNK]` instead of guessing when neither stream nor trusted content metadata establishes the class.
10. Put mirror/service disambiguation after the tag and only when useful.
11. Keep diagnostic rows distinct from playable stream rows.

If manual playback establishes a provider-specific rule, record it in this file before teaching wrappers to rely on it.
