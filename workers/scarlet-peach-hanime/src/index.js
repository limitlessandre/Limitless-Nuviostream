const HANIME_ORIGIN = "https://hanime.tv";
const SEARCH_URL = "https://guest.freeanimehentai.net/api/v11/search_hvs";
const HANDSHAKE_URL = "https://auth.hanime.tv/api/v11/handshake";
const SIGNATURE_VERSION = "web2";
const SIGNATURE_SALT_1 = "Xkdi29";
const SIGNATURE_SALT_2 = "mn2";
const HANDSHAKE_KEY_SEED = "htv-insecure-handshake-v1";
const HANDSHAKE_AAD = "htv-insecure-v1";
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedHits = null;
let cachedHitsAt = 0;

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

function normalizeTitle(value) {
  const text = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return text
    .split(" ")
    .map(word => word === "wo" ? "o" : word)
    .filter(Boolean)
    .join(" ");
}

function compactTitle(value) {
  return normalizeTitle(value).replace(/\s+/g, "");
}

function seriesBase(name) {
  let text = String(name || "").trim();
  text = text.replace(/\s+(?:Ep|Episode)\s*\d+\s*$/i, "");
  text = text.replace(/\s+Season\s+\d{1,3}\s*$/i, "");
  const trailing = text.match(/^(.*?)(?:\s+)(\d{1,3})$/);
  if (trailing && !/\bSeason\s*$/i.test(trailing[1])) text = trailing[1].trim();
  return text;
}

function episodeNumber(hit) {
  const name = String(hit && hit.name || "");
  let m = name.match(/\b(?:Ep|Episode)\s*(\d{1,3})\s*$/i);
  if (m) return Number(m[1]);
  m = name.match(/(?:^|\s)(\d{1,3})\s*$/);
  if (m && !/\bSeason\s+\d{1,3}\s*$/i.test(name)) return Number(m[1]);
  const slug = String(hit && hit.slug || "");
  m = slug.match(/(?:-|_)(?:ep(?:isode)?-?)?(\d{1,3})$/i);
  if (m) return Number(m[1]);
  return 1;
}

function titleVariants(hit) {
  const values = [hit && hit.name, seriesBase(hit && hit.name)];
  const extras = hit && (hit.search_titles || hit.searchTitles || hit.titles);
  if (Array.isArray(extras)) values.push(...extras);
  else if (extras && typeof extras === "string") values.push(extras);
  return values.filter(Boolean);
}

function expandedTitles(values) {
  const out = [];
  for (const value of values || []) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    out.push(raw);
    const base = seriesBase(raw);
    if (base && base !== raw) out.push(base);
  }
  return out;
}

function scoreHit(hit, requestedTitles, episode, year) {
  const req = expandedTitles(requestedTitles).map(normalizeTitle).filter(Boolean);
  const vars = expandedTitles(titleVariants(hit)).map(normalizeTitle).filter(Boolean);
  let best = 0;
  for (const a of req) {
    for (const b of vars) {
      if (!a || !b) continue;
      const ac = compactTitle(a);
      const bc = compactTitle(b);
      if (a === b || (ac && ac === bc)) best = Math.max(best, 100);
      else if ((ac && bc) && (ac.startsWith(bc) || bc.startsWith(ac))) best = Math.max(best, 90);
      else if (a.startsWith(b) || b.startsWith(a)) best = Math.max(best, 86);
      else {
        const aw = new Set(a.split(" "));
        const bw = new Set(b.split(" "));
        const common = [...aw].filter(x => bw.has(x)).length;
        const denom = Math.max(aw.size, bw.size, 1);
        best = Math.max(best, Math.round((common / denom) * 72));
      }
    }
  }
  if (episodeNumber(hit) === Number(episode || 1)) best += 20;
  const hitYear = Number(hit && (hit.released_at_year || hit.year || 0));
  if (year && hitYear && Number(year) === hitYear) best += 5;
  return best;
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

async function getSearchHits() {
  const now = Date.now();
  if (cachedHits && now - cachedHitsAt < SEARCH_CACHE_TTL_MS) return cachedHits;
  const sig = await signatureHeaders();
  const response = await fetch(SEARCH_URL, { headers: browserHeaders(sig) });
  if (!response.ok) throw new Error(`Hanime search HTTP ${response.status}`);
  const payload = await response.json();
  const hits = Array.isArray(payload) ? payload : Array.isArray(payload && payload.data) ? payload.data : [];
  if (!hits.length) throw new Error("Hanime search returned no data");
  cachedHits = hits;
  cachedHitsAt = now;
  return hits;
}

async function importHandshakeKey() {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(HANDSHAKE_KEY_SEED));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sealMessage(obj) {
  const key = await importHandshakeKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(HANDSHAKE_AAD), tagLength: 128 }, key, enc.encode(JSON.stringify(obj))));
  const data = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  const envelope = {
    v: 1,
    alg: "AES-256-GCM",
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    data: bytesToBase64(data)
  };
  return bytesToBase64(enc.encode(JSON.stringify(envelope)));
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
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(HANDSHAKE_AAD), tagLength: 128 }, key, joined);
  return JSON.parse(dec.decode(plain));
}

