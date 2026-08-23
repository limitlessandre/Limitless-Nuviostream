"use strict";

const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "AniZone";
const BASE = "https://anizone.to";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": `${BASE}/`
};

async function fetchText(url, options = {}) {
  const finalUrl = /^https?:\/\//i.test(url) ? url : `${BASE}${url}`;
  try {
    const response = await fetch(finalUrl, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) },
      skipSizeCheck: true
    });
    if (!response || !response.ok) return "";
    return await response.text();
  } catch (_) {
    return "";
  }
}

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, skipSizeCheck: true });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function decodeEscapedTitle(value) {
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\\"/g, '"');
}

function addUnique(list, value) {
  const clean = String(value || "").trim();
  if (!clean) return;
  const key = clean.toLowerCase();
  if (!list.some(item => String(item).toLowerCase() === key)) list.push(clean);
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;

  const data = await fetchJson(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
    { headers: HEADERS }
  );
  const list = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function getTmdbDetails(tmdbId, mediaType) {
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`,
    { headers: HEADERS }
  );
  if (!data) return null;
  return {
    title: mediaType === "movie" ? (data.title || data.original_title || "") : (data.name || data.original_name || ""),
    originalTitle: mediaType === "movie" ? (data.original_title || data.title || "") : (data.original_name || data.name || ""),
    imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : (data.imdb_id || "")
  };
}

async function resolveAnimeMapping(imdbId, season, episode) {
  if (!imdbId) return null;
  return await fetchJson(
    `https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(imdbId)}&s=${season || 1}&e=${episode || 1}`
  );
}

function addAnimeTitles(target, anime) {
  if (!anime) return;
  addUnique(target, anime.title);
  addUnique(target, anime.title_english);
  addUnique(target, anime.title_japanese);
  if (Array.isArray(anime.titles)) {
    for (const entry of anime.titles) {
      if (entry && entry.title) addUnique(target, entry.title);
    }
  }
  if (Array.isArray(anime.title_synonyms)) {
    for (const title of anime.title_synonyms) addUnique(target, title);
  }
}

async function getMalTitles(malId) {
  const titles = [];
  if (!malId) return titles;
  const data = await fetchJson(`https://api.jikan.moe/v4/anime/${malId}`);
  addAnimeTitles(titles, data && data.data);
  return titles;
}

