"use strict";

// Limitless Nexus AniKoto local relay test.
// Ports the minimal transport behavior proven by mkelvers/arc:
// required media headers, guarded redirects, HLS URI rewriting,
// alternate imgnex mirrors, and PNG/JPEG disguised MPEG-TS unwrapping.

const HOST = "127.0.0.1";
const PORT = 8787;
const REFERER = "https://megaplay.buzz/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const TIMEOUT_MS = 10000;
const MAX_PLAYLIST = 2 * 1024 * 1024;
const MAX_SUBTITLE = 512 * 1024;
const MAX_SEGMENT = 64 * 1024 * 1024;

const MEDIA_SUFFIXES = [
  "akirax.buzz",
  "anizara.store",
  "imgnex.top",
  "kryntal.top",
  "lostproject.club",
  "megaplay.buzz",
  "mikora.top",
  "norami.top",
  "shiora.site",
  "shiora.top",
  "tiktokcdn.com",
  "trycloud.pro",
  "watching.onl",
  "mewstream.buzz",
  "voltara.click",
  "kotocdn.site"
];

const IMGNEX_MIRRORS = [
  "akirax.buzz",
  "mikora.top",
  "norami.top",
  "shiora.site",
  "shiora.top"
];

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith("." + suffix));
}

function normalizeTarget(value) {
  let url;
  try { url = value instanceof URL ? new URL(value.href) : new URL(String(value || "")); }
  catch (_) { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !hostAllowed(url.hostname)) return null;
  return url;
}

function mediaCandidates(initial) {
  const source = normalizeTarget(initial);
  if (!source) return [];
  const out = [source];
  if (source.hostname.toLowerCase().endsWith(".imgnex.top") && source.pathname.startsWith("/anime/")) {
    for (const suffix of IMGNEX_MIRRORS) {
      const alt = new URL(source.href);
      alt.hostname = "megap." + suffix;
      alt.pathname = source.pathname.slice("/anime".length);
      out.push(alt);
    }
  }
  const seen = new Set();
  return out.filter((url) => {
    const key = url.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function corsHeaders(extra) {
  const headers = new Headers(extra || {});
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range,Accept,Content-Type");
  headers.set("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges,Content-Type");
  return headers;
}

async function fetchOnce(initial, range) {
  let target = initial;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const headers = new Headers({ Accept: "*/*", Referer: REFERER, "User-Agent": UA });
    if (range) headers.set("Range", range);
    let response;
    try {
      response = await fetch(target, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (_) {
      const error = new Error("upstream-network");
      error.retryable = true;
      throw error;
    }

    if (response.status < 300 || response.status >= 400) {
      if (!response.ok && response.status !== 206) {
        const error = new Error("upstream-" + response.status);
        error.status = response.status;
        throw error;
      }
      return { response, target };
    }

    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("redirect-limit");
    const next = normalizeTarget(new URL(location, target));
    if (!next) throw new Error("unsupported-redirect");
    target = next;
  }
  throw new Error("redirect-limit");
}

async function fetchResource(initial, range) {
  let lastError = null;
  for (const candidate of mediaCandidates(initial)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await fetchOnce(candidate, range); }
      catch (error) {
        lastError = error;
        if (!error || !error.retryable) break;
      }
    }
  }
  throw lastError || new Error("upstream-failed");
}

async function limitedBytes(response, maximum) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) throw new Error("body-too-large");
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maximum) throw new Error("body-too-large");
  return buffer;
}

