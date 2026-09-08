# Limitless Nexus: Scarlet Peach — Providers

**Branch: `scarlet-peach-providers`. Keep Scarlet Peach provider changes on this branch unless the user explicitly directs otherwise. Do not create custom, alternate, or per-user install links.**

## Install URLs

Scarlet Peach uses two separate manifests because Nuvio treats metadata addons and plugin repositories as different systems.

Catalog / metadata addon:

`https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Provider repository:

`https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`

Use the catalog URL in Nuvio's addon installer. Use the provider repository URL in **Settings → General → Plugins → Add Repository**.

## Active provider: Hanime

Scarlet Peach Providers `0.2.0` switches the active provider from HentaiTV to `Scarlet Peach - Hanime`.

Why Hanime is now first:

- Current AniYomi Hanime playback was independently verified working in September 2026.
- Yuzono's current Hanime extension was updated in August 2026 for Hanime's new encrypted website/API flow.
- The current protocol uses a signed v11 search API plus an AES-256-GCM `/api/v11/handshake` rather than brittle player-page scraping.
- Hanime's guest handshake can return playable HLS streams without requiring debrid/P2P.

Protocol references:

- `yuzono/anime-extensions` Hanime source, especially `Hanime.kt`, `NativeSignatureProvider.kt`, and `HandshakeCipher.kt`.
- `anime-src/hanime-stremio`, especially `lib/services/htv_stream_resolver.js` and its Cloudflare handshake relay.

HentaiTV code remains in this branch as parked reference/debug work, but it is no longer listed in the active plugin manifest.

## Hanime architecture

```text
Nuvio provider
    -> Scarlet Peach catalog metadata (MAL/AniList/SP id -> title/aliases)
    -> Scarlet Peach Hanime resolver Worker
        -> signed Hanime v11 search dataset
        -> strict title + episode matching
        -> encrypted Hanime v11 handshake
        -> decrypted guest HLS sources
    -> Nuvio stream rows
```

The Nuvio provider intentionally stays small. Hanime signing and AES-GCM handshake logic live in the Worker so Nuvio's restricted plugin runtime is not responsible for crypto/browser-protocol behavior.

## Hanime Worker deployment

Worker source:

`workers/scarlet-peach-hanime/src/index.js`

Cloudflare config:

`workers/scarlet-peach-hanime/wrangler.jsonc`

Worker name:

`scarlet-peach-hanime`

With the existing Cloudflare workers.dev subdomain, the intended canonical resolver base after deployment is:

`https://scarlet-peach-hanime.limitlessandre.workers.dev`

Health check after deployment:

`https://scarlet-peach-hanime.limitlessandre.workers.dev/health`

Expected health response includes:

`"service":"Scarlet Peach Hanime Resolver"`

The Nuvio Hanime provider is already configured for that canonical resolver URL. Until the Worker is deployed, Nuvio will show a visible `DIAG RESOLVER` row rather than failing silently.

### Cloudflare deployment notes

Deploy only the `workers/scarlet-peach-hanime` Worker directory from the `scarlet-peach-providers` branch. No secrets are required for the current MVP because the Worker is a narrow resolver with fixed Hanime upstream endpoints, not a general-purpose proxy.

The Worker exposes only:

- `GET /health`
- `POST /resolve`

The resolver accepts title, aliases, year, and episode. It does not expose arbitrary upstream URLs.

## Current matching contract

The Nuvio provider currently resolves Scarlet Peach metadata IDs:

- `mal:<id>`
- `anilist:<id>`
- `sp:<id>`

Episode-suffixed Nuvio IDs such as `mal:368:1` are normalized to the base series ID before metadata lookup, while the suffix is preserved as the requested episode.

The Worker scores Hanime entries using normalized titles/aliases and the requested episode number. It prefers an exact title/base-title match for the correct episode and rejects weak matches instead of guessing.

## Stream behavior

Returned Hanime streams use the current guest v11 handshake and are expected to be HLS. Nuvio rows include:

- verified height/quality when Hanime returns it
- `Referer: https://player.hanime.tv/`
- `Origin: https://player.hanime.tv`

Language, dub/sub, and censor status are not guessed from the catalog provider. Those fields should only be promoted into stream labels when the upstream response verifies them.

## Current handoff

Repository: `limitlessandre/Limitless-Nuviostream`  
Branch: `scarlet-peach-providers`  
Provider manifest version: `0.2.0`  
Active provider: `Scarlet Peach - Hanime`  
Provider file: `providers/scarlet-peach-hanime-v1.js`  
Resolver Worker: `workers/scarlet-peach-hanime/`  
Provider manifest: `https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/manifest.json`  
Catalog manifest: `https://scarlet-peach-catalog.limitlessandre.workers.dev/manifest.json`

Next validation sequence after Worker deployment:

1. Verify `/health`.
2. Refresh Scarlet Peach Providers in Nuvio and confirm version `0.2.0`.
3. Test `Bible Black` episode 1 from Scarlet Peach (`mal:368:1`).
4. Test one newer title such as Jimihen episode 1.
5. Confirm at least one guest HLS source plays in Nuvio.
6. Only after playback is confirmed, add quality/variant refinements and broader cross-catalog ID support.
