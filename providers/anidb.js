// SPDX-License-Identifier: GPL-3.0-only
"use strict";

// Limitless AniDB 1.0.8
// Live AniDB.app identifiers are authoritative. Explicit season titles are
// resolved before external ID mappings so split/absolute episode orders cannot
// silently collapse a later anime season back onto the base record.

const NAME = "AniDB";
const BASE_URL = "https://anidb.app";
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const MAP = "https://id-mapping-api-malid.hf.space/api/resolve";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "application/json, text/plain, */*"
};

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (!value) continue;
    const text = String(value).trim();
    const key = normalizeTitle(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function roman(number) {
  const n = Number(number);
  const table = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return Number.isInteger(n) && n > 0 && n < table.length ? table[n] : String(number || "");
}

function ordinal(number) {
  const n = Number(number);
  if (!Number.isFinite(n)) return String(number || "");
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absolutize(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return BASE_URL + value;
  return BASE_URL + "/" + value;
}

function deduplicateStreams(streams) {
  const seen = new Set();
  return (streams || []).filter(stream => {
    if (!stream || !stream.url) return false;
    const key = `${stream.url}|${stream.language || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchText(url, headers) {
  try {
    const response = await fetch(url, { headers: headers || { "User-Agent": USER_AGENT } });
    if (!response || !response.ok) {
      console.log(`[${NAME}] HTTP ${response ? response.status : "?"}: ${url}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.log(`[${NAME}] ${error && error.message ? error.message : error}`);
    return null;
  }
}

async function fetchJson(url, headers, options) {
  try {
    const response = await fetch(url, {
      ...(options || {}),
      headers: { ...(headers || { "User-Agent": USER_AGENT }), ...((options && options.headers) || {}) }
    });
    if (!response || !response.ok) {
      console.log(`[${NAME}] HTTP ${response ? response.status : "?"}: ${url}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.log(`[${NAME}] ${error && error.message ? error.message : error}`);
    return null;
  }
}

function mediaType(value) {
  return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

async function resolveTmdbId(inputId, type) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;

  const data = await fetchJson(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_KEY}&external_source=imdb_id`,
    { "Accept": "application/json" }
  );
  const list = type === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
}

async function fetchTmdbInfo(tmdbId, type) {
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=external_ids,alternative_titles`,
    { "Accept": "application/json" }
  );
  if (!data) return null;

  const alternativeBlock = data.alternative_titles || {};
  const alternatives = type === "movie" ? alternativeBlock.titles : alternativeBlock.results;

  return {
    title: type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name),
    original: type === "movie" ? data.original_title : data.original_name,
    imdb: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || null,
    genres: Array.isArray(data.genres) ? data.genres.map(item => item.id) : [],
    alternatives: Array.isArray(alternatives)
      ? alternatives.map(item => item && item.title).filter(Boolean).slice(0, 12)
      : []
  };
}

async function mapMalEpisode(imdbId, season, episode) {
  if (!imdbId) return null;
  return await fetchJson(
    `${MAP}?id=${encodeURIComponent(imdbId)}&s=${encodeURIComponent(season)}&e=${encodeURIComponent(episode)}`,
    { "Accept": "application/json" }
  );
}

async function fetchJikanAliases(malId) {
  if (!malId) return [];
  const data = await fetchJson(
    `https://api.jikan.moe/v4/anime/${encodeURIComponent(malId)}`,
    { "Accept": "application/json" }
  );
  const anime = data && data.data;
  if (!anime) return [];
  return unique([
    anime.title,
    anime.title_english,
    anime.title_japanese,
    ...(Array.isArray(anime.title_synonyms) ? anime.title_synonyms : []),
    ...(Array.isArray(anime.titles) ? anime.titles.map(item => item && item.title) : [])
  ]);
}

async function fetchAniListAliases(malId) {
  if (!malId) return [];
  const query = `query($idMal:Int){Media(idMal:$idMal,type:ANIME){title{english romaji native} synonyms}}`;
  const data = await fetchJson(
    "https://graphql.anilist.co",
    { "Content-Type": "application/json", "Accept": "application/json" },
    {
      method: "POST",
      body: JSON.stringify({ query, variables: { idMal: Number(malId) } })
    }
  );
  const media = data && data.data && data.data.Media;
  if (!media) return [];
  return unique([
    media.title && media.title.english,
    media.title && media.title.romaji,
    media.title && media.title.native,
    ...(Array.isArray(media.synonyms) ? media.synonyms : [])
  ]);
}

function buildGenericAliases(tmdb) {
  return unique([
    tmdb && tmdb.title,
    tmdb && tmdb.original,
    ...(tmdb && Array.isArray(tmdb.alternatives) ? tmdb.alternatives : [])
  ]).slice(0, 14);
}

function buildGeneratedSeasonAliases(tmdb, season, type) {
  if (type !== "tv" || Number(season) <= 1 || !tmdb || !tmdb.title) return [];
  const bases = unique([tmdb.title, tmdb.original, ...(tmdb.alternatives || [])]).slice(0, 6);
  const out = [];
  for (const base of bases) {
    out.push(`${base} Season ${season}`);
    out.push(`${base} ${ordinal(season)} Season`);
    out.push(`${base} ${roman(season)}`);
  }
  return unique(out).slice(0, 18);
}

async function buildMappedAliases(mapping) {
  const malId = mapping && mapping.mal_id ? Number(mapping.mal_id) : null;
  const metadataAliases = malId
    ? await Promise.all([fetchJikanAliases(malId), fetchAniListAliases(malId)])
    : [[], []];
  return unique([
    mapping && mapping.anime_title,
    ...metadataAliases[0],
    ...metadataAliases[1]
  ]).slice(0, 18);
}

function parseAnimeLinks(html) {
  if (!html) return [];
  const results = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["'](?:https?:\/\/anidb\.app)?\/anime\/([a-z0-9-]+?)-(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const inner = match[3] || "";
    const alt = inner.match(/<img\b[^>]*alt=["']([^"']+)["']/i);
    const titleAttr = match[0].match(/\btitle=["']([^"']+)["']/i);
    const p = inner.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const title = stripHtml(
      (alt && alt[1]) ||
      (titleAttr && titleAttr[1]) ||
      (p && p[1]) ||
      match[1].replace(/-/g, " ")
    );
    const item = { slug: match[1], numId: match[2], title };
    if (!item.title || seen.has(item.numId)) continue;
    seen.add(item.numId);
    results.push(item);
  }

  return results;
}

async function searchAnime(query) {
  const urls = [
    BASE_URL + "/browse?q=" + encodeURIComponent(query),
    BASE_URL + "/search/suggestions?q=" + encodeURIComponent(query)
  ];
  const merged = [];
  const seen = new Set();

  for (const url of urls) {
    const html = await fetchText(url, HEADERS);
    for (const item of parseAnimeLinks(html)) {
      if (seen.has(item.numId)) continue;
      seen.add(item.numId);
      merged.push(item);
    }
  }

  return merged;
}

async function findExactCandidate(aliases) {
  for (const alias of aliases || []) {
    const key = normalizeTitle(alias);
    if (!key) continue;
    const results = await searchAnime(alias);
    const exact = results.find(item => normalizeTitle(item.title) === key);
    if (exact) return { ...exact, matchedAlias: alias };
  }
  return null;
}

async function findSeasonCandidateFromBroadSearch(baseAliases, seasonAliases) {
  const targetMap = new Map();
  for (const alias of seasonAliases || []) {
    const key = normalizeTitle(alias);
    if (key && !targetMap.has(key)) targetMap.set(key, alias);
  }
  if (!targetMap.size) return null;

  for (const baseAlias of baseAliases || []) {
    const results = await searchAnime(baseAlias);
    for (const candidate of results) {
      const key = normalizeTitle(candidate.title);
      if (!targetMap.has(key)) continue;
      return { ...candidate, matchedAlias: targetMap.get(key), broadSeasonMatch: true };
    }
  }
  return null;
}

async function findSeasonCandidateFromRelations(baseAliases, seasonAliases) {
  const targetMap = new Map();
  for (const alias of seasonAliases || []) {
    const key = normalizeTitle(alias);
    if (key && !targetMap.has(key)) targetMap.set(key, alias);
  }
  if (!targetMap.size) return null;

  for (const baseAlias of baseAliases || []) {
    const results = await searchAnime(baseAlias);
    const baseKey = normalizeTitle(baseAlias);
    const baseCandidate = results.find(item => normalizeTitle(item.title) === baseKey);
    if (!baseCandidate) continue;

    const html = await fetchText(`${BASE_URL}/anime/${baseCandidate.slug}-${baseCandidate.numId}`, HEADERS);
    if (!html) continue;

    for (const candidate of parseAnimeLinks(html)) {
      if (String(candidate.numId) === String(baseCandidate.numId)) continue;
      const key = normalizeTitle(candidate.title || candidate.slug.replace(/-/g, " "));
      if (!targetMap.has(key)) continue;
      return {
        ...candidate,
        title: candidate.title || targetMap.get(key),
        matchedAlias: targetMap.get(key),
        relationSeasonMatch: true
      };
    }
  }
  return null;
}

function rejectGenericSeasonCandidate(candidate, genericAliases) {
  if (!candidate) return null;
  const genericKeys = new Set((genericAliases || []).map(normalizeTitle));
  return genericKeys.has(normalizeTitle(candidate.title)) ? null : candidate;
}

async function resolveAnimeIdentity(tmdb, mapping, season, type) {
  const seasonNumber = Number(season) || 1;
  const genericAliases = buildGenericAliases(tmdb);

  if (type === "tv" && seasonNumber > 1) {
    const generatedAliases = buildGeneratedSeasonAliases(tmdb, seasonNumber, type);

    // 1) Explicit live season title wins. Do not MAL-verify this path: an exact
    // AniDB title like "[Oshi No Ko] Season 2" is safer than cross-database
    // numbering for shows whose TMDB/IMDb/TVDB season orders disagree.
    const generated = await findExactCandidate(generatedAliases);
    if (generated) return { ...generated, identitySource: "live-explicit-season" };

    // 2) Mapping metadata can add alternate season names, but never allow a
    // generic/base title to satisfy a later-season request.
    const mappedAliases = await buildMappedAliases(mapping);
    const mapped = rejectGenericSeasonCandidate(
      await findExactCandidate(mappedAliases),
      genericAliases
    );
    if (mapped) return { ...mapped, identitySource: "live-mapped-season" };

    const seasonAliases = unique([...generatedAliases, ...mappedAliases]);
    const broad = await findSeasonCandidateFromBroadSearch(genericAliases, seasonAliases);
    if (broad) return { ...broad, identitySource: "live-broad-season" };

    const relation = await findSeasonCandidateFromRelations(genericAliases, seasonAliases);
    if (relation) return { ...relation, identitySource: "live-relation-season" };

    return null;
  }

  const mappedAliases = await buildMappedAliases(mapping);
  const mapped = await findExactCandidate(mappedAliases);
  if (mapped) return { ...mapped, identitySource: "live-mapped" };

  const generic = await findExactCandidate(genericAliases);
  return generic ? { ...generic, identitySource: "live-generic" } : null;
}

async function fetchEpisodes(animeId) {
  const json = await fetchJson(
    BASE_URL + "/api/frontend/anime/" + animeId + "/episodes",
    HEADERS
  );
  if (!json) return [];
  return Array.isArray(json) ? json : (Array.isArray(json.episodes) ? json.episodes : []);
}

function findEpisodeId(episodes, episodeNumber) {
  for (const item of episodes || []) {
    if (String(item && item.number) === String(episodeNumber)) return item.id;
  }
  return null;
}

async function resolveEpisodeId(animeId, requestedEpisode, mapping) {
  const episodes = await fetchEpisodes(animeId);
  if (!episodes.length) {
    console.log(`[${NAME}] Live AniDB id ${animeId} returned 0 episodes`);
    return null;
  }

  const tries = unique([
    String(requestedEpisode),
    mapping && mapping.mal_episode != null ? String(mapping.mal_episode) : null,
    mapping && mapping.episode != null ? String(mapping.episode) : null
  ]);

  for (const number of tries) {
    const id = findEpisodeId(episodes, number);
    if (id) return id;
  }

  console.log(
    `[${NAME}] Episode miss on live id ${animeId}. Requested ${requestedEpisode}; ` +
    `available=${episodes.slice(0, 30).map(item => item && item.number).join(",")}`
  );
  return null;
}

async function fetchEpisodeLanguages(episodeId) {
  const data = await fetchJson(
    BASE_URL + "/api/frontend/episode/" + episodeId + "/languages",
    HEADERS
  );
  if (!data) return [];
  return Array.isArray(data) ? data : (Array.isArray(data.languages) ? data.languages : []);
}

function normalizeHlsUrl(value) {
  return String(value || "")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .trim();
}

function extractHlsUrl(html) {
  if (!html) return "";
  const patterns = [
    /(?:file\s*:\s*|source\s*=\s*)["']([^"']+\.m3u8(?:\?[^"']*)?)["']/i,
    /["'](?:file|src|source)["']\s*:\s*["']([^"']+\.m3u8(?:\?[^"']*)?)["']/i,
    /["']((?:https?:)?\/\/[^"']+\.m3u8(?:\?[^"']*)?)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return normalizeHlsUrl(match[1]);
  }
  return "";
}

function classifyLanguage(language) {
  const code = String(
    language && (language.code || language.lang || language.language || language.name) || ""
  ).toLowerCase().trim();
  if (["eng", "en", "english"].includes(code)) return { isDub: true, name: "English", tag: "DUB" };
  if (["jpn", "ja", "jp", "japanese"].includes(code)) return { isDub: false, name: "Japanese", tag: "HARDSUB" };
  return null;
}

async function resolveStreamFromLanguage(language, context) {
  const lang = classifyLanguage(language);
  if (!lang) return null;

  const direct = normalizeHlsUrl(
    language && (language.stream_url || language.streamUrl || language.hls_url || language.hlsUrl || "")
  );
  let streamUrl = /\.m3u8(?:$|\?)/i.test(direct) ? direct : "";
  const embedUrl = absolutize(language && (language.embed_url || language.embedUrl || language.url || ""));

  if (!streamUrl) {
    if (!embedUrl) return null;
    const html = await fetchText(embedUrl, {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    });
    streamUrl = extractHlsUrl(html);
  }

  if (!streamUrl) return null;
  if (streamUrl.startsWith("//")) streamUrl = "https:" + streamUrl;

  return {
    name: `${NAME} | 1080p [${lang.tag}]`,
    title: `${context.title} • ${context.label} • ${lang.isDub ? "English Dub" : "Japanese Hard Sub"}`,
    url: streamUrl,
    quality: "1080p",
    provider: NAME,
    type: "m3u8",
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": embedUrl || BASE_URL + "/"
    },
    language: lang.name,
    subtitles: []
  };
}

async function getStreams(inputId, inputMediaType, season, episode) {
  try {
    const type = mediaType(inputMediaType);
    const tmdbId = await resolveTmdbId(inputId, type);
    if (!tmdbId) return [];

    const tmdb = await fetchTmdbInfo(tmdbId, type);
    if (!tmdb || !tmdb.title) return [];
    if (tmdb.genres.length && !tmdb.genres.includes(16)) return [];

    const requestedSeason = type === "movie" ? 1 : (Number.parseInt(season, 10) || 1);
    const requestedEpisode = type === "movie" ? 1 : (Number.parseFloat(episode) || 1);
    const mapping = await mapMalEpisode(tmdb.imdb, requestedSeason, requestedEpisode);

    console.log(
      `[${NAME}] request ${tmdb.title} S${requestedSeason}E${requestedEpisode}` +
      ` mapMAL=${mapping && mapping.mal_id ? mapping.mal_id : "?"}` +
      ` mapTitle=${mapping && mapping.anime_title ? mapping.anime_title : "?"}` +
      ` mapEp=${mapping && mapping.mal_episode != null ? mapping.mal_episode : "?"}`
    );

    const candidate = await resolveAnimeIdentity(tmdb, mapping, requestedSeason, type);
    if (!candidate) {
      console.log(`[${NAME}] No season-safe live match for ${tmdb.title} S${requestedSeason}E${requestedEpisode}`);
      return [];
    }

    console.log(
      `[${NAME}] matched ${candidate.title} id=${candidate.numId}` +
      ` source=${candidate.identitySource || "live"}` +
      ` alias=${candidate.matchedAlias || "?"}`
    );

    const episodeId = await resolveEpisodeId(candidate.numId, requestedEpisode, mapping);
    if (!episodeId) return [];

    const languages = await fetchEpisodeLanguages(episodeId);
    if (!languages.length) {
      console.log(`[${NAME}] AniDB episode ${episodeId} returned no languages`);
      return [];
    }

    const context = {
      title: candidate.title || tmdb.title,
      label: type === "movie" ? "Movie" : `S${requestedSeason}E${requestedEpisode}`
    };

    const streams = await Promise.all(
      languages.map(item => resolveStreamFromLanguage(item, context).catch(() => null))
    );

    const finalStreams = deduplicateStreams(streams.filter(Boolean));
    console.log(`[${NAME}] Resolved ${finalStreams.length} stream(s) from live id ${candidate.numId}`);
    return finalStreams;
  } catch (error) {
    console.log(`[${NAME}] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
