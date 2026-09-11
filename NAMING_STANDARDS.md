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
Vidlink • HD 720p • [HSUB]
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
verified dub + selectable subtitles → [DUB+SUB]
otherwise                          → [SUB]
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

The standalone Vidlink rebuild reproducing the confirmed one-row control contract was manually playback-verified in Nuvio during the September 2026 rebuild. Den-O S1E1 returned the expected single 720p direct row and the current stream class was verified as hard-subbed. The confirmed baseline does not expose selectable subtitle tracks to Nuvio, so this stream class may use `[HSUB]`.

Do not infer `[HSUB]` merely from Vidlink language metadata. If the active Vidlink implementation begins exposing selectable caption tracks, dual audio, or a materially different source class, re-run the normal decision tree and re-verify the classification.

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

That language field describes the audio/content language. It does **not** by itself decide `[SUB]`, `[HSUB]`, `[DUB]`, or `[UNK]`.

Examples:

```text
Japanese + selectable subtitle tracks → [SUB]
Japanese + verified hard subs, no selectable tracks → [HSUB]
Japanese + subtitle behavior unverified → [UNK]
English + explicit Dub label, no selectable tracks → [DUB]
English language only, no other evidence → [UNK]
```

## Implementation rule for future providers

When adding or refining a provider:

1. Preserve extraction/playback behavior first.
2. Inspect the raw row metadata before normalizing the visible name.
3. Detect multiple audio tracks before all other tag logic.
4. Detect real selectable subtitle tracks from returned track arrays.
5. Use explicit source/provider text only for verified Dub or Hard-Sub classification.
6. Never infer subtitle type from Japanese/original language alone.
7. Fall back to `[UNK]` instead of guessing.
8. Put mirror/service disambiguation after the tag and only when useful.
9. Keep diagnostic rows distinct from playable stream rows.

If manual playback establishes a provider-specific rule, record it in this file before teaching wrappers to rely on it.
