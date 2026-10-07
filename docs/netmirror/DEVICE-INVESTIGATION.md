# Device playback follow-up — baseline b0d86c9

Production gate: do not alter NetMirror 1.3.0 / Nexus 2.3.9 until the candidate tests explain the false acceptance and a fresh replacement passes repeated fetches using its exact exported headers.

## Findings established before production changes

* Baseline `inspectHls` fetches the master once, accepts any child that starts with EXTM3U and has EXTINF, and never sums durations. The new baseline-reproduction test confirms that a 19-second video child with full-length audio passes as a 720p DUAL source.
* Baseline semantic deduplication is first-wins. Mobile `sources[]` lists Auto before Mid HD. The saved resolver output confirms that **all three deployed rows used Auto**, not the signed `q=720p` source. A regression reproduces that choice even when the rows have identical media and audio sets.
* Subtitle metadata contains invalid language values such as `81947712-en`, `81048667-ar`, and `81048667-es-es`: the old normalizer treats the entire subtitle filename stem as a language. The descriptive `name` remains correct, explaining the device's visible labels inside Unknown groups.
* Current public NuvioMobile HEAD was verified as `b1c9d08435a5b7d7487b30bbf181cb48830c2458`. Its `PluginRuntime.kt` reads `subtitles[].url`, `.language`, `.name`, and optional `.headers`. Android `PlayerEngine.android.kt` passes language to `setLanguage` and name to `setLabel`. This is not a `lang` versus `language` field mismatch.

The 19-second fixture is synthetic, based on the device report. It is not represented as a captured server response. Captured valid media playlists have video/English-audio durations of 3163.079/3162.986 seconds (Teach), 1574.250/1574.358 (Centaurworld), and 3655.854/3655.701 (Squid Game).

## Pre-production live gate: PASS

Fresh signed mobile playlist sources were tested independently on 2026-10-06. All returned sources were Auto and Mid HD; none advertised a separate Full HD source. Each candidate was fetched three times with precisely its exported Referer/User-Agent/Accept/Accept-Language headers and no cookies. Selected candidates then passed three additional checks after a further delay.

| S1E1 | Selected source | Verified video duration | Runtime metadata | Audio tracks | Captions | Delayed checks |
|---|---|---:|---:|---:|---:|---|
| Teach You a Lesson | signed Mid HD, q=720p | 3163.079 s | 3120 s | 20 | 9 | 3/3 |
| Centaurworld | signed Mid HD, q=720p | 1574.250 s | 1560 s | 32 | 33 | 3/3 |
| Squid Game | signed Mid HD, q=720p | 3655.854 s | 3660 s | 25 | 63 | 3/3 |

Auto also remained stable during this particular probe. Its device failure was **not** recaptured live. The replacement preference is supported by the first-wins defect, the device report, and successful independent/delayed validation of the exact signed Mid HD source, not a claim that every Auto fetch fails.

An additional bounded segment probe confirms MPEG-TS PMT stream type `0x1b` (AVC video) for all three selected video renditions; their English audio segments expose `0x0f` (AAC) separately. The selected video is therefore not just an audio playlist with a misleading name. Misleading `.jpg`/`.woff2`/`.js` extensions are not used as content evidence.

## Candidate selection and remaining limits

The candidate prototype verifies parent identities, variant topology, audio attributes, embedded subtitle sets, complete VOD child playlists, segment identities, and durations across at least three rounds. It rejects parent/media-only replacements, wrong episode IDs, audio-only declarations, tiny durations relative to the episode/audio, and changed child segments. Relative duration checks preserve legitimate shorts. Signed quality-specific candidates win equivalent rows; separately verified qualities remain separate intact masters.

Audio identity includes NAME, CHARACTERISTICS, CHANNELS, DEFAULT, AUTOSELECT, language and underlying rendition URL. Subtitle normalization removes episode prefixes and CC/index decorations from the language code while preserving the full display name and regional language distinction. Only known equivalent NetMirror subtitle routes are merged; English versus English CC and regional alternatives remain distinct.

Repeated HTTP and video-packet validation is stronger evidence than the original single-fetch audit but cannot guarantee that an upstream URL will never change later or reproduce all device behavior. PC/mobile/Tizen playback after deployment must still confirm the replacement. Nuvio's public plugin fetch bridge exposes text/JSON, not binary responses; the MPEG-TS check is an independent diagnostic, not an unsupported binary-fetch dependency added to the provider.

## Integrated release: NetMirror 1.4.0 / Nexus 2.3.10 / rev 140

Only after the live gate passed was the candidate policy embedded directly in `netmirror-standalone-nexus-v1.js`. The provider remains standalone. A parity test checks the embedded policy against the tested investigation prototype.

The integrated provider returns one signed `q=720p` DUAL master for each title, not the Auto URL. End-to-end times were 56.332 seconds for fresh Teach verification, 12.082 seconds for cached Centaurworld and 13.387 seconds for cached Squid Game. Each candidate gets three production validation rounds; the extra delayed checks above are the independent pre-release gate. Video durations and audio/subtitle counts remained as in the table. No subtitle language contains an episode prefix; all 9/33/63 caption tracks remain present, including CC and regional variants.

Every fresh native `sources[]` row was audited as well: Full HD, Mid HD and Low HD for each of the three titles. All nine native candidates were rejected for wrong episode/media identity. No verified 1080p master exists in this evidence; 1080p is not advertised. Tests ensure that independently verified 1080p and 720p intact masters would both survive selection, while a broader but unstable Auto candidate cannot replace a stable signed master.

Native quality candidates are verified concurrently within a 20-second stage budget, so one quality does not consume the next quality's validation time. A regression verifies both intact 1080p and 720p multi-audio masters through this path using fixture responses; this does not claim a live 1080p source exists. The mobile stage budget is 65 seconds to accommodate verification plus repeated media checks; total resolution budget is 105 seconds after TMDB metadata. Individual request/body guards remain six seconds in asynchronous fetch runtimes. Synchronous native bridges retain their own host timeout behavior and cannot be forcibly interrupted by a JavaScript timer.

Validation: **42 tests pass**, provider/script syntax checks and `git diff --check` pass. Baseline tests are pinned to `b0d86c9`; the tests distinguish the old false acceptance from the corrected behavior. The fixture provenance file distinguishes captured child playlists from the synthetic 19-second regression. `device-stability-evidence.json` includes redacted pre-production candidate checks, native quality rejections, packet inspection and integrated-provider results.

Built-in HLS tracks cannot be removed from an upstream master without rewriting it. The provider deduplicates known equivalent external/embedded metadata, prefers external caption files when available, and leaves unmatched embedded captions intact rather than discarding working subtitles. The three selected mobile masters have no built-in subtitle groups, so their cleaned external track lists avoid that duplication issue.

Changed production files: the NetMirror standalone provider and its manifest entry/root version only. Supporting changes are confined to NetMirror probe scripts, tests, fixtures and documentation. No Master, Provider Lab, other provider, or Nuvio application code was modified. A fresh Nuvio playback check is still needed; this release is not represented as device-confirmed.
