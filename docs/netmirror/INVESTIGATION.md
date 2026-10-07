# NetMirror transport investigation — 2026-10-06

Baseline: Nexus 2.3.8 / NetMirror 1.2.2, commit `8df7879` on `Limitless-nexus`.
Reference: Sushan64/NetMirror-Extension master `40a3319ce03d9a6fb3a59aacf420341a24c4e630`, NetflixMirrorProvider.kt and Utils.kt.
These probes were completed before editing the production provider.

| S1E1 | TMDB | Netflix episode | NewTV audio/subtitle declarations | Mobile audio / external captions |
|---|---:|---:|---:|---:|
| Teach You a Lesson | 276161 | 81947712 | 20 / 9 | 20 / 9 |
| Centaurworld | 93233 | 81048667 | 32 / 33 | 32 / 33 |
| Squid Game | 93405 | 81262746 | 25 / 63 | 25 / 63 |

## Reproduced failures

1. All three successful mobile playlists throw `Assignment to constant variable.` at `rows = rows.filter(...)` after `const rows = []`. This rejects the outer `Promise.all`, losing independently successful Net27 results too.
2. NewTV returns status `otp` with a master URL. Unlike the reference, Nexus rejects anything except `ok`. However, simply removing that condition is unsafe: all three NewTV masters point their video variants to `/files/220884/`, while audio and subtitles name the requested episode. The 1080 child returns HTTP 200 with `Only Valid Users Allowed`; lower children are HLS for the unrelated common asset. Master HTTP success and valid audio declarations alone do not establish correct playback.
3. Mobile verification completes on the fourth ten-second poll in this run. The existing path has seven polls, no request/body deadline, and even a synchronous busy-wait fallback.
4. Mobile masters contain actual audio groups, but the provider reads only their count, then labels the whole master from `lang=eng` in its URL. It also emits uninspected additional playlist sources. Centaurworld's Auto master has two STREAM-INF entries with different stated widths but the **same 720p child URL**. Exact signed-URL comparison cannot represent this identity correctly.
5. NewTV embeds subtitle group `subs`; mobile/native masters do not. Their playlist caption metadata must remain attached. Do not merge metadata based on title alone.

## Independent transport findings

NewTV: player and master HTTP 200 for all three, English-default audio group `aac`, subtitle group `subs`. Reject this unauthenticated video identity mismatch and continue fallback. These are not verified working NewTV video replacements.

Mobile: verified-cookie playlists succeed. Initial Auto masters contain correct episode video IDs. Re-fetching signed Auto URLs later can instead return the common `220884` asset: signing/expiry/HD state matters. Mid HD masters retained the correct episode, audio group and playable children. All three contain multiple selectable tracks, including English and Korean. Centaurworld is English-original but its current mobile master advertises 32 selectable tracks; the user's single-audio observation is consistent with the provider's previous misleading English-only metadata.

Native: `net77.cc/play.php` returns an `h` value. Playlist requests returned sources, but this probe's native video masters resolve to `220884`; native child responses were invalid or failed. Preserve this fallback but never call it verified on HTTP status alone.

Net27: both old `se/ep` and reference `s/e` requests returned matching S1E1 identities. Results are MP4, not HLS: Teach 480/1080; Centaurworld 360/480/720/1080; Squid 360/480/1080. Byte-range probes returned HTTP 206 and MP4 `ftyp` signatures for every asset. Distinct resolutions/assets are not semantic duplicates. These responses do not expose verified audio languages; TMDB original-language metadata is not playback-language evidence.

## Headers and child validation

The reference interceptor preserves each link's Referer. It adds native Origin and cookies only on native NetMirror hosts. Tests here fetch masters plus every returned audio/video/subtitle child playlist; small byte ranges verify sample English/Korean audio and video segments. CDN media uses misleading extensions/MIME types (`.jpg`, `.js`, `.woff2`), so extension alone cannot validate or reject media. Net27 uses `https://videodownloader.site/` as referer. NewTV uses its returned referer. Mobile uses `https://net52.cc/mobile/home?app=1`. Do not forward native cookies to third-party CDN/subtitle hosts.

