# AniKoto parked investigation — 2026-09-10

Status: parked for later follow-up. Do not treat this as production-ready.

## Why it was parked

AniKoto changed recently and the current behavior no longer maps cleanly onto Nuvio's provider-only runtime. The goal is to resume after upstream AniKoto, AniYomi references, or Nuvio playback/runtime behavior changes enough to give us new leverage. Continuing to probe the same boundary now is unlikely to be a good use of time.

## Last validated Nexus state

- Last active Nexus manifest with AniKoto experiments: `084edbb50b7bea625790a70e515cdabf37e88d97` (Nexus 2.1.65).
- Main relay-v4 implementation commit: `a6332bd2304ae38d442788a170b95970faec75cd`.
- Original Work-mode local commit was reported as `3e913a8`, but it was never uploaded; `a6332bd...` reconstructs the tested files on GitHub.
- Android-direct provider commit: `76c32e2799251d555023d06a5b7a1406d3a66244`.

## What worked

### Extraction / identity

- Mushoku Tensei: Jobless Reincarnation S1E1 was the primary canary.
- AniList: `108465`
- MAL: `39535`
- Identity mapping, current AniKoto/MegaPlay source resolution, AES-CBC encrypted source decoding, dynamic mirror discovery, `getSourcesNew` fallback, SUB/DUB separation, subtitles, and quality detection were all implemented.
- `Vidstream-2` and `HD-1` resolved to the same final URL for the tested Mushoku episode, so the provider intentionally collapsed them into one labeled source instead of showing fake duplicates.

### Relay v4 on Windows

Relay v4 successfully handled the transport behavior that direct provider playback could not reliably handle:

- bounded segment cache
- in-flight request deduplication
- four-segment prefetch
- expiring URL refresh / hoster re-resolution
- ordinary response streaming
- PNG/JPEG-wrapped MPEG-TS detection and unwrapping
- SSRF / loopback protections

Reported validation before device testing:

- 21/21 tests in Node
- 21/21 tests in Bun
- 30 consecutive SUB segments
- 30 consecutive DUB segments
- English, Portuguese, and Spanish VTT files validated

Real Nuvio Desktop testing then confirmed both SUB and DUB playback worked cleanly and the earlier heavy buffering was gone.

## What did not work

### Desktop subtitles

The provider and relay returned valid external subtitle tracks, but Nuvio Desktop did not expose them in the native player menu. Current Nuvio Desktop code accepts `externalSubtitles` at `PlatformPlayerSurface`, then drops them before `NativePlayerSurface`. The native controller/bridge has subtitle APIs, but the provider repository cannot fix that app-side handoff without modifying Nuvio itself.

Do not repeat the synthetic HLS subtitle injection experiment. That approach caused playback to hang even though the subtitle file and playlist requests succeeded.

### Android direct playback

A separate provider, `anikototv-android-direct-v1.js`, was created to stop before localhost rewriting and return the raw resolved HTTPS media URL, headers, and subtitle tracks directly to Nuvio Android. Stream discovery worked, but playback did not load during the first Android test.

Android should not depend on a PC. The failed direct test is therefore parked rather than replaced with a LAN-to-PC workaround.

## Important reference behavior

Two independently working AniYomi AniKoto implementations were examined:

- Yuzono `anime-extensions`
- SalmanBappi `sb-extensions-source`

Both use app-managed local M3U8/proxy transport for problematic AniKoto streams. SalmanBappi's implementation is the stronger performance/lifecycle reference because it includes disk cache, in-flight deduplication, prefetching, playlist/session state, URL refresh/reminting, and wrapped-segment handling.

Arc (`mkelvers/arc`) was also validated end-to-end for the same Mushoku episode. Arc rewrites HLS through its own stream proxy and unwraps disguised segments before returning MPEG-TS.

This strongly suggests the remaining problem is transport/runtime integration rather than title or episode extraction.

## Files to inspect when resuming

Provider / source path:

- `custom/providers/anikototv-nexus-v8.js`
- `custom/providers/anikototv-nexus-v6.js`
- `custom/providers/anikototv-nexus-v5.js`
- `custom/providers/anikoto-sources.js`
- `custom/providers/anikototv-android-direct-v1.js`
- `custom/providers/anikototv-diagnostic-v2.js`

Relay / validation path:

- `tools/anikoto-relay.js`
- `tools/anikoto-relay-core.js`
- `tools/anikoto-transport.js`
- `scripts/anikoto-live.cjs`
- `tests/anikoto.test.cjs`
- `docs/anikoto-relay-v4.md`

Use the immutable commits listed above when comparing historical behavior. Some wrapper files contain branch-based nested URLs, so repoint those before trying to reactivate an old snapshot unchanged.

## Good reasons to resume

Resume the investigation when one or more of these occur:

1. AniKoto/MegaPlay changes its stream delivery again.
2. The Yuzono or SalmanBappi AniKoto extensions receive a meaningful playback/transport update.
3. Nuvio's provider runtime gains a response-body transform, local-server, stream-proxy, or equivalent transport hook.
4. Nuvio Android's playback engine/data-source behavior changes in a way that may handle the raw AniKoto HLS path.
5. Nuvio Desktop begins registering provider `externalSubtitles` with its native player.
6. A new direct AniKoto host/mirror appears that does not require the wrapped-segment transport path.

## Production safety

- `Limitless-Master-Nexus` was never modified for this AniKoto experiment.
- Do not promote the parked provider until Android and Desktop behavior are re-validated without manual development dependencies.
