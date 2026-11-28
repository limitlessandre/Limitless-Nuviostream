# Read-only provider compliance checks

Requires Node.js 20 or newer; validation for this update used Node 24.19.0. No npm packages, network, provider imports or runtime normalization are required by the row/manifest checker. Tools do not rewrite provider rows or implementations.

## Commands

```sh
node --test tests/provider-standards/*.test.js
node scripts/check-provider-standards.js tests/provider-standards/fixtures/positive.json --strict
node scripts/check-provider-standards.js tests/provider-standards/fixtures/negative.json --audit
node scripts/audit-provider-standards.js --root=.
```

The first checker defaults to **nonblocking audit**: violations are listed, exit 0. `--strict` exits 1 for mechanically detected violations; invalid input/options exits 2. No flags install a runtime filter or CI hook. Existing providers start in audit mode; new providers and explicitly maintained output use strict mode for the declared scope. Strict success is **not** proof of native playback or all source behavior.

`audit-provider-standards.js` only reads the active root manifest and local entry sources. It never fetches or executes providers. It records source hashes and review heuristics; a pattern is not a runtime verdict. Missing/external sources remain unproved. Run it from a complete current Nexus checkout, not a different branch's working tree. `SOURCE_AUDIT.json` is the captured result from the pinned Nexus baseline listed in the audit report.

Optional trusted-code failure probe:

```sh
node scripts/probe-provider-diagnostics.js --root=.
```

This **does execute trusted repository entry code** in bounded subprocesses, with fetch replaced by HTTP 503 and no real site calls. It is not a security sandbox for arbitrary untrusted code. Each child has a six-second limit; unavailable/timed-out probes yield no conclusion. It examines the entry/loader failure path, not every downstream failure. `FAILURE_PROBE.json` is the captured current result. Static source auditing remains separate and execution-free.

## Input and evidence schema

A row input has `policy`, `items: [{row, evidence}]`, and preferably `candidateInventory` of all validated candidates before selection. See the positive/negative JSON fixtures. Never publish private stream URLs, cookies or response payloads as fixtures; use sanitized public captures or `.invalid` synthetic URLs.

```json
{
  "policy": { "provider": "Example" },
  "items": [{
    "row": {
      "name": "Example • HD 720p • [DUB]",
      "url": "https://media.invalid/example.mp4",
      "quality": "720p",
      "language": "English"
    },
    "evidence": {
      "media": { "validated": true, "height": 720, "audioLanguage": "en" }
    }
  }]
}
```

Evidence fields are an **audit attestation**, not data the checker can authenticate. Pair them with source review, provider-specific tests and live/native verification. The tools do not infer evidence from names/filenames or fetch media themselves.

- `media.validated`, `height`, `audioLanguage`: actual validated media/player facts. Numeric `height` outranks source-reported height. `selectableAudioTracks` or genuinely distinct returned `audioTracks` with `selectable: true` can establish multiple selectable audio. `selectableSubtitlesAvailable: true` checks that actual subtitle entries were retained.
- `source.firstParty`, `urlBound`, `identityBound`, `height`: explicit first-party player quality bound to the exact approved URL/content. The same binding scopes `audioLanguage`, `dubVerified`, `hardSubsVerified`, `multipleSelectableAudio` and `streamClass`; a raw marketing label is insufficient.
- `content.trusted`, `originalLanguage`: last-resort content-language evidence. Contradictory actual audio wins.
- `mirror: {key, independent: true}`: independent-source evidence; different hosts alone do not establish it. Quality grouping keeps tag, actual language/track descriptors and mirror key independent. Quality-specific subtitle URLs do not create new classes. `disambiguator: {label, useful: true}` explains an otherwise noncanonical suffix.
- `policy.verifications`: explicit reviewed provider/stream-class/audio-language/tag/reference records for scoped manual verification. They must correspond to the authoritative naming document; they cannot generalize a KissKH or Vidlink observation to unrelated classes.
- `candidateInventory`: supplies omitted candidates for superior-quality and unknown-source-loss checks. Without it the result explicitly says selection completeness is unproved. An output-only test cannot detect what an extractor discarded before returning.

Unknown-only candidates retain distinct URLs rather than one height-zero bucket. Known duplicates may be deduplicated; an unknown extra may be omitted under the documented two-evidenced-alternatives exception within its own class/mirror. Supply `policy.unknownOmissionException: {reference, reason}` for that reviewed choice; without an explicit record strict checks preserve the unknown candidate. Invalid/expired candidates must not be falsely marked validated. Use provider-specific failure fixtures to prove why a candidate was rejected.

### Diagnostics

Supply `policy.desktopContract` only for an actually inspected client contract. The currently supported profile is `nuviodesktop-plugin-1ece6d7ae5dbda29d0ab05952375692a56d81078`. It accepts only the exact previously examined WCO hashless sentinel, rejects extra playback targets and still requires native verification. It is not a universal recommendation or automatic permission to change another provider's representation. Read the compatibility document before selecting a transport.

For existing WCO only, `provider: "WCO"` with `allowWcoLegacyCodes: true` recognizes its recorded stage-code aliases. This changes checker recognition, not WCO output. Other providers use the canonical codes from the lifecycle standard.

When no safe visible adapter is verified, an input can record `items: []`, `policy.diagnosticTransportUnavailable: true` and a typed internal `failure: {code: "HTTP 503", stage: "series"}`. The checker reports the API limitation as requiring review, rather than demanding a fabricated URL. Provider-specific evidence must substantiate that code. Unexplained empty results are violations.

The predicate model tests visibility/shared playback eligibility, not native UI, mode preference/ranking or arbitrary torrent semantics. `nativePlaybackProved` always remains false. Unknown runtime profiles and unsupported representations never receive a diagnostic-safety approval.

### Manifest inputs

A raw manifest may be checked directly, or supplied as `manifest` alongside `baselineManifest` and `changeScope`. IDs must be unique/stable; required name/version/filename/enabled/types must be valid. A baseline comparison protects unrelated entries and upgrade identity. Declare `updatedProviderIds` and any `newProviderIds` explicitly. It does not infer whether an ID rename, native test or publication is authorized.

## What passing means

Mechanically checkable coverage: canonical grammar/tiers/tags; consistent evidence and actual measured-quality precedence; excessive/redundant qualities; duplicates; preserved unknown/superior candidates when an inventory exists; meaningful mirrors; media/track/language consistency; manifest identity/metadata; diagnostic code/format/sanitization; profile-scoped autoplay exclusion. Positive and negative fixtures exercise these paths.

Not proved by these checks: genuine content/audio/visual subtitles, honesty/completeness of supplied evidence, semantic correctness of an error cause, all transitive code paths, private authentication behavior, live source health, native cancellation, actual Desktop rendering/playback/track switching or all runtime versions. Missing review evidence is not an excuse to fabricate it. Provider-specific regressions and native release gates remain mandatory.

Do not edit working providers to silence an audit. Record scoped exceptions and gaps; use the prioritized remediation plan for separately authorized provider updates.
