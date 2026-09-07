"use strict";

// 123MoviesIN Nexus probe v0.1.1
// Stage 1.1: exploit the site's TMDB-native /film/<tmdb>/ and /show/<tmdb>/ routes,
// verify Nuvio can reach the current domain family, expose diagnostic details directly
// in the visible row label, and follow the first discovered player candidate one level
// deeper before playback extraction is enabled.

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

function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = parseInt(limit, 10) || 180;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
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

async function fetchPage(url, referer) {
  try {
    const headers = { ...HEADERS };
    if (referer) headers.Referer = referer;
    const response = await fetch(url, { headers, redirect: "follow", skipSizeCheck: true });
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

function originOf(url) {
  const match = clean(url).match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : "";
}

function absoluteUrl(baseUrl, candidate) {
  const raw = clean(candidate).replace(/&amp;/g, "&");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = clean(baseUrl);
  const origin = originOf(base);
  if (/^\/\//.test(raw)) {
    const scheme = /^https:/i.test(base) ? "https:" : "http:";
    return scheme + raw;
  }
  if (raw.charAt(0) === "/") return origin ? origin + raw : raw;
  const withoutHash = base.split("#")[0].split("?")[0];
  const slash = withoutHash.lastIndexOf("/");
  const directory = slash >= 0 ? withoutHash.slice(0, slash + 1) : withoutHash + "/";
  return directory + raw;
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
    if (out.length >= 16) break;
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
  const sourceUrls = collectMatches(text, /<source[^>]+src=["']([^"']+)["']/gi, 1);
  const mediaUrls = collectMatches(text, /["'](https?:\/\/[^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi, 1);
  const jsMediaUrls = collectMatches(text, /(?:file|src|url)\s*[:=]\s*["'](https?:\/\/[^"']+(?:m3u8|mp4)[^"']*)["']/gi, 1);
  const playerCandidates = [];
  for (const value of iframeUrls.concat(dataSrcUrls).concat(sourceUrls)) {
    if (!playerCandidates.includes(value)) playerCandidates.push(value);
  }
  const directMedia = [];
  for (const value of mediaUrls.concat(jsMediaUrls)) {
    if (!directMedia.includes(value)) directMedia.push(value);
  }

  return {
    titleMatch,
    streamMarker,
    seasonLinks,
    playerCandidates,
    mediaUrls: directMedia,
    requested: mediaType === "movie" ? "movie" : `S${parseInt(season, 10) || 1}E${parseInt(episode, 10) || 1}`
  };
}

function diag(label, detail, displayTitle, origin) {
  const base = clean(origin) || ORIGINS[0];
  const visible = short(detail, 190);
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${visible ? ` • ${visible}` : ""}`,
    title: displayTitle || clean(detail) || `${PROVIDER_NAME} diagnostic`,
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
    const finalOrigin = originOf(page.finalUrl) || origin;

    const routeDetail = `${meta.title} • TMDB ${tmdbId} • ${analysis.requested} • ${hostOf(page.finalUrl)} • HTTP ${page.status}`;
    const playerDetail = `title=${analysis.titleMatch ? "yes" : "no"} • stream=${analysis.streamMarker ? "yes" : "no"} • players=${analysis.playerCandidates.length} • direct=${analysis.mediaUrls.length}${type === "tv" ? ` • seasons=${analysis.seasonLinks.length}` : ""}`;

    const rows = [
      diag("ROUTE OK", routeDetail, meta.title, finalOrigin),
      diag("PLAYER SCAN", playerDetail, meta.title, finalOrigin)
    ];

    if (analysis.playerCandidates.length) {
      const playerUrl = absoluteUrl(page.finalUrl, analysis.playerCandidates[0]);
      rows.push(diag("PLAYER HOST", `${hostOf(playerUrl)} • ${short(playerUrl, 120)}`, meta.title, finalOrigin));

      if (playerUrl) {
        const playerPage = await fetchPage(playerUrl, page.finalUrl);
        if (playerPage.ok && playerPage.text) {
          const playerAnalysis = analyzePage(playerPage.text, meta.title, type, season, episode);
          rows.push(diag(
            "PLAYER FETCH",
            `${hostOf(playerPage.finalUrl)} • HTTP ${playerPage.status} • nested=${playerAnalysis.playerCandidates.length} • direct=${playerAnalysis.mediaUrls.length} • stream=${playerAnalysis.streamMarker ? "yes" : "no"}`,
            meta.title,
            originOf(playerPage.finalUrl) || finalOrigin
          ));
          if (playerAnalysis.mediaUrls.length) {
            rows.push(diag("MEDIA HOST", hostOf(playerAnalysis.mediaUrls[0]), meta.title, originOf(playerPage.finalUrl) || finalOrigin));
          } else if (playerAnalysis.playerCandidates.length) {
            const nestedUrl = absoluteUrl(playerPage.finalUrl, playerAnalysis.playerCandidates[0]);
            rows.push(diag("NESTED HOST", `${hostOf(nestedUrl)} • ${short(nestedUrl, 120)}`, meta.title, originOf(playerPage.finalUrl) || finalOrigin));
          }
        } else {
          const playerFailure = playerPage.error
            ? `${hostOf(playerUrl)} • ${playerPage.error}`
            : `${hostOf(playerUrl)} • HTTP ${playerPage.status || "ERR"}`;
          rows.push(diag("PLAYER BLOCKED", playerFailure, meta.title, finalOrigin));
        }
      }
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
