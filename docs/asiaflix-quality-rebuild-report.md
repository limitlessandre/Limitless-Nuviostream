# AsiaFlix quality rebuild

Authoritative specification: `docs/asiaflix-quality-rebuild-handoff.md`. Baseline `03e1dc7` (AsiaFlix 0.5.1 / Nexus 2.3.36), branch `Limitless-nexus`. Proposed result: AsiaFlix **0.5.2**, Nexus **2.3.37**, provider revision **052**. No other provider, application code, Master branch, or resolver architecture changed.

## Live result and exact quality evidence

Normal `getStreams(1788779, "movie", 1, 1)` now returns one row:

```text
AsiaFlix Test • HD 720p • [SUB]
quality: "720p"
```

The winning Vidbasic Standard Server URL remains the same exact signed URL captured during the baseline investigation (query omitted here):

```text
https://stream.vidbasic.top/0b4f3d7e-4dc3-d047-dde4-a862382a974c/index.m3u8
```

Its first-party AsiaFlix resolver still returns `500 {"message":"INTERNAL_ERR"}`. The existing episode-owned Vidbasic iframe/AES fallback remains responsible for playback. The actual output is a direct, complete HLS **media playlist**, not a master. It has no `RESOLUTION`, no variant metadata, and no `EXT-X-MAP`. Media segments are MPEG-TS stored as byte ranges within `.html` objects. The playlist misleadingly reports `image/jpeg`; the segment responses misleadingly report `text/html`. Inspection uses their bytes, not MIME labels.

The first real segment sample was fetched with the same Vidbasic playback headers, `Range: bytes=0-32767`. It returned 206 with the matching Content-Range. Its PMT identifies:

- PID **256**, stream type **0x1b**: H.264/AVC video.
- PID **257**, stream type **0x0f**: AAC audio.

At byte offset **1293**, PID 256 contains an Annex-B H.264 SPS. Decoding its Exp-Golomb macroblock dimensions and frame-cropping fields yields **width 1280, height 720**. The runtime height detector returns **720** from this configuration; the existing canonical label function produces **HD 720p**. The title, file extension, bitrate, server name, API quality label, and site SUB styling do not supply the resolution.

SPS plus the following PPS prefix, used as a tiny codec-only regression fixture:

```text
0000016764001facc86014016ec05a808080a000000300470100142000000781e30633400000000168e978f3c8
```

Five *distinct* declared segment ranges were inspected. Every sample contains H.264 SPS evidence for 720p. Later segment samples locate it at byte 414. It is therefore **not** a delayed SPS, HEVC/VPS issue, fMP4/CMAF/init-map issue, missing video PID, or absent resolution evidence.

| Declared segment start | Audit sample range | Detected height |
|---|---|---|
| 0 | 0–32767 | 720 |
| 494252 | 494252–527019 | 720 |
| 1283288 | 1283288–1316055 | 720 |
| 3307860 | 3307860–3340627 | 720 |
| 4865816 | 4865816–4898583 | 720 |

The committed `asiaflix-quality-rebuild-evidence.json` contains response metadata, hashes, PMT/SPS findings, byte-transport comparisons, and the final live provider run. Raw manifests, responses, and segment bytes are isolated outside the repository; signed output tokens are not committed.

## Why the previous runtime lost quality

The existing SPS parser already detects 720p when given intact bytes. The failures occur before or around that parser:

1. `request()` appended an entire reader chunk with `bytes.push(...part.slice(...))`. A single 256 KiB response chunk exceeds the engine's argument stack limit. Replaying the live bytes in that response shape produced **Maximum call stack size exceeded**. The segment probe swallowed the error and returned no height, leaving Auto. Streaming chunk sizes are environment-dependent; a native Node fetch with smaller chunks can already return 720p on the baseline.
2. A response exposing only `text()` reached numeric byte parsers as a string. Replaying the same media as a lossless Latin-1 byte string gave baseline height **0**, even though the SPS was present. The rebuilt binary reader converts lossless byte strings to numeric bytes. It rejects strings containing characters beyond byte range, including UTF-8 replacement characters; lost binary data cannot safely produce quality.
3. The first five playlist entries all point to `0.html` with different `EXT-X-BYTERANGE` offsets. The baseline ignored these offsets and fetched `bytes=0-262143` five times. That did not inspect five real segments and could never find parameter sets occurring only in a later range.

