# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Reinstall manifest

This branch is a provider library, not an independently installable Nuvio addon. Reinstall Scarlet Peach through the catalog addon while its server is running:

- Nuvio on the same PC: `http://127.0.0.1:7001/manifest.json`
- Nuvio on another device on the same network: `http://<PC-LAN-IP>:7001/manifest.json`

Do not create a provider-only manifest or an alternate install URL. A raw GitHub manifest is not sufficient because the catalog addon requires live `/catalog/...` and `/meta/...` routes. If Scarlet Peach is later deployed to an approved host, use the catalog branch's single canonical hosted `/manifest.json` URL.

## MVP scope

- Shared resolver contract: `id`, `type`, `title`, `aliases`, `year`, `episode`.
- Only `mal:`, `anilist:`, and `sp:` stable IDs are accepted. HentaiStream private IDs are rejected.
- HentaiTV adapter boundary with deterministic title matching. A site transport/client must be supplied separately by an approved runtime integration.
- HentaiStream is a comparison/testing oracle only, never a dependency or identifier source.

## Handoff / next session

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Current status: shared contract and HentaiTV resolver scaffold complete; unit tests run with `npm test`.  
Known limitation: live HentaiTV transport and stream extraction are deliberately not included in the catalog and require an approved integration.  
Next providers: HentaiMama, MuchoHentai, HStream, HentaiHaven.
