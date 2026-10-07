# AsiaFlix quality rebuild handoff

## Scope

Work only on `Limitless-nexus`.

Do **not** modify `Limitless-Master-Nexus`.
Do **not** change unrelated providers.
Do **not** replace the current AsiaFlix resolver unless evidence proves the resolver itself is the problem.

Current Nexus head when this handoff was written:

`034f9b9eb15f568d53a3ffde068d019f5a487c3e`

Current AsiaFlix manifest entry:

- provider: `AsiaFlix Test`
- version: `0.5.1`
- file: `custom/providers/asiaflix-nexus-v10.js`
- manifest: root `manifest.json` only

## Confirmed current behavior

The current AsiaFlix path is materially farther along than the old diagnostic implementation.

For **Unang Pasok**, Nuvio now receives a normal playable-looking stream row:

```
AsiaFlix Test • Unknown Auto • [SUB]
Auto
```

This means the provider is already successfully reaching a validated media row and exposing selectable subtitle tracks. The `[SUB]` classification is therefore behaving as intended.

The remaining visible defect is **quality detection**. A valid stream is reaching Nuvio with `quality: "Auto"` because the current probing path cannot derive a reliable video height.

Do not regress this working behavior while investigating quality.

## Current implementation details

`custom/providers/asiaflix-nexus-v10.js` currently includes:

- first-party AsiaFlix resolver calls
- bounded host fallbacks
- StreamWish handling
- Vidbasic Standard Server support
- Vidbasic encrypted media URL decoding
- selectable subtitle extraction
- HLS master parsing
- HLS child-playlist validation
- MP4 probing
- H.264 SPS height parsing
- MPEG-TS payload probing
- up to five HLS segment probes
- canonical Nexus quality labels
- evidence-based `[SUB]`, `[DUB+SUB]`, `[HSUB]`, `[DUB]`, `[DUAL]`, `[UNK]`

The current manifest description says this explicitly, so do not assume quality probing is absent. The task is to determine why it fails for this live stream.

## Primary target

Reproduce the exact live path for **Unang Pasok** that currently produces:

```
AsiaFlix Test • Unknown Auto • [SUB]
```

Then identify the actual video resolution using reliable evidence from the live media.

The end goal is:

```
AsiaFlix Test • <canonical quality> • [SUB]
```

with the same playback URL behavior and the same selectable subtitle behavior.

Examples of canonical labels:

- `FHD 1080p`
- `HD 720p`
- `HD-Low 540p`
- `SD 480p`
- `SD-Low 360p`

Do not guess a quality from bitrate, filename, server name, or site styling.

## Investigation requirements

Instrument the provider or build a temporary local diagnostic that captures, for the exact winning media source:

1. first-party AsiaFlix resolver response
2. final selected media URL and content type
3. whether the URL is HLS or MP4
4. HLS master playlist, if any
5. variant playlist metadata, if any
6. media playlist container type
7. several real media segments
8. segment codec/container structure
9. whether SPS/PPS/VPS data appears only after the first few segments
10. whether the stream is MPEG-TS, fMP4/CMAF, or another container
11. whether resolution can be obtained from initialization segments, PMT/PES metadata, AVC/HEVC SPS, MP4 boxes, or another deterministic source

Use tools such as `ffprobe` locally in the Work environment as a **diagnostic reference** if useful, but the final provider must derive quality using code that works in the Nuvio provider runtime. Do not make Nuvio depend on ffprobe.

## Likely failure areas to check

The current implementation may be failing because:

- the first five probed segments do not contain an H.264 SPS
- the stream is HEVC/H.265 rather than H.264
- the stream uses fMP4/CMAF and resolution is in an init segment
- the SPS is split across PES/TS packets in a way the current concatenation parser mishandles
- the relevant video PID is not being reconstructed correctly
- an HLS master exists but omits RESOLUTION
- the media is returned as a direct playlist rather than a master playlist
- range behavior prevents the probe from receiving enough bytes
- the quality exists in a source/API field that is currently discarded
- an initialization map or codec config box contains the dimensions

Determine which one is actually true before changing the parser.

## Safety / regression constraints

Preserve:

- exact title ownership
- episode ownership
- the working first-party resolver path
- Vidbasic Standard Server behavior
- selectable English subtitles
- current `[SUB]` classification when selectable subtitle tracks exist
- bounded timeouts
- source validation
- one winning row behavior unless there is strong evidence multiple distinct playable qualities should be exposed

Do not:

- hardcode Unang Pasok resolution
- infer resolution from bitrate alone
- tag a row `[HSUB]` when selectable subtitle tracks exist
- expose unvalidated API candidates
- turn diagnostics into permanent user-visible rows
- touch Master

## Secondary regression check

After fixing Unang Pasok quality, verify at least one additional AsiaFlix title that uses a different host/container path if available. The goal is to make the detector general rather than title-specific.

If a stream genuinely has no trustworthy resolution evidence, it is acceptable to leave it `Unknown Auto`. The objective is evidence-based quality, not forced labeling.

## Definition of done

The change is ready for user testing when:

1. Unang Pasok still returns the same working stream path.
2. Its selectable subtitles still produce `[SUB]`.
3. The provider derives a real resolution from media evidence and displays the canonical quality label, **or** the investigation proves that the live source exposes no trustworthy resolution evidence and documents why.
4. No unrelated provider or production file changes.
5. JavaScript syntax checks pass.
6. Temporary diagnostics are removed or isolated before the user test.

Commit the Nexus-only result and report exactly what media evidence produced the quality value.
