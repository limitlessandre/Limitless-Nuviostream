"use strict";

const PROVIDER_NAME = "Re:ANIME";
const BASE_PROVIDER_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/reanime.js";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

let cachedBase = null;

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...BASE_HEADERS, ...(options.headers || {}) },
      skipSizeCheck: true
    });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function loadBase() {
  if (cachedBase && typeof cachedBase.getStreams === "function") return cachedBase;
  try {
    const response = await fetch(BASE_PROVIDER_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const localRequire = function(name) { throw new Error(`Unsupported nested require: ${name}`); };
    const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
    const exported = factory(mod, mod.exports, localRequire) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedBase = exported;
    return cachedBase;
  } catch (_) {
    return null;
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return [value.english, value.romaji, value.native, value.userPreferred]
      .filter(Boolean)
      .join(" ");
  }
  return String(value);
}

function slugFromCandidate(candidate) {
  return String(candidate && (candidate.anime_id || candidate.animeId || candidate.slug || candidate.id) || "").trim();
}

function searchResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function explicitFalse(value) {
  return value === false || value === 0 || String(value).toLowerCase() === "false" || String(value) === "0";
}

async function resolveTmdbId(inputId, type) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const list = type === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function getTmdbIdentity(tmdbId, type, season, episode) {
  if (type === "movie") {
    const movie = await fetchJson(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
    if (!movie) return null;
    return {
      primary: movie.title || movie.original_title || "",
      original: movie.original_title || movie.title || "",
      context: movie.title || movie.original_title || ""
    };
  }

  const show = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
  if (!show) return null;
  const showTitle = show.name || show.original_name || "";
  const originalTitle = show.original_name || show.name || "";

  if (Number(season) === 0) {
    const special = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/0/episode/${encodeURIComponent(String(episode))}?api_key=${TMDB_API_KEY}`);
    if (special && special.name) {
      return {
        primary: special.name,
        original: special.name,
        showTitle,
        originalShowTitle: originalTitle,
        context: special.name
      };
    }
  }

  return {
    primary: showTitle,
    original: originalTitle,
    showTitle,
    originalShowTitle: originalTitle,
    context: showTitle
  };
}

async function searchReAnime(term) {
  for (const base of REANIME_DOMAINS) {
    for (const endpoint of ["/api/v1/search", "/api/search"]) {
      const data = await fetchJson(`${base}${endpoint}?q=${encodeURIComponent(term)}&limit=15&offset=0`, {
        headers: { "Referer": `${base}/home` }
      });
      const results = searchResults(data);
      if (results.length) return results;
    }
  }
  return [];
}

async function getDetail(slug) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}/api/v1/anime/${encodeURIComponent(slug)}`, {
      headers: { "Referer": `${base}/home` }
    });
    if (data) return data;
  }
  return null;
}

function significantTokens(value) {
  const stop = new Set(["the", "and", "episode", "special", "season", "part", "cour"]);
  return normalize(value).split(" ").filter(token => token.length >= 4 && !stop.has(token));
}

function scoreCandidate(candidate, identity, isSpecial) {
  const hay = normalize([
    titleText(candidate && candidate.title),
    candidate && candidate.name,
    candidate && candidate.english_title,
    candidate && candidate.romaji_title,
    candidate && candidate.alternative_title,
    candidate && candidate.anime_id,
    candidate && candidate.slug
  ].filter(Boolean).join(" "));
  if (!hay) return 0;

  if (isSpecial) {
    const specialTokens = significantTokens(identity.primary);
    if (!specialTokens.length || !specialTokens.every(token => hay.includes(token))) return 0;
    let score = 80 + specialTokens.length * 5;
    for (const token of significantTokens(identity.showTitle).slice(0, 4)) if (hay.includes(token)) score += 3;
    if (/\bepisode\s*0\b|\bspecial\b|\bova\b/.test(hay)) score += 8;
    return score;
  }

  const target = normalize(identity.primary);
  const original = normalize(identity.original);
  if (target && hay === target) return 120;
  if (original && hay === original) return 115;
  if (target && hay.includes(target)) return 90;
  if (original && hay.includes(original)) return 85;

  const tokens = significantTokens(identity.primary);
  if (tokens.length && tokens.every(token => hay.includes(token))) return 70 + tokens.length;
  return 0;
}

function noEpisodeInfo(identity, candidate, detail) {
  const label = identity.context || identity.primary || titleText(candidate && candidate.title) || "Requested title";
  const status = String((detail && detail.status) || (candidate && candidate.status) || "").trim();
  const suffix = status ? ` • Source status: ${status}` : "";
  return {
    name: `${PROVIDER_NAME} • INFO • No Episode on Source`,
    title: `${label} • Re:ANIME catalog entry exists, but no playable episode is currently available${suffix}`,
    url: "https://reanime.to/favicon.ico",
    quality: "Info",
    provider: PROVIDER_NAME,
    type: "mp4",
    language: "Unavailable",
    subtitles: []
  };
}

async function metadataOnlyFallback(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [];

  const identity = await getTmdbIdentity(tmdbId, type, season, episode);
  if (!identity || !identity.primary) return [];

  const isSpecial = type !== "movie" && Number(season) === 0;
  const terms = [...new Set((isSpecial ? [
    `${identity.showTitle || ""} ${identity.primary}`.trim(),
    identity.primary,
    `${identity.originalShowTitle || ""} ${identity.primary}`.trim()
  ] : [identity.primary, identity.original]).filter(Boolean))];

  const seen = new Set();
  const ranked = [];
  for (const term of terms) {
    const results = await searchReAnime(term);
    for (const candidate of results) {
      const slug = slugFromCandidate(candidate);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const score = scoreCandidate(candidate, identity, isSpecial);
      if (score > 0) ranked.push({ candidate, slug, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  for (const match of ranked.slice(0, 5)) {
    const detail = await getDetail(match.slug);
    const candidateCannotWatch = explicitFalse(match.candidate && match.candidate.can_watch);
    const detailCannotWatch = detail && explicitFalse(detail.can_watch);
    if (candidateCannotWatch || detailCannotWatch) {
      return [noEpisodeInfo(identity, match.candidate, detail)];
    }
  }

  return [];
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const base = await loadBase();
  if (base && typeof base.getStreams === "function") {
    try {
      const normal = await base.getStreams(inputId, mediaType, season, episode);
      if (Array.isArray(normal) && normal.length) return normal;
    } catch (_) {}
  }

  try {
    return await metadataOnlyFallback(inputId, mediaType, season, episode);
  } catch (error) {
    console.log(`[Re:ANIME] metadata-only fallback: ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
