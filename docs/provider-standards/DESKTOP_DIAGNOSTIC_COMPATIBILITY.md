# Nuvio Desktop diagnostic compatibility

## Inspected source and scope

Read-only inspection of the current public `NuvioMedia/NuvioDesktop` default `Dev` head resolved to **1ece6d7ae5dbda29d0ab05952375692a56d81078**. This is also the revision previously examined for WCO. It does not identify the user's installed executable build. No native Desktop app was run for this standards update.

Source references at that exact commit:

- [PluginRuntime.kt, parseJsonResults, lines 196–248](https://github.com/NuvioMedia/NuvioDesktop/blob/1ece6d7ae5dbda29d0ab05952375692a56d81078/composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/plugins/runtime/PluginRuntime.kt#L196): nonblank string `url` or object `url.url` required; blank URL rows are dropped. There is no diagnostic row discriminator. It parses infoHash/headers/subtitles too.
- [StreamFetchSupport.kt, toStreamItem](https://github.com/NuvioMedia/NuvioDesktop/blob/1ece6d7ae5dbda29d0ab05952375692a56d81078/composeApp/src/commonMain/kotlin/com/nuvio/app/features/streams/StreamFetchSupport.kt#L82): maps plugin results with `plugin:` or `plugin-repo:` identities and URL/infoHash, visible name and request headers. Separate provider title is not a dependable place for the essential stage.
- [StreamModels.kt, lines 44–135 and 201–207](https://github.com/NuvioMedia/NuvioDesktop/blob/1ece6d7ae5dbda29d0ab05952375692a56d81078/composeApp/src/commonMain/kotlin/com/nuvio/app/features/streams/StreamModels.kt#L44): nonblank direct URLs are eligible except magnet/torrent schemes; valid hashes can create P2P targets. Installed-addon debrid identity is different from the plugin path. `hasPlayableSource` is a broad presence flag, **not** a diagnostic-safe verdict. Selection uses additional predicates.
- [StreamAutoPlaySelector.kt, lines 206–241](https://github.com/NuvioMedia/NuvioDesktop/blob/1ece6d7ae5dbda29d0ab05952375692a56d81078/composeApp/src/commonMain/kotlin/com/nuvio/app/features/streams/StreamAutoPlaySelector.kt#L206): direct URL, server, valid P2P hash or ready installed-addon debrid candidate may autoplay. DIAG/INFO text and quality do not make a URL nonplayable. Preferences/modes eventually use this shared eligibility predicate.

## Representation findings

| Representation | Inspected plugin contract | Decision |
|---|---|---|
| HTTP(S) icon/favicon/placeholder MP4 with DIAG/INFO | Nonblank direct URL; may be selected/autoplayed | Unsafe; do not use |
| `data:`, `javascript:`, `about:blank` or arbitrary custom scheme | No universal scheme-safe diagnostic exemption | Unproved/unsafe; do not invent |
| Blank/missing URL | Plugin parser drops row | Cannot produce a visible diagnostic row |
| Valid magnet/hash | May be a real P2P target when enabled | Unsafe for diagnostics |
| WCO exact hashless sentinel, no other targets | Visible; direct/P2P/debrid/manual-selection predicates exclude playback on inspected plugin path | Conditional compatibility only, not universal approval |
| Native typed nonplayable diagnostic | No such plugin result type in inspected source | Preferred future API capability, not currently available |

Current WCO uses exactly `magnet:?dn=WCO%20Unified%20Diagnostic` with no xt/hash/tracker/external/server/debrid target. The source-derived tests establish conditional predicate exclusion for the pinned **plugin** path, including P2P/debrid settings. Its broad `hasPlayableSource` flag remains true because a URL exists. Native rendering, clicks, future client versions and addon/debrid paths are not proved by this static model. Do not blindly copy the workaround across providers/platforms.

The checker requires explicit profile `nuviodesktop-plugin-1ece6d7ae5dbda29d0ab05952375692a56d81078` and accepts only the exact examined sentinel, with all extra playback targets forbidden. Unknown client profiles and other URLs are rejected as unproved. Even a profile-safe result reports `nativeValidationRequired: true`; it is not a native playback certification. The predicate port models only the supported parser/eligibility cases, not torrent scheme internals, ranking or the app's entire UI.

## Safest supported strategy

There is no demonstrated universal visible-and-nonplayable diagnostic representation across all Nuvio runtimes. Keep a canonical typed internal failure record. If an actual build/path has not verified a safe visible adapter, do not fabricate a stream URL: return no playable row, retain sanitized failure details in supported logging/internal evidence, and report the API's visibility limitation. An empty URL is not a way to display the failure. Request/design first-class client support in a separate authorized task if needed.

A tested compatibility adapter can be used only within its documented build/path/settings scope and should be revalidated when that scope changes. Do not add hashes, trackers, server/external targets, resolver fields or playback headers to a diagnostic. Native checks must cover display, manual click behavior, all configured autoplay modes, plugin-only/all-source selection, P2P on/off and relevant debrid settings. Confirm valid streams suppress final-error clutter. Do not expose private URLs/tokens during evidence capture.

The existing WCO 2.9.0 implementation is frozen during Desktop testing. This investigation does not change its workaround or implement a provider-wide migration. HTTP-icon diagnostics in other providers are audit findings for separately authorized remediation.
