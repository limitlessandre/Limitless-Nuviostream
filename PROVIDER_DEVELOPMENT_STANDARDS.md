# Limitless Provider Development Standards

Mandatory for new providers, provider testing/promotion, and existing providers when maintained or substantially updated. Existing findings are audited without rewriting working extractors. User-authorized scope and branch restrictions apply; a standards change is not authorization to migrate providers or promote Master.

## Authority and scope

| Source of truth | Owns |
|---|---|
| [AGENTS.md](AGENTS.md) | Concise instructions and required reading for repository agents |
| [NAMING_STANDARDS.md](NAMING_STANDARDS.md) | Exact quality tiers, tag meanings, evidence priority, mirrors, provider-specific verification and quality-selection default |
| This document | Lifecycle, identity/reliability safeguards, diagnostic codes, testing and release gates |
| [Desktop diagnostic compatibility](docs/provider-standards/DESKTOP_DIAGNOSTIC_COMPATIBILITY.md) | Versioned client-source investigation, representation limits and native checks |
| [Compliance tooling](docs/provider-standards/COMPLIANCE_CHECKS.md) | Input schema, audit/strict commands, coverage and limitations |
| Relevant provider documentation, regression tests and release records | Verified provider-specific behavior and intentional deviations |

Do not copy detailed naming definitions into provider-specific alternatives. Document conflicts and resolve them against the current canonical document and verified evidence. Preserve provider-specific verified exceptions; do not generalize them to unrelated languages, titles or source classes.

## 1. Preserve identity before extraction

Start from the current manifest/provider and known working cases. Record series/movie IDs, requested coordinates, source collection/page identity and expected behavior. Preserve verified legacy matching and independent fallback paths during rebuilds; working identity code must not disappear when changing players or packaging.

- **TMDB:** resolve the requested ID/type and essential season/episode metadata. Validate returned IDs and season ownership. Treat metadata service failure separately from source absence. Trusted alternatives can enrich identity; they cannot override conflicting series/edition/season evidence.
- **Alternative titles/anime:** aliases must belong to the verified work/season. Distinguish remakes, Kai/Shippuden/recaps/compilations and similarly named franchises. A later anime season must not silently fall back to season 1. Cross-service mappings need evidence, not substring popularity.
- **Movies:** require the actual movie identity and resolve conflicting year/edition evidence. A premium/login page is not proof a movie is missing.
- **Season 0/Episode 0/fractional conventions:** use explicit title, series and source-page coordinates. Never globally convert S0En into SnE0 or an OVA index. A provider's decimal episode can correspond to an integer catalog special only with verified title and ownership evidence.
- **Multipart titles:** equivalent terminal `Part 1 / Part I / Part One / (1)` forms may match only with exact base title and part, verified collection/season, requested episode coordinates, unique metadata and matching page evidence. Never turn arbitrary sequel numbers or Roman words into a fuzzy global alias. Power Rangers Turbo's TMDB S5E1 `Shift into Turbo (1)` and WCO `Shift Into Turbo, Part I` demonstrate a contextual rule, not permission to ignore season/episode conflicts.
- **Combined cartoons:** resolve the requested TMDB segment inside actual source packages. Amphibia S1E2 maps to WCO Episode 1 `Anne or Beast? / Best Fronds`; blindly selecting numeric Episode 2 is wrong. Keep strict title decomposition and explain combined playback starts at the package beginning unless verified segment timestamps exist.
- **Ownership:** approve the actual collection, episode page, redirects, heading/title evidence and player frame. Recheck after redirects. Reject conflicting part/episode/season/series rather than returning another playable episode. Number-only anime support is allowed within a proven season where the source legitimately lacks a title, not in the face of an explicit conflicting title.

A playable URL alone never proves the correct content. Add negative regressions for the nearest wrong episode, similarly named series, another season/part and contradictory redirected pages. If essential identity cannot be verified, return an accurate failure rather than weakening matching.

## 2. Evidence-based presentation and final selection

Read [NAMING_STANDARDS.md](NAMING_STANDARDS.md) before changing labels. Canonical stream grammar is `Provider • Quality • [TAG] • Optional Mirror/Disambiguator`; the recognized tags are `[DUB]`, `[HSUB]`, `[SUB]`, `[DUB+SUB]`, `[DUAL]`, `[UNK]`. That document owns their exact meanings and the current scoped NetMirror/KissKH/Vidlink/WCO rules.

Measured media/track evidence outranks contradictory player claims; verified player/source evidence outranks content-language fallback. Never invent numeric resolution, language, hard/soft subtitles or selectable multi-audio. Separate dub/original files are not DUAL. Japanese audio alone is not HSUB. Preserve actual subtitle/caption URLs, track languages/labels and request headers without leaking them into diagnostics.

The **global default is two highest distinct evidenced qualities per meaningful audio/track category and useful independent mirror**, after media validation. Preserve 480/360 when those are best, or one tier when only one works. Do not impose a minimum quality. Independent languages/track sets and genuine mirrors remain independent. Unknown-quality URLs are not a shared height-zero duplicate; keep useful unknown sources and explain any documented exception. Exact ranking, provenance, adaptive and mirror exceptions are in the naming document.

