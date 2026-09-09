"use strict";

// Limitless Nexus AniKoto local relay v3.
// Keeps Arc's proven transport behavior, removes the experimental HLS subtitle
// injection that regressed playback, and adds lightweight segment diagnostics.

const HOST = "127.0.0.1";
const PORT = 8787;
const REFERER = "https://megaplay.buzz/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const TIMEOUT_MS = 10000;
const MAX_PLAYLIST = 2 * 1024 * 1024;
const MAX_SUBTITLE = 512 * 1024;
const MAX_SEGMENT = 64 * 1024 * 1024;

const MEDIA_SUFFIXES = [
  "akirax.buzz", "anizara.store", "imgnex.top", "kryntal.top",
  "lostproject.club", "megaplay.buzz", "mikora.top", "norami.top",
  "shiora.site", "shiora.top", "tiktokcdn.com", "trycloud.pro",
  "watching.onl", "mewstream.buzz", "voltara.click", "kotocdn.site"
];
const IMGNEX_MIRRORS = ["akirax.buzz", "mikora.top", "norami.top", "shiora.site", "shiora.top"];

let playlistCount = 0;
let unwrapCount = 0;
let passthroughCount = 0;
let subtitleCount = 0;

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith("." + suffix));
}

function normalizeTarget(value) {
  let url;
  try { url = value instanceof URL ? new URL(value.href) : new URL(String(value || "")); }
  catch (_) { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hostAllowed(url.hostname)) return null;

  const shard = url.hostname.match(/^(s\d+)\.shiora\.(?:site|top)$/i);
  if (shard) url.hostname = shard[1] + ".akirax.buzz";
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
  if (source.hostname.toLowerCase().endsWith(".mikora.top")) {
    for (const suffix of ["shiora.site", "akirax.buzz"]) {
      const alt = new URL(source.href);
      alt.hostname = alt.hostname.replace(/\.mikora\.top$/i, "." + suffix);
      out.push(alt);
    }
  }
  if (source.hostname.toLowerCase().endsWith(".shiora.top")) {
    const alt = new URL(source.href);
    alt.hostname = alt.hostname.replace(/\.shiora\.top$/i, ".shiora.site");
    out.push(alt);
  }
  if (/^(?:cdn|ncdn)\.kryntal\.top$/i.test(source.hostname)) {
    for (const prefix of ["cdn", "ncdn"]) {
      const alt = new URL(source.href);
      alt.hostname = prefix + ".watching.onl";
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

function isDisguisedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return /^p\d+-ad-site-sign-sg\.tiktokcdn\.com$/.test(host) ||
    /^s\d+\.(?:akirax\.buzz|norami\.top|shiora\.site|shiora\.top)$/.test(host);
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
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) throw new Error("body-too-large");
  return bytes;
}

function findSequence(bytes, needle, start = 0) {
  outer: for (let i = start; i <= bytes.length - needle.length; i += 1) {
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
  if (pngIndex >= 0) return bytes.subarray(pngIndex + pngEnd.length);

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpegEnd = findSequence(bytes, new Uint8Array([0xff,0xd9]), 1);
    if (jpegEnd >= 0) return bytes.subarray(jpegEnd + 2);
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
  return String(text || "").split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (!line.startsWith("#")) return relayReference(line.trim(), playlistUrl, relayOrigin);
    return line.replace(/URI=(["'])(.*?)\1/g, (_, quote, reference) =>
      "URI=" + quote + relayReference(reference, playlistUrl, relayOrigin) + quote
    );
  }).join("\n");
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
  const target = normalizeTarget(requestUrl.searchParams.get("url"));
  if (!target) {
    return new Response("Invalid or unsupported AniKoto media URL", { status: 400, headers: corsHeaders() });
  }

  let fetched;
  try {
    fetched = await fetchResource(target, request.headers.get("range"));
  } catch (error) {
    console.error("[upstream:error]", target.hostname, String(error && error.message || error));
    return new Response("AniKoto upstream failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
  }

  const { response, target: resolvedTarget } = fetched;
  const headers = copySafeHeaders(response);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const path = resolvedTarget.pathname.toLowerCase();
  const isPlaylist = path.endsWith(".m3u8") || contentType.includes("mpegurl");

  if (isPlaylist) {
    try {
      const body = new TextDecoder().decode(await limitedBytes(response, MAX_PLAYLIST));
      if (!/^\s*#EXTM3U(?:\s|$)/.test(body)) throw new Error("invalid-playlist");
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Type", "application/vnd.apple.mpegurl");
      playlistCount += 1;
      if (playlistCount <= 12) {
        console.log(`[playlist] #${playlistCount} ${resolvedTarget.hostname}${resolvedTarget.pathname}`);
      }
      return new Response(request.method === "HEAD" ? null : rewritePlaylist(body, resolvedTarget, requestUrl.origin), {
        status: response.status,
        headers: corsHeaders(headers)
      });
    } catch (error) {
      console.error("[playlist:error]", String(error && error.message || error));
      return new Response("Playlist relay failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
    }
  }

  if (path.endsWith(".vtt") || contentType.includes("text/vtt")) {
    try {
      const bytes = await limitedBytes(response, MAX_SUBTITLE);
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Type", "text/vtt; charset=utf-8");
      headers.set("Content-Length", String(bytes.byteLength));
      subtitleCount += 1;
      console.log(`[subtitle] #${subtitleCount} ${resolvedTarget.hostname}${resolvedTarget.pathname} ${bytes.byteLength} bytes`);
      return new Response(request.method === "HEAD" ? null : bytes, { status: response.status, headers: corsHeaders(headers) });
    } catch (error) {
      console.error("[subtitle:error]", String(error && error.message || error));
      return new Response("Subtitle relay failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
    }
  }

  const disguised = isDisguisedHost(resolvedTarget.hostname) || /\.(?:png|jpe?g)$/i.test(path) || contentType.startsWith("image/");
  if (disguised) {
    try {
      const bytes = await limitedBytes(response, MAX_SEGMENT);
      const unwrapped = unwrapDisguisedSegment(bytes);
      if (!unwrapped.length || unwrapped[0] !== 0x47) throw new Error("invalid-segment");
      headers.set("Content-Type", "video/mp2t");
      headers.set("Content-Length", String(unwrapped.byteLength));
      unwrapCount += 1;
      if (unwrapCount <= 12 || unwrapCount % 25 === 0) {
        console.log(`[unwrap] #${unwrapCount} ${resolvedTarget.hostname}${resolvedTarget.pathname} ${bytes.byteLength}->${unwrapped.byteLength}`);
      }
      return new Response(request.method === "HEAD" ? null : unwrapped, {
        status: response.status,
        headers: corsHeaders(headers)
      });
    } catch (error) {
      console.error("[segment:error]", resolvedTarget.hostname + resolvedTarget.pathname, String(error && error.message || error));
      return new Response("Segment relay failed: " + String(error && error.message || error), { status: 502, headers: corsHeaders() });
    }
  }

  const length = response.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  passthroughCount += 1;
  if (passthroughCount <= 12 || passthroughCount % 25 === 0) {
    console.log(`[segment] #${passthroughCount} ${resolvedTarget.hostname}${resolvedTarget.pathname} type=${contentType || "unknown"} len=${length || "?"} range=${request.headers.get("range") || "none"}`);
  }
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
      return Response.json({ ok: true, service: "Limitless AniKoto Relay v3", host: HOST, port: PORT }, {
        headers: corsHeaders({ "Cache-Control": "no-store" })
      });
    }
    if (url.pathname === "/play" && (request.method === "GET" || request.method === "HEAD")) {
      const media = normalizeTarget(url.searchParams.get("url"));
      if (!media) return new Response("Invalid AniKoto media URL", { status: 400, headers: corsHeaders() });
      return Response.redirect(url.origin + "/stream?url=" + encodeURIComponent(media.href), 302);
    }
    if (url.pathname === "/stream" && (request.method === "GET" || request.method === "HEAD")) {
      return proxyRequest(request);
    }
    return new Response("Limitless AniKoto Relay v3\nGET /health\nGET /stream?url=<media>", {
      status: 200,
      headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" })
    });
  }
});

console.log(`[Limitless AniKoto Relay v3] listening on http://${server.hostname}:${server.port}`);
console.log(`[Limitless AniKoto Relay v3] health: http://${server.hostname}:${server.port}/health`);