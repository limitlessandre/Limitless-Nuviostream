"use strict";

const PROVIDER_NAME = "Scarlet Peach - HentaiTV";
const CATALOG_BASE = "https://scarlet-peach-catalog.limitlessandre.workers.dev";
const HENTAITV_BASE = "https://hentai.tv";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function clean(value) { return String(value == null ? "" : value).trim(); }
function short(value, max) { const text = clean(value).replace(/\s+/g, " "); const n = Number(max) || 180; return text.length > n ? text.slice(0, n - 1) + "…" : text; }
function diag(label, detail) {
  const text = clean(detail);
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${text ? ` • ${short(text, 180)}` : ""}`,
    title: text || `${PROVIDER_NAME} diagnostic`,
    url: `${HENTAITV_BASE}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(the|animation|ova)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreTitle(target, candidate) {
  const a = normalize(target), b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = new Set(a.split(" ")), right = new Set(b.split(" "));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(left.size, right.size, 1);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function parseEpisodeNumber(value) {
  const text = String(value || "");
  const match = text.match(/(?:episode|ep)[-\s_]*(\d+)(?:\D*$)/i) || text.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function slugSeriesTitle(slug) {
  return String(slug || "")
    .replace(/-episode-\d+$/i, "")
    .replace(/-\d+$/i, "")
    .replace(/-/g, " ")
    .trim();
}

function cleanSeriesTitle(value) {
  return decodeHtml(value)
    .replace(/\s+(?:episode|ep)\s*\d+.*$/i, "")
    .replace(/\s*[-–—:]\s*(?:episode|ep)\s*\d+.*$/i, "")
    .trim();
}

function videoSlugVariations(episodeSlug) {
  const base = String(episodeSlug || "").replace(/-episode-(\d+)$/i, "-$1");
  const out = [base];
  for (const prefix of ["ova-", "ona-", "special-"]) {
    if (base.toLowerCase().startsWith(prefix)) out.unshift(base.slice(prefix.length));
  }
  if (/^1ldk-jk-/i.test(base)) out.unshift(base.replace(/^1ldk-jk-/i, "1ldk-+-jk-"));
  const alt = String(episodeSlug || "").replace(/-episode-/i, "-");
  if (alt) out.push(alt);
  return [...new Set(out.filter(Boolean))];
}

function toStream(url) {
  const quality = String(url).match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i)?.[1];
  const container = /\.m3u8(?:[?#]|$)/i.test(url) ? "HLS" : /\.mp4(?:[?#]|$)/i.test(url) ? "MP4" : "";
  const details = [quality ? `${quality}p` : "", container].filter(Boolean).join(" • ");
  const name = details ? `${PROVIDER_NAME} • ${details}` : PROVIDER_NAME;
  return {
    name,
    title: name,
    url,
    provider: PROVIDER_NAME,
    behaviorHints: {
      proxyHeaders: { request: { Referer: "https://nhplayer.com/" } }
    }
  };
}

function browserHeaders(referer) {
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1"
  };
  if (referer) headers.Referer = referer;
  return headers;
}

async function safeFetch(url, options = {}) {
  try {
    return await fetch(url, {
      ...options,
      skipSizeCheck: true,
      headers: { ...browserHeaders(), ...(options.headers || {}) }
    });
  } catch (_) {
    return null;
  }
}

async function readText(response) {
  if (!response) return "";
  try {
    const raw = await response.text();
    return typeof raw === "string" ? raw : clean(raw);
  } catch (_) {
    return "";
  }
}

async function readJsonResponse(response) {
  if (!response) return null;
  try {
    const raw = await response.text();
    if (typeof raw === "string" && raw.trim()) return JSON.parse(raw.trim());
    if (raw && typeof raw === "object") return raw;
  } catch (_) {}
  try { return await response.json(); } catch (_) { return null; }
}

function unwrapRows(payload, depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "string") {
    try { return unwrapRows(JSON.parse(payload), depth + 1); } catch (_) { return null; }
  }
  if (!payload || typeof payload !== "object") return null;
  const keys = Object.keys(payload);
  const numeric = keys.filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
  if (numeric.length && (numeric.length === keys.length || "length" in payload || "size" in payload)) {
    return numeric.map((key) => payload[key]);
  }
  for (const key of ["object", "episodes", "results", "items", "data", "body", "value", "content", "json"]) {
    if (!(key in payload)) continue;
    const found = unwrapRows(payload[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function getScarletMeta(inputId) {
  const url = `${CATALOG_BASE}/meta/series/${encodeURIComponent(inputId)}.json`;
  const response = await safeFetch(url, { headers: { Accept: "application/json" } });
  if (!response) return { meta: null, error: "catalog request failed" };
  if (!response.ok) return { meta: null, error: `catalog HTTP ${response.status}` };
  const payload = await readJsonResponse(response);
  return payload && payload.meta ? { meta: payload.meta, error: "" } : { meta: null, error: "catalog meta missing" };
}

async function getTmdbMeta(inputId, mediaType) {
  const raw = clean(inputId).replace(/^tmdb:/i, "");
  const kind = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  let tmdbId = null;

  if (/^\d+$/.test(raw)) tmdbId = Number(raw);
  else if (/^tt\d+$/i.test(raw)) {
    const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const findResponse = await safeFetch(findUrl, { headers: { Accept: "application/json" } });
    if (!findResponse || !findResponse.ok) return { meta: null, error: "TMDB IMDb lookup failed" };
    const found = await readJsonResponse(findResponse);
    const rows = kind === "movie" ? found && found.movie_results : found && found.tv_results;
    if (Array.isArray(rows) && rows[0] && rows[0].id) tmdbId = Number(rows[0].id);
  }

  if (!tmdbId) return { meta: null, error: `unsupported id ${inputId}` };
  const detailsUrl = `https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const response = await safeFetch(detailsUrl, { headers: { Accept: "application/json" } });
  if (!response || !response.ok) return { meta: null, error: `TMDB ${kind} lookup failed for ${tmdbId}` };
  const data = await readJsonResponse(response);
  const name = clean(data && (data.name || data.title || data.original_name || data.original_title));
  if (!name) return { meta: null, error: `TMDB title missing for ${tmdbId}` };
  return { meta: { name }, error: "" };
}

function directHentaiTvSlug(inputId) {
  const raw = clean(inputId);
  return /^htv-/i.test(raw) ? raw.replace(/^htv-/i, "") : "";
}

async function getInputMeta(inputId, mediaType) {
  const raw = clean(inputId);
  if (/^(mal|anilist|sp):/i.test(raw)) return getScarletMeta(raw);
  if (/^(tmdb:)?\d+$/i.test(raw) || /^tt\d+$/i.test(raw)) return getTmdbMeta(raw, mediaType);
  return { meta: null, error: `unsupported id ${inputId}` };
}

function rowsFromWpEpisodes(title, episodes) {
  const grouped = new Map();
  for (const item of episodes || []) {
    const slug = clean(item && item.slug);
    const rendered = decodeHtml(item && item.title && item.title.rendered || "");
    const link = clean(item && item.link);
    const linkSlug = (link.match(/\/hentai\/([^/?#]+)/i) || [])[1] || "";
    const effectiveSlug = slug || linkSlug;
    if (!effectiveSlug) continue;
    const episodeNumber = parseEpisodeNumber(effectiveSlug) || parseEpisodeNumber(rendered);
    const seriesTitle = cleanSeriesTitle(rendered) || slugSeriesTitle(effectiveSlug);
    if (!seriesTitle || !episodeNumber) continue;
    const key = normalize(seriesTitle);
    if (!grouped.has(key)) grouped.set(key, { title: seriesTitle, episodes: {}, score: scoreTitle(title, seriesTitle), source: "wp" });
    grouped.get(key).episodes[episodeNumber] = effectiveSlug;
  }
  return [...grouped.values()].filter((item) => item.score >= 0.40).sort((a, b) => b.score - a.score);
}

async function searchWp(title) {
  const endpoint = `${HENTAITV_BASE}/wp-json/wp/v2/episodes?search=${encodeURIComponent(title)}&per_page=10`;
  const response = await safeFetch(endpoint, { headers: { ...browserHeaders(), Accept: "application/json,text/plain,*/*" } });
  if (!response || !response.ok) return [];
  const payload = await readJsonResponse(response);
  const rows = unwrapRows(payload);
  return rows ? rowsFromWpEpisodes(title, rows) : [];
}

async function searchHtml(title) {
  const url = `${HENTAITV_BASE}/?s=${encodeURIComponent(title)}`;
  const response = await safeFetch(url, { redirect: "follow", headers: { ...browserHeaders(), Cookie: "inter=1" } });
  if (!response || !response.ok) return [];
  const html = await readText(response);
  if (!html) return [];

  const matches = [];
  const seen = new Set();
  const re = /href=["'](?:https?:\/\/hentai\.tv)?\/hentai\/([^"'/?#]+)\/?["']/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const slug = clean(match[1]);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const episodeNumber = parseEpisodeNumber(slug);
    if (!episodeNumber) continue;
    const seriesTitle = slugSeriesTitle(slug);
    const score = scoreTitle(title, seriesTitle);
    if (score >= 0.40) matches.push({ title: seriesTitle, episodes: { [episodeNumber]: slug }, score, source: "html" });
  }

  const grouped = new Map();
  for (const item of matches) {
    const key = normalize(item.title);
    if (!grouped.has(key)) grouped.set(key, { title: item.title, episodes: {}, score: item.score, source: "html" });
    Object.assign(grouped.get(key).episodes, item.episodes);
    grouped.get(key).score = Math.max(grouped.get(key).score, item.score);
  }
  return [...grouped.values()].sort((a, b) => b.score - a.score);
}

async function searchHentaiTv(title) {
  const wp = await searchWp(title);
  if (wp.length) return { rows: wp, source: "wp", error: "" };
  const html = await searchHtml(title);
  if (html.length) return { rows: html, source: "html", error: "" };
  return { rows: [], source: "none", error: "no HentaiTV match from WP or HTML search" };
}

function titleQueries(name) {
  const raw = clean(name), out = [];
  function add(value) { value = clean(value); if (value && !out.includes(value)) out.push(value); }
  add(raw);
  add(raw.split(/[:–—]/)[0]);
  const words = raw.replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) add(words.slice(0, Math.min(5, words.length)).join(" "));
  if (words.length) add(words[0]);
  return out;
}

async function resolveEpisodeSlug(meta, episode) {
  let lastError = "";
  for (const query of titleQueries(meta.name)) {
    const result = await searchHentaiTv(query);
    if (result.error) lastError = result.error;
    for (const item of result.rows) {
      if (item.episodes && item.episodes[episode]) {
        return { slug: item.episodes[episode], query, match: item.title, source: result.source, error: "" };
      }
    }
  }
  return { slug: null, query: titleQueries(meta.name).join(" | "), match: "", source: "none", error: lastError || "no title/episode match" };
}

function decodeBase64(value) {
  try {
    let text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    if (typeof atob === "function") return atob(text);
  } catch (_) {}
  return "";
}

function directMediaFromHtml(html) {
  if (!html) return [];
  const normalized = String(html).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const found = [];
  const patterns = [
    /<source[^>]+src=["']([^"']+)["']/gi,
    /file["']?\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
    /source["']?\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
    /["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      const url = decodeHtml(match[1]);
      if (/^https?:\/\//i.test(url) && !found.includes(url) && !/thumbnail/i.test(url)) found.push(url);
    }
  }
  return found;
}

async function nhplayerStreams(html) {
  const out = [];
  const idMatch = String(html || "").match(/nhplayer\.com\/v\/([a-zA-Z0-9_-]+)/i);
  if (!idMatch) return out;
  const nhUrl = `https://nhplayer.com/v/${idMatch[1]}/`;
  const response = await safeFetch(nhUrl, { redirect: "follow", headers: browserHeaders(`${HENTAITV_BASE}/`) });
  if (!response || !response.ok) return out;
  const nhHtml = await readText(response);
  if (!nhHtml) return out;

  for (const url of directMediaFromHtml(nhHtml)) if (!out.includes(url)) out.push(url);

  const dataIdMatch = nhHtml.match(/data-id=["']([^"']+)["']/i);
  if (dataIdMatch) {
    const dataId = decodeHtml(dataIdMatch[1]);
    const uMatch = dataId.match(/(?:^|[?&])u=([^&]+)/i) || dataId.match(/u=([^&]+)/i);
    if (uMatch) {
      const decoded = decodeBase64(decodeURIComponent(uMatch[1]));
      if (/^https?:\/\//i.test(decoded) && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(decoded) && !out.includes(decoded)) out.push(decoded);
    }
  }
  return out;
}

async function verifyR2(url) {
  const headers = { Referer: "https://nhplayer.com/", Origin: "https://nhplayer.com" };
  const head = await safeFetch(url, { method: "HEAD", redirect: "follow", headers });
  if (head && head.ok) return true;
  const ranged = await safeFetch(url, { method: "GET", redirect: "follow", headers: { ...headers, Range: "bytes=0-0" } });
  return !!(ranged && (ranged.ok || ranged.status === 206));
}

async function resolveStreamsFromSlug(slug) {
  const pageUrl = `${HENTAITV_BASE}/hentai/${slug}`;
  const page = await safeFetch(pageUrl, { redirect: "follow", headers: { ...browserHeaders(), Cookie: "inter=1" } });
  let html = "";
  if (page && page.ok) html = await readText(page);

  if (html) {
    const direct = directMediaFromHtml(html);
    if (direct.length) return { streams: direct.map(toStream), error: "" };

    const nh = await nhplayerStreams(html);
    if (nh.length) return { streams: nh.map(toStream), error: "" };

    const iframeSource = html.match(/iframe[^>]+src=["']([^"']+source=[^"']+)["']/i);
    if (iframeSource) {
      const sourceMatch = decodeHtml(iframeSource[1]).match(/[?&]source=([^&]+)/i);
      if (sourceMatch) {
        try {
          const url = decodeURIComponent(sourceMatch[1]);
          if (/^https?:\/\//i.test(url) && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url)) return { streams: [toStream(url)], error: "" };
        } catch (_) {}
      }
    }
  }

  for (const videoSlug of videoSlugVariations(slug)) {
    const url = `https://r2.1hanime.com/${videoSlug}.mp4`;
    if (await verifyR2(url)) return { streams: [toStream(url)], error: "" };
  }

  return {
    streams: [],
    error: `no media source; page HTTP ${page ? page.status : "failed"} • html=${html ? "yes" : "no"} • nhplayer=${/nhplayer\.com/i.test(html) ? "yes" : "no"}`
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const ep = Number.isInteger(Number(episode)) && Number(episode) > 0 ? Number(episode) : 1;
    const directSlug = directHentaiTvSlug(inputId);
    if (directSlug) {
      const playback = await resolveStreamsFromSlug(directSlug);
      if (!playback.streams.length) return [diag("PLAYBACK", `${playback.error} • directSlug=${directSlug}`)];
      return playback.streams;
    }

    const input = await getInputMeta(inputId, mediaType);
    if (!input.meta || !input.meta.name) return [diag("ID", `${input.error || "metadata unavailable"} • input=${inputId} type=${mediaType}`)];

    const resolved = await resolveEpisodeSlug(input.meta, ep);
    if (!resolved.slug) return [diag("MATCH", `${resolved.error} • title=${input.meta.name} • ep=${ep} • queries=${resolved.query}`)];

    const playback = await resolveStreamsFromSlug(resolved.slug);
    if (!playback.streams.length) return [diag("PLAYBACK", `${playback.error} • slug=${resolved.slug} • match=${resolved.match} • search=${resolved.source}`)];
    return playback.streams;
  } catch (error) {
    return [diag("ERROR", clean(error && error.message ? error.message : error) || "unexpected provider failure")];
  }
}

module.exports = { getStreams };
