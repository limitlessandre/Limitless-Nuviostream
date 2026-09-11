# Vidlink Standalone Rebuild Handoff

## Goal

Rebuild Vidlink as a Nexus-owned standalone Nuvio provider with **no runtime dependency on Eclipsia/Codeberg**, while reproducing the exact playback behavior of the last user-confirmed working Vidlink provider before adding any extra stream variants or features.

This is a rebuild task, not a patch-the-current-v2 task. The current standalone attempts are diagnostic references only.

## Branch safety

- Development branch: `Limitless-nexus`
- Production branch: `Limitless-Master-Nexus`
- **Do not modify production until the user explicitly confirms actual Nuvio playback from the rebuilt standalone provider.**
- Keep the current confirmed production Vidlink path intact during development.
- Do not promote merely because a row appears. Playback must be verified in Nuvio.

## Canonical naming reference

Read repository-root `NAMING_STANDARDS.md` before changing user-facing labels.

For an unverified Vidlink stream with no selectable subtitle tracks, use `[UNK]`. If selectable subtitle tracks are actually returned, use `[SUB]` according to the naming standard. Do not infer HSUB from language.

## Known-good control

The confirmed Vidlink provider is the existing `Vidlink` entry, restored after the failed standalone replacement.

Known user test:

- Title: `Kamen Rider Den-O`
- Episode: S1E1
- Confirmed control behavior: **exactly one Vidlink row**
- Confirmed control quality shown in Nuvio: **720p**
- Confirmed control playback: **works in Nuvio**

The working presentation currently appears as approximately:

```text
Vidlink • HD 720p • [UNK]
```

Important: the control returning one row is a behavioral target. Do not assume every URL or quality advertised by the Vidlink API should be exposed.

## Broken standalone behavior

Standalone v1 did not play.

Standalone Test v2 also diverged from the control. In the user's Nuvio test it returned **three candidate video rows**, while the confirmed Vidlink control returned one 720p row. The three standalone candidates did not play.

This is the strongest regression clue currently available:

```text
working control: 1 playable row
standalone rebuild attempts: 3 non-playing rows
```

Treat the extra candidates as suspect until the exact selection behavior of the working provider is understood.

## Existing files to inspect

### Working/control lineage

- `custom/providers/vidlink-eclipsia-nexus-v3.js`
  - Last user-confirmed Vidlink behavior before standalone replacement.
  - Follow its runtime output shape and stream-selection behavior carefully.
- `custom/providers/vidlink-master.js` on production
  - Currently restored to the confirmed path.

### Failed standalone references

- `custom/providers/vidlink-standalone-nexus-v1.js`
  - Direct Vidlink/EncDec implementation.
  - Used standard/DASH environment handling and exposed candidates that failed playback.
- `custom/providers/vidlink-standalone-nexus-v2.js`
  - Simplified plain `/api/b/...` experiment.
  - Still must not be considered confirmed.

Do not overwrite these diagnostic references unless there is a specific reason. Prefer a new rebuild file/version.

## External implementation references already identified

Current Vidlink flow is known to use:

```text
GET https://enc-dec.app/api/enc-vidlink?text=<tmdb_id>
GET https://vidlink.pro/api/b/movie/<encrypted_id>
GET https://vidlink.pro/api/b/tv/<encrypted_id>/<season>/<episode>
```

Expected Vidlink request headers include:

```text
Origin: https://vidlink.pro
Referer: https://vidlink.pro/
User-Agent: browser UA
```

Useful references previously inspected:

- `smy778/EncDecEndpoints` → `samples/vidlink.py`
- `zoro6969/plugins_nuvio` → `providers/vidlink.js`
- `BeamlakAschalew/flixquest-scraper` → `src/providers/vidlink.ts`
- `ayman708-UX/PlayTorrioV3` → `lib/services/scraper/sites/vidlink.dart`

These references are useful for understanding the API, but **the working Nuvio control is the authority for selection/playback behavior**.

## Rebuild method

Start from the confirmed control and instrument/compare it before writing a replacement.

The rebuild should determine, for Den-O S1E1:

1. The exact Vidlink API request(s) made by the working control.
2. The exact API response fields used by the working control.
3. Which single candidate the working control selects and why.
4. Exact URL type returned to Nuvio: MP4 vs HLS, and whether the URL is a master playlist, media playlist, or direct file.
5. Exact request/playback headers attached to the working row.
6. Whether the working provider rewrites, filters, probes, or parses the returned URL before exposing it.
7. Whether returned `qualities`, `playlist`, DASH variants, proxy-required entries, or other candidates are deliberately ignored.
8. Whether the working row contains behavior/proxy/header fields that the standalone versions omitted or changed.

Only after reproducing that one-row result should the dependency on Eclipsia/Codeberg be removed.

## Preferred implementation strategy

Create a new standalone rebuild provider on `Limitless-nexus`, for example:

```text
custom/providers/vidlink-standalone-rebuild-v1.js
```

The first successful milestone is intentionally narrow:

```text
Den-O S1E1
→ exactly one Vidlink Standalone Rebuild row
→ 720p if that is what the working control selects
→ row actually plays in Nuvio
```

Do not add additional quality rows, DASH rows, captions, multi-language variants, or fallback candidates until this baseline passes.

Once baseline playback passes, add features one at a time and ensure the known-good row remains playable.

## Diagnostic expectations

If useful, expose a separate temporary diagnostic provider/row rather than contaminating the playable row list. Diagnostics should show enough information to compare the control and rebuild, such as:

```text
API endpoint
response stream.type / deliveryType
playlist present?
qualities keys
sourceId
selected candidate host/path suffix
selected candidate content type if probed
playback headers
candidate count before filtering
candidate count after filtering
```

Do not expose full sensitive/tokenized URLs in user-facing names.

## Acceptance criteria

The standalone rebuild is **not confirmed** until the user verifies actual Nuvio playback.

Minimum acceptance criteria:

```text
1. No runtime Eclipsia/Codeberg dependency.
2. Den-O S1E1 returns the same effective stream selection as the confirmed Vidlink control.
3. Exactly one baseline row unless the control itself proves multiple rows should exist.
4. Baseline row actually plays in Nuvio Desktop.
5. Naming follows NAMING_STANDARDS.md.
6. Production remains on the confirmed provider until explicit user approval to promote.
```

After confirmation, replace the active Nexus Vidlink with the standalone rebuild, remove temporary standalone test entries, then promote the same confirmed implementation to `Limitless-Master-Nexus`.
