# Limitless Nexus Naming Standards

This file is the canonical reference for user-facing stream names in **Limitless Nexus**. When a future development chat is asked to "use the naming standards", "follow the Nexus naming scheme", or similar, inspect this file before changing provider labels.

These rules govern user-facing presentation and the final quality-selection default. They must not be used to invent media properties that the provider, returned tracks, or prior scoped manual verification do not establish, or to rewrite extraction outside the authorized maintenance scope.

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
KissKH • DIAG NO SOURCE FOUND • S1E2
```

## Audio/subtitle tag decision tree

Tags are evidence-based. Apply them in this priority order.

### 1. `[DUAL]`

Use only when multiple selectable audio tracks are genuinely available in the returned media. Actual track metadata or an explicit trustworthy player/source declaration of selectable multiple audio can establish this; a marketing label, multiple servers, or separate dub/original encodes cannot.

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

`[DUB]` is the English/default-English audio bucket, whether English-original or an English dub, on the verified evidence and scoped fallback rules below. Actual stream/player audio evidence comes first; a Dub label or trusted English-original content fallback must not override contradictory media evidence. An unproven display string saying English is not, by itself, verification.

`[HSUB]` requires explicit hard-sub evidence from the source/provider or a provider/stream class that has been manually verified in playback. Japanese/original audio by itself is not enough.

`[UNK]` means the stream is playable but its audio/subtitle class has not been verified well enough for one of the other tags. It is intentionally actionable: a `[UNK]` row is a candidate for manual site/playback verification.

## Current provider-specific verification

### NetMirror

The main NetMirror provider uses the fast verified Net27/Aoneroom subject route. English Dub and Original encodes are separate stream rows rather than being labeled `[DUAL]` unless the returned media itself exposes multiple selectable audio tracks.

- verified English Dub + selectable subtitles → `[DUB+SUB]`
- verified English Dub + no selectable subtitles → `[DUB]`
- verified non-English Original + selectable subtitles → `[SUB]`
- English-original/default-English content + selectable subtitles → `[DUB+SUB]` when stream/provider evidence or trusted content-language fallback establishes English
- English-original/default-English content + no selectable subtitles → `[DUB]` on the same evidence basis
- use `[DUAL]` only for a genuine multi-audio source, not merely because separate dub/original encodes both exist

The slower session-based NetMirror implementation that can expose genuine selectable multi-audio masters is parked in Provider Lab until its cold bootstrap delay is solved.

### KissKH

The current first-party Japanese KissKH stream class was manually verified during the September 2026 Nexus investigation as hard-subbed when no selectable subtitle tracks are exposed. Therefore current Japanese KissKH first-party rows with no selectable subtitle tracks may use `[HSUB]`.

Do not generalize that rule to other languages or providers. If KissKH changes its playback model, re-verify this assumption.

### Vidlink

Vidlink follows the general Nexus decision tree. The old Den-O S1E1 hard-sub playback check is not a provider-wide rule and must not be used to classify unrelated titles.

Current behavior:
- actual Vidlink audio/subtitle metadata takes priority
- English-original/default-English content may fall back to TMDB `original_language: en` → `[DUB]`
- non-English content with selectable subtitle tracks → `[SUB]`
- non-English content with no subtitle/audio evidence → `[UNK]`
- use `[HSUB]` only when the returned source explicitly establishes hard subtitles

The production provider reads caption/subtitle arrays returned by Vidlink and uses the same `multiLang=0` API mode observed in Vidlink's own player flow. If future payloads expose multiple audio tracks or explicit English-dub metadata, classify them with the normal `[DUAL]` / `[DUB]` rules.

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

## Global quality-selection default

Return the **two highest distinct verified qualities per meaningful audio category**, independently for actual language/track variants and useful independent mirrors. Apply selection after identity/media validation and sufficient quality evidence, not before discovering which candidates actually work.

| Available valid qualities within one category/mirror | Keep |
|---|---|
| 1080p DUB, 720p DUB, 480p DUB | 1080p DUB and 720p DUB |
| 1080p HSUB, 720p HSUB, 480p HSUB | 1080p HSUB and 720p HSUB independently of DUB |
| 480p and 360p | Both; no minimum resolution |
| Only one valid tier | That tier |

Measured resolution wins over contradictory labels. If binary probing cannot measure dimensions, explicitly trustworthy first-party player information may supply a height only when it belongs to the approved content/player and exact media URL. Preserve measured/source-reported/unknown provenance internally. Filenames, guessed URLs and unsupported labels are not quality evidence. Adaptive sources without a verified available height remain **Unknown Auto**; do not duplicate an identical master URL under invented fixed resolutions.

Unknown resolution is not a shared height-zero tier. Preserve distinct useful valid unknown URLs; never collapse them merely because dimensions are unavailable. Where two better evidenced tiers already exist within the **same** category/mirror, unrankable extras may be omitted under a documented provider-specific selection decision (the existing WCO policy). Preserve unknowns when fewer than two evidenced alternatives exist. Candidate-inventory tests must show that a known superior source or an otherwise lost audio category was not discarded.

Two qualities is not a two-row limit across the provider. Distinct languages, genuine selectable audio/track sets and useful independent mirrors retain their own choices. Redundant URLs/headers or repeated known tiers without independent value should be deduplicated. A CDN hostname difference alone is not mirror evidence. Document exceptions such as a useful independent fallback or an adaptive master; never use an exception to advertise unsupported properties.

## Evidence priority and diagnostic separation

Use actual verified stream/track/media facts first, then trustworthy player/source evidence tied to the selected content, then scoped manual verification or trusted content-language fallback when stronger facts are unavailable. Content metadata never overrides contrary stream evidence. Preserve genuine selectable subtitle tracks; hard subtitles are not selectable tracks. Keep every provider-specific verification section above in its recorded scope.

Diagnostics use the separate `Provider • DIAG CODE • Concise Explanation` grammar and no audio/quality stream tag. Codes, sanitization, failure evidence and release behavior are owned by [PROVIDER_DEVELOPMENT_STANDARDS.md](PROVIDER_DEVELOPMENT_STANDARDS.md#4-diagnostic-contract). Their transport must satisfy the [versioned Desktop contract investigation](docs/provider-standards/DESKTOP_DIAGNOSTIC_COMPATIBILITY.md); a correctly named HTTP-icon diagnostic is still potentially playable.

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
