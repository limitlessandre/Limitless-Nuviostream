// SPDX-License-Identifier: GPL-3.0-only
"use strict";

// Limitless AniDB 1.0.7
// Runtime access/extraction follows the current AniDB.app frontend API behavior.
// Identity resolution intentionally uses live AniDB.app URL identifiers rather than
// a frozen catalog, because AniDB.app identifiers can be regenerated/migrated.

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
  if (value.indexOf("//") === 0) return "https:" + value;
  if (value.charAt(0) === "/") return BASE_URL + value;
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

function buildGeneratedSeasonAliases(tmdb, season, type) {
  if (type !== "tv" || Number(season) <= 1 || !tmdb || !tmdb.title) return [];
  return unique([
    `${tmdb.title} Season ${season}`,
    `${tmdb.title} ${roman(season)}`,
    `${tmdb.title} ${ordinal(season)} Season`,
    tmdb.original && `${tmdb.original} Season ${season}`,
    tmdb.original && `${tmdb.original} ${roman(season)}`
  ]);
}

async function buildMappedSeasonAliases(mapping) {
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

function buildGenericAliases(tmdb) {
  return unique([
    tmdb && tmdb.title,
    tmdb && tmdb.original,
    ...(tmdb && Array.isArray(tmdb.alternatives) ? tmdb.alternatives : [])
  ]).slice(0, 14);
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
    const p = inner.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const title = stripHtml((alt && alt[1]) || (p && p[1]) || match[1].replace(/-/g, " "));
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

async function verifyCandidateMal(candidate, malId) {
  if (!candidate || !candidate.numId || !malId) return false;
  const pageUrl = `${BASE_URL}/anime/${candidate.slug}-${candidate.numId}`;
  const html = await fetchText(pageUrl, HEADERS);
  if (!html) return false;
  const match = html.match(/myanimelist\.net\/anime\/(\d+)/i);
  return !!(match && Number(match[1]) === Number(malId));
}

async function findCandidate(aliases, malId, requireMalVerification) {
  const queued = [];
  const seenIds = new Set();

  for (const alias of aliases || []) {
    const aliasKey = normalizeTitle(alias);
    if (!aliasKey) continue;
    const results = await searchAnime(alias);

    for (const candidate of results) {
      if (!seenIds.has(candidate.numId)) {
        seenIds.add(candidate.numId);
        queued.push({ ...candidate, matchedAlias: alias });
      }
      if (normalizeTitle(candidate.title) !== aliasKey) continue;
      if (!requireMalVerification || !malId || await verifyCandidateMal(candidate, malId)) {
        return { ...candidate, matchedAlias: alias };
      }
    }
  }

  if (malId) {
    for (const candidate of queued.slice(0, 12)) {
      if (await verifyCandidateMal(candidate, malId)) return candidate;
    }
  }

  return null;
}

async function findSeasonCandidateFromBroadSearch(baseAliases, seasonAliases, malId) {
  const targets = new Map();
  for (const alias of seasonAliases || []) {
    const key = normalizeTitle(alias);
    if (key && !targets.has(key)) targets.set(key, alias);
  }
  if (!targets.size) return null;

  for (const baseAlias of baseAliases || []) {
    const results = await searchAnime(baseAlias);
    for (const candidate of results) {
      const key = normalizeTitle(candidate.title);
      if (!targets.has(key)) continue;
      if (malId && !(await verifyCandidateMal(candidate, malId))) continue;
      return { ...candidate, matchedAlias: targets.get(key), broadSeasonMatch: true };
    }
  }
  return null;
}

async function findSeasonCandidateFromBaseRelations(baseAliases, seasonAliases, malId) {
  const targets = new Map();
  for (const alias of seasonAliases || []) {
    const key = normalizeTitle(alias);
    if (key && !targets.has(key)) targets.set(key, alias);
  }
  if (!targets.size) return null;

  for (const baseAlias of baseAliases || []) {
    const results = await searchAnime(baseAlias);
    const baseKey = normalizeTitle(baseAlias);
    const baseCandidate = results.find(item => normalizeTitle(item.title) === baseKey);
    if (!baseCandidate) continue;

    const html = await fetchText(`${BASE_URL}/anime/${baseCandidate.slug}-${baseCandidate.numId}`, HEADERS);
    if (!html) continue;
    const related = parseAnimeLinks(html);

    for (const candidate of related) {
      if (String(candidate.numId) === String(baseCandidate.numId)) continue;
      const key = normalizeTitle(candidate.title || candidate.slug.replace(/-/g, " "));
      if (!targets.has(key)) continue;
      if (malId && !(await verifyCandidateMal(candidate, malId))) continue;
      return { ...candidate, title: candidate.title || targets.get(key), matchedAlias: targets.get(key), relationSeasonMatch: true };
    }
  }
  return null;
}

async function resolveAnimeIdentity(tmdb, mapping, season, type) {
  const malId = mapping && mapping.mal_id ? Number(mapping.mal_id) : null;
  const seasonNumber = Number(season) || 1;
  const genericAliases = buildGenericAliases(tmdb);
  const mappedAliases = await buildMappedSeasonAliases(mapping);

  if (type === "tv" && seasonNumber > 1) {
    const generatedAliases = buildGeneratedSeasonAliases(tmdb, seasonNumber, type);
    const seasonAliases = unique([...mappedAliases, ...generatedAliases]);

    // Live identifiers are authoritative. AniDB.app can regenerate numeric IDs,
    // so never let a cached/frozen catalog short-circuit these searches.
    if (mappedAliases.length) {
      const mapped = await findCandidate(mappedAliases, malId, !!malId);
      if (mapped) return { ...mapped, identitySource: "live-mapped-season" };
    }

    const generated = await findCandidate(generatedAliases, malId, !!malId);
    if (generated) return { ...generated, identitySource: "live-generated-season" };

    const broad = await findSeasonCandidateFromBroadSearch(genericAliases, seasonAliases, malId);
    if (broad) return { ...broad, identitySource: "live-broad-season" };

    const relation = await findSeasonCandidateFromBaseRelations(genericAliases, seasonAliases, malId);
    if (relation) return { ...relation, identitySource: "live-relation-season" };

    return null;
  }

  if (mappedAliases.length) {
    const mapped = await findCandidate(mappedAliases, malId, !!malId);
    if (mapped) return { ...mapped, identitySource: "live-mapped" };
  }

  if (malId) {
    const verified = await findCandidate(genericAliases, malId, true);
    if (verified) return { ...verified, identitySource: "live-generic-verified" };
  }

  const exact = await findCandidate(genericAliases, null, false);
  return exact ? { ...exact, identitySource: "live-generic" } : null;
}

async function resolveEpisodeId(animeId, episodeNumber) {
  const json = await fetchJson(
    BASE_URL + "/api/frontend/anime/" + animeId + "/episodes",
    HEADERS
  );
  if (!json) return null;
  const episodes = Array.isArray(json) ? json : (Array.isArray(json.episodes) ? json.episodes : []);
  for (const item of episodes) {
    if (String(item && item.number) === String(episodeNumber)) return item.id;
  }
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
  let embedUrl = absolutize(language && (language.embed_url || language.embedUrl || language.url || ""));

  if (!streamUrl) {
    if (!embedUrl) return null;
    const html = await fetchText(embedUrl, {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    });
    streamUrl = extractHlsUrl(html);
  }

  if (!streamUrl) return null;
  if (streamUrl.indexOf("//") === 0) streamUrl = "https:" + streamUrl;

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

    const candidate = await resolveAnimeIdentity(tmdb, mapping, requestedSeason, type);
    if (!candidate) {
      console.log(`[${NAME}] No season-safe live AniDB match for ${tmdb.title} S${requestedSeason}E${requestedEpisode}`);
      return [];
    }

    console.log(
      `[${NAME}] ${tmdb.title} S${requestedSeason}E${requestedEpisode}` +
      ` -> MAL ${mapping && mapping.mal_id ? mapping.mal_id : "?"}` +
      ` -> ${candidate.title} (${candidate.numId}) via ${candidate.identitySource || candidate.matchedAlias || "live"}`
    );

    // AniDB.app season records restart at local episode 1. The MAL mapping is a
    // fallback for providers/records that expose absolute or split-cour numbering.
    let episodeId = await resolveEpisodeId(candidate.numId, requestedEpisode);
    if (!episodeId && mapping && mapping.mal_episode != null && Number(mapping.mal_episode) !== requestedEpisode) {
      episodeId = await resolveEpisodeId(candidate.numId, Number(mapping.mal_episode));
    }
    if (!episodeId) {
      console.log(`[${NAME}] No episode ${requestedEpisode} on live AniDB id ${candidate.numId}`);
      return [];
    }

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
