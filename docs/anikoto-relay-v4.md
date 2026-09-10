# AniKoto Nexus 2.0.8 / Nexus 2.1.64

**This is a tested relay reference, not a completed native Nuvio integration. Separate relay startup is still required.** Limitless-Nuviostream contains provider scripts and tools, not Nuvio's application/player source. A provider cannot start a persistent native HTTP server or fix the Windows player bridge. The native lifecycle and subtitle changes below must be implemented in the Nuvio application repository. No production/master branch is changed.

## Baseline and reference evidence

Started from Nexus `90fb838cdb295918a7df39c30e5a16952bffe2cb`, AniKoto 2.0.7 / Nexus 2.1.63.

Primary reference: [SalmanBappi snapshot 43384ef](https://github.com/salmanbappi/sb-extensions-source/tree/43384ef5305f4e7b12efb4698591d019bcd557c4/lib-multisrc/anikototheme/src/main/java/eu/kanade/tachiyomi/multisrc/anikototheme). Inspected AnikotoTheme.kt, AnikotoExtractors.kt, LocalProxyServer.kt and HlsPlaylistParser.kt. Its player owns the local server, cache, in-flight fetches, prefetch generations and mutable variant state. Its recovery escalates from segment/variant to master and hoster re-resolution. This implementation adapts those behaviors to JavaScript rather than translating Kotlin line by line.

Cross-check: [Yuzono snapshot fbb9f45](https://github.com/yuzono/anime-extensions/tree/fbb9f45c6738619793a6eda8a8f1151a7b90952d/lib-multisrc/anikototheme/src/eu/kanade/tachiyomi/multisrc/anikototheme). AnikotoExtractor.kt merges the site's server list and mapper results, resolves each host independently, tries getSourcesNew, handles iframe/direct HLS/MewCDN and retains caption tracks and hoster headers.

The existing relay's CDN alternatives from the earlier Arc-based implementation are preserved. No arbitrary new CDN domains are inferred at runtime.

## What caused the problems

* v6's server loop returned immediately after its first successful server; v5's row handoff accepted only one result per audio mode. This lost usable additional mirrors.
* Only getSources was attempted. Valid empty responses, decoding failures and newer source modes had no getSourcesNew fallback.
* Relay v3 had no segment cache, in-flight deduplication or lookahead. Every requested image-wrapped segment had to be fully fetched and stripped before playback could use it. Candidate retries could multiply its 10-second timeout.
* It forwarded Range to the disguised upstream and retained upstream range metadata after stripping bytes. Those offsets describe the image-wrapped representation, not the video handed to the player.
* Subtitle injection was already removed by the baseline relay commit, but the manifest and v8 comments still claimed it worked.

## Discovery, identity and output

`anikototv-nexus-v8.js` remains the manifest entry, calling the existing v6 wrapper. The wrapper retains v5's identity/title/episode mapping and AES-CBC path. Neither v5 nor shared anime identity files are edited.

The dedicated `anikoto-sources.js` extracts all named servers from the selected episode's server HTML. It also uses the episode's actual `data-mal`, `data-slug` and `data-timestamp` to query the mapper, matching Yuzono's route. Discovery is shared between SUB/DUB requests and cached for two minutes (maximum 16 identities). Up to 32 discovered server entries are processed with three workers per audio mode.

Each hoster tries getSources and then getSourcesNew if the primary response produces no usable source. Existing AES-CBC, plaintext sources, caption tracks, direct HLS, bounded iframe recursion and MewCDN fragment/HOST_MAP extraction are supported. The proven AniList/MAL and catalog rescue paths remain available if discovery produces no usable rows.

SUB, HSUB/H-Sub and DUB/A-Dub metadata determine audio grouping. SUB and DUB never deduplicate against one another. Within an audio mode, identical final media URLs merge their human-readable mirror names. Known source quality metadata is retained; otherwise the row stays Auto and the HLS master retains adaptive variants.

### Live Mushoku result

Canary: AniList 108465, MAL 39535, episode 1. Existing exact title matching selected AniKoto series 5694 and the selected episode metadata. The live server list returned:

| Audio | Discovered names | Current transport |
|---|---|---|
| SUB | Vidstream-2, HD-1 | Both resolve to the same SUB embed and final URL |
| DUB | Vidstream-2, HD-1 | Both resolve to the same DUB embed and final URL |

The correct current output is two unique rows, each named `Vidstream-2 / HD-1`, one per audio mode. Distinct URLs produce distinct rows; fixtures verify that behavior. Four artificial duplicate rows are not manufactured to make the mirror count look larger.

## Relay design and limits

`tools/anikoto-relay.js` runs on Bun or modern Node and binds **127.0.0.1 only**. Its exported `start({port})` returns `{port, relay, close}`; `port: 0` supports an app-assigned dynamic port. Standalone defaults to 8787 for compatibility with the current provider. `anikoto-relay-core.js` exports a server-independent request handler and explicit cleanup lifecycle.

Selecting `/play` creates a bounded session and redirects to a tokenized loopback resource. Stable resource IDs preserve variant/segment sequence references while upstream signed URLs change. Nested playlists, relative/absolute media references, EXT-X-KEY and EXT-X-MAP URIs are rewritten; subtitle groups are not injected.

Defaults:

* Four-segment lookahead, at most three simultaneous background prefetches globally. Prefetch does not recursively prefetch the episode. Foreground requests may share an existing background fetch.
* Cache limited to 24 entries and 64 MiB; individual segment reads limited to 12 MiB, playlists to 2 MiB, subtitles to 512 KiB. At most eight unique segment operations/upstream connections are admitted. Cache eviction uses recency and idle expiration.
* Ordinary segments are sniffed then streamed while a bounded copy fills the cache. Wrapped segments require full bounded buffering and validation. No image wrapper is returned as video. PNG/JPEG stripping verifies three TS sync bytes 188 bytes apart, including limited padding after the wrapper.
* Cached/transformed Range requests address the final video bytes and return corrected 206/Content-Range/length values. Direct MP4 passthrough forwards upstream Range. Byte-range HLS with disguised-image offsets has not been live validated.
* Candidate/redirect chains share an eight-second network budget, including response bodies. A handler has a 25-second deadline across refresh attempts. Large ordinary MP4 passthrough uses an eight-second idle-body deadline instead of a total download deadline.
* Sessions expire after ten idle minutes; expiry/close aborts their network operations and clears their cache. Quality changes/seeks cancel stale prefetch generations. Per-session resource maps and session counts are bounded.

### Expiring URLs

Active variants refresh in the background after 60 seconds. A failed segment retries through variant refresh, master refresh, then fresh hoster-page/source resolution using its stored embed and audio mode. Mutable resources preserve stable player URLs and media-sequence positions. Refresh work is shared to avoid concurrent re-mint storms. Invalid HTTP-200 error pages are rejected and eligible for refresh. Transient interrupted buffered transfers are retried; a failed prefetch cannot permanently poison a foreground waiter.

Recovery is covered by fault-injection tests. A full real-time episode through actual URL expiration remains a device test. If the site changes its protocol/domain, requires a browser challenge or withdraws the source, the relay returns a bounded failure; it does not bypass those requirements.

### Relay security

Only known AniKoto media/hoster HTTPS suffixes are accepted, without URL credentials or custom ports. Every redirect is checked. DNS results are checked for private/reserved addresses and pinned to the actual HTTPS connection; this is not just a hostname string check. Loopback Host validation mitigates DNS rebinding against the listener. Session media endpoints require their random token. The relay is not an unrestricted open proxy. Unknown future CDN hosts need explicit review before adding to the allowlist.

## Subtitles and required app work

All provider captions remain independent `subtitles` entries with URL, ID/name and language. Their files are served through `/subtitle` with no HLS injection. Live English, Brazilian Portuguese and Spanish files returned HTTP 200 and valid WEBVTT for both modes.

Confirmed application issue at [Nuvio Desktop af480339, PlayerEngine.desktop.kt](https://github.com/NuvioMedia/NuvioDesktop/blob/af4803399e77480ca7db75284b89a049cc6fe040/composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/PlayerEngine.desktop.kt): line 39 accepts `externalSubtitles`; the call at line 63 does not forward it, and `NativePlayerSurface` at line 95 has no matching parameter. Therefore selectable provider captions cannot be fixed solely by preserving the provider's track list. That snapshot is a reference checkout, not a modification to the app.

Native integration contract:

1. Own the local relay/transformer in the Nuvio app or playback-session lifecycle. Start it before extraction/playback and stop it on app shutdown; cancel session work when playback changes. An embedded JavaScript runtime alone does not supply the Node HTTP/DNS modules used by this test reference. Desktop needs an app-managed helper process or native implementation; Android/TV need a platform-owned equivalent.
2. Publish the actual loopback origin/port to the provider through a defined runtime API/settings contract. Then replace the provider's fixed 8787 address. Do not expose a local listener to the LAN by default.
3. Pass `externalSubtitles` through NativePlayerSurface and NativePlayerController into the native backend. Attach the tracks after media load, retain label/language, support selection/off and clear them on source change. Verify the backend's external-subtitle loading API and track enumeration on Windows; preserve equivalent behavior on other platforms.
4. Do not fix the missing parameter by injecting a synthetic HLS subtitle group. The earlier attempt hung playback and is intentionally absent here.

## Run and test

For current desktop testing, from this repository checkout run `bun tools/anikoto-relay.js` (or `node tools/anikoto-relay.js`). Updating only the old copied `C:\Projects\anikoto-relay.js` is insufficient: the new entry requires the sibling core/transport files and `custom/providers/anikoto-sources.js`. Stop the older 8787 relay before starting this version. `/health` identifies relay v4 and exposes cache counters without signed media URLs.

No service, scheduled task, startup registration or changes to the installed Nuvio application are made. This repository cannot implement automatic Nuvio-owned startup; manual startup remains an explicit intermediate limitation.

Offline tests: `node --test tests/anikoto.test.cjs` or `bun test ./tests/anikoto.test.cjs`. Basic tests require no live AniKoto access. Live transport check: `bun scripts/anikoto-live.cjs 30`; it owns an isolated dynamic-port relay and closes it afterward. That script starts from the supplied canary identity; it does not simulate clicking Nuvio or replace device identity testing.

Syntax checks cover all eight changed/new JavaScript files. Offline tests also load the complete v8 -> v6 -> v5 -> source-helper chain. Provider HTTP deadlines use timers when the plugin runtime supplies them; timerless runtimes retain their native HTTP timeout. Shared identity internals are unchanged. Relay deadlines are enforced by its Node/Bun transport independently of those plugin-runtime limitations.

Live testing verified nested HLS and five then thirty consecutive TS segments per audio mode, plus every returned caption. One earlier extended DUB run failed after eleven segments; its original error lacked sufficient detail and its exact network cause was not established. This prompted explicit transient-body/prefetch-failure recovery coverage; long playback is still not claimed buffer-free.

Final validation: **21/21 offline tests passed on Node and Bun**, and all eight JavaScript files passed syntax checks. The final Bun live canary passed **30 SUB + 30 DUB segments**, validating three MPEG-TS sync bytes in each complete response. Fetching each 30-segment group plus its playlists took 3.840 seconds SUB and 4.341 seconds DUB (network-transfer measurements, not playback startup/decoder measurements). All six caption checks passed. Relay counters showed 22 cache hits, 36 shared in-flight waits and 20,121,455 cache bytes, below the 64 MiB limit. The unchanged entries for every unrelated manifest provider were also compared against the baseline.

Remaining user verification: refresh Nexus 2.1.64 / AniKoto 2.0.8, run relay v4, select Mushoku S1E1 SUB and DUB, check startup/seeking/quality changes and sustained playback. Repeat after a long pause to exercise expiration. The Desktop subtitle selector requires the app handoff fix above before it can be considered complete. Other titles may expose distinct or unsupported hosters; dynamic discovery is implemented, but challenge-driven hosters and every future CDN cannot be guaranteed by this reference build.

## Exact changed files

* `custom/providers/anikoto-sources.js`
* `custom/providers/anikototv-nexus-v6.js`
* `custom/providers/anikototv-nexus-v8.js`
* `tools/anikoto-relay.js`
* `tools/anikoto-relay-core.js`
* `tools/anikoto-transport.js`
* `scripts/anikoto-live.cjs`
* `tests/anikoto.test.cjs`
* `manifest.json`
* `docs/anikoto-relay-v4.md`

No unrelated provider, shared anime identity file or Nuvio app source is modified. `Limitless-Master-Nexus` remains untouched.