The committed evidence distinguishes these reproduced transport failures from device-specific diagnosis. An `arrayBuffer()` response gave 720p on both baseline and fixed code. Actual installed-device fetch behavior still requires the user test; the investigation does not claim every Nuvio version has the same transport defect.

## Runtime change

- Append reader bytes with bounded indexed copies, avoiding spread argument overflow.
- Normalize byte-string responses before parsing. Prefer real reader/ArrayBuffer bytes where available and fail quality closed when text decoding is lossy. Preserve an intact ASCII MP4 file signature when present so unavailable codec bytes do not discard an otherwise validated MP4 row.
- Parse explicit and implicit HLS byte-range offsets. Deduplicate identical URL/offset probes, not distinct segments stored in the same object.
- Inspect an observed init map before media segments when present, using existing MP4 dimension parsing.
- Read at most 32 KiB per HLS sample, up to five samples under a shared **two-second quality budget**, inside the unchanged twelve-second resolver budget. A successful first SPS stops probing immediately.
- Preserve the intact master/media URL, signed parameters, headers, captions, ownership checks, one-row selection, and all classification logic. Optional quality failure returns the validated row with Auto rather than discarding playback.

Current official Nuvio mobile/TV code supports `Response.arrayBuffer()` using base64 native transport. The provider uses this supported API without modifying the application. References: [mobile binary fetch change](https://github.com/NuvioMedia/NuvioMobile/pull/2041), [current mobile bindings](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/plugins/runtime/js/JsBindings.kt), [current TV runtime](https://github.com/NuvioMedia/NuvioTV/blob/dev/app/src/full/java/com/nuvio/tv/core/plugin/PluginRuntime.kt). Older bridges that irreversibly UTF-8-decode media still fail quality closed; the provider cannot reconstruct destroyed bytes. No ffprobe dependency is introduced.

## Verification

| Path | Result | Resolution evidence | Resolver time / requests |
|---|---|---|---|
| Unang Pasok, normal movie provider path | HD 720p / SUB, same Vidbasic HLS URL | First segment AVC SPS: 1280×720 | **1.705 s / 7** |
| Prosecutor S1E1, normal TV provider path | HD-Low 640p, first-party HLS proxy | Master `RESOLUTION=1280x640`, validated child | **4.642 s / 10** |
| Prosecutor same-episode API MixDrop lane | HD-Low 640p, MP4 proxy | Existing MP4 `tkhd` fixed-point height | **1.392 s / 2** |

Unang's English subtitle remains exported with language `en`, name `English`, and playback headers. Independent caption fetch returned 200 with valid cue timings. SUB still takes precedence when a selectable caption exists. Secondary classification is unchanged from the 0.5.1 baseline.

`node --test tests/asiaflix-quality.test.cjs tests/asiaflix-playback.test.cjs`: **29/29 pass**. Coverage includes live SPS bytes; differing synthetic resolutions and cropping; TS packet splitting; reader/ArrayBuffer/byte-string interfaces; large chunks; lossy/unknown bytes and preserved MP4 playback; real byte-range continuation; initialization maps; ignored Range responses; timeout fallback; intact dual-audio master selection; and existing title/episode/resolver/caption regressions. Syntax and diff checks pass.

Temporary diagnostics are isolated outside the Git repository and absent from the committed provider. New `__test` exports are pure parser helpers, not network diagnostics or user-visible rows. Commit scope is the AsiaFlix provider, its manifest entry/root version, these two regression suites, and this report/evidence. Existing unrelated untracked investigations are excluded.

Ready for Nuvio device testing. Unsupported codec data or an irreversibly decoded response may honestly remain Unknown Auto. No resolution or title is hardcoded in the runtime detector.