## 3. Extraction reliability

- Bound each metadata/search/episode/player/media request and the complete invocation. Keep an explicit margin below the inspected Desktop host's 60-second limit; WCO's 52-second logical budget is a scoped baseline, not permission to assume every platform has the same limit. Include retry, verification waits, fallback and final validation in the budget.
- Use bounded retries only where safe and useful. Respect observed 403/429/503 differences; suppress repeated unhealthy searches and avoid retry loops. Failure on an optional path must not discard completed usable streams. Recovery must never relax identity.
- Follow safe redirects with the required first-party Referer/Origin/User-Agent. Preserve session-sensitive verification sequencing and source-required playback headers. Do not send cookies/tokens to unrelated origins. Do not bypass access controls or claim anonymous playback where login is required.
- Resolve first-party players and verify actual media responses. Reject HTML, JSON errors, expired links and fake extensions. Validate HLS playlists/children/media or MP4 signatures/metadata with bounded reads. HTTP 200, a `.mp4` suffix or a player label is insufficient on its own.
- Probe quality using actual safe binary responses when available; honor Range semantics and metadata positions. Decoded UTF-8 text is not reliable MP4 binary data. If dimensions are unavailable, use only explicitly trustworthy source quality bound to the approved identity and exact URL; otherwise use Unknown Auto. Record measured/source/unknown provenance internally.
- Preserve genuine audio/subtitle metadata and useful mirrors. Do not add redundant results or infer dual audio from coincident URLs. Gather sufficient evidence before ranking; an expired high-quality candidate must not suppress playable lower tiers.
- Keep fallback paths independent enough to recover the intended failure boundary. Specify whether recovery fills missing lanes or runs only when no valid results remain. Test partial completion and failed/stalled optional lanes.
- Freeze every transitive executable dependency, not just an entry URL that downloads mutable branch code. Prefer self-contained standalones; record source refs, Git blob/SHA-256 hashes, deterministic builders and provenance. Network data/player responses are not automatically executable code dependencies. Do not dynamically evaluate untrusted fetched JavaScript.
- Test the actual Desktop fetch interface (binary availability, URL serialization, timers/cancellation) as well as Node. Logical expiry may return while native requests finish; do not promise native cancellation without evidence. Keep state per invocation/user/provider; stable IDs do not authorize sharing session state across providers.

## 4. Diagnostic contract

Canonical visible name: `Provider • DIAG CODE • Concise Explanation`. Put the essential code/stage and useful season/episode context in the **name**; Desktop may not display the separate title field. Keep names bounded (240 characters) and optional detail fields bounded (400 characters). No markup, control characters, raw URLs, signed query values, cookies, authorization headers, tokens, raw service bodies or exception stacks.

| Code | Evidence required |
|---|---|
| NO SERIES MATCH | Healthy, completed series searches found no safe requested identity |
| NO EPISODE MATCH | Verified series and healthy relevant episode index found no safe requested episode |
| IDENTITY CONFLICT | Explicit conflicting series/edition/season/episode/title/part evidence |
| NO SOURCE FOUND | Verified content, authoritative source response explicitly provides no source |
| NO VALID MEDIA | Candidates existed; all applicable playable-media validations failed |
| PLAYER FAILED | Verified content reached player/embed/verification stage but resolution failed |
| HTTP 403 | Observed forbidden response; include stage without exposing URL |
| HTTP 429 | Observed rate limit; do not call the content missing |
| HTTP 503 | Observed upstream unavailability; distinguish unsuccessful bounded recovery |
| NETWORK FAILED | Observed transport/connectivity failure, not an invented HTTP status |
| TIMEOUT | An actual bounded operation/deadline expired; retain metadata/player/media stage |
| METADATA FAILED | Essential metadata unavailable, malformed or conflicting |
| UNSUPPORTED CONTENT | An explicit provider capability/access limitation, not unproved source absence |
| RUNTIME ERROR | Unexpected runtime/module failure, sanitized rather than raw exception text |

Examples: `WCO • DIAG NO EPISODE MATCH • S0E7`, `AsiaFlix • DIAG HTTP 503 • Server unavailable`, `KissKH • DIAG PLAYER FAILED • Embed resolution`.

Internally record stage, observed status, optional/retry state, elapsed time and opaque candidate identity when practical. A wrapper must not convert a typed HTTP/timeout failure into “not found.” Use allowlisted safe fields and decode/redact encoded text before display. Preserve the actual cause across fallback; successful recovery means no public failure clutter.

Return diagnostic rows only if no valid playable streams remain. Keep diagnostic construction and ordinary media validation separate. Never select a diagnostic as a playable or autoplay target. Do not use favicon/HTTP icon/placeholder video URLs, `data:`, `about:blank` or an invented URI merely to satisfy a parser.