async function searchJikanAliases(query, season) {
  const output = [];
  const clean = String(query || "").trim();
  if (!clean) return output;

  const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(clean)}&limit=15`);
  const results = data && Array.isArray(data.data) ? data.data.slice() : [];

  // New seasons frequently appear in Jikan before third-party season mapping
  // databases update. Prefer entries whose aliases explicitly look like the
  // requested season, then retain nearby results as additional aliases.
  results.sort((a, b) => {
    const aTitles = [];
    const bTitles = [];
    addAnimeTitles(aTitles, a);
    addAnimeTitles(bTitles, b);
    const aScore = seasonLooksRight(aTitles, season) ? 0 : 1;
    const bScore = seasonLooksRight(bTitles, season) ? 0 : 1;
    return aScore - bScore;
  });

  for (const anime of results.slice(0, 8)) {
    const titles = [];
    addAnimeTitles(titles, anime);
    if ((season || 1) > 1 && !seasonLooksRight(titles, season)) continue;
    for (const title of titles) addUnique(output, title);
  }

  // If the season marker is not represented in Jikan's localized aliases yet,
  // keep the top search-result aliases as a final discovery fallback.
  if (!output.length) {
    for (const anime of results.slice(0, 4)) addAnimeTitles(output, anime);
  }

  return output;
}

function extractCards(html) {
  const $ = cheerio.load(html);
  const cards = [];
  const seen = new Set();

  $('[x-data*="anmTitles"]').each((_, el) => {
    const card = $(el);
    const href = card.find('a[href*="/anime/"]').first().attr("href") || "";
    const match = href.match(/\/anime\/([^/?#]+)/i);
    if (!match || seen.has(match[1])) return;

    const titles = new Set();
    const xData = card.attr("x-data") || "";
    const defaultMatch = xData.match(/(?:window\.)?getTitle\(this\.anmTitles,\s*'([^']+)'\)/i);
    if (defaultMatch && defaultMatch[1]) titles.add(decodeEscapedTitle(defaultMatch[1]));

    const jsonMatch = xData.match(/JSON\.parse\('([^']+)'\)/i);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const jsonString = jsonMatch[1]
          .replace(/\\\\/g, "\\")
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\'/g, "'");
        const parsed = JSON.parse(jsonString);
        Object.values(parsed || {}).forEach(value => {
          if (value) titles.add(String(value));
        });
      } catch (_) {}
    }

    const fallback = card.text().replace(/\s+/g, " ").trim();
    if (fallback) titles.add(fallback);

    seen.add(match[1]);
    cards.push({ slug: match[1], titles: Array.from(titles) });
  });

  return cards;
}

function firstAnimeSlug(html) {
  const $ = cheerio.load(html);
  let slug = null;
  $('main a[href*="/anime/"], a[href*="/anime/"]').each((_, el) => {
    if (slug) return;
    const href = String($(el).attr("href") || "");
    const match = href.match(/\/anime\/([^/?#]+)/i);
    if (match && match[1] && match[1] !== "anime") slug = match[1];
  });
  return slug;
}

function seasonLooksRight(titles, season) {
  const joined = titles.join(" ");
  if ((season || 1) <= 1) {
    return !/(?:season\s*[2-9]|\b2nd\s+season\b|\b3rd\s+season\b|\b4th\s+season\b|\sII\b|\sIII\b|\sIV\b)/i.test(joined);
  }

  const n = String(season);
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][season] || "";
  const patterns = [
    new RegExp(`season\\s*${n}`, "i"),
    new RegExp(`${n}(?:nd|rd|th)\\s+season`, "i"),
    new RegExp(`\\b${n}\\b`, "i")
  ];
  if (roman) patterns.push(new RegExp(`\\b${roman}\\b`, "i"));
  return patterns.some(regex => regex.test(joined));
}

function pickCard(cards, candidateTitles, season, mediaType) {
  const targets = candidateTitles.filter(Boolean).map(normalizeTitle).filter(Boolean);
  if (!targets.length || !cards.length) return null;

  for (const card of cards) {
    for (const title of card.titles) {
      const normalized = normalizeTitle(title);
      if (targets.includes(normalized) && (mediaType === "movie" || seasonLooksRight(card.titles, season))) {
        return card.slug;
      }
    }
  }

  for (const card of cards) {
    const seasonOk = mediaType === "movie" || seasonLooksRight(card.titles, season);
    if (!seasonOk) continue;
    for (const title of card.titles) {
      const normalized = normalizeTitle(title);
      if (targets.some(target => normalized.includes(target) || target.includes(normalized))) {
        return card.slug;
      }
    }
  }

  if (cards.length === 1 && (mediaType === "movie" || seasonLooksRight(cards[0].titles, season))) {
    return cards[0].slug;
  }

  return null;
}

function normalizeSubtitleLanguage(label, srclang, url) {
  const text = `${label || ""} ${srclang || ""} ${url || ""}`.toLowerCase().replace(/_/g, "-");
  if (/\benglish\b|(^|[^a-z])(en|eng)([- ]|[^a-z]|$)/i.test(text)) return { code: "en", display: "English" };
  if (/\bjapanese\b|(^|[^a-z])(ja|jp|jpn)([- ]|[^a-z]|$)/i.test(text)) return { code: "ja", display: "Japanese" };
  if (/\bkorean\b|(^|[^a-z])(ko|kr|kor)([- ]|[^a-z]|$)/i.test(text)) return { code: "ko", display: "Korean" };
  if (/\bchinese\b|\bmandarin\b|(^|[^a-z])(zh|zho|chi)([- ]|[^a-z]|$)/i.test(text)) return { code: "zh", display: "Chinese" };
  return null;
}

function extractEpisode(html) {
  const $ = cheerio.load(html);
  let masterUrl = $("media-player").first().attr("src") || "";
  if (!masterUrl) {
    const match = html.match(/https:\/\/[^"'\s]+\/master\.m3u8[^"'\s]*/i);
    masterUrl = match ? match[0] : "";
  }
  if (!masterUrl) return null;

  const subtitles = [];
  const seen = new Set();
  $("track").each((_, el) => {
    const track = $(el);
    const url = String(track.attr("src") || "").trim();
    const kind = String(track.attr("kind") || "").toLowerCase();
    if (!url || !(kind === "subtitles" || kind === "captions" || /\.(?:ass|ssa|vtt|srt)(?:$|[?#])/i.test(url))) return;

    const rawLabel = String(track.attr("label") || track.attr("srclang") || "English").trim();
    const lang = normalizeSubtitleLanguage(rawLabel, track.attr("srclang"), url);
    if (!lang) return;

    const key = `${lang.code}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);

    subtitles.push({
      url,
      language: lang.code,
      name: `${rawLabel || lang.display} [AniZone Source]`,
      headers: HEADERS
    });
  });

  return { masterUrl, subtitles };
}

