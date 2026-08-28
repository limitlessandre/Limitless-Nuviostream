const FLIXCLOUD_ORIGIN = "https://flixcloud.cc";
const ENC_DEC_ORIGIN = "https://enc-dec.app";
const ENC_DEC_PARSE = `${ENC_DEC_ORIGIN}/api/parse-flixcloud`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const DEFAULT_MASK_HEX = "9d2af147b38e5c70a619e43bd8620fc5";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length,Content-Range,X-Limitless-Proxy,X-Limitless-Upstream",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders },
  });
}

function text(message, status = 200, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS, ...extraHeaders },
  });
}

function normalizeProxyBase(requestUrl) {
  const u = new URL(requestUrl);
  return `${u.protocol}//${u.host}`;
}

function isAllowedFlixUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "flixcloud.cc" || host.endsWith(".flixcloud.cc");
  } catch (_) {
    return false;
  }
}

function parseMaskHex(value) {
  const raw = String(value || DEFAULT_MASK_HEX).trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(raw)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function detectHeader(data) {
  if (data.length >= 12 &&
      data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 12;
  if (data.length >= 8 &&
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
      data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 8;
  return 0;
}

function xorPayload(payload, mask) {
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 15];
  return payload;
}

function extractNestedToken(parentUrl) {
  try {
    let current = String(parentUrl || "");
    for (let depth = 0; depth < 4 && current; depth++) {
      const u = new URL(current);
      const token = u.searchParams.get("token");
      if (token) return token;
      current = u.searchParams.get("url") || "";
    }
  } catch (_) {}
  return null;
}

function ensureToken(childUrl, parentUrl) {
  try {
    const child = new URL(childUrl);
    if (child.searchParams.get("token")) return child.toString();
    const token = extractNestedToken(parentUrl);
    if (token) child.searchParams.set("token", token);
    return child.toString();
  } catch (_) {
    return childUrl;
  }
}

function encodePathPayload(data) {
  return encodeURIComponent(JSON.stringify(data));
}

function decodePathPayload(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    return value && typeof value === "object" ? value : null;
  } catch (_) {
    return null;
  }
}

function makeProxyUrl(proxyBase, upstreamUrl, maskHex) {
  return `${String(proxyBase).replace(/\/+$/, "")}/proxy/${encodePathPayload({ u: upstreamUrl, m: maskHex })}`;
}

function fixBandwidth(line) {
  if (!line.startsWith("#EXT-X-STREAM-INF")) return line;
  const peak = line.match(/\bBANDWIDTH=(\d+)/i)?.[1];
  const avg = line.match(/\bAVERAGE-BANDWIDTH=(\d+)/i)?.[1];
  const peakNum = peak ? Number(peak) : 0;
  const avgNum = avg ? Number(avg) : 0;
  if (!peakNum || peakNum >= 100000) return line;
  const replacement = avgNum > 100000 ? avgNum : peakNum * 1000;
  return line.replace(/\bBANDWIDTH=\d+/i, `BANDWIDTH=${replacement}`);
}

function rewriteManifest(body, parentUrl, proxyBase, maskHex) {
  const uriAttr = /URI="([^"]+)"/g;
  const lines = String(body || "").split(/\r?\n/);
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("#")) {
      let cleaned = fixBandwidth(trimmed);
      cleaned = cleaned.replace(uriAttr, (full, uri) => {
        try {
          const absolute = ensureToken(new URL(uri, parentUrl).toString(), parentUrl);
          if (!isAllowedFlixUrl(absolute)) return full;
          return `URI="${makeProxyUrl(proxyBase, absolute, maskHex)}"`;
        } catch (_) {
          return full;
        }
      });
      return cleaned;
    }
    try {
      const absolute = ensureToken(new URL(trimmed, parentUrl).toString(), parentUrl);
      if (!isAllowedFlixUrl(absolute)) return trimmed;
      return makeProxyUrl(proxyBase, absolute, maskHex);
    } catch (_) {
      return trimmed;
    }
  }).join("\n");
}

