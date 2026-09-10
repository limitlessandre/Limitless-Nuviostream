# KissKH standalone provider notes — 2026-09-10

## Status

KissKH was rebuilt as a Nexus-owned provider after validating Eclipsia/Fyron as a working reference. The active Nexus provider no longer fetches Eclipsia/Codeberg at runtime.

Active production wrapper: `custom/providers/kisskh-production-v1.js`

Pinned tested resolver: `custom/providers/kisskh-standalone-nexus-v1.js` at commit `8e48328bf8b5367cead3a31ee0498cde013376d3`.

External services still required by the provider are KissKH itself, TMDB for identity metadata, media CDNs returned by KissKH, and `enc-dec.app` for current KissKH video/subtitle token generation and encrypted subtitle decoding.

## Why the earlier Nexus KissKH attempt failed

The earlier implementation understood the broad KissKH API correctly, including search, drama detail, episode IDs, the episode `.png` endpoint, and the `Video`, `Video_tmp`, and `ThirdParty` source fields. The fragile pieces were around the current authorization/playback flow.

Observed differences from the working 2026 flow:

- Working token generation uses `https://enc-dec.app/api/enc-kisskh?text=<episodeId>&type=vid`; the earlier provider used an older Google Apps Script key bridge.
- Current episode requests use `ts=&time=` with empty values, not `ts=null&time=null`.
- Current media playback works with KissKH-root Referer/Origin headers; the earlier implementation used the full episode page as the returned media Referer.
- Non-MP4/non-M3U8 `ThirdParty` values are embed/player URLs and must not be blindly labeled as HLS.
- Current subtitles use a separate `type=sub` token and `/api/Sub/<episodeId>`. Some `.txt` subtitle payloads require `enc-dec.app/api/dec-kisskh` decryption.
- A domain can successfully answer search while later detail/key/video steps are stale. Domain fallback must validate the complete path rather than stop at the first search hit.
- Loose title selection can return a valid but wrong show. Strict title ownership is required before accepting any stream.

## Title ownership

The standalone resolver gets TMDB metadata and alternative titles, normalizes those aliases, and accepts only exact normalized KissKH titles. Candidate detail pages are revalidated before episode selection.

This was important for Kamen Rider Den-O: the working reference returned a playable but unrelated show even though KissKH did not actually contain Den-O. The correct Nexus result is therefore `DIAG NO SOURCE FOUND`, not a false-positive stream.

## Domain fallback

The current resolver tries these KissKH domains sequentially:

1. `https://kisskh.ovh`
2. `https://kisskh.do`
3. `https://kisskh.co`
4. `https://kisskh.id`
5. `https://kisskh.la`

A domain only wins after exact title ownership, detail/episode resolution, token generation, episode source retrieval, and at least one playable direct source succeed.

## Episode media fallback

KissKH episode JSON can expose:

- `Video` — primary first-party source
- `Video_tmp` — direct fallback when present and playable
- `ThirdParty` — possible embed/player fallback

The standalone resolver currently returns verified direct HLS/MP4 sources. It does not manufacture a row for a `ThirdParty` value that cannot be directly verified.

### Test observations

**Kamen Rider Ex-Aid S1E1**

- `Video`: first-party HLS on `hls11.cdnvideo11.shop`
- `ThirdParty`: `sbplay2.xyz`
- Unique source fields observed: 2
- `sbplay2.xyz` failed all audit probes and produced no nested playable URL, so it is not exposed as a fallback row.
- The first-party HLS played successfully in Nuvio.

**Kamen Rider Den-O S1E1**

- KissKH did not actually contain the requested show.
- The older/reference matching path selected an unrelated title.
- Standalone strict ownership correctly rejects it.

## Quality behavior

The audited first-party KissKH HLS URLs were media playlists rather than adaptive master playlists. If KissKH returns a master playlist later, the standalone resolver expands its `#EXT-X-STREAM-INF` variants into separate Nexus quality rows.

When only a media playlist is available, quality is inferred only when the source URL itself contains a recognizable resolution. Otherwise the provider reports `Unknown Auto` rather than inventing a quality.

Nexus quality naming follows the shared scheme, for example:

- `KissKH • FHD 1080p`
- `KissKH • HD 720p`
- `KissKH • SD 480p`
- `KissKH • Unknown Auto`

`[SUB]` is appended only when real subtitle tracks are returned.

## No-source diagnostic

The production wrapper returns:

`KissKH • DIAG NO SOURCE FOUND`

when the standalone resolver produces no valid stream. This includes unavailable titles, unsupported/missing episodes, or complete failure across all configured KissKH domains.

## Revisit triggers

Re-audit KissKH when any of these happen:

- EncDec changes its KissKH endpoint or response shape.
- KissKH changes domains or episode query parameters.
- A new `Video_tmp`/`ThirdParty` host becomes common and requires an extractor.
- HLS changes from media playlists to adaptive masters or vice versa.
- Known titles start producing `NO SOURCE FOUND` despite being playable on KissKH itself.
