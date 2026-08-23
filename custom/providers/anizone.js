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

async function getMalTitle(malId) {
  if (!malId) return "";
  const data = await fetchJson(`https://api.jikan.moe/v4/anime/${malId}`);
  if (!data || !data.data) return "";
  return data.data.title_english || data.data.title || data.data.title_japanese || "";
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
    let defaultMatch = xData.match(/(?:window\.)?getTitle\(this\.anmTitles,\s*'([^']+)'\)/i);
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

function seasonLooksRight(titles, season) {
  const joined = titles.join(" ");
  if ((season || 1) <= 1) {
    return !/(?:season\s*[2-9]|\b2nd\s+season\b|\b3rd\s+season\b|\b4th\s+season\b|\sII\b|\sIII\b|\sIV\b)/i.test(joined);
  }
  const n = String(season);
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][season] || "";
  return new RegExp(`season\\s*${n}|${n}(?:nd|rd|th)\\s+season|\\b${n}\\b${roman ? `|\\b${roman}\\b` : ""}`, "i").test(joined);
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

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const normalizedType = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
    const tmdbId = await resolveTmdbId(inputId, normalizedType);
    if (!tmdbId) return [];

    const tmdb = await getTmdbDetails(tmdbId, normalizedType);
    if (!tmdb || !tmdb.title) return [];

    let mappedEpisode = normalizedType === "movie" ? 1 : (parseFloat(episode) || 1);
    let mapping = null;
    let malTitle = "";

    if (normalizedType === "tv") {
      mapping = await resolveAnimeMapping(tmdb.imdbId, parseInt(season, 10) || 1, parseFloat(episode) || 1);
      if (mapping) {
        mappedEpisode = mapping.mal_episode || mappedEpisode;
        malTitle = await getMalTitle(mapping.mal_id);
      }
    }

    const candidateTitles = [
      malTitle,
      mapping && mapping.anime_title,
      tmdb.title,
      tmdb.originalTitle
    ].filter(Boolean);

    const queries = [];
    for (const title of candidateTitles) {
      const cleaned = String(title).split(":")[0].trim();
      if (cleaned && !queries.includes(cleaned)) queries.push(cleaned);
    }

    let animeSlug = null;
    for (const query of queries.slice(0, 3)) {
      const html = await fetchText(`/anime?search=${encodeURIComponent(query)}`);
      if (!html) continue;
      animeSlug = pickCard(extractCards(html), candidateTitles, parseInt(season, 10) || 1, normalizedType);
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
