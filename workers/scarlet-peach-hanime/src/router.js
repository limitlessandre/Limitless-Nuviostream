import base from "./index.js";

const HANIME_ORIGIN = "https://hanime.tv";
const HANDSHAKE_URL = "https://auth.hanime.tv/api/v11/handshake";
const SIGNATURE_VERSION = "web2";
const SIGNATURE_SALT_1 = "Xkdi29";
const SIGNATURE_SALT_2 = "mn2";
const HANDSHAKE_KEY_SEED = "htv-insecure-handshake-v1";
const HANDSHAKE_AAD = "htv-insecure-v1";

const enc = new TextEncoder();
const dec = new TextDecoder();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    }
  });
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function validSlug(value) {
  const slug = clean(value);
  return /^[a-z0-9][a-z0-9-]{0,199}$/i.test(slug) ? slug : "";
}

function validSessionToken(value) {
  const token = clean(value);
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) return "";
  return token;
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(input) {
  let s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function signatureHeaders() {
  const time = Math.floor(Date.now() / 1000);
  const input = `${time},${SIGNATURE_SALT_1},${HANIME_ORIGIN},${SIGNATURE_SALT_2},${time}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(input)));
  return {
    "x-signature-version": SIGNATURE_VERSION,
    "x-signature": bytesToHex(digest),
    "x-time": String(time)
  };
}

function browserHeaders(extra = {}) {
  return {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    origin: HANIME_ORIGIN,
    referer: `${HANIME_ORIGIN}/`,
    "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    ...extra
  };
}

async function importHandshakeKey() {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(HANDSHAKE_KEY_SEED));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sealMessage(obj) {
  const key = await importHandshakeKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: enc.encode(HANDSHAKE_AAD),
    tagLength: 128
  }, key, enc.encode(JSON.stringify(obj))));
  const data = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  return bytesToBase64(enc.encode(JSON.stringify({
    v: 1,
    alg: "AES-256-GCM",
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    data: bytesToBase64(data)
  })));
}

async function openMessage(token) {
  const envelope = JSON.parse(dec.decode(base64ToBytes(token)));
  const key = await importHandshakeKey();
  const iv = base64ToBytes(envelope.iv);
  const data = base64ToBytes(envelope.data);
  const tag = base64ToBytes(envelope.tag);
  const joined = new Uint8Array(data.length + tag.length);
  joined.set(data, 0);
  joined.set(tag, data.length);
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv,
    additionalData: enc.encode(HANDSHAKE_AAD),
    tagLength: 128
  }, key, joined);
  return JSON.parse(dec.decode(plain));
}

async function resolveHandshake(slug, sessionToken) {
  const timestamp = Math.floor(Date.now() / 1000);
  const token = await sealMessage({ timestamp_unix: timestamp, directive: "htv_player_handshake", slug });
  const sig = await signatureHeaders();
  const headers = browserHeaders({ ...sig, "content-type": "application/json" });
  const session = validSessionToken(sessionToken);
  if (session) headers["x-session-token"] = session;

  const response = await fetch(HANDSHAKE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ token })
  });
  const xToken = response.headers.get("x-token");
  if (!response.ok || !xToken) {
    throw new Error(`Hanime handshake HTTP ${response.status}${xToken ? "" : " (no x-token)"}`);
  }
  const payload = await openMessage(xToken);
  const sources = Array.isArray(payload && payload.sources) ? payload.sources : [];
  return sources
    .filter(source => source && (source.src || source.url) && String(source.kind || "normal").toLowerCase() !== "promotion")
    .map(source => {
      const raw = String(source.src || source.url);
      const url = raw.startsWith("http") ? raw : new URL(raw, HANIME_ORIGIN).toString();
      const height = Number(source.height || String(source.label || "").match(/\d+/)?.[0] || 0);
      return {
        url,
        height,
        label: source.label || (height ? `${height}p` : "HLS"),
        type: source.type || "application/x-mpegURL"
      };
    });
}

async function exactResolve(body) {
  const slug = validSlug(body && body.slug);
  if (!slug) return null;
  const sessionToken = validSessionToken(body && body.sessionToken);
  const streams = await resolveHandshake(slug, sessionToken);
  if (!streams.length) {
    return json(404, { error: `Hanime exact slug returned no playable ${sessionToken ? "authenticated" : "guest"} streams`, slug });
  }
  return json(200, {
    mode: "exact-slug",
    authenticated: Boolean(sessionToken),
    match: {
      name: clean(body && body.title) || slug,
      slug,
      score: 200,
      episode: Math.max(1, Number(body && body.episode || 1))
    },
    streams
  });
}

async function authenticatedFuzzyResolve(request, body, env, ctx) {
  const sessionToken = validSessionToken(body && body.sessionToken);
  if (!sessionToken) return null;

  const guestResponse = await base.fetch(request, env, ctx);
  if (!guestResponse || !guestResponse.ok) return guestResponse;

  let guestPayload = null;
  try {
    guestPayload = await guestResponse.clone().json();
  } catch {
    return guestResponse;
  }

  const slug = validSlug(guestPayload && guestPayload.match && guestPayload.match.slug);
  if (!slug) return guestResponse;

  try {
    const streams = await resolveHandshake(slug, sessionToken);
    if (!streams.length) return guestResponse;
    return json(200, {
      ...guestPayload,
      mode: "authenticated-fuzzy",
      authenticated: true,
      streams
    });
  } catch {
    return guestResponse;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/resolve" && request.method === "POST") {
      try {
        const body = await request.clone().json();
        if (validSlug(body && body.slug)) return await exactResolve(body);
        if (validSessionToken(body && body.sessionToken)) {
          const authenticated = await authenticatedFuzzyResolve(request, body, env, ctx);
          if (authenticated) return authenticated;
        }
      } catch (error) {
        return json(502, { error: error && error.message ? error.message : String(error), mode: "router" });
      }
    }
    return base.fetch(request, env, ctx);
  }
};
