"use strict";

// Shared Nexus anime identity resolver.
// MAL/Jikan and AniList remain the preferred anime-native identity sources.
// If those upstream APIs are unavailable or leave only one usable provider alias,
// use Re:ANIME's reachable catalog as an exact TMDB/IMDb-verified alias bridge,
// then retain TMDB/IMDb aliases as the final safety fallback.
// Non-anime titles remain on the underlying TMDB/IMDb-only path.

const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/a6e9abb6318fdd68a86a0a561f396599de7a952e/custom/providers/anime-identity.js";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
let coreCache = null;

function uniq(values) {
  const out = [], seen = new Set();
  for (const value of values || []) {
    const text = String(value == null ? "" : value).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalize(value) {
  return String(value || "").toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableAliases(values) {
  return uniq((values || []).map(normalize).filter(Boolean));
}

async function fetchJson(url, options) {
  try {
    const response = await fetch(url, {
      ...(options || {}),
      headers: {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        ...((options && options.headers) || {})
      },
      skipSizeCheck: true
    });
    if (!response || !response.ok) return null;
    return JSON.parse(String(await response.text() || "{}"));
  } catch (_) {
    return null;
  }
}

async function loadCore() {
  if (coreCache && typeof coreCache.resolveAnimeIdentity === "function") return coreCache;
  try {
    const response = await fetch(CORE_URL, { skipSizeCheck:true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.resolveAnimeIdentity !== "function") return null;
    coreCache = exported;
    return exported;
  } catch (_) {
    return null;
  }
}

function searchResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function candidateSlug(candidate) {
  return String(candidate && (candidate.anime_id || candidate.animeId || candidate.slug || candidate.id) || "").trim();
}

function collectTitles(value, depth) {
  if (depth > 3 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) {
    let out = [];
    for (const item of value) out = out.concat(collectTitles(item, depth + 1));
    return out;
  }
  if (typeof value !== "object") return [];
  let out = [];
  const keys = [
    "english", "romaji", "native", "userPreferred", "title", "name",
    "title_english", "english_title", "title_romaji", "romaji_title",
    "alternative_title", "alternative_titles", "synonyms", "titles"
  ];
  for (const key of keys) if (value[key] != null) out = out.concat(collectTitles(value[key], depth + 1));
  return out;
}

async function reanimeApi(path) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}${path}`, { headers:{ "Referer":`${base}/home` } });
    if (data) return data;
  }
  return null;
}

async function reanimeBridge(identity) {
  if (!identity || !identity.isAnime) return null;
  const requestedTmdb = Number(identity.tmdbId || 0) || 0;
  const requestedImdb = String(identity.imdbId || "").toLowerCase();
  const terms = uniq([].concat(identity.aliases || []).concat(identity.fallbackAliases || []).concat([identity.title, identity.originalTitle])).slice(0, 8);
  const seen = new Set();

  for (const term of terms) {
    if (!normalize(term)) continue;
    const search = await reanimeApi(`/api/v1/search?q=${encodeURIComponent(term)}&limit=15&offset=0`);
    for (const candidate of searchResults(search)) {
      const slug = candidateSlug(candidate);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const detail = await reanimeApi(`/api/v1/anime/${encodeURIComponent(slug)}`);
      if (!detail) continue;

      const detailTmdb = Number(detail.themoviedb_id || detail.tmdb_id || detail.tmdbId || 0) || 0;
      const detailImdb = String(detail.imdb_id || detail.imdbId || "").toLowerCase();
      const exactId = (requestedTmdb && detailTmdb === requestedTmdb) || (requestedImdb && detailImdb === requestedImdb);
      if (!exactId) continue;

      const aliases = uniq(collectTitles(candidate, 0).concat(collectTitles(detail, 0)));
      const anilistId = Number(detail.anilist_id || detail.anilistId || candidate.anilist_id || candidate.anilistId || 0) || null;
      const malId = Number(detail.mal_id || detail.malId || candidate.mal_id || candidate.malId || 0) || null;
      if (!aliases.length && !anilistId && !malId) continue;
      return { aliases, anilistId, malId, slug };
    }
  }
  return null;
}

async function resolveAnimeIdentity(inputId, mediaType, season, episode, tmdbApiKey) {
  const core = await loadCore();
  if (!core) return null;
  const base = await core.resolveAnimeIdentity(inputId, mediaType, season, episode, tmdbApiKey);
  if (!base || !base.isAnime) return base;

  const currentAnimeAliases = Array.isArray(base.animeAliases) ? base.animeAliases : [];
  if (usableAliases(currentAnimeAliases).length >= 2) return base;

  const bridge = await reanimeBridge(base);
  if (!bridge) return base;

  const animeAliases = uniq(currentAnimeAliases.concat(bridge.aliases || []));
  const aliases = uniq(animeAliases.concat(base.aliases || []).concat(base.fallbackAliases || [])).slice(0, 32);
  return {
    ...base,
    aliases,
    animeAliases,
    malId: base.malId || bridge.malId || null,
    anilistId: base.anilistId || bridge.anilistId || null,
    identitySource: base.malId || base.anilistId
      ? `${base.identitySource || "anime"}+reanime-bridge`
      : "reanime-bridge"
  };
}

module.exports = { resolveAnimeIdentity };