function findSequence(bytes, needle) {
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function unwrapDisguisedSegment(bytes) {
  const pngEnd = new Uint8Array([0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]);
  const pngIndex = findSequence(bytes, pngEnd);
  if (pngIndex >= 0) {
    const body = bytes.subarray(pngIndex + pngEnd.length);
    if (body.length && body[0] === 0x47) return body;
  }

  const jpegEnd = new Uint8Array([0xff,0xd9]);
  const jpegIndex = findSequence(bytes, jpegEnd);
  if (jpegIndex >= 0) {
    const body = bytes.subarray(jpegIndex + jpegEnd.length);
    if (body.length && body[0] === 0x47) return body;
  }

  if (bytes.length && bytes[0] === 0x47) return bytes;

  for (let i = 0; i < Math.min(bytes.length, 1024 * 1024); i += 1) {
    if (bytes[i] !== 0x47) continue;
    if (i + 188 >= bytes.length || bytes[i + 188] === 0x47) return bytes.subarray(i);
  }
  return bytes;
}

function relayReference(reference, playlistUrl, relayOrigin) {
  const value = String(reference || "").trim();
  if (!value || value.startsWith("data:")) return value;
  const target = normalizeTarget(new URL(value, playlistUrl));
  if (!target) throw new Error("unsupported-playlist-host");
  return relayOrigin + "/stream?url=" + encodeURIComponent(target.href);
}

function rewritePlaylist(text, playlistUrl, relayOrigin) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith("#")) return relayReference(line, playlistUrl, relayOrigin);
      return line.replace(/URI=(["'])(.*?)\1/g, (_, quote, reference) =>
        "URI=" + quote + relayReference(reference, playlistUrl, relayOrigin) + quote
      );
    })
    .join("\n");
}

function copySafeHeaders(response) {
  const out = new Headers();
  for (const name of ["accept-ranges", "cache-control", "content-range", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

async function proxyRequest(request) {
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get("url");
  const target = normalizeTarget(raw);
  if (!target) return new Response("Invalid or unsupported AniKoto media URL", { status: 400, headers: corsHeaders() });

  let fetched;
  try { fetched = await fetchResource(target, request.headers.get("range")); }
  catch (error) {
    return new Response("AniKoto upstream failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
  }

  const { response, target: resolvedTarget } = fetched;
  const headers = copySafeHeaders(response);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const isPlaylist = resolvedTarget.pathname.toLowerCase().endsWith(".m3u8") || contentType.includes("mpegurl");

  if (isPlaylist) {
    try {
      const bytes = await limitedBytes(response, MAX_PLAYLIST);
      const body = new TextDecoder().decode(bytes);
      if (!/^\s*#EXTM3U(?:\s|$)/.test(body)) throw new Error("invalid-playlist");
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Type", "application/vnd.apple.mpegurl");
      return new Response(rewritePlaylist(body, resolvedTarget, requestUrl.origin), {
        status: response.status,
        headers: corsHeaders(headers)
      });
    } catch (error) {
      return new Response("Playlist relay failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
    }
  }

  if (resolvedTarget.pathname.toLowerCase().endsWith(".vtt") || contentType.includes("text/vtt")) {
    try {
      const bytes = await limitedBytes(response, MAX_SUBTITLE);
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Type", "text/vtt; charset=utf-8");
      headers.set("Content-Length", String(bytes.byteLength));
      return new Response(bytes, { status: response.status, headers: corsHeaders(headers) });
    } catch (error) {
      return new Response("Subtitle relay failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
    }
  }

  const disguised = /\.(?:png|jpe?g)$/i.test(resolvedTarget.pathname) || contentType.startsWith("image/") || /(?:imgnex\.top|akirax\.buzz|mikora\.top|norami\.top|shiora\.(?:site|top))$/i.test(resolvedTarget.hostname);
  if (disguised) {
    try {
      const bytes = await limitedBytes(response, MAX_SEGMENT);
      const unwrapped = unwrapDisguisedSegment(bytes);
      if (!unwrapped.length || unwrapped[0] !== 0x47) throw new Error("invalid-segment");
      headers.set("Content-Type", "video/mp2t");
      headers.set("Content-Length", String(unwrapped.byteLength));
      return new Response(unwrapped, { status: response.status, headers: corsHeaders(headers) });
    } catch (error) {
      return new Response("Segment relay failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
    }
  }

  const length = response.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: corsHeaders(headers)
  });
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "Limitless AniKoto Relay", host: HOST, port: PORT }, { headers: corsHeaders({ "Cache-Control": "no-store" }) });
    }
    if (url.pathname === "/stream" && (request.method === "GET" || request.method === "HEAD")) {
      return proxyRequest(request);
    }
    return new Response("Limitless AniKoto Relay\nGET /health\nGET /stream?url=<encoded https media url>", { status: 200, headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" }) });
  }
});

console.log(`[Limitless AniKoto Relay] listening on http://${server.hostname}:${server.port}`);
console.log(`[Limitless AniKoto Relay] health: http://${server.hostname}:${server.port}/health`);
