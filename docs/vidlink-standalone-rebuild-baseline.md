# Vidlink standalone rebuild: control parity baseline

Status: **selection and row-contract parity verified; actual Nuvio Desktop playback pending user confirmation.** This report implements `docs/vidlink-standalone-rebuild-handoff.md`. It does not supersede its acceptance gate.

Development branch: `Limitless-nexus`. Production `Limitless-Master-Nexus` remains unchanged at `c53c060634cb4dbd7e2cbbe82e7c2b7c019e25b6`. The confirmed Nexus Vidlink entry and failed v1/v2 files are preserved. A separate **Vidlink Standalone Rebuild** entry is added in manifest `2.2.4`; no active Vidlink replacement or promotion has occurred.

## Reference and method

On 2026-09-11, ran `custom/providers/vidlink-eclipsia-nexus-v3.js` with its actual downloaded Haylox runtime against **Kamen Rider Den-O, TMDB 259906, TV S1E1**. Download source:

`https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/providers/haylox.js`

Observed source SHA-256:

`666d0b6160cc42e1f0cebef621dc47262ee8d8695b96351ce75abde3a43a480f`

Production's `vidlink-master.js` was inspected read-only. It loads the Nexus v3 wrapper pinned at `0dc4cae83461b97de361af229ca2e569af7e04f8`; that wrapper dynamically loads the same Haylox endpoint. The hash records the runtime observed during this investigation, not a claim that the remote runtime can never change.

The new provider independently implements the measured control's request, extraction, filtering, sorting, and presentation contract. It contains no runtime code download, dynamic evaluation, or Eclipsia/Codeberg dependency. Credit for the behavioral reference remains explicit. Existing control playlist/legacy response handling is preserved; no additional selection or playback features were introduced.

## Den-O trace

The control first makes these concurrent requests, using fetch defaults with no explicit headers:

1. `GET https://api.themoviedb.org/3/tv/259906?api_key=<redacted>`; a valid title is required.
2. `GET https://enc-dec.app/api/enc-vidlink?text=259906`; uses `result` unchanged as the encrypted ID.

It then makes exactly one Vidlink API request:

`GET https://vidlink.pro/api/b/tv/<encrypted-id>/1/1`

Extraction request headers, copied exactly into the rebuild:

```text
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36
Connection: keep-alive
Referer: https://vidlink.pro/
Origin: https://vidlink.pro
```

There is no `multiLang` query, `X-Playback-Environment`, explicit `Accept`, or second DASH/environment request. The Origin value has no trailing slash.

Observed API fields:

| Field | Value |
|---|---|
| `sourceId` | `mwVault` |
| `stream.type` / `stream.deliveryType` | `file` / `file` |
| `stream.qualities` keys | `360`, `480`, `720` |
| Each quality | Object with `url`, `type: mp4`, `codecName: h264`, empty `headers`, `requiresProxy: true` |
| `stream.playlist` | Absent |
| Captions advertised | Seven; none exposed by control |
| Candidate count in response | Three |
| Candidate count returned | One |

The control reads **object-valued `stream.qualities[key].url`**, deriving quality from the key. It accepts only 720p/1080p/1440p/4K and HTTPS URLs, then deduplicates by exact URL and sorts descending. The 360 and 480 entries cannot pass. This is a quality filter, not a Den-O-specific hardcoded URL or an unconditional `slice(0, 1)`.

The selected URL is exactly `stream.qualities["720"].url`, a direct `.mp4` on `bcdn.hakunaymatata.com`. No URL rewrite, probe, playlist parsing, or proxy conversion occurs during Den-O extraction. There is no master or media playlist in this response. `requiresProxy`, stream flags, codec, resource IDs, sizes, and caption entries are ignored by the control and rebuild. Their presence alone must not change the baseline row.

Returned row:

```text
name: Vidlink Standalone Rebuild • HD 720p • [UNK]
title: <the control's exact invisible sorting prefix>Vidlink
url: <the unmodified 720 quality URL>
quality: 720p
type: video
```

These are the only five fields. **No playback headers** are attached: extraction headers are not copied to the media row. There is also no `behaviorHints`, proxy field, `provider`, `language`, or subtitle field. `[UNK]` follows `NAMING_STANDARDS.md` because the returned row exposes no selectable tracks and its audio/subtitle class is unverified.

For responses with a playlist, the existing control fetches and parses master variants using the same extraction headers. It only exposes variants with accepted, known resolutions; failed requests, media playlists, and variants lacking resolution do not produce an Auto fallback. This existing behavior is retained, but it is not exercised by Den-O and has no separate Nuvio playback claim.

## Failed standalone comparison

Live runs reproduced the handoff's cardinality regression:

| Behavior | Confirmed control | Standalone v1 | Standalone v2 | Rebuild |
|---|---|---|---|---|
| Den-O rows | 1 | 3 | 3 | 1 |
| Qualities | 720p | 360p, 480p, 720p | 720p, 480p, 360p | 720p |
| Direct row `type` | `video` | `mp4` | `mp4` | `video` |
| Playback header override | Absent | Present, including environment | Present | Absent |
| Captions in returned row | Absent | Present | Present | Absent |
| API environments | Plain | standard + dash-hevc | Plain | Plain |

v1 also adds `?multiLang=0`; v2 still accepts string quality values and can expose an unparsed playlist as an Auto fallback. Neither behavior belongs in this rebuild.

The missing quality filter **explains the extra rows**. In the captured live runs, both failed versions' 720p URL was exactly equal to the control's 720p URL. Changed playback headers, media type, and added metadata are therefore material compatibility differences even when the source URL matches. They are not individually proven causes of the reported Nuvio playback failure. Restoring the exact contract avoids guessing which field caused it.

## Verification and next acceptance step

The offline fixture is the observed standard API response with media and caption URLs replaced by `example.invalid` addresses. It contains no usable media tokens. Regression tests compare the control's expected output contract with the failed versions using identical input, check extraction requests, quality rejection, existing playlist semantics, errors, and a timer-free Nuvio-style export.

```text
node --test tests/vidlink-rebuild.test.cjs
node scripts/vidlink-rebuild-live.cjs --probe
```

The live harness checks the control source fingerprint, shares response snapshots across control and rebuild, and compares exact selected URL, row fields, sorting title, and extraction requests. Only the visible provider name may differ. Its optional bounded MP4 byte probe is a transport check, **not actual Nuvio playback verification**. Diagnostic output excludes full media URLs, query tokens, cookies, and API keys. The provider itself does not run diagnostics or media probes.

Results on 2026-09-11: **7/7 regression tests passed**, all provider JavaScript syntax checks passed, and every pre-existing manifest entry was verified unchanged. The fresh live comparison at `2026-09-11T05:40:49.254Z` passed the expected control fingerprint, exact row parity except name, and all three extraction requests. The bounded media probe returned **HTTP 206**, `Content-Type: video/mp4`, `Content-Range: bytes 0-1023/213690988`, and a valid MP4 `ftyp` signature. This proves byte access with no provider playback-header overrides, not decoder or player behavior in Nuvio.

In Nuvio Desktop, refresh the existing Limitless Nexus manifest and open Den-O S1E1. Select **Vidlink Standalone Rebuild • HD 720p • [UNK]**. Confirm that exactly one rebuild row appears and that selecting it actually starts the correct episode with video and audio. Record the outcome before adding captions, lower qualities, environment variants, or any other feature.

Until that confirmation, the rebuild remains unconfirmed and the active Vidlink control stays available. Production changes require the user's explicit permission; this task does not authorize them.
