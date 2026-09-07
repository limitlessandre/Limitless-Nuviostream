"use strict";

// AsiaFlix Nexus probe v0.2.0
// Keeps the existing AsiaFlix playback provider intact and adds visible diagnostics
// around TMDB identity, API search, detail/episode mapping, host discovery, and final streams.

const PROVIDER_NAME = "AsiaFlix Test";
const BASE_PROVIDER_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/asiaflix-production-v2.js";
const API_URL = "https://api.asiaflix.net/v1";
const BASE_URL = "https://asiaflix.net";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const API_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Access-Control": "web"
};
let cachedBase = null;

function clean(value) { return String(value == null ? "" : value).trim(); }
function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = Number(limit) || 200;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function normalizeTitle(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/\b(the|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function yearOf(value) {
  const m = clean(value).match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}
function candidateNames(row) {
  const alt = Array.isArray(row && row.altNames) ? row.altNames : [];
  return [...new Set([row && row.name, ...alt].map(clean).filter(Boolean))];
}
function scoreCandidate(row, meta) {
  const names = candidateNames(row);
  if (!names.length) return -1;
  let score = -1;
  for (const expected of meta.aliases || []) {
    const a = normalizeTitle(expected);
    if (!a) continue;
    for (const source of names) {
      const b = normalizeTitle(source);
      if (!b) continue;
      if (a === b) score = Math.max(score, 100);
      else if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) score = Math.max(score, 82);
    }
  }
  const cy = yearOf(row && (row.releaseYear || row.year || row.releaseDate || row.aired));
  if (score >= 0 && cy && meta.year) {
    if (cy === meta.year) score += 12;
    else if (Math.abs(cy - meta.year) === 1) score += 2;
    else score -= 20;
  }
  return score;
}

async function fetchJson(url, headers) {
  try {
    const response = await fetch(url, { headers: { ...API_HEADERS, ...(headers || {}) }, redirect: "follow", skipSizeCheck: true });
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

async function tmdbInfo(tmdbId, type) {
  const r = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,external_ids`, {});
  if (!r.ok || !r.data) return null;
  const data = r.data;
  const title = clean(type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name));
  const original = clean(type === "movie" ? (data.original_title || data.title) : (data.original_name || data.name));
  const altRows = data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results);
  const aliases = [];
  const push = value => { const v = clean(value); if (v && !aliases.includes(v)) aliases.push(v); };
  push(title); push(original);
  if (Array.isArray(altRows)) for (const row of altRows) push(row && (row.title || row.name));
  return {
    id: tmdbId,
    title,
    aliases: aliases.slice(0, 12),
    year: yearOf(type === "movie" ? data.release_date : data.first_air_date)
  };
}

async function searchAsiaFlix(query) {
  const url = `${API_URL}/drama/search?q=${encodeURIComponent(query)}&page=1&projections=${encodeURIComponent('["releaseYear","status","altNames"]')}`;
  const r = await fetchJson(url, {});
  if (!r.ok || !r.data) return { ok: false, rows: [], error: r.error || `HTTP ${r.status || "ERR"}` };
  const data = r.data;
  const rows = Array.isArray(data.body) ? data.body : Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
  return { ok: true, rows, error: "" };
}

async function fetchDetails(slug) {
  return fetchJson(`${API_URL}/drama/detail?slug=${encodeURIComponent(slug)}`, {});
}

function findEpisode(details, type, episode) {
  const eps = Array.isArray(details && details.episodes) ? details.episodes : [];
  if (!eps.length) return null;
  if (type === "movie") return eps[0];
  const wanted = Number(episode || 1);
  return eps.find(ep => Math.abs(Number(ep && ep.number) - wanted) < 0.001) || null;
}

function diag(label, detail) {
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 210)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${BASE_URL}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function loadBase() {
  if (cachedBase && typeof cachedBase.getStreams === "function") return cachedBase;
  try {
    const response = await fetch(BASE_PROVIDER_URL, { redirect: "follow", skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedBase = exported;
    return cachedBase;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const s = Number(season || 1);
  const e = Number(episode || 1);
  const rows = [];

  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB FAILED", `input=${inputId} • type=${type}`)];
  const meta = await tmdbInfo(tmdbId, type);
  if (!meta || !meta.title) return [diag("TMDB FAILED", `TMDB ${tmdbId} returned no title`)];
  rows.push(diag("TMDB", `${meta.title} • TMDB ${tmdbId} • year=${meta.year || "?"} • aliases=${meta.aliases.length}`));

  if (type === "tv" && s !== 1) {
    rows.push(diag("SEASON UNSUPPORTED", `${meta.title} • S${s} • current AsiaFlix provider safely maps only Season 1`));
    return rows;
  }

  const terms = [...new Set([meta.title, ...meta.aliases].map(clean).filter(Boolean))].slice(0, 8);
  const candidates = new Map();
  const searchNotes = [];
  for (const term of terms) {
    const result = await searchAsiaFlix(term);
    if (!result.ok) {
      searchNotes.push(`${term}=ERR ${result.error}`);
      continue;
    }
    searchNotes.push(`${term}=${result.rows.length}`);
    for (const item of result.rows) {
      const slug = clean(item && (item.slug || item.id || item.url));
      if (!slug) continue;
      const score = scoreCandidate(item, meta);
      const previous = candidates.get(slug);
      if (!previous || score > previous.score) candidates.set(slug, { row: item, score });
    }
    if ([...candidates.values()].some(item => item.score >= 100)) break;
  }

  const ranked = [...candidates.entries()]
    .map(([slug, value]) => ({ slug, row: value.row, score: value.score }))
    .sort((a, b) => b.score - a.score);
  const samples = ranked.slice(0, 4).map(item => `${clean(item.row && item.row.name)}(${item.score})`).filter(Boolean);
  rows.push(diag("SEARCH", `${searchNotes.slice(0, 4).join(" • ")} • candidates=${ranked.length}${samples.length ? ` • top=${samples.join(" | ")}` : ""}`));

  const matched = ranked.find(item => item.score >= 70);
  if (!matched) {
    rows.push(diag("NO MATCH", `${meta.title} • no candidate scored >=70`));
    return rows;
  }

  const detailResult = await fetchDetails(matched.slug);
  if (!detailResult.ok || !detailResult.data) {
    rows.push(diag("DETAIL FAILED", `${matched.slug} • ${detailResult.error || `HTTP ${detailResult.status || "ERR"}`}`));
    return rows;
  }
  const details = detailResult.data;
  const detailName = clean(details && details.name) || clean(matched.row && matched.row.name) || matched.slug;
  const eps = Array.isArray(details && details.episodes) ? details.episodes : [];
  rows.push(diag("MATCH OK", `${detailName} • slug=${matched.slug} • score=${matched.score} • episodes=${eps.length}`));

  const selectedEpisode = findEpisode(details, type, e);
  if (!selectedEpisode) {
    rows.push(diag("NO EPISODE", `${detailName} • ${type === "tv" ? `S${s}E${e}` : "movie"} • episodes=${eps.length}`));
    return rows;
  }
  const hosts = Array.isArray(selectedEpisode.streamUrls) ? selectedEpisode.streamUrls : [];
  rows.push(diag("EPISODE OK", `${detailName} • episode=${selectedEpisode.number} • hosts=${hosts.length}${hosts.length ? ` • ${hosts.slice(0,4).map(h => clean(h && h.source) || "Server").join(" | ")}` : ""}`));

  const base = await loadBase();
  if (!base) {
    rows.push(diag("BASE FAILED", "Could not load existing AsiaFlix playback provider"));
    return rows;
  }

  let playable = [];
  try {
    const result = await base.getStreams(inputId, mediaType, season, episode);
    playable = Array.isArray(result) ? result : [];
  } catch (error) {
    rows.push(diag("BASE ERROR", clean(error && error.message ? error.message : error)));
  }

  if (playable.length) {
    rows.unshift(...playable.map(row => ({ ...row, provider: PROVIDER_NAME, name: clean(row.name).replace(/^AsiaFlix\b/i, PROVIDER_NAME) })));
    rows.push(diag("STREAMS OK", `playable=${playable.length}`));
  } else {
    rows.push(diag("NO STREAM", `${detailName} • episode matched but playback provider returned 0 streams`));
  }
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
