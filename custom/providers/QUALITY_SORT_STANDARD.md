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

- `[DUB]` = dubbed audio
- `[SUB]` = original/Japanese audio with subtitles, whether hard or soft
- `[DUB+SUB]` = dubbed audio with subtitle tracks
- `[DUAL]` = dual/multiple audio tracks with subtitles

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
3. Use only `[DUB]`, `[SUB]`, `[DUB+SUB]`, and `[DUAL]` for anime audio/subtitle variants.
4. Hard-vs-soft subtitle detail is intentionally hidden from the main visible label under `[SUB]` unless a future playback requirement makes that distinction necessary.
5. Do not alter diagnostic or informational rows that do not represent playable video quality.
6. Preserve existing provider extraction, matching, language metadata, subtitle tracks, headers, and safety logic. Label normalization is presentation-only.
7. New Nexus providers should follow this convention before being added to the manifest.
