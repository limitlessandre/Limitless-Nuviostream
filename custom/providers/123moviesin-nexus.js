"use strict";

// 123MoviesIN Nexus probe v0.1.0
// Stage 1: exploit the site's TMDB-native /film/<tmdb>/ and /show/<tmdb>/ routes,
// verify Nuvio can reach the current domain family, and expose compact diagnostics
// for the title page/player surface before we add playback extraction.

const PROVIDER_NAME = "123MoviesIN";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const ORIGINS = [
  "https://123moviesin.com",
  "https://123movies2.org",
  "https://123movies-fun.com"
];

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

function clean(value) {
  return String(value || "").trim();
}

function mediaTypeOf(mediaType) {
  return String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: HEADERS, skipSizeCheck: true });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: "follow", skipSizeCheck: true });
    const status = response ? response.status : 0;
    const ok = Boolean(response && response.ok);
    const text = response ? clean(await response.text()) : "";
    const finalUrl = clean(response && response.url) || url;
    return { ok, status, text, finalUrl, error: "" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      finalUrl: url,
      error: clean(error && error.message ? error.message : error)
    };
  }
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;

  const data = await fetchJson(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
  );
  const rows = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(rows) && rows[0] && rows[0].id ? parseInt(rows[0].id, 10) : null;
}

async function tmdbInfo(tmdbId, mediaType) {
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`
  );
  if (!data) return null;
  const title = mediaType === "movie"
    ? clean(data.title || data.original_title)
    : clean(data.name || data.original_name);
  return { id: tmdbId, title };
}

function slugify(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeTitle(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function hostOf(url) {
  const match = clean(url).match(/^https?:\/\/([^/]+)/i);
  return match ? match[1] : "unknown-host";
}

function pathFor(meta, mediaType) {
  const slug = slugify(meta && meta.title) || String(meta && meta.id || "title");
  return mediaType === "movie"
    ? `/film/${meta.id}/${slug}/`
    : `/show/${meta.id}/${slug}/`;
}

function collectMatches(html, regex, groupIndex) {
  const out = [];
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(html)) !== null) {
    const value = clean(match[groupIndex || 1]);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= 12) break;
  }
  return out;
}

function analyzePage(html, expectedTitle, mediaType, season, episode) {
  const text = clean(html);
  const normalized = normalizeTitle(text.replace(/<[^>]+>/g, " "));
  const titleKey = normalizeTitle(expectedTitle);
  const titleMatch = Boolean(titleKey && normalized.includes(titleKey));
  const streamMarker = /stream\s+in\s+hd|stream\s+now/i.test(text);
  const seasonLinks = collectMatches(text, /href=["']([^"']*(?:season|s\d+)[^"']*)["']/gi, 1);
  const iframeUrls = collectMatches(text, /<iframe[^>]+src=["']([^"']+)["']/gi, 1);
  const dataSrcUrls = collectMatches(text, /(?:data-src|data-url|data-link)=["']([^"']+)["']/gi, 1);
  const mediaUrls = collectMatches(text, /["'](https?:\/\/[^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi, 1);
  const playerCandidates = [];
  for (const value of iframeUrls.concat(dataSrcUrls)) {
    if (!playerCandidates.includes(value)) playerCandidates.push(value);
  }

  return {
    titleMatch,
    streamMarker,
    seasonLinks,
    playerCandidates,
    mediaUrls,
    requested: mediaType === "movie" ? "movie" : `S${parseInt(season, 10) || 1}E${parseInt(episode, 10) || 1}`
  };
}

function diag(label, detail, displayTitle, origin) {
  const base = clean(origin) || ORIGINS[0];
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}`,
    title: clean(detail) || displayTitle || `${PROVIDER_NAME} diagnostic`,
    url: `${base.replace(/\/$/, "")}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB", `Unable to resolve ${inputId} to a TMDB ${type} id`)];

  const meta = await tmdbInfo(tmdbId, type);
  if (!meta || !meta.title) return [diag("TMDB", `TMDB ${type} ${tmdbId} returned no title`)];

  const path = pathFor(meta, type);
  let lastFailure = null;

  for (const origin of ORIGINS) {
    const targetUrl = `${origin}${path}`;
    const page = await fetchPage(targetUrl);
    if (!page.ok || !page.text) {
      lastFailure = { origin, page };
      continue;
    }

    const analysis = analyzePage(page.text, meta.title, type, season, episode);
    const finalOriginMatch = clean(page.finalUrl).match(/^(https?:\/\/[^/]+)/i);
    const finalOrigin = finalOriginMatch ? finalOriginMatch[1] : origin;

    const routeDetail = `${meta.title} • TMDB ${tmdbId} • ${analysis.requested} • ${hostOf(page.finalUrl)} • HTTP ${page.status}`;
    const playerDetail = `title=${analysis.titleMatch ? "yes" : "no"} • streamMarker=${analysis.streamMarker ? "yes" : "no"} • playerCandidates=${analysis.playerCandidates.length} • directMedia=${analysis.mediaUrls.length}${type === "tv" ? ` • seasonLinks=${analysis.seasonLinks.length}` : ""}`;

    const rows = [
      diag("ROUTE OK", routeDetail, meta.title, finalOrigin),
      diag("PLAYER SCAN", playerDetail, meta.title, finalOrigin)
    ];

    if (analysis.playerCandidates.length) {
      rows.push(diag("PLAYER HOST", hostOf(analysis.playerCandidates[0]), meta.title, finalOrigin));
    }
    return rows;
  }

  if (lastFailure) {
    const detail = lastFailure.page && lastFailure.page.error
      ? `${hostOf(lastFailure.origin)} • ${lastFailure.page.error}`
      : `${hostOf(lastFailure.origin)} • HTTP ${lastFailure.page && lastFailure.page.status || "ERR"}`;
    return [diag("FETCH BLOCKED", detail, meta.title, lastFailure.origin)];
  }

  return [diag("NO SOURCE", `${meta.title} • TMDB ${tmdbId}`)];
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
