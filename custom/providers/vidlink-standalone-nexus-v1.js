"use strict";

// Limitless Nexus standalone Vidlink provider.
// No runtime dependency on Eclipsia/Codeberg. The extraction flow is based on
// Vidlink's current encrypted TMDB API and cross-checked against maintained
// EncDec/Vidlink implementations.

const PROVIDER_NAME = "Vidlink";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const TMDB_API = "https://api.themoviedb.org/3";
const BASE_URL = "https://vidlink.pro";
const ENC_URL = "https://enc-dec.app/api/enc-vidlink";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const BASE_HEADERS = {
  "Accept": "application/json,*/*",
  "User-Agent": UA,
  "Origin": BASE_URL,
  "Referer": `${BASE_URL}/`
};
const STANDARD_HEADERS = { ...BASE_HEADERS, "X-Playback-Environment": "standard" };
const DASH_HEADERS = { ...BASE_HEADERS, "X-Playback-Environment": "dash-hevc" };

function clean(v) { return String(v == null ? "" : v).trim(); }
function mediaTypeOf(v) {
  const t = clean(v).toLowerCase();
  return t === "movie" ? "movie" : "tv";
}

async function requestJson(url, headers, attempts) {
  const count = Math.max(1, Number(attempts || 2));
  for (let i = 0; i < count; i++) {
    try {
      const response = await fetch(url, {
        headers: { ...BASE_HEADERS, ...(headers || {}) },
        redirect: "follow",
        skipSizeCheck: true
      });
      if (!response || !response.ok) continue;
      const text = String(await response.text() || "");
      if (!text) continue;
      const data = JSON.parse(text);
      if (data && typeof data === "object") return data;
    } catch (_) {}
  }
  return null;
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = clean(inputId);
  const numeric = raw.match(/^(?:tmdb:)?(\d+)$/i);
  if (numeric) return Number(numeric[1]);

  const imdb = raw.match(/^(?:imdb:)?(tt\d+)$/i);
  if (!imdb) return null;
  const data = await requestJson(
    `${TMDB_API}/find/${encodeURIComponent(imdb[1])}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
    { "Origin": "", "Referer": "" },
    1
  );
  const list = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
}

async function tmdbInfo(tmdbId, mediaType) {
  const data = await requestJson(
    `${TMDB_API}/${mediaType}/${encodeURIComponent(String(tmdbId))}?api_key=${TMDB_API_KEY}`,
    { "Origin": "", "Referer": "" },
    1
  );
  if (!data) return { title: "Vidlink", year: "" };
  const title = mediaType === "movie"
    ? clean(data.title || data.original_title)
    : clean(data.name || data.original_name);
  const date = mediaType === "movie" ? clean(data.release_date) : clean(data.first_air_date);
  return { title: title || "Vidlink", year: /^\d{4}/.test(date) ? date.slice(0, 4) : "" };
}

async function encryptedId(tmdbId) {
  const data = await requestJson(`${ENC_URL}?text=${encodeURIComponent(String(tmdbId))}`, { "Origin": "", "Referer": "" }, 2);
  if (!data) return "";
  if (Number(data.status || 200) !== 200) return "";
  return clean(data.result);
}

function apiEndpoint(mediaType, encrypted, season, episode, query) {
  const base = mediaType === "movie"
    ? `${BASE_URL}/api/b/movie/${encodeURIComponent(encrypted)}`
    : `${BASE_URL}/api/b/tv/${encodeURIComponent(encrypted)}/${Number(season || 1)}/${Number(episode || 1)}`;
  return query ? `${base}?${query}` : base;
}

function subtitleTrack(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const url = clean(item);
    if (!/^https?:\/\//i.test(url)) return null;
    return { url, file: url, language: "Unknown", name: "Unknown" };
  }
  const url = clean(item.file || item.url || item.src || item.uri);
  if (!/^https?:\/\//i.test(url)) return null;
  const label = clean(item.label || item.name || item.lang || item.language) || "Unknown";
  const language = clean(item.language || item.lang || item.label || item.name) || label;
  return { url, file: url, language, name: label };
}

function subtitlesFrom(payloads) {
  const out = [];
  const seen = new Set();
  for (const payload of payloads || []) {
    if (!payload || typeof payload !== "object") continue;
    const groups = [payload.stream && payload.stream.captions, payload.subtitles, payload.captions];
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const raw of group) {
        const track = subtitleTrack(raw);
        if (!track || seen.has(track.url)) continue;
        seen.add(track.url);
        out.push(track);
      }
    }
  }
  return out;
}

function heightOf(value) {
  const text = clean(value);
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const m = text.match(/(?:^|[^0-9])(4320|2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}

function qualityLabel(height) {
  const h = Number(height || 0);
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

function audioEvidence(payloads) {
  const texts = [];
  let dual = false;
  for (const payload of payloads || []) {
    const stream = payload && payload.stream;
    if (!stream || typeof stream !== "object") continue;
    for (const key of ["audio", "audioType", "audioLanguage", "language", "lang"]) {
      if (stream[key]) texts.push(String(stream[key]));
    }
    const groups = [stream.audioTracks, stream.audios, payload.audioTracks, payload.audios];
    if (groups.some(group => Array.isArray(group) && group.filter(Boolean).length > 1)) dual = true;
  }
  const text = texts.join(" ").toLowerCase();
  if (/dual\s*audio|\bdual\b/.test(text)) dual = true;
  return {
    dual,
    dub: /english\s*dub|\bdubbed\b|\bdub\b/.test(text),
    hsub: /hard[\s-]*subs?|hardsub|\bhsub\b/.test(text),
    language: texts.length ? clean(texts[0]) : "Unknown"
  };
}

function tagFor(subtitles, evidence) {
  if (evidence && evidence.dual) return "[DUAL]";
  if (Array.isArray(subtitles) && subtitles.length) return evidence && evidence.dub ? "[DUB+SUB]" : "[SUB]";
  if (evidence && evidence.dub) return "[DUB]";
  if (evidence && evidence.hsub) return "[HSUB]";
  return "[UNK]";
}

function titleFor(meta, mediaType, season, episode) {
  if (mediaType === "tv") return `${meta.title} • S${Number(season || 1)}E${Number(episode || 1)}`;
  return meta.year ? `${meta.title} (${meta.year})` : meta.title;
}

function addQualityCandidates(out, stream, headers, sourceId) {
  if (!stream || typeof stream !== "object" || !stream.qualities || typeof stream.qualities !== "object") return;
  for (const [quality, value] of Object.entries(stream.qualities)) {
    const url = typeof value === "string" ? clean(value) : clean(value && value.url);
    if (!/^https?:\/\//i.test(url)) continue;
    const h = heightOf(quality) || heightOf(value && (value.quality || value.resolution || value.label || value.name)) || heightOf(url);
    const rowHeaders = typeof value === "object" && value && value.headers && typeof value.headers === "object"
      ? { ...headers, ...value.headers }
      : { ...headers };
    out.push({ url, height: h, headers: rowHeaders, type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4", sourceId });
  }
}

function addPlaylistCandidate(out, stream, headers, sourceId) {
  if (!stream || typeof stream !== "object") return;
  const url = clean(stream.playlist);
  if (!/^https?:\/\//i.test(url)) return;
  if (/\.mpd(?:$|[?#])/i.test(url) || String(stream.deliveryType || stream.type || "").toLowerCase() === "dash") return;
  const resolutions = stream.playbackMetadata && Array.isArray(stream.playbackMetadata.resolutions)
    ? stream.playbackMetadata.resolutions.map(heightOf).filter(Boolean)
    : [];
  const h = resolutions.length ? Math.max(...resolutions) : heightOf(url);
  out.push({
    url,
    height: h,
    headers: { ...headers, ...((stream.playlistHeaders && typeof stream.playlistHeaders === "object") ? stream.playlistHeaders : {}) },
    type: "m3u8",
    sourceId
  });
}

async function fetchPayloads(endpoint) {
  const standard = await requestJson(endpoint, STANDARD_HEADERS, 2);
  const dash = await requestJson(endpoint, DASH_HEADERS, 1);
  return { standard, dash };
}

async function getStreams(inputId, mediaType = "movie", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [];

  const encrypted = await encryptedId(tmdbId);
  if (!encrypted) return [];

  let payloads = await fetchPayloads(apiEndpoint(type, encrypted, season, episode, "multiLang=0"));
  if (!payloads.standard && !payloads.dash) {
    payloads = await fetchPayloads(apiEndpoint(type, encrypted, season, episode, ""));
  }
  if (!payloads.standard && !payloads.dash) return [];

  const meta = await tmdbInfo(tmdbId, type);
  const subs = subtitlesFrom([payloads.standard, payloads.dash]);
  const evidence = audioEvidence([payloads.standard, payloads.dash]);
  const tag = tagFor(subs, evidence);
  const candidates = [];
  const standardStream = payloads.standard && payloads.standard.stream;
  const dashStream = payloads.dash && payloads.dash.stream;
  const sourceId = clean((payloads.standard && payloads.standard.sourceId) || (payloads.dash && payloads.dash.sourceId));

  addQualityCandidates(candidates, standardStream, STANDARD_HEADERS, sourceId);
  if (!candidates.length) addQualityCandidates(candidates, dashStream, DASH_HEADERS, sourceId);
  if (!candidates.length) addPlaylistCandidate(candidates, standardStream, STANDARD_HEADERS, sourceId);
  if (!candidates.length) addPlaylistCandidate(candidates, dashStream, DASH_HEADERS, sourceId);

  const seen = new Set();
  const rows = [];
  for (const c of candidates) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    rows.push({
      name: `${PROVIDER_NAME} • ${qualityLabel(c.height)} • ${tag}`,
      title: titleFor(meta, type, season, episode),
      url: c.url,
      quality: c.height ? `${c.height}p` : "Auto",
      language: evidence.language || "Unknown",
      headers: c.headers,
      provider: PROVIDER_NAME,
      type: c.type,
      subtitles: subs
    });
  }
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
