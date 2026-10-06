# Nexus stream quality and audio label standard

Nuvio sorts plugin streams alphabetically by source name and then by the visible stream label. Provider result order is therefore not enough to keep higher resolutions above lower resolutions.

All manifest-facing Nexus providers should put a sort-friendly quality tier immediately after the provider name while preserving the numeric resolution:

- `2x4K 8K 4320p`
- `4K 2160p`
- `Enhanced QHD 1440p`
- `FHD 1080p`
- `HD 720p`
- `HD-Low 576p` / `HD-Low 540p`
- `SD 480p`
- `SD-Low 360p`
- `SD-Very Low 240p`
- `Unknown Auto`

Anime audio/subtitle variants use exactly these compact tags when applicable:

- `[DUB]` = English/default-English audio, including English-original content and verified English dubs
- `[SUB]` = non-English/original audio with selectable subtitles
- `[DUB+SUB]` = English/default-English audio with selectable subtitle tracks
- `[DUAL]` = dual/multiple selectable audio tracks

Recommended row shape:

`Provider • <quality tier> • <audio tag> • Mirror N`

Only include fields that are useful to the viewer. Omit cosmetic or redundant technical labels such as codec names, HLS version, container type, internal server names, source IDs, and repeated episode/title text unless they distinguish genuinely different playback choices.

Examples:

- `Tubi • 4K 2160p • Mirror 1`
- `Tubi • FHD 1080p • Mirror 1`
- `WCO • HD 720p • [DUB]`
- `WCO • HD 720p • [SUB]`
- `Re:ANIME • FHD 1080p • [DUAL]`
- `AnikotoTV • HD 720p • [DUB+SUB]`

Rules:

1. Keep the original numeric resolution in the `quality` field.
2. Put the quality tier before audio tags and mirror labels.
3. Use `[DUB]` as the simplified English-audio bucket for both English-original/default-English content and verified English dubs.
4. Prefer actual stream/provider audio metadata; content metadata such as TMDB original language is a fallback only when stream audio evidence is absent.
5. Use `[SUB]` for non-English/original audio with selectable subtitles, `[DUB+SUB]` for English audio with selectable subtitles, and `[DUAL]` when multiple selectable audio tracks are exposed.
6. Preserve `[HSUB]` and `[UNK]` where the canonical root `NAMING_STANDARDS.md` requires them.
7. Hard-vs-soft subtitle detail is intentionally compact in the visible label except where `[HSUB]` is needed to describe a verified hard-sub stream.
8. Do not alter diagnostic or informational rows that do not represent playable video quality.
9. Preserve existing provider extraction, matching, language metadata, subtitle tracks, headers, and safety logic. Label normalization is presentation-only.
10. New Nexus providers should follow this convention before being added to the manifest.
