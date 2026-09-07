"use strict";

// 1Shows Nexus probe v0.1.1
// Uses the current 1Shows/Aniyomi VidZee flow: e=1 encrypted payloads + RC4-drop2048.
// Also checks the live 1Shows season API so we can separate catalog/ID issues from playback issues.

const PROVIDER_NAME = "1Shows Test";
const SITE_BASE = "https://www.1shows.org";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const API_BASE = "https://core.vidzee.wtf";
const PLAYER_ORIGIN = "https://player.vidzee.wtf";
const STREAM_REFERER = `${PLAYER_ORIGIN}/`;
const SERVERS = ["ipcloud", "v6:Hindi", "dcloud", "tik"];
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const RC4_KEY_HEX = "e4f9b27d8c1a6ef5037db98ac54e21f0b9d6c3a781fe42ad65c0e9b73f148a2d";

function clean(value) { return String(value == null ? "" : value).trim(); }
function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = Number(limit) || 205;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function hostOf(url) { try { return new URL(url).hostname; } catch (_) { return "unknown-host"; } }
function inferHeight(text) {
  const m = clean(text).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}
function tier(height) {
  const h = Number(height || 0);
  if (h >= 2160) return `4K ${h}p`;
  if (h >= 1440) return `Enhanced QHD ${h}p`;
  if (h >= 1080) return `FHD ${h}p`;
  if (h >= 720) return `HD ${h}p`;
  if (h >= 540) return `HD-Low ${h}p`;
  if (h >= 480) return `SD ${h}p`;
  if (h >= 360) return `SD-Low ${h}p`;
  return h > 0 ? `SD-Very Low ${h}p` : "Unknown Auto";
}

