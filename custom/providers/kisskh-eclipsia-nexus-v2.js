"use strict";

// Nexus KissKH v2: strict title ownership around Eclipsia v9.9.0 Fyron/KissKH.
// The upstream provider remains authoritative for token generation and playback.
// Nexus preflights TMDB titles/aliases against KissKH search and then verifies that
// Fyron actually opens one of the accepted KissKH drama IDs before returning rows.
const PROVIDER_NAME = "KissKH";
const SOURCE_URL = "https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/providers/fyron.js";
const DEFAULT_BASE_URL = "https://kisskh.ovh";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
let cachedSource = "";
let cachedBaseUrl = "";

function clean(value) { return String(value == null ? "" : value).trim(); }
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function yearOf(value) {
  const match = clean(value).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}
function normalizeTitle(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function idOf(item) {
  const value = item && (item.id != null ? item.id : (item.dramaId != null ? item.dramaId : item.Id));
  return clean(value);
}
function titleOf(item) { return clean(item && (item.title || item.name || item.Title || item.Name)); }

async function fetchJson(url, options) {
  try {
    const response = await fetch(url, { ...(options || {}), redirect: "follow", skipSizeCheck: true });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch (_) { return null; }
}

async function loadSource() {
  if (cachedSource) return { source: cachedSource, baseUrl: cachedBaseUrl || DEFAULT_BASE_URL };
  try {
    const response = await fetch(SOURCE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
    const match = source.match(/\bBASE_URL\s*=\s*["'](https?:\/\/[^"']+)["']/i);
    cachedSource = source;
    cachedBaseUrl = match && match[1] ? match[1].replace(/\/+$/, "") : DEFAULT_BASE_URL;
    return { source: cachedSource, baseUrl: cachedBaseUrl };
  } catch (_) { return null; }
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const rows = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(rows) && rows[0] && rows[0].id ? Number(rows[0].id) : null;
}

async function tmdbMeta(tmdbId, mediaType) {
  const data = await fetchJson(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
  if (!data) return null;
  const aliases = [];
  const push = value => {
    const v = clean(value);
    if (v && !aliases.includes(v)) aliases.push(v);
  };
  if (mediaType === "movie") {
    push(data.title); push(data.original_title);
    const alt = data.alternative_titles && data.alternative_titles.titles;
    if (Array.isArray(alt)) for (const item of alt) push(item && item.title);
  } else {
    push(data.name); push(data.original_name);
    const alt = data.alternative_titles && data.alternative_titles.results;
    if (Array.isArray(alt)) for (const item of alt) push(item && item.title);
  }
  const primary = aliases[0] || "";
  if (!primary) return null;
  return {
    title: primary,
    aliases: aliases.slice(0, 14),
    year: yearOf(mediaType === "movie" ? data.release_date : data.first_air_date)
  };
}

async function strictOwnership(inputId, mediaType, baseUrl) {
  const tmdbId = await resolveTmdbId(inputId, mediaType);
  if (!tmdbId) return null;
  const meta = await tmdbMeta(tmdbId, mediaType);
  if (!meta) return null;

  const normalizedAliases = new Set(meta.aliases.map(normalizeTitle).filter(Boolean));
  const accepted = new Map();
  const terms = [];
  const pushTerm = value => {
    const v = clean(value);
    if (v && !terms.includes(v)) terms.push(v);
  };
  for (const alias of meta.aliases) {
    pushTerm(alias);
    if (terms.length >= 8) break;
  }

  for (const term of terms) {
    const data = await fetchJson(`${baseUrl}/api/DramaList/Search?q=${encodeURIComponent(term)}&type=0`, {
      headers: { Referer: `${baseUrl}/`, Origin: baseUrl }
    });
    if (!Array.isArray(data)) continue;
    for (const item of data) {
      const id = idOf(item);
      const title = titleOf(item);
      if (!id || !title || !normalizedAliases.has(normalizeTitle(title))) continue;
      const candidateYear = yearOf(item && (item.releaseDate || item.year || item.title));
      if (candidateYear && meta.year && candidateYear !== meta.year) continue;
      accepted.set(id, item);
    }
    if (accepted.size) break;
  }

  return accepted.size ? { meta, accepted } : null;
}

function makeTracedFetch(calls) {
  const realFetch = fetch;
  return async function tracedFetch(input, init) {
    const url = clean(typeof input === "string" ? input : input && input.url);
    try {
      const response = await realFetch(input, init);
      calls.push({ url, status: Number(response && response.status || 0) });
      return response;
    } catch (error) {
      calls.push({ url, status: 0 });
      throw error;
    }
  };
}

function buildModule(source, tracedFetch) {
  const mod = { exports: {} };
  const factory = new Function(
    "module", "exports", "require", "fetch",
    source + "\n;return { moduleExports: module.exports, localGetStreams: (typeof getStreams === 'function' ? getStreams : null) };"
  );
  const captured = factory(
    mod,
    mod.exports,
    function(name) { throw new Error("Unsupported nested require: " + name); },
    tracedFetch
  );
  if (captured && captured.moduleExports && typeof captured.moduleExports.getStreams === "function") return captured.moduleExports;
  if (captured && typeof captured.localGetStreams === "function") return { getStreams: captured.localGetStreams };
  if (mod.exports && typeof mod.exports.getStreams === "function") return mod.exports;
  return null;
}

function detailIdFromCalls(calls) {
  for (const call of calls || []) {
    const match = clean(call && call.url).match(/\/api\/DramaList\/Drama\/([^?/#]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return "";
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""} ${row && row.title || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const match = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return match ? Number(match[1]) : 0;
}
function qualityLabel(height) {
  if (height >= 4320) return `2x4K 8K ${height}p`;
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `Enhanced QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 540) return `HD-Low ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height >= 360) return `SD-Low ${height}p`;
  return `SD-Very Low ${height}p`;
}
function hasSubtitleTracks(row) {
  const candidates = [row && row.subtitles, row && row.subtitleTracks, row && row.captions, row && row.tracks];
  return candidates.some(value => Array.isArray(value) && value.some(track => {
    if (!track) return false;
    if (typeof track === "string") return !!track;
    const kind = String(track.kind || track.type || "").toLowerCase();
    if (kind && !/(sub|caption|text|vtt|srt)/.test(kind)) return false;
    return !!(track.url || track.file || track.src || track.label || track.language || track.lang);
  }));
}
function audioLabel(row) {
  const text = [
    row && row.name, row && row.title, row && row.audio, row && row.audioType,
    row && row.audioLanguage, row && row.language, row && row.lang
  ].filter(Boolean).join(" ").toLowerCase();
  const hasSubs = hasSubtitleTracks(row) || /hard\s*subs?|soft\s*subs?|\bsubbed\b|\bsubs?\b|\bcaptions?\b/.test(text);
  const hasDub = /dub\s*\+\s*subs?|dub\+subs?|english\s*dub|\bdubbed\b|\bdub\b/.test(text);
  if (/dual\s*audio|\bdual\b/.test(text)) return "[DUAL]";
  if (hasDub && hasSubs) return "[DUB+SUB]";
  if (hasDub) return "[DUB]";
  if (hasSubs) return "[SUB]";
  return "";
}
function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = qualityNumber(row);
  const rawQuality = String(row.quality || "").trim();
  let quality = height ? qualityLabel(height) : "";
  if (!quality && /^(auto|unknown)$/i.test(rawQuality) && row.url) quality = "Unknown Auto";
  if (!quality) return row;
  const audio = audioLabel(row);
  return { ...row, name: `${PROVIDER_NAME} • ${quality}${audio ? ` • ${audio}` : ""}` };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const loaded = await loadSource();
  if (!loaded) return [];

  // Fail closed. A false positive is worse than an omitted KissKH row.
  const ownership = await strictOwnership(inputId, type, loaded.baseUrl);
  if (!ownership) return [];

  const calls = [];
  let upstream;
  try { upstream = buildModule(loaded.source, makeTracedFetch(calls)); }
  catch (_) { return []; }
  if (!upstream || typeof upstream.getStreams !== "function") return [];

  let rows;
  try { rows = await upstream.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
  if (!Array.isArray(rows) || !rows.length) return [];

  const openedId = detailIdFromCalls(calls);
  if (!openedId || !ownership.accepted.has(openedId)) return [];
  return rows.map(normalizeRow);
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
