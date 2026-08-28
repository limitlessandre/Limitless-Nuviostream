# Limitless Nexus FlixCloud Proxy

Shared playback infrastructure for Nuvio providers that resolve streams through FlixCloud.

## Why it exists

FlixCloud's decrypted master playlist is not always directly playable by Nuvio. Media segments may be wrapped in a fake WebP/PNG header and XOR-obfuscated with a 16-byte mask. This Worker mirrors the playback behavior used by maintained Re:ANIME clients:

1. Parse the initial FlixCloud master manifest through `enc-dec.app`.
2. Rewrite child playlist, media, key, and subtitle URLs back through this proxy.
3. Preserve FlixCloud's short-lived `token` query parameter across relative HLS URLs.
4. Strip fake WebP/PNG headers from media segments.
5. XOR-decode obfuscated MPEG-TS segment payloads.

The proxy is deliberately host-restricted. User-supplied upstream URLs must use HTTPS and resolve to `flixcloud.cc` or one of its subdomains, so this cannot act as a generic open web proxy.

## Endpoints

- `GET /health` - health/version information.
- `GET /manifest?u=<master>&w=<w_payload>&m=<maskHex>` - prepares and rewrites the initial master playlist.
- `GET /proxy?u=<child>&m=<maskHex>` - proxies rewritten child playlists, subtitles, keys, and media segments.

The XOR mask is a 32-character hex string representing 16 bytes. The Worker contains the current AniYomi fallback mask, but Nexus should normally scrape the live mask from FlixCloud's `hls.js` and pass it explicitly.

## Local validation

```bash
npm install
npm run check
npm test
npm run dev
```

The unit tests do not contact Re:ANIME or FlixCloud. They validate the deterministic proxy mechanics locally.

## Deploy to Cloudflare Workers

```bash
npm install
npx wrangler login
npm run deploy
```

After deployment, set Re:ANIME's `FlixCloud Proxy URL` setting in Nuvio to the Worker origin, for example:

```text
https://limitless-nexus-flixcloud.<account>.workers.dev
```

Do not include `/manifest` or `/proxy`; the provider appends those paths.

## Upstream references

The implementation is based on the currently maintained Re:ANIME/FlixCloud behavior in Yuzono's AniYomi extension, particularly its local `FlixProxyServer`, and the public `enc-dec.app` FlixCloud flow. Nexus keeps this functionality in a shared service so any later provider using FlixCloud can reuse it.
