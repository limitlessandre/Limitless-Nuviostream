# Limitless Nexus

**Limitless Nexus** is the active provider development and Nuvio Desktop testing branch of Limitless Nuviostream. Production-ready work is promoted individually to Master only after verification and explicit authorization. Nexus is not a mirror of Master.

## Development standards — start here

- [AGENTS.md](AGENTS.md): concise mandatory instructions automatically discoverable at the repository root by Codex when this branch is checked out.
- [PROVIDER_DEVELOPMENT_STANDARDS.md](PROVIDER_DEVELOPMENT_STANDARDS.md): identity, reliability, diagnostics, tests, branch lifecycle and release/rollback requirements.
- [NAMING_STANDARDS.md](NAMING_STANDARDS.md): authoritative labels, quality selection and scoped provider-specific audio/subtitle evidence.
- [Compliance tools](docs/provider-standards/COMPLIANCE_CHECKS.md): nonblocking existing-provider audits and strict checks for new/explicitly updated providers.
- [Desktop diagnostic compatibility](docs/provider-standards/DESKTOP_DIAGNOSTIC_COMPATIBILITY.md), [active-provider audit](docs/provider-standards/ACTIVE_PROVIDER_AUDIT.md), and [prioritized remediation](docs/provider-standards/REMEDIATION_PLAN.md).

These specifications apply from the beginning for new providers and during maintenance/significant updates of existing ones. They do not authorize blanket rewrites or claim all existing providers already conform. Audit tools are read-only and do not change extraction behavior.

## Install

The active Nexus manifest is the root [manifest.json](manifest.json):

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/manifest.json
```

## Branch model and promotion

| Branch | Role |
|---|---|
| Limitless-Provider-Lab | Experiments, alternate approaches and reproducible historical archives |
| Limitless-nexus | Focused development, maintenance and Desktop testing |
| Limitless-Master-Nexus | Stable, verified implementations promoted individually with explicit authorization |

Never merge an entire branch to promote one provider. Preserve stable IDs, verified matching/fallbacks, unrelated providers and rollback references. Prepare minimal provider/manifest changes, validate artifacts, device-test and verify deployed hashes under the detailed lifecycle standard. Branch filenames or packaging can differ only with documented, tested adaptations; blob differences alone do not establish promotion state. For a release intended to use identical bytes, verify identical artifact hashes on both branches.

## Active Nexus checkpoint

The current root manifest is authoritative; this table is a documentation checkpoint, not a second manifest.

| Provider | Version | Status / next validation |
|---|---:|---|
| Re:ANIME | 1.8.0 | Established; diagnostic/silent-failure audit findings remain |
| AniKoto Resurrection Test | 0.2.1 | Experimental Nexus diagnostic rebuild; no Master promotion implied |
| WCO | 2.9.0 | Unified normal WCO deployed; native Desktop validation in progress; Master unchanged at 2.7.1 |
| AsiaFlix | 0.5.3 | Active provider; no longer the old AsiaFlix Test 0.3.6 checkpoint |
| Tubi | 1.3.1 | Established; wrapper/diagnostic audit findings remain |
| NetMirror | 2.0.2 | Fast verified route; separate language encodes, not fabricated dual audio |
| Vidlink | 1.2.0 | General naming decision tree; preserve actual caption tracks |
| KissKH | 1.1.1 | Scoped first-party Japanese hard-sub verification; diagnostic remediation needed |

Repository manifest version: **2.3.49**. The separate WCO Unified TEST manifest entry was removed after normal WCO installation. Historical WCO implementations remain preserved in Provider Lab. WCO source, manifest metadata and version are unchanged by this standards/testing update.

## Working principles and next work

Preserve working content identity while debugging extraction. A playable URL is not finished until the series/episode, quality, audio/subtitle class, headers and mirror value are verified. Prefer independent useful fallbacks over duplicate frontends. Do not generalize one provider's playback evidence to another.

New work follows the global two-quality default and the detailed standards. Existing providers are initially audited nonblockingly, then maintained one authorized source at a time. HTTP-icon diagnostics and silent wrapper failures are prioritized in the remediation plan, not migrated automatically by this update.

WCO 2.9.0 remains under native Desktop testing. Do not begin Master promotion without separate authorization. Read current branch files/manifest and relevant provider regression/release evidence before making changes; this README's checkpoint must not override a newer manifest. The goal is a compact maintainable catalog with reliable, independently useful coverage.
