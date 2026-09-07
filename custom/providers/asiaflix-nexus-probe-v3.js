"use strict";

// AsiaFlix Nexus probe v0.2.3
// Purpose: never let a slow AsiaFlix host resolver consume the whole Nuvio provider window.
// Flow: TMDB -> direct slug -> one search fallback -> episode -> host list -> bounded API resolver.

const PROVIDER_NAME = "AsiaFlix Test";
const BASE_URL = "https://asiaflix.net";
const API_URL = "https://api.asiaflix.net/v1";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 1800;

const API_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Access-Control": "web"
};
const VIDEO_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Referer": `${BASE_URL}/`,
  "Origin": BASE_URL
};

function clean(value) { return String(value == null ? "" : value).trim(); }
function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = Number(limit) || 205;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function yearOf(value) {
  const m = clean(value).match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}
function slugify(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function normalizeTitle(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/\b(the|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function hostOf(url) {
  try { return new URL(clean(url).replace(/^\/\//, "https://")).hostname; } catch (_) { return "unknown-host"; }
}
function languageName(code) {
  const key = clean(code).toLowerCase();
  const names = { ja: "Japanese", ko: "Korean", zh: "Chinese", th: "Thai", tl: "Filipino", fil: "Filipino", en: "English", vi: "Vietnamese", id: "Indonesian", ms: "Malay" };
  return names[key] || (key ? key.toUpperCase() : "Original");
}
function diag(label, detail) {
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 205)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${BASE_URL}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

function networkCapabilityError() {
  // Nuvio's QuickJS bridge blocks in __native_fetch and ignores AbortSignal.
  // A Promise race cannot interrupt native synchronous I/O. Do not start it.
  if (typeof __native_fetch === "function") return "Synchronous native fetch cannot enforce provider deadlines";
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") return "Runtime timers unavailable; bounded networking disabled";
  return "";
}

async function boundedJson(url, options, timeoutMs) {
  const unsupported = networkCapabilityError();
  if (unsupported) throw new Error(unsupported);
  const ms = Number(timeoutMs) || REQUEST_TIMEOUT_MS;
  let timer = null;
  let controller = null;
  try {
    if (typeof AbortController !== "undefined") controller = new AbortController();
    const opts = { ...(options || {}), redirect: "follow", skipSizeCheck: true };
    if (controller) opts.signal = controller.signal;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        // Settle the deadline first so abort rejection cannot mask TIMEOUT.
        reject(new Error("TIMEOUT"));
        try { if (controller) controller.abort(); } catch (_) {}
      }, ms);
    });
    // Include body download/JSON decoding in the same deadline as headers.
    const request = (async () => {
      const response = await fetch(url, opts);
      if (!response) return { ok: false, status: 0, data: null, error: "no response" };
      const status = Number(response.status || 0);
      if (!response.ok) return { ok: false, status, data: null, error: `HTTP ${status || "ERR"}` };
      return { ok: true, status, data: await response.json(), error: "" };
    })();
    return await Promise.race([request, timeout]);
  } finally {
    try { if (timer !== null) clearTimeout(timer); } catch (_) {}
  }
}

async function fetchJson(url, headers, timeoutMs) {
  const started = Date.now();
  // Do not log API keys or encoded host URLs.
  const stage = url.includes("get-stream-url") ? `resolver:${decodeURIComponent((url.match(/[?&]server=([^&]*)/) || [])[1] || "unknown")}`
    : url.includes("/drama/detail") ? "detail" : url.includes("/drama/search") ? "search"
    : url.includes("/find/") ? "tmdb-id" : "tmdb-info";
  let result;
  console.log(`[${PROVIDER_NAME}] ${stage} start`);
  try {
    result = await boundedJson(url, { headers: { ...API_HEADERS, ...(headers || {}) } }, timeoutMs);
  } catch (error) {
    const message = clean(error && error.message ? error.message : error) || "request error";
    result = { ok: false, status: 0, data: null, error: message === "TIMEOUT" ? `TIMEOUT>${timeoutMs || REQUEST_TIMEOUT_MS}ms` : message };
  }
  console.log(`[${PROVIDER_NAME}] ${stage} ${result.error || `HTTP ${result.status}`} ${Date.now() - started}ms`);
  return result;
}

async function resolveTmdbId(inputId, type) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;
  const r = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, {}, 1500);
  const list = type === "movie" ? r.data && r.data.movie_results : r.data && r.data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
}