async function fetchJson(url, headers) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/plain,*/*",
        ...(headers || {})
      },
      redirect: "follow",
      skipSizeCheck: true
    });
    if (!response) return { ok: false, status: 0, data: null, error: "no response" };
    const status = Number(response.status || 0);
    if (!response.ok) return { ok: false, status, data: null, error: `HTTP ${status || "ERR"}` };
    return { ok: true, status, data: await response.json(), error: "" };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: clean(error && error.message ? error.message : error) || "request error" };
  }
}

async function resolveTmdbId(inputId, type) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;
  const r = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, {});
  const rows = type === "movie" ? r.data && r.data.movie_results : r.data && r.data.tv_results;
  return Array.isArray(rows) && rows[0] && rows[0].id ? Number(rows[0].id) : null;
}

function hexToBytes(hex) {
  const out = [];
  const text = clean(hex).replace(/[^0-9a-f]/gi, "");
  for (let i = 0; i + 1 < text.length; i += 2) out.push(parseInt(text.slice(i, i + 2), 16));
  return out;
}
function base64ToBytes(value) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const text = clean(value).replace(/[^A-Za-z0-9+/=]/g, "");
  const out = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "=") break;
    const idx = chars.indexOf(ch);
    if (idx < 0) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return out;
}
function utf8Decode(bytes) {
  let escaped = "";
  for (const b of bytes) escaped += "%" + Number(b & 255).toString(16).padStart(2, "0");
  try { return decodeURIComponent(escaped); } catch (_) { return String.fromCharCode(...bytes); }
}
function rc4Drop2048(keyBytes, dataBytes) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBytes[i % keyBytes.length]) & 255;
    const temp = s[i]; s[i] = s[j]; s[j] = temp;
  }
  let i = 0; j = 0;
  for (let discard = 0; discard < 2048; discard++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const temp = s[i]; s[i] = s[j]; s[j] = temp;
  }
  const out = new Array(dataBytes.length);
  for (let k = 0; k < dataBytes.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const temp = s[i]; s[i] = s[j]; s[j] = temp;
    const streamByte = s[(s[i] + s[j]) & 255];
    out[k] = (dataBytes[k] ^ streamByte) & 255;
  }
  return out;
}
function decryptVidzeePayload(blob) {
  try {
    const data = base64ToBytes(blob);
    const key = hexToBytes(RC4_KEY_HEX);
    const plain = utf8Decode(rc4Drop2048(key, data));
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) { return null; }
}

function diag(label, detail) {
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 205)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${SITE_BASE}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function catalogProbe(tmdbId, type, season, episode) {
  if (type === "movie") {
    const r = await fetchJson(`${SITE_BASE}/api/movie/${tmdbId}`, { "Referer": `${SITE_BASE}/` });
    return { kind: "movie", result: r, episodes: [], selected: null };
  }
  const r = await fetchJson(`${SITE_BASE}/api/tv/${tmdbId}/season/${season}`, { "Referer": `${SITE_BASE}/` });
  const eps = r.ok && r.data && Array.isArray(r.data.episodes) ? r.data.episodes : [];
  const selected = eps.find(ep => Number(ep && ep.episode_number) === Number(episode)) || null;
  return { kind: "tv", result: r, episodes: eps, selected };
}

async function hosterProbe() {
  const r = await fetchJson("https://api.viduki.net/embed_providers?site=1shows", { "Referer": `${SITE_BASE}/` });
  const providers = r.ok && r.data && Array.isArray(r.data.providers) ? r.data.providers : [];
  return { result: r, providers };
}

function buildStreamUrl(tmdbId, type, season, episode, server) {
  const path = type === "tv" ? `tv/${tmdbId}/${season}/${episode}` : `movie/${tmdbId}`;
  return `${API_BASE}/streams/${path}?s=${encodeURIComponent(server)}&e=1`;
}

async function vidzeeProbe(tmdbId, type, season, episode, server) {
  const r = await fetchJson(buildStreamUrl(tmdbId, type, season, episode, server), {
    "Referer": STREAM_REFERER,
    "Origin": PLAYER_ORIGIN
  });
  if (!r.ok) return { server, ok: false, error: r.error || `HTTP ${r.status || "ERR"}` };
  const blob = clean(r.data && r.data.c);
  if (!blob) return { server, ok: false, error: "no-c" };
  const decoded = decryptVidzeePayload(blob);
  const url = clean(decoded && decoded.url);
  if (!/^https?:\/\//i.test(url)) return { server, ok: false, error: decoded ? "decoded-no-url" : "decrypt-failed" };
  return {
    server,
    ok: true,
    url,
    language: clean(decoded && decoded.language) || (server.toLowerCase().includes("hindi") ? "Hindi" : "Auto")
  };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const s = Number(season || 1), e = Number(episode || 1);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB FAILED", `input=${inputId} • type=${type}`)];

  const [catalog, hosters, probes] = await Promise.all([
    catalogProbe(tmdbId, type, s, e),
    hosterProbe(),
    Promise.all(SERVERS.map(server => vidzeeProbe(tmdbId, type, s, e, server)))
  ]);

  const rows = [];
  const c = catalog.result;
  if (c && c.ok) {
    if (type === "tv") {
      rows.push(diag("CATALOG OK", `TMDB ${tmdbId} • S${s} • episodes=${catalog.episodes.length}${catalog.selected ? ` • E${e}=${clean(catalog.selected.name) || "found"}` : ` • E${e}=missing`}`));
    } else {
      rows.push(diag("CATALOG OK", `TMDB ${tmdbId} • movie • HTTP ${c.status}`));
    }
  } else {
    rows.push(diag("CATALOG FAIL", `TMDB ${tmdbId} • ${c ? c.error : "no response"}`));
  }

  if (hosters.result && hosters.result.ok) {
    const labels = hosters.providers.slice(0, 6).map(p => clean(p && (p.label || p.id))).filter(Boolean);
    rows.push(diag("HOSTERS", `dynamic=${hosters.providers.length}${labels.length ? ` • ${labels.join(" | ")}` : ""}`));
  } else {
    rows.push(diag("HOSTERS FAIL", hosters.result ? hosters.result.error : "no response"));
  }

  const failures = [];
  const seen = new Set();
  let successCount = 0;
  for (const probe of probes) {
    if (!probe.ok) {
      failures.push(`${probe.server}=${probe.error}`);
      continue;
    }
    successCount++;
    const url = probe.url;
    if (!seen.has(url)) {
      seen.add(url);
      const height = inferHeight(url);
      rows.unshift({
        name: `${PROVIDER_NAME} • ${tier(height)} • ${probe.server}`,
        title: `TMDB ${tmdbId}${type === "tv" ? ` • S${s}E${e}` : " • Movie"}`,
        url,
        quality: height ? `${height}p` : "Auto",
        language: probe.language,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": STREAM_REFERER,
          "Origin": PLAYER_ORIGIN
        },
        provider: PROVIDER_NAME,
        type: /\.mp4(?:$|[?#])/i.test(url) ? "mp4" : "m3u8",
        subtitles: []
      });
    }
    rows.push(diag("SERVER OK", `${probe.server} • ${probe.language} • ${hostOf(url)}`));
  }

  rows.push(diag("REQUEST", `TMDB ${tmdbId} • ${type}${type === "tv" ? ` • S${s}E${e}` : ""} • encrypted=e1 • servers=${successCount}/${SERVERS.length}`));
  if (failures.length) rows.push(diag("SERVER FAIL", failures.join(" • ")));
  if (!successCount) rows.push(diag("NO STREAM", `VidZee returned no playable encrypted source for TMDB ${tmdbId}`));
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
