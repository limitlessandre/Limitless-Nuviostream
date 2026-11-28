# Repository instructions

Before developing or maintaining providers, read [PROVIDER_DEVELOPMENT_STANDARDS.md](PROVIDER_DEVELOPMENT_STANDARDS.md), [NAMING_STANDARDS.md](NAMING_STANDARDS.md), and the affected provider's documentation, release evidence and regression tests. Read the current target branch files/manifest; local branch copies can differ.

- Preserve verified extraction, identity, playback and independent legacy fallbacks. Never substitute another episode or relax series/season/edition ownership for stream count.
- Follow canonical naming and the two-highest-quality default with meaningful audio/mirror independence. Use measured or trustworthy bound evidence; never invent resolution, audio, subtitles or selectable dual audio.
- Keep truthful, sanitized stage diagnostics separate from media. Use only a verified client-compatible nonplayable representation; no autoplay-selectable error URLs. Read the linked Desktop compatibility limits before adopting a workaround.
- Bound requests, retries and the whole invocation; preserve playback headers/actual tracks and reproducible dependencies. Respect the Desktop deadline and binary-fetch limitations.
- Run applicable provider regressions and compliance checks; distinguish static evidence from native Desktop playback. Record native validation before Master promotion.
- Target Limitless-nexus by default for provider development and preserve local work. Respect Provider Lab / Nexus / Master separation. Publish only the authorized provider/files; never merge an entire branch to promote a provider. Master always requires explicit authorization.
- Preserve stable identities, unrelated providers, manifest metadata, rollback references and historical source. Verify baseline and deployed artifact hashes; stop/report unexpected concurrent changes.
- Document scoped intentional deviations and their evidence/tests. Use nonblocking audits for unchanged legacy providers; authorized maintenance/significant upgrades must run applicable strict checks. Never rewrite working behavior merely to satisfy tooling.

The detailed standards own the lifecycle; NAMING_STANDARDS.md owns labels and verified provider-specific classifications. User authorization/preferences in the session govern scope and explicit exceptions.