function flixHeaders() {
  return {
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Origin": FLIXCLOUD_ORIGIN,
    "Referer": `${FLIXCLOUD_ORIGIN}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
}

async function fetchFlix(upstream, request) {
  let current = new URL(upstream);
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedFlixUrl(current.toString())) throw new Error(`Blocked upstream host: ${current.hostname}`);
    const headers = flixHeaders();
    const range = request.headers.get("Range");
    if (range) headers.Range = range;
    const response = await fetch(current.toString(), { headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) return response;
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error("Too many upstream redirects");
}

function proxyHeadersFrom(upstream, extra = {}) {
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Limitless-Proxy", "flixcloud-v1.1");
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return headers;
}

function initialManifestParams(url, payload) {
  return {
    upstream: String(payload?.u || url.searchParams.get("u") || ""),
    wPayload: String(payload?.w || url.searchParams.get("w") || ""),
    maskHex: String(payload?.m || url.searchParams.get("m") || DEFAULT_MASK_HEX).toLowerCase(),
  };
}

async function handleInitialManifest(request, url, payload = null) {
  const { upstream, wPayload, maskHex } = initialManifestParams(url, payload);
  if (!isAllowedFlixUrl(upstream)) return text("Invalid or blocked FlixCloud URL", 400, { "X-Limitless-Upstream": "invalid-upstream" });
  if (!wPayload) return text("Missing w payload", 400, { "X-Limitless-Upstream": "missing-w" });
  if (!parseMaskHex(maskHex)) return text("Invalid XOR mask", 400, { "X-Limitless-Upstream": "invalid-mask" });

  const parsedUrl = new URL(ENC_DEC_PARSE);
  parsedUrl.searchParams.set("url", upstream);
  parsedUrl.searchParams.set("w_payload", wPayload);

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
      "Origin": ENC_DEC_ORIGIN,
      "Referer": `${ENC_DEC_ORIGIN}/`,
      "Accept-Encoding": "identity",
    },
  });
  if (!response.ok) return text(`Manifest decoder HTTP ${response.status}`, 502, { "X-Limitless-Upstream": "decoder" });
  const body = await response.text();
  const rewritten = rewriteManifest(body, upstream, normalizeProxyBase(request.url), maskHex);
  return new Response(rewritten, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-store",
      "X-Limitless-Proxy": "flixcloud-v1.1",
      "X-Limitless-Upstream": "manifest",
    },
  });
}

function looksLikeManifest(url) {
  try { return new URL(url).pathname.toLowerCase().includes(".m3u8"); } catch (_) { return false; }
}

function looksLikeSubtitle(url, contentType = "") {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.includes("/subtitles/") || /\.(vtt|srt|ass|ssa)$/.test(path) || /text\/vtt|subrip|x-ass/i.test(contentType);
  } catch (_) {
    return false;
  }
}

function proxyParams(url, payload) {
  return {
    upstream: String(payload?.u || url.searchParams.get("u") || ""),
    maskHex: String(payload?.m || url.searchParams.get("m") || DEFAULT_MASK_HEX).toLowerCase(),
  };
}

async function handleProxy(request, url, payload = null) {
  const { upstream, maskHex } = proxyParams(url, payload);
  const mask = parseMaskHex(maskHex);
  if (!isAllowedFlixUrl(upstream)) return text("Invalid or blocked FlixCloud URL", 400, { "X-Limitless-Upstream": "invalid-upstream" });
  if (!mask) return text("Invalid XOR mask", 400, { "X-Limitless-Upstream": "invalid-mask" });

  const response = await fetchFlix(upstream, request);
  if (!response.ok && response.status !== 206) return text(`FlixCloud HTTP ${response.status}`, 502, { "X-Limitless-Upstream": "cdn" });
  const contentType = response.headers.get("Content-Type") || "";

  if (looksLikeManifest(upstream) || /mpegurl/i.test(contentType)) {
    const body = await response.text();
    const rewritten = rewriteManifest(body, upstream, normalizeProxyBase(request.url), maskHex);
    return new Response(rewritten, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "X-Limitless-Proxy": "flixcloud-v1.1",
        "X-Limitless-Upstream": "child-manifest",
      },
    });
  }

  if (looksLikeSubtitle(upstream, contentType)) {
    const headers = proxyHeadersFrom(response, { "X-Limitless-Upstream": "subtitle" });
    headers.delete("Content-Length");
    return new Response(response.body, { status: response.status, headers });
  }

  const input = new Uint8Array(await response.arrayBuffer());
  const headerSize = detectHeader(input.subarray(0, Math.min(13, input.length)));
  if (headerSize === 0) {
    const headers = proxyHeadersFrom(response, { "X-Limitless-Upstream": "passthrough" });
    headers.set("Content-Length", String(input.byteLength));
    return new Response(input, { status: response.status, headers });
  }

  const payloadBytes = input.slice(headerSize);
  const shouldXor = payloadBytes.length > 0 && payloadBytes[0] !== 0x47;
  if (shouldXor) {
    if ((payloadBytes[0] ^ mask[0]) !== 0x47) {
      return text("FlixCloud XOR mask validation failed", 502, { "X-Limitless-Upstream": "bad-mask" });
    }
    xorPayload(payloadBytes, mask);
  }

  const headers = proxyHeadersFrom(response, {
    "Content-Type": "video/mp2t",
    "Content-Length": String(payloadBytes.byteLength),
    "X-Limitless-Upstream": shouldXor ? "xor-segment" : "stripped-segment",
  });
  headers.delete("Content-Range");
  headers.delete("Accept-Ranges");
  return new Response(payloadBytes, { status: 200, headers });
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET" && request.method !== "HEAD") return text("Method not allowed", 405, { Allow: "GET, HEAD, OPTIONS" });

  const url = new URL(request.url);
  try {
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "Limitless Nexus FlixCloud Proxy", version: "1.1.0", protocol: "path-payload-v1" });
    }
    if (url.pathname.startsWith("/manifest/")) {
      const payload = decodePathPayload(url.pathname, "/manifest/");
      if (!payload) return text("Invalid manifest path payload", 400, { "X-Limitless-Upstream": "invalid-path-payload" });
      return await handleInitialManifest(request, url, payload);
    }
    if (url.pathname.startsWith("/proxy/")) {
      const payload = decodePathPayload(url.pathname, "/proxy/");
      if (!payload) return text("Invalid proxy path payload", 400, { "X-Limitless-Upstream": "invalid-path-payload" });
      return await handleProxy(request, url, payload);
    }
    // Backward compatibility for Re:ANIME 1.2.0 and any old cached HLS URLs.
    if (url.pathname === "/manifest") return await handleInitialManifest(request, url);
    if (url.pathname === "/proxy") return await handleProxy(request, url);
    return text("Not found", 404);
  } catch (error) {
    return json({ ok: false, error: error && error.message ? error.message : String(error) }, 502);
  }
}

export { decodePathPayload, detectHeader, encodePathPayload, ensureToken, isAllowedFlixUrl, parseMaskHex, rewriteManifest, xorPayload };

export default {
  fetch: handleRequest,
};
