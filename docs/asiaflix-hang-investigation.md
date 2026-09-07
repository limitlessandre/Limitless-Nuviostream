# AsiaFlix Test hang investigation — 2026-09-07

Starting point: `limitlessandre/Limitless-Nuviostream`, branch `Limitless-nexus`, commit `6b829a1` (AsiaFlix Test 0.2.2 / Nexus 2.1.32). The patch updates AsiaFlix Test to 0.2.3. Nexus's top-level version and every other provider entry remain unchanged.

## Reproduction and exact blocking request

Live requests were run through the original provider in a Node VM, first with timers, then without timers. The latter reproduces the provider's unsafe fallback. An independent eight-second AbortSignal was added by the harness so the investigation itself could not wait indefinitely. It is not a timeout supplied by v0.2.2. No physical-device/UI reproduction was performed, and the user's installed Nuvio runtime version is unknown.

| S1E1 | TMDB | Detail slug | Episode list | First resolver | Second resolver |
|---|---:|---|---|---|---|
| Kamen Rider Ex-Aid | 262158 | `kamen-rider-ex-aid` | 45 episodes, E1 has 8 hosts | `watchasian`, no headers within 8 seconds | `streamwish`, HTTP 500 |
| Kamen Rider Den-O | 259906 | `kamen-rider-den-o` | 50 episodes, E1 has 2 hosts | `watchasian`, no headers within 8 seconds | `vidbasic`, HTTP 500 |

Both TMDB metadata and AsiaFlix detail requests returned HTTP 200, with complete JSON bodies. Exact title matching and episode selection succeeded. No search fallback or external host extractor ran in these live paths.

Both stalls were at:

```text
GET https://api.asiaflix.net/v1/drama/get-stream-url
    ?value=encodeURIComponent(base64(host.url))
    &server=watchasian
```

The exact unmodified host URL input for Ex-Aid was:

```text
//embasic.pro/z2pqlftjhs?id=OTQ3MjU=&title=Kamen+Rider+Ex-Aid+episode+1&typesub=SUB
```

For Den-O:

```text
//embasic.pro/z2pqlftjhs?id=NTU3ODk=&title=Kamen+Rider+Den+O+episode+1&typesub=SUB
```

These identify the exact request without obscuring its input in a long encoded URL. The provider sends the URL string as returned by AsiaFlix, matching maintained source behavior. Only diagnostic hostname formatting now recognizes protocol-relative URLs.

Original code path:

```text
getStreams
  -> resolveTmdbId (numeric input: no request)
  -> tmdbInfo -> fetchJson
  -> findTarget -> fetchDetails -> fetchJson
  -> findEpisode -> selectedEpisode.streamUrls[0]
  -> sequential await resolveServer(watchasian)
  -> fetchJson -> boundedFetch
  -> fetch(url, options)
  -> if setTimeout is unavailable: await request without a deadline
```

With normal timers, v0.2.2 returned in 2,545 ms (Ex-Aid) and 2,367 ms (Den-O), reporting a 1,400 ms watchasian timeout. With timers removed, watchasian waited 8,006 / 8,011 ms until the **harness** stopped it. The second resolver started only afterward. Total times were 9,180 / 8,958 ms. This proves the configured 1,400 ms limit was not enforced; it does not establish how long the remote server would eventually wait.

## Root cause and runtime evidence

1. `boundedFetch` started fetch before checking for timers and explicitly fell back to an unbounded await. The slow watchasian resolver therefore blocked all remaining diagnostics and resolver work on a timerless runtime.
2. The timeout covered only the fetch promise. Its `finally` cleared the timer before `fetchJson` awaited `response.json()`. A response with prompt headers and a stalled body could hang at any network stage even with timers available. This second defect was reproduced with fault injection, not observed in the live episode requests.
3. The two resolvers ran sequentially, so a stuck first request prevented the second from starting.