`transport-evidence.json` records all 18 returned masters, raw HLS attributes (including absent AUTOSELECT), group IDs, names, languages, defaults, resolutions, URLs, child results, headers and cookie names with secret values redacted. Six captured master fixtures preserve the baseline for regression tests. Raw signed responses remain outside Git in the local `netmirror-evidence` directory.

No PC/mobile/Tizen app playback is claimed by these HTTP probes.

## Implemented result — Nexus 2.3.9 / NetMirror 1.3.0 (rev 130)

Final live validation (`validation.json`):

| S1E1 | Returned rows | Quality / tag | Audio tracks | External subtitles | Time |
|---|---:|---|---:|---:|---:|
| Teach You a Lesson | 1 | HD 720p / DUAL | 20 (including English and Korean) | 9 | 48.880 s, fresh verification |
| Centaurworld | 1 | HD 720p / DUAL | 32 | 33 | 5.747 s, cached verification |
| Squid Game | 1 | HD 720p / DUAL | 25 | 63 | 5.164 s, cached verification |

Each returned URL is an intact master, never a video-only child. Auto/Mid HD rows describing the same media and tracks collapse. A broader master supersedes a contained rendition only when audio tracks and subtitle language sets agree. Different single-audio renditions and distinct media/quality assets remain separate. The preferred verified master already exposes English and the original language, so Net27 is retained as fallback rather than concatenated as duplicate language-labelled rows.

NewTV is attempted first, followed by native, mobile, and Net27. NewTV/native mismatched masters were rejected in the final live run. Their code paths remain available for valid future responses. HTTP 200 HTML is rejected. Net27 uses reference `s/e` parameters and preserves identity checks. Unknown audio stays UNK instead of guessing from TMDB.

Every network request, including body consumption, has a six-second bound and abort where supported. Stage budgets are NewTV 18 seconds, native 12, mobile 52 (including at most four ten-second verification polls), Net27 8, within a shared 90-second resolution budget after at most three six-second TMDB metadata calls. Stage failure cannot discard another completed family. Timerless runtimes fail promptly with diagnostics; no synchronous polling remains. Initial provider lookup can still take about 49 seconds because the upstream verification requires waiting; subsequent calls reuse the cookie.

Production fetches masters and representative English/original audio plus all video child playlists using the exact exported Referer/User-Agent headers. Native cookies stay within API requests and are not exported in Nuvio's static cross-host playback header map. Signed mobile masters and child playlists were verified without exporting authentication cookies; native paths that need unavailable authentication continue to fall back. The independent audit fetched all declared child playlists, not only production's representative selection. Sample media byte ranges begin with MPEG-TS sync data despite misleading file extensions; Net27 ranges begin with MP4 ftyp.

Validation: 24 tests pass (`node --test tests/netmirror-standalone.test.cjs tests/netmirror-hls.test.cjs`), provider syntax check and `git diff --check` pass. Tests include captured master fixtures, complete mobile success/duplicate regression, same-episode subtitle checks, wrong-media rejection, language naming, separate audio preservation, cookie scope, and stalled fetch/body deadlines.

Only the production NetMirror provider, its manifest entry/root Nexus version, NetMirror tests/fixtures, diagnostic scripts, and this evidence directory changed. KissKH, 1Shows, Master and Provider Lab were not modified. Playback inside the actual PC/mobile/Tizen apps remains unverified; HTTP/media probes are not a substitute for device playback.

## Reproducing the evidence

Run `scripts/probe-netmirror-transports.cjs` first (it reads the pre-fix provider from commit `8df7879`), then `scripts/probe-netmirror-returned-links.cjs`, `scripts/audit-netmirror-hls.cjs`, and `scripts/summarize-netmirror-evidence.cjs`. These scripts write raw responses, including short-lived signing data, into the sibling `netmirror-evidence` directory outside Git. The summary redacts cookie values and signing parameters. Run `scripts/validate-netmirror-live.cjs` for current end-to-end provider output. Network state and signing validity can change between runs; always fetch fresh playlists rather than replaying old signed master URLs as proof of availability.