async function tmdbInfo(tmdbId, type) {
  const r = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,external_ids`, {}, 1500);
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
    aliases: aliases.slice(0, 8),
    year: yearOf(type === "movie" ? data.release_date : data.first_air_date),
    language: languageName(data.original_language)
  };
}

function detailMatches(details, meta) {
  const source = normalizeTitle(details && (details.name || details.title));
  if (!source) return false;
  return (meta.aliases || []).some(alias => normalizeTitle(alias) === source);
}

async function fetchDetails(slug) {
  return fetchJson(`${API_URL}/drama/detail?slug=${encodeURIComponent(slug)}`, {}, 1600);
}

async function searchAsiaFlix(query) {
  const url = `${API_URL}/drama/search?q=${encodeURIComponent(query)}&page=1`;
  const r = await fetchJson(url, {}, 1600);
  if (!r.ok || !r.data) return { ok: false, rows: [], error: r.error || `HTTP ${r.status || "ERR"}` };
  const data = r.data;
  const rows = Array.isArray(data.body) ? data.body : Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
  return { ok: true, rows, error: "" };
}

function slugFromRow(row) {
  const direct = clean(row && row.slug);
  if (direct) return direct;
  const url = clean(row && row.url);
  if (url) {
    const m = url.match(/\/drama\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]);
  }
  return "";
}

async function findTarget(meta) {
  const directSlug = slugify(meta.title);
  if (directSlug) {
    const r = await fetchDetails(directSlug);
    if (r.ok && r.data && detailMatches(r.data, meta)) {
      return { details: r.data, slug: directSlug, via: "direct", note: `direct=${directSlug}/HTTP${r.status}` };
    }
    var directNote = `direct=${directSlug}/${r.error || `HTTP${r.status}`}`;
  }

  const search = await searchAsiaFlix(meta.title);
  if (!search.ok) return { details: null, note: `${directNote || "direct=none"} • search=${search.error}` };

  const exact = search.rows.find(row => {
    const names = [row && row.name, row && row.title, ...(Array.isArray(row && row.altNames) ? row.altNames : [])].map(normalizeTitle).filter(Boolean);
    return (meta.aliases || []).some(alias => names.includes(normalizeTitle(alias)));
  });
  if (!exact) {
    const samples = search.rows.slice(0, 4).map(row => clean(row && (row.name || row.title))).filter(Boolean);
    return { details: null, note: `${directNote || "direct=none"} • search=${search.rows.length}${samples.length ? ` • samples=${samples.join(" | ")}` : ""}` };
  }

  const slug = slugFromRow(exact) || slugify(exact.name || exact.title);
  const detail = await fetchDetails(slug);
  if (!detail.ok || !detail.data || !detailMatches(detail.data, meta)) {
    return { details: null, note: `${directNote || "direct=none"} • exact=${slug} • detail=${detail.error || `HTTP${detail.status}`}` };
  }
  return { details: detail.data, slug, via: "search", note: `search=${search.rows.length}` };
}

function findEpisode(details, type, episode) {
  const eps = Array.isArray(details && details.episodes) ? details.episodes : [];
  if (!eps.length) return null;
  if (type === "movie") return eps[0];
  const wanted = Number(episode || 1);
  return eps.find(ep => Math.abs(Number(ep && ep.number) - wanted) < 0.001) || null;
}

function utf8Bytes(value) {
  const encoded = encodeURIComponent(String(value || ""));
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%" && i + 2 < encoded.length) { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  return bytes;
}
function base64Encode(value) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(value);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63] + chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? chars[triple & 63] : "=";
  }
  return out;
}

async function resolveServer(host) {
  const source = clean(host && host.source) || "Server";
  const hostUrl = clean(host && host.url);
  if (!hostUrl) return { source, hostUrl, files: [], error: "empty-url" };
  const endpoint = `${API_URL}/drama/get-stream-url?value=${encodeURIComponent(base64Encode(hostUrl))}&server=${encodeURIComponent(source.toLowerCase())}`;
  const r = await fetchJson(endpoint, {}, 1400);
  const files = r.ok && r.data && Array.isArray(r.data.sources)
    ? r.data.sources.map(file => ({ source, url: clean(file && file.url), isM3U8: Boolean(file && file.isM3U8) })).filter(file => file.url)
    : [];
  return { source, hostUrl, files, error: r.ok ? (files.length ? "" : "no-sources") : r.error };
}

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
  if (h >= 480) return `SD ${h}p`;
  return h > 0 ? `SD-Low ${h}p` : "Unknown Auto";
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const s = Number(season || 1), e = Number(episode || 1);
  const rows = [];

  if (type === "tv" && s !== 1) return [diag("SEASON UNSUPPORTED", `S${s} • AsiaFlix exposes a flat episode list` )];
  const unsupported = networkCapabilityError();
  if (unsupported) return [diag("RUNTIME UNSUPPORTED", unsupported)];

  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB FAILED", `input=${inputId} • type=${type}`)];
  const meta = await tmdbInfo(tmdbId, type);
  if (!meta || !meta.title) return [diag("TMDB FAILED", `TMDB ${tmdbId} returned no title`)];
  rows.push(diag("TMDB", `${meta.title} • TMDB ${tmdbId} • year=${meta.year || "?"}`));

  const target = await findTarget(meta);
  if (!target || !target.details) {
    rows.push(diag("NO MATCH", `${meta.title} • ${target && target.note ? target.note : "no target"}`));
    return rows;
  }

  const details = target.details;
  const detailName = clean(details && (details.name || details.title)) || meta.title;
  const eps = Array.isArray(details && details.episodes) ? details.episodes : [];
  rows.push(diag("MATCH OK", `${detailName} • slug=${target.slug} • via=${target.via} • episodes=${eps.length}`));

  const selectedEpisode = findEpisode(details, type, e);
  if (!selectedEpisode) {
    rows.push(diag("NO EPISODE", `${detailName} • ${type === "tv" ? `S${s}E${e}` : "movie"} • episodes=${eps.length}`));
    return rows;
  }

  const hosts = Array.isArray(selectedEpisode.streamUrls) ? selectedEpisode.streamUrls.filter(h => clean(h && h.url)) : [];
  const hostSummary = hosts.slice(0, 6).map(h => `${clean(h.source) || "Server"}@${hostOf(h.url)}`).join(" | ");
  rows.push(diag("EPISODE OK", `${detailName} • episode=${selectedEpisode.number} • hosts=${hosts.length}${hostSummary ? ` • ${hostSummary}` : ""}`));
  if (!hosts.length) return rows.concat(diag("NO STREAM", "Episode matched but source listed no stream hosts"));

  // Probe only the first two resolvers. Upstream AsiaFlix falls back to host-specific extractors
  // (VidMoly/StreamWish/Dood/etc.); this probe intentionally stops before those so Nuvio cannot hang.
  const probes = await Promise.all(hosts.slice(0, 2).map(resolveServer));

  const playable = [];
  const resolverNotes = [];
  const seen = new Set();
  for (const probe of probes) {
    resolverNotes.push(`${probe.source}@${hostOf(probe.hostUrl)}=${probe.files.length ? `${probe.files.length} source(s)` : probe.error}`);
    for (const file of probe.files) {
      const url = clean(file.url);
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const height = inferHeight(`${url} ${file.source || ""}`);
      playable.push({
        name: `${PROVIDER_NAME} • ${tier(height)}${file.source ? ` • ${clean(file.source)}` : ""}`,
        title: `${detailName} • ${type === "tv" ? `Episode ${e}` : "Movie"}`,
        url,
        quality: height ? `${height}p` : "Auto",
        language: meta.language,
        headers: VIDEO_HEADERS,
        provider: PROVIDER_NAME,
        type: file.isM3U8 || /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4",
        subtitles: []
      });
    }
  }

  playable.sort((a, b) => parseInt(String(b.quality).match(/\d+/)?.[0] || "0", 10) - parseInt(String(a.quality).match(/\d+/)?.[0] || "0", 10));
  if (playable.length) rows.unshift(...playable);
  rows.push(diag("RESOLVERS", resolverNotes.join(" • ") || "no resolver probes"));
  rows.push(diag(playable.length ? "STREAMS OK" : "PROBE COMPLETE", `${detailName} • playable=${playable.length} • host-specific extractor refinement pending`));
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