function buildQueries(candidateTitles) {
  const queries = [];
  for (const title of candidateTitles) {
    const clean = String(title || "").trim();
    if (!clean) continue;
    addUnique(queries, clean);
    const beforeColon = clean.split(":")[0].trim();
    addUnique(queries, beforeColon);
    const withoutSeason = beforeColon
      .replace(/\s+(?:season\s*\d+|\d+(?:nd|rd|th)\s+season)$/i, "")
      .trim();
    addUnique(queries, withoutSeason);
  }
  return queries;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const normalizedType = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
    const tmdbId = await resolveTmdbId(inputId, normalizedType);
    if (!tmdbId) return [];

    const tmdb = await getTmdbDetails(tmdbId, normalizedType);
    if (!tmdb || !tmdb.title) return [];

    const seasonNumber = parseInt(season, 10) || 1;
    let mappedEpisode = normalizedType === "movie" ? 1 : (parseFloat(episode) || 1);
    let mapping = null;
    let malTitles = [];

    if (normalizedType === "tv") {
      mapping = await resolveAnimeMapping(tmdb.imdbId, seasonNumber, parseFloat(episode) || 1);
      if (mapping) {
        mappedEpisode = mapping.mal_episode || mappedEpisode;
        malTitles = await getMalTitles(mapping.mal_id);
      }
    }

    // Independent fallback for newly airing seasons whose IMDb->MAL season
    // mapping has not propagated yet.
    const jikanAliases = normalizedType === "tv"
      ? await searchJikanAliases(tmdb.title, seasonNumber)
      : [];

    const candidateTitles = [];
    for (const title of malTitles) addUnique(candidateTitles, title);
    for (const title of jikanAliases) addUnique(candidateTitles, title);
    addUnique(candidateTitles, mapping && mapping.anime_title);
    addUnique(candidateTitles, tmdb.title);
    addUnique(candidateTitles, tmdb.originalTitle);

    const queries = buildQueries(candidateTitles);
    let animeSlug = null;

    for (const query of queries.slice(0, 12)) {
      const html = await fetchText(`/anime?search=${encodeURIComponent(query)}`);
      if (!html) continue;

      animeSlug = pickCard(extractCards(html), candidateTitles, seasonNumber, normalizedType);

      // Preserve the useful fallback from Yoru's original implementation. With
      // a highly specific alias such as "Youjo Senki II", the first anime card
      // is preferable to dropping the provider just because AniZone changed
      // some Alpine/x-data markup on its search page.
      if (!animeSlug) animeSlug = firstAnimeSlug(html);
      if (animeSlug) break;
    }

    if (!animeSlug) return [];

    const episodeHtml = await fetchText(`/anime/${animeSlug}/${mappedEpisode}`);
    if (!episodeHtml) return [];
    const parsed = extractEpisode(episodeHtml);
    if (!parsed) return [];

    return [{
      name: `${PROVIDER_NAME} • Source Subs`,
      title: `${candidateTitles[0] || tmdb.title} • Episode ${mappedEpisode}`,
      url: parsed.masterUrl,
      quality: "Auto",
      provider: PROVIDER_NAME,
      type: "m3u8",
      headers: HEADERS,
      language: "Japanese",
      subtitles: parsed.subtitles
    }];
  } catch (error) {
    console.log(`[AniZone] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
