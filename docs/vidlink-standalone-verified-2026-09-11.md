# Vidlink standalone verified status — 2026-09-11

This note supersedes the pre-playback status in `docs/vidlink-standalone-rebuild-baseline.md`.

## Final result

The standalone rebuild from Work commit `c0c0f4f7b9e7d3b71ef8fc11f65ef5ba56fa0073` was manually verified in Nuvio Desktop with Kamen Rider Den-O S1E1.

Verified behavior:

- exactly one Vidlink row;
- 720p;
- actual Nuvio playback works;
- the current stream class is manually verified hard-subbed;
- visible name is `Vidlink • HD 720p • [HSUB]`;
- no Eclipsia/Codeberg code is fetched at runtime.

The confirmed standalone implementation preserves the measured control contract: plain Vidlink API request, the original quality filter, direct media row type `video`, and no playback headers attached to the returned media row.

## Promotion

The standalone implementation replaced the old Eclipsia-backed active Vidlink in `Limitless-nexus` and was promoted to `Limitless-Master-Nexus` after user playback verification.

Future Vidlink changes must preserve this verified one-row playable baseline first. New captions, lower-quality rows, DASH/environment variants, extra headers, proxy metadata, or other row fields should be tested separately in Nexus before promotion.

The provider-specific `[HSUB]` verification is also recorded in the root `NAMING_STANDARDS.md`.
