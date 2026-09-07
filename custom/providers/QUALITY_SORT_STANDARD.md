# Nexus stream quality label standard

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

Recommended row shape:

`Provider • <quality tier> • <audio/variant/server> • Mirror N`

Examples:

- `Tubi • 4K 2160p • Mirror 1`
- `Tubi • FHD 1080p • Mirror 1`
- `WCO • HD 720p • English Dub`
- `Re:ANIME • SD 480p • Soft Subs`

Rules:

1. Keep the original numeric resolution in the `quality` field.
2. Put the quality tier before language, server, mirror, codec, or audio labels.
3. Do not alter diagnostic or informational rows that do not represent playable video quality.
4. Preserve existing provider extraction, matching, and safety logic. Quality labeling is presentation-only.
5. New Nexus providers should follow this convention before being added to the manifest.