async function resolveHandshake(slug) {
  const timestamp = Math.floor(Date.now() / 1000);
  const token = await sealMessage({ timestamp_unix: timestamp, directive: "htv_player_handshake", slug });
  const sig = await signatureHeaders();
  const response = await fetch(HANDSHAKE_URL, {
    method: "POST",
    headers: browserHeaders({ ...sig, "content-type": "application/json" }),
    body: JSON.stringify({ token })
  });
  const xToken = response.headers.get("x-token");
  if (!response.ok || !xToken) throw new Error(`Hanime handshake HTTP ${response.status}${xToken ? "" : " (no x-token)"}`);
  const payload = await openMessage(xToken);
  const sources = Array.isArray(payload && payload.sources) ? payload.sources : [];
  return sources
    .filter(s => s && (s.src || s.url) && String(s.kind || "normal").toLowerCase() !== "promotion")
    .map(s => {
      const raw = String(s.src || s.url);
      const url = raw.startsWith("http") ? raw : new URL(raw, HANIME_ORIGIN).toString();
      const height = Number(s.height || String(s.label || "").match(/\d+/)?.[0] || 0);
      return { url, height, label: s.label || (height ? `${height}p` : "HLS"), type: s.type || "application/x-mpegURL" };
    });
}

async function resolve(body) {
  const title = String(body && body.title || "").trim();
  const aliases = Array.isArray(body && body.aliases) ? body.aliases.filter(Boolean).map(String) : [];
  const episode = Math.max(1, Number(body && body.episode || 1));
  const year = body && body.year ? Number(body.year) : null;
  if (!title) return json(400, { error: "title required" });

  const requestedTitles = [title, ...aliases].filter(Boolean);
  const hits = await getSearchHits();
  const allRanked = hits
    .filter(hit => hit && hit.slug)
    .map(hit => ({ hit, score: scoreHit(hit, requestedTitles, episode, year) }))
    .sort((a, b) => b.score - a.score);
  const ranked = allRanked.filter(x => x.score >= 80);

  if (!ranked.length) {
    return json(404, {
      error: "no Hanime match",
      title,
      episode,
      candidates: allRanked.slice(0, 3).map(x => ({ name: x.hit.name, slug: x.hit.slug, score: x.score, episode: episodeNumber(x.hit) }))
    });
  }

  const chosen = ranked.find(x => episodeNumber(x.hit) === episode) || ranked[0];
  const streams = await resolveHandshake(chosen.hit.slug);
  if (!streams.length) return json(404, { error: "Hanime matched but returned no playable guest streams", match: { name: chosen.hit.name, slug: chosen.hit.slug, score: chosen.score }, episode });

  return json(200, {
    match: { name: chosen.hit.name, slug: chosen.hit.slug, score: chosen.score, episode: episodeNumber(chosen.hit) },
    streams
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json(200, { ok: true, service: "Scarlet Peach Hanime Resolver", protocol: "hanime-v11-handshake", matcher: "romanization-v2" });
    if (url.pathname !== "/resolve" || request.method !== "POST") return json(404, { error: "Not found" });
    try {
      const body = await request.json();
      return await resolve(body);
    } catch (error) {
      return json(502, { error: error && error.message ? error.message : String(error) });
    }
  }
};
