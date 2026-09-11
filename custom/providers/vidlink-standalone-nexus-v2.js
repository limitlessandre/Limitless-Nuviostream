"use strict";

// Vidlink standalone test v2 for Limitless Nexus.
// Intentionally uses Vidlink's plain /api/b endpoint and ordinary Referer/Origin
// playback headers. No runtime dependency on Eclipsia/Codeberg.

const PROVIDER_NAME = "Vidlink Standalone Test";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const TMDB_API = "https://api.themoviedb.org/3";
const VIDLINK_BASE = "https://vidlink.pro";
const ENC_URL = "https://enc-dec.app/api/enc-vidlink";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json,*/*",
  "Referer": `${VIDLINK_BASE}/`,
  "Origin": VIDLINK_BASE
};

function clean(v) { return String(v == null ? "" : v).trim(); }
function typeOfMedia(v) { return clean(v).toLowerCase() === "movie" ? "movie" : "tv"; }

async function fetchJson(url, headers) {
  try {
    const r = await fetch(url, { headers: { ...HEADERS, ...(headers || {}) }, redirect: "follow", skipSizeCheck: true });
    if (!r || !r.ok) return null;
    const text = String(await r.text() || "");
    return text ? JSON.parse(text) : null;
  } catch (_) { return null; }
}

async function fetchText(url, headers) {
  try {
    const r = await fetch(url, { headers: { ...HEADERS, ...(headers || {}) }, redirect: "follow", skipSizeCheck: true });
    if (!r || !r.ok) return "";
    return String(await r.text() || "");
  } catch (_) { return ""; }
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = clean(inputId);
  const numeric = raw.match(/^(?:tmdb:)?(\d+)$/i);
  if (numeric) return Number(numeric[1]);
  const imdb = raw.match(/^(?:imdb:)?(tt\d+)$/i);
  if (!imdb) return null;
  const data = await fetchJson(`${TMDB_API}/find/${encodeURIComponent(imdb[1])}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, { Origin: "", Referer: "" });
  const list = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
}

async function tmdbMeta(tmdbId, mediaType) {
  const data = await fetchJson(`${TMDB_API}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`, { Origin: "", Referer: "" });
  if (!data) return { title: "Vidlink", year: "" };
  const title = mediaType === "movie" ? clean(data.title || data.original_title) : clean(data.name || data.original_name);
  const date = mediaType === "movie" ? clean(data.release_date) : clean(data.first_air_date);
  return { title: title || "Vidlink", year: /^\d{4}/.test(date) ? date.slice(0, 4) : "" };
}

async function encryptTmdbId(tmdbId) {
  const data = await fetchJson(`${ENC_URL}?text=${encodeURIComponent(String(tmdbId))}`, { Origin: "", Referer: "" });
  return data && data.result ? clean(data.result) : "";
}

function subtitleTrack(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const url = clean(item);
    return /^https?:\/\//i.test(url) ? { url, file: url, language: "Unknown", name: "Unknown" } : null;
  }
  const url = clean(item.file || item.url || item.src || item.uri);
  if (!/^https?:\/\//i.test(url)) return null;
  const label = clean(item.label || item.name || item.lang || item.language) || "Unknown";
  return { url, file: url, language: clean(item.language || item.lang) || label, name: label };
}

function collectSubs(payload) {
  const groups = [payload && payload.stream && payload.stream.captions, payload && payload.subtitles, payload && payload.captions];
  const out = [], seen = new Set();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const track = subtitleTrack(item);
      if (!track || seen.has(track.url)) continue;
      seen.add(track.url);
      out.push(track);
    }
  }
  return out;
}

function heightFrom(value) {
  const text = clean(value);
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const m = text.match(/(?:^|[^0-9])(4320|2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}

function qualityLabel(h) {
  h = Number(h || 0);
  if (h >= 4320) return `2x4K 8K ${h}p`;
  if (h >= 2160) return `4K ${h}p`;
  if (h >= 1440) return `Enhanced QHD ${h}p`;
  if (h >= 1080) return `FHD ${h}p`;
  if (h >= 720) return `HD ${h}p`;
  if (h >= 540) return `HD-Low ${h}p`;
  if (h >= 480) return `SD ${h}p`;
  if (h >= 360) return `SD-Low ${h}p`;
  if (h > 0) return `SD-Very Low ${h}p`;
  return "Unknown Auto";
}

function resolveUrl(value, base) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  try { return new URL(raw, base).toString(); } catch (_) { return raw; }
}

function parseMaster(text, playlistUrl) {
  const lines = String(text || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const info = lines[i];
    const res = info.match(/RESOLUTION=\d+x(\d+)/i);
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith("#")) j++;
    if (j >= lines.length) continue;
    const url = resolveUrl(lines[j], playlistUrl);
    if (!/^https?:\/\//i.test(url)) continue;
    rows.push({ url, height: res ? Number(res[1]) : 0, type: "m3u8" });
  }
  return rows;
}

function mediaTitle(meta, mediaType, season, episode) {
  return mediaType === "tv"
    ? `${meta.title} • S${Number(season || 1)}E${Number(episode || 1)}`
    : (meta.year ? `${meta.title} (${meta.year})` : meta.title);
}

function makeRow(candidate, subs, title) {
  const tag = subs.length ? "[SUB]" : "[UNK]";
  return {
    name: `${PROVIDER_NAME} • ${qualityLabel(candidate.height)} • ${tag}`,
    title,
    url: candidate.url,
    quality: candidate.height ? `${candidate.height}p` : "Auto",
    language: "Unknown",
    headers: HEADERS,
    provider: PROVIDER_NAME,
    type: candidate.type || (/\.m3u8(?:$|[?#])/i.test(candidate.url) ? "m3u8" : "mp4"),
    subtitles: subs
  };
}

function diag(message) {
  return {
    name: `${PROVIDER_NAME} • DIAG NO SOURCE FOUND`,
    title: message,
    url: `${VIDLINK_BASE}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function getStreams(inputId, mediaType = "movie", season = 1, episode = 1) {
  const type = typeOfMedia(mediaType);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("Could not resolve TMDB ID")];

  const enc = await encryptTmdbId(tmdbId);
  if (!enc) return [diag("Vidlink encryption token unavailable")];

  const endpoint = type === "movie"
    ? `${VIDLINK_BASE}/api/b/movie/${encodeURIComponent(enc)}`
    : `${VIDLINK_BASE}/api/b/tv/${encodeURIComponent(enc)}/${Number(season || 1)}/${Number(episode || 1)}`;

  const payload = await fetchJson(endpoint, HEADERS);
  if (!payload || !payload.stream) return [diag("Vidlink API returned no stream object")];

  const meta = await tmdbMeta(tmdbId, type);
  const title = mediaTitle(meta, type, season, episode);
  const subs = collectSubs(payload);
  const candidates = [];
  const stream = payload.stream;

  if (stream.qualities && typeof stream.qualities === "object") {
    for (const [key, value] of Object.entries(stream.qualities)) {
      const url = typeof value === "string" ? clean(value) : clean(value && value.url);
      if (!/^https?:\/\//i.test(url)) continue;
      const h = heightFrom(key) || heightFrom(value && (value.quality || value.resolution || value.label || value.name));
      candidates.push({ url, height: h, type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4" });
    }
  }

  if (stream.playlist && /^https?:\/\//i.test(clean(stream.playlist))) {
    const playlistUrl = clean(stream.playlist);
    const text = await fetchText(playlistUrl, HEADERS);
    const variants = parseMaster(text, playlistUrl);
    if (variants.length) candidates.push(...variants);
    else candidates.push({ url: playlistUrl, height: 0, type: "m3u8" });
  }

  const seen = new Set();
  const rows = [];
  for (const candidate of candidates.sort((a, b) => Number(b.height || 0) - Number(a.height || 0))) {
    if (!candidate.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    rows.push(makeRow(candidate, subs, title));
  }

  return rows.length ? rows : [diag("Vidlink stream object contained no playable URL")];
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
