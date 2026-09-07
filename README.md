# Limitless Nexus: Scarlet Peach — Providers

**Branch: `test/scarlet-peach`. This is the only branch for Scarlet Peach testing. Keep future changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Reinstall manifest

This repository is a provider library, not an independently installable Nuvio addon. Reinstall the catalog using its one canonical test manifest:

`http://127.0.0.1:7001/manifest.json`

Do not create a provider-only manifest or an alternate install URL. A provider addon manifest, if later needed, must be exposed through the same approved test deployment process and documented as its single canonical `/manifest.json` URL.

## MVP scope

- Shared resolver contract: `id`, `type`, `title`, `aliases`, `year`, `episode`.
- Only `mal:`, `anilist:`, and `sp:` stable IDs are accepted. HentaiStream private IDs are rejected.
- HentaiTV adapter boundary with deterministic title matching. A site transport/client must be supplied separately by an approved runtime integration.
- HentaiStream is a comparison/testing oracle only, never a dependency or identifier source.

## Handoff / next session

Repository: `nexus-scarlet-peach-providers`  
Branch: `test/scarlet-peach`  
Current status: shared contract and HentaiTV resolver scaffold complete; unit tests run with `npm test`.  
Known limitation: live HentaiTV transport and stream extraction are deliberately not included in the catalog and require an approved integration.  
Next providers: HentaiMama, MuchoHentai, HStream, HentaiHaven.
