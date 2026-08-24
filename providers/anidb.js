// SPDX-License-Identifier: GPL-3.0-only
"use strict";

// Limitless AniDB 1.0.4
// Runtime access/extraction is based on Eclipsia Praxiel 1.1.0 (GPL-3.0).
// Limitless adds MAL season identity locking, exact finite aliases, animation guard,
// and the repository's DUB/HARDSUB naming convention.

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
    `${tmdb.title} ${roman(season)}`,
    `${tmdb.title} Season ${season}`,
    `${tmdb.title} ${ordinal(season)} Season`
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
  ]).slice(0, 15);
}

function buildGenericAliases(tmdb) {
  return unique([
    tmdb && tmdb.title,
    tmdb && tmdb.original,
    ...(tmdb && Array.isArray(tmdb.alternatives) ? tmdb.alternatives : [])
  ]).slice(0, 14);
}

async function searchAnime(query) {
  const html = await fetchText(
    BASE_URL + "/search/suggestions?q=" + encodeURIComponent(query),
    HEADERS
  );
  if (!html) return [];

  const results = [];
  const seen = new Set();
  const pattern = /<a href="(?:https?:\/\/anidb\.app)?\/anime\/([a-z0-9-]+?)-(\d+)"[^>]*>[\s\S]{0,400}?<img[^>]*alt="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const item = {
      slug: match[1],
      numId: match[2],
      title: match[3] || match[1].replace(/-/g, " ")
    };
    if (seen.has(item.numId)) continue;
    seen.add(item.numId);
    results.push(item);
  }
  return results;
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
    const results = await searchAnime(alias);
    for (const candidate of results) {
      if (!seenIds.has(candidate.numId)) {
        seenIds.add(candidate.numId);
        queued.push(candidate);
      }
      if (normalizeTitle(candidate.title) === normalizeTitle(alias)) {
        if (!requireMalVerification || !malId || await verifyCandidateMal(candidate, malId)) {
          return { ...candidate, matchedAlias: alias };
        }
      }
    }
  }

  if (malId) {
    for (const candidate of queued.slice(0, 8)) {
      if (await verifyCandidateMal(candidate, malId)) {
        return { ...candidate, matchedAlias: candidate.title };
      }
    }
  }

  return null;
}

async function findSeasonCandidateFromBroadSearch(baseAliases, seasonAliases) {
  const targetKeys = new Set((seasonAliases || []).map(normalizeTitle).filter(Boolean));
  if (!targetKeys.size) return null;

  for (const baseAlias of baseAliases || []) {
    const results = await searchAnime(baseAlias);
    for (const candidate of results) {
      if (targetKeys.has(normalizeTitle(candidate.title))) {
        return { ...candidate, matchedAlias: baseAlias, broadSeasonMatch: true };
      }
    }
  }
  return null;
}

async function resolveAnimeIdentity(tmdb, mapping, season, type) {
  const malId = mapping && mapping.mal_id ? Number(mapping.mal_id) : null;
  const seasonNumber = Number(season) || 1;
  const genericAliases = buildGenericAliases(tmdb);
  const genericKeys = new Set(genericAliases.map(normalizeTitle));

  // AniDB.app stores many later seasons as separate anime records. For S2+,
  // try explicit season-shaped titles before trusting MAL mapping, because the
  // mapping service can lag behind newly separated seasons.
  if (type === "tv" && seasonNumber > 1) {
    const generatedAliases = buildGeneratedSeasonAliases(tmdb, seasonNumber, type);
    const generatedMatch = await findCandidate(generatedAliases, null, false);
    if (generatedMatch) {
      return { ...generatedMatch, identitySource: "generated-season" };
    }

    // Some AniDB titles use decorative punctuation that the suggestions endpoint
    // does not reliably match when included in the query. Search the base title,
    // then accept only a candidate whose normalized title exactly matches one of
    // our generated season forms. This remains deterministic and non-fuzzy.
    const broadSeasonMatch = await findSeasonCandidateFromBroadSearch(genericAliases, generatedAliases);
    if (broadSeasonMatch) {
      return { ...broadSeasonMatch, identitySource: "broad-exact-season" };
    }

    const mappedAliases = await buildMappedSeasonAliases(mapping);
    const mappedMatch = await findCandidate(mappedAliases, malId, false);
    if (mappedMatch && !genericKeys.has(normalizeTitle(mappedMatch.title))) {
      return { ...mappedMatch, identitySource: "mapped-season" };
    }

    // Correctness beats a false positive: never collapse S2+ back to the generic
    // base-series record just because that record also contains episode 1.
    return null;
  }

  const mappedAliases = await buildMappedSeasonAliases(mapping);
  if (mappedAliases.length) {
    const mappedMatch = await findCandidate(mappedAliases, malId, false);
    if (mappedMatch) return { ...mappedMatch, identitySource: "mapped" };
  }

  if (malId) {
    const verified = await findCandidate(genericAliases, malId, true);
    return verified ? { ...verified, identitySource: "generic-verified" } : null;
  }

  if (type === "movie" || seasonNumber === 1) {
    const exact = await findCandidate(genericAliases, null, false);
    return exact ? { ...exact, identitySource: "generic" } : null;
  }

  return null;
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

async function resolveStreamFromLanguage(language, context) {
  const code = String(language && language.code || "").toLowerCase();
  if (code !== "eng" && code !== "jpn") return null;

  const embedUrl = language && language.embed_url ? String(language.embed_url) : "";
  if (!embedUrl) return null;

  const html = await fetchText(embedUrl, {
    "User-Agent": USER_AGENT,
    "Referer": BASE_URL + "/"
  });
  if (!html) return null;

  const match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)
    || html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (!match || !match[1]) return null;

  const isDub = code === "eng";
  const languageName = isDub ? "English" : "Japanese";
  const tag = isDub ? "DUB" : "HARDSUB";

  return {
    name: `${NAME} | 1080p [${tag}]`,
    title: `${context.title} • ${context.label} • ${isDub ? "English Dub" : "Japanese Hard Sub"}`,
    url: match[1],
    quality: "1080p",
    provider: NAME,
    type: "m3u8",
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": embedUrl
    },
    language: languageName,
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
      console.log(`[${NAME}] No season-safe AniDB match for ${tmdb.title} S${requestedSeason}E${requestedEpisode}`);
      return [];
    }

    console.log(
      `[${NAME}] ${tmdb.title} S${requestedSeason}E${requestedEpisode}` +
      ` -> MAL ${mapping && mapping.mal_id ? mapping.mal_id : "?"}` +
      ` -> ${candidate.title} (${candidate.numId}) via ${candidate.matchedAlias}`
    );

    // AniDB.app's separated season records normally restart at episode 1.
    // Prefer the requested local episode. MAL episode numbering is only a fallback.
    let episodeId = await resolveEpisodeId(candidate.numId, requestedEpisode);
    if (!episodeId && mapping && mapping.mal_episode != null && Number(mapping.mal_episode) !== requestedEpisode) {
      episodeId = await resolveEpisodeId(candidate.numId, Number(mapping.mal_episode));
    }
    if (!episodeId) return [];

    const languages = await fetchEpisodeLanguages(episodeId);
    if (!languages.length) return [];

    const context = {
      title: candidate.title || tmdb.title,
      label: type === "movie" ? "Movie" : `S${requestedSeason}E${requestedEpisode}`
    };

    const streams = await Promise.all(
      languages.map(item => resolveStreamFromLanguage(item, context).catch(() => null))
    );

    return deduplicateStreams(streams.filter(Boolean));
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
