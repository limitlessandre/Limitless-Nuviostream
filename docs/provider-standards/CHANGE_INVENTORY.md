# Standards change inventory

Only these 22 paths belong to the Nexus standards/testing publication. Two existing documents are modified; 20 files are added. No manifest, provider implementation, extraction dependency, cache/version field, WCO artifact, Master file or Provider Lab file is changed. No blanket diagnostic migration or runtime enforcement is installed.

| Action | File | Purpose |
|---|---|---|
| Add | AGENTS.md | Root-discoverable agent instructions and mandatory reading |
| Add | PROVIDER_DEVELOPMENT_STANDARDS.md | Canonical lifecycle, identity/reliability, diagnostics, tests and promotion |
| Modify | NAMING_STANDARDS.md | Global quality selection, evidence clarification and diagnostic separation; preserve provider-specific sections |
| Modify | README.md | Standards links, correct Nexus checkpoint and scoped workflow |
| Add | scripts/check-provider-standards.js | Audit/strict row/manifest CLI |
| Add | scripts/provider-standards/check.js | Read-only evidence/selection/format/metadata checks |
| Add | scripts/provider-standards/desktop-contract.js | Conditional known-profile transport check and source-derived eligibility model |
| Add | scripts/audit-provider-standards.js | Non-executing local entry-source audit |
| Add | scripts/probe-provider-diagnostics.js | Optional bounded trusted-code HTTP-503 probe; no real site requests |
| Add | tests/provider-standards/check.test.js | 63 positive/negative tool regressions |
| Add | tests/provider-standards/fixtures/positive.json | Passing evidence-consistent selection fixture |
| Add | tests/provider-standards/fixtures/negative.json | Excess qualities/contradictory evidence fixture |
| Add | docs/provider-standards/COMPLIANCE_CHECKS.md | CLI/schema/limits and incremental adoption |
| Add | docs/provider-standards/DESKTOP_DIAGNOSTIC_COMPATIBILITY.md | Actual versioned client contract and safe-strategy limitations |
| Add | docs/provider-standards/DESKTOP_CONTRACT_PROVENANCE.json | Inspected upstream ref and source Git blobs |
| Add | docs/provider-standards/ACTIVE_PROVIDER_AUDIT.md | All eight active providers, severity, coverage and remediation |
| Add | docs/provider-standards/SOURCE_AUDIT.json | Baseline entry hashes and nonblocking source facts |
| Add | docs/provider-standards/FAILURE_PROBE.json | Mocked entry-failure reporting/eligibility findings |
| Add | docs/provider-standards/TRANSITIVE_SOURCE_PROVENANCE.json | Nine inspected non-WCO transitive source locks |
| Add | docs/provider-standards/REMEDIATION_PLAN.md | Provider-by-provider priorities, no implementation migration |
| Add | docs/provider-standards/TEST_RESULTS.md | 268 passing checks, freeze/integrity checks and native limits |
| Add | docs/provider-standards/CHANGE_INVENTORY.md | This complete file list and publication boundary |

Validation: 63 new tooling tests plus all 205 preserved local WCO regressions pass. New tools are self-contained Node scripts/tests; private/local WCO development packages and source-inspection snapshots are not included in this publication. See TEST_RESULTS.md for what was actually tested and what remains native-only.