**There is no universal diagnostic transport established for all Nuvio builds.** Read the [compatibility investigation](docs/provider-standards/DESKTOP_DIAGNOSTIC_COMPATIBILITY.md). The inspected plugin API drops blank URLs and does not have a dedicated typed nonplayable row. WCO's exact hashless magnet is a version/path-scoped compatibility workaround: source predicates exclude it, but native display/interaction and build must still be verified. Do not automatically adopt it for other providers or client versions. If no safe representation is verified, return no fabricated stream, preserve the sanitized typed failure internally/logging, and document the visible-diagnostic API limitation for review. A native first-class diagnostic row is the preferred future capability.

Existing WCO stage names (e.g. TMDB LOOKUP FAILED, NO SPECIAL MATCH, PLAYER VERIFICATION FAILED) retain their scoped semantics during its ongoing Desktop test; they are not a second universal namespace. The checker supports an explicit WCO-only alias opt-in. No current provider behavior changes merely because these documents are published.

## 5. Mandatory validation

For applicable content, verify both identity and playback outcomes:

- Ordinary anime/Western episodes, later seasons and aliases; movies; Season 0, Episode 0 and source fractional conventions; multipart and combined packages; provider-specific franchise mapping.
- Wrong series/edition/year/season/episode/part, ambiguous/generic metadata, redirects and metadata failure. Preserve every previously verified case during unification/rebuilds.
- Valid MP4/HLS; expired, HTML/JSON or missing media; observed HTTP 403/429/503, network failure, timeout, verification/player errors and full/partial fallback.
- Accurate measured/source/unknown quality; two highest tiers independently per meaningful audio/track/mirror; lower-only, single-tier, unknown-only and unknown omission checks; duplicates.
- DUB/HSUB/SUB/DUB+SUB/DUAL/UNK with positive and negative evidence, selectable tracks, playback headers and independent mirrors.
- Diagnostics: truthful visible code, safe sanitization, no success clutter, separate media validation and client parsing/manual-selection/autoplay/P2P/debrid behavior.
- Manifest identity/metadata, syntax, standalone reproduction, all frozen hashes and exact deployed bytes. Preserve unrelated providers and rollback references.

Run provider regressions and the reusable [compliance checks](docs/provider-standards/COMPLIANCE_CHECKS.md). Existing providers initially use nonblocking `--audit`; new providers and explicitly maintained/upgraded output use `--strict` for the declared scope. Report missing evidence and native checks honestly. Do not change extraction to satisfy static tests or weaken a test that caught a wrong episode.

Source inspection and Node tests cannot prove native playback, actual subtitles/track switching, native cancellation or every autoplay mode. Record exact candidate hash, Desktop build/platform, cases and actual playback findings. Actual Nuvio Desktop playback is required before Master/production promotion; explicit user-authorized Nexus testing can precede it with pending status recorded. Keep successful historical evidence distinct from a newly modified candidate; document authorized exceptions.

## 6. Official lifecycle and branches

1. **Provider Lab:** experiments, alternate approaches and disabled historical archives. Preserve complete reproducible dependencies and unique IDs. An archive is not a production endorsement.
2. **Nexus:** active development, focused updates and Desktop testing. Inspect current source/manifest and known regressions, implement the authorized provider scope, run applicable strict checks, publish only necessary files when authorized, and record pending native validation. Never silently adopt changes across all providers.
3. **Master:** stable, individually promoted and device-verified implementations. Require explicit session authorization plus native playback evidence for the candidate. Never promote because Nexus is ahead, a version matches, or static tests pass alone.

Upgrades preserve stable provider IDs and display names unless a rename is explicitly authorized. Bump provider version, relevant cache revision and repository manifest version when code/metadata changes require client refresh. Documentation/testing-only updates need no manifest/provider/version bump.

Re-read expected branch head and manifest before publishing; stop/report unexpected concurrent changes instead of overwriting them. Prepare exact minimal diffs, use non-forced expected-head updates, and verify deployed manifest/URL/hash. Promote one provider, never merge whole branches. Prefer identical validated artifact bytes across branches; any packaging adaptation must be documented, reproducible and revalidated. Different filenames/hashes alone do not prove promotion state.

Retain historical source and a rollback record containing pre-change commits/entries, frozen artifact hashes, fresh-cache/version procedure and validation steps. Rollback is a new scoped commit preserving current unrelated work, not an indiscriminate branch reset. A completed Nexus release does not authorize Master.

## 7. Exceptions and incremental adoption

Record the provider, source class/content scope, evidence/provenance or native verification reference, reason, affected default, tests and limitations before relying on a deviation. Useful mirrors, adaptive sources and provider-specific title conventions are evidence-based exceptions, not shortcuts to more streams. Do not invent identity, tracks, qualities, HTTP causes or diagnostic safety to avoid a failure.

The current WCO 2.9.0 implementation/entry is frozen while native testing proceeds. Findings for other existing providers are in the [active-provider audit](docs/provider-standards/ACTIVE_PROVIDER_AUDIT.md) and [prioritized plan](docs/provider-standards/REMEDIATION_PLAN.md); remediate one authorized provider at a time. These standards/tools do not perform runtime normalization or automatically migrate diagnostics.