The inspected current [NuvioMobile FetchBridge](https://github.com/tapframe/NuvioMobile/blob/b1c9d08435a5b7d7487b30bbf181cb48830c2458/composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/plugins/runtime/network/FetchBridge.kt) registers synchronous `__native_fetch` and uses `runBlocking` around HTTP. Its [JavaScript bindings](https://github.com/tapframe/NuvioMobile/blob/b1c9d08435a5b7d7487b30bbf181cb48830c2458/composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/plugins/runtime/js/JsBindings.kt) call that bridge directly, do not forward `signal`, and do not install timers. An AbortController polyfill alone therefore cannot cancel that network operation. A JavaScript Promise race cannot interrupt synchronous native I/O. This is evidence about that pinned runtime, not confirmation of the user's installed build.

## Maintained AsiaFlix comparison

Compared against [Yuzono AsiaFlix](https://github.com/yuzono/anime-extensions/blob/fbb9f45c6738619793a6eda8a8f1151a7b90952d/src/en/asiaflix/src/eu/kanade/tachiyomi/animeextension/en/asiaflix/AsiaFlix.kt), extension version code 32, current checkout `fbb9f45c6738619793a6eda8a8f1151a7b90952d`.

- API origin, `/v1/drama/detail?slug=`, search shape, `X-Access-Control: web`, flat `episodes`, and `streamUrls` agree with the experiment.
- The resolver uses the same Base64 URL value and lowercase server name. There is no endpoint/parameter drift causing this hang.
- Maintained source processes hosts concurrently, tries API resolution, then falls back to host-specific extractors. Its fallback recognizes Dood, StreamTape, MixDrop, StreamWish, VidHide and VidMoly. It explicitly notes that VidMoly API resolution returns 500. It does not provide a watchasian/embasic or vidbasic fallback in that dispatch.
- Maintained source expands HLS playlists and preserves AsiaFlix Referer/Origin. This experimental probe still returns direct API sources with those headers and retains its two-host limit. No new host extractors or playlist requests were added.

## Fix and bounds

- One deadline now encloses fetch plus JSON body consumption, with cleanup after either success or failure. The timeout rejects before attempting abort so cancellation cannot hide the timeout diagnostic.
- Missing timer support or the known synchronous native bridge returns `DIAG RUNTIME UNSUPPORTED` before any provider network call. This intentionally makes that runtime return a diagnostic rather than attempting unbounded networking. Restoring playback there requires runtime support for cancellable asynchronous requests, outside the requested provider-only scope.
- Both existing resolver probes start concurrently. Failure of one preserves the other's result.
- Logs identify each network stage, elapsed milliseconds and HTTP/error outcome, without API keys or encoded host URLs.
- TMDB ID and metadata requests: 1,500 ms each. Direct detail, optional search and searched detail: 1,600 ms each. Resolver pair: 1,400 ms concurrently. Default helper budget: 1,800 ms. Nominal longest request path is 9,200 ms including IMDb lookup and search fallback, plus event-loop scheduling and local processing. These are cooperative asynchronous deadlines, not guarantees against a blocked JavaScript event loop.

## Validation and remaining availability

The patched live Ex-Aid path returned in **1,759 ms**; Den-O returned in **1,734 ms**. Both returned complete diagnostics. Watchasian timed out at 1,403 / 1,408 ms; concurrent Streamwish and vidbasic requests returned HTTP 500 at 791 / 275 ms. **Neither episode yielded a playable source from the two probed hosts. Playback availability remains unresolved.**

45 regression tests cover both titles, original failure reproduction, stalled headers and bodies at all seven stages, missing timers, the native bridge guard, missing/ignored cancellation, late rejection, HTTP/malformed JSON/network failures, parallel resolver start, stream header preservation, deduplication, timer cleanup, and isolation of manifest changes. Test timers are accelerated while their requested production budgets are asserted. Syntax checks and `git diff --check` pass.

Run from the repository root:

```text
node --test tests/asiaflix-probe.test.cjs
node scripts/asiaflix-live.cjs
node scripts/asiaflix-live.cjs --no-timers
```

The live harness also accepts a provider-file argument for reproducing v0.2.2 from `git show 6b829a1:custom/providers/asiaflix-nexus-probe-v3.js`. It performs a separate TMDB title lookup before invoking the provider, traces headers and body completion, and applies the independent eight-second investigation cutoff. The patched timerless provider itself makes zero requests, as verified by the tests.

## Changed files

- `custom/providers/asiaflix-nexus-probe-v3.js`: experimental provider fix.
- `manifest.json`: only AsiaFlix Test description/version, now 0.2.3.
- `scripts/asiaflix-live.cjs`: reproducible live tracing harness.
- `tests/asiaflix-probe.test.cjs`: regression tests.
- `docs/asiaflix-hang-investigation.md`: findings and evidence.

KissKH, 1Shows, production AsiaFlix, older experimental provider files, and all other providers are unchanged.
