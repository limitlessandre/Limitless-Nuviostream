"use strict";

const PROVIDER_NAME = "AsiaFlix";
const BASE_URL = "https://asiaflix.net";
const API_URL = "https://api.asiaflix.net/v1";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

const API_HEADERS = {
  ...BASE_HEADERS,
  "X-Access-Control": "web"
};

const VIDEO_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Referer": `${BASE_URL}/`,
  "Origin": BASE_URL
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
    skipSizeCheck: true
  });
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response ? response.status : "?"} for ${url}`);
  }
  return response;
}

async function fetchJson(url, options = {}) {
  try {
    return await (await request(url, options)).json();
  } catch (_) {
    return null;
  }
}

async function fetchText(url, options = {}) {
  try {
    return String(await (await request(url, options)).text() || "");
  } catch (_) {
    return "";
  }
}

function normalizedMediaType(mediaType) {
  return String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;

  const data = await fetchJson(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
  );
  const list = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

function yearFromDate(value) {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function languageName(code) {
  const key = String(code || "").toLowerCase();
  const names = {
    ko: "Korean",
    zh: "Chinese",
    ja: "Japanese",
    th: "Thai",
    tl: "Filipino",
    fil: "Filipino",
    en: "English",
    vi: "Vietnamese",
    id: "Indonesian",
    ms: "Malay"
  };
  return names[key] || (key ? key.toUpperCase() : "Original");
}

async function getTmdbInfo(tmdbId, mediaType) {
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids,alternative_titles`
  );
  if (!data) return null;

  const mainTitle = mediaType === "movie"
    ? (data.title || data.original_title || "")
    : (data.name || data.original_name || "");
  const originalTitle = mediaType === "movie"
    ? (data.original_title || data.title || "")
    : (data.original_name || data.name || "");
  const date = mediaType === "movie" ? data.release_date : data.first_air_date;
  const altBlock = data.alternative_titles || {};
  const altRows = mediaType === "movie" ? altBlock.titles : altBlock.results;
  const altTitles = Array.isArray(altRows)
    ? altRows.map(row => row && (row.title || row.name)).filter(Boolean)
    : [];

  return {
    id: tmdbId,
    title: mainTitle,
    originalTitle,
    year: yearFromDate(date),
    originalLanguage: languageName(data.original_language),
    imdbId: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || "",
    aliases: [...new Set([mainTitle, originalTitle, ...altTitles].map(x => String(x || "").trim()).filter(Boolean))]
  };
}

function normalizeTitle(value) {
  let text = String(value || "").trim().toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value) {
  return new Set(normalizeTitle(value).split(" ").filter(token => token.length > 1));
}

function tokenSimilarity(a, b) {
  const aa = titleTokens(a);
  const bb = titleTokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common++;
  return common / Math.max(aa.size, bb.size);
}

function candidateNames(candidate) {
  const alt = Array.isArray(candidate && candidate.altNames) ? candidate.altNames : [];
  return [...new Set([candidate && candidate.name, ...alt].map(x => String(x || "").trim()).filter(Boolean))];
}

function candidateYear(candidate) {
  const values = [
    candidate && candidate.releaseYear,
    candidate && candidate.year,
    candidate && candidate.releaseDate,
    candidate && candidate.aired,
    candidate && candidate.firstAirDate
  ];
  for (const value of values) {
    const match = String(value || "").match(/(19|20)\d{2}/);
    if (match) return parseInt(match[0], 10);
  }
  return null;
}

function scoreCandidate(candidate, meta) {
  const sourceNames = candidateNames(candidate);
  if (!sourceNames.length) return -100;

  let best = 0;
  for (const expected of meta.aliases) {
    const a = normalizeTitle(expected);
    if (!a) continue;
    for (const source of sourceNames) {
      const b = normalizeTitle(source);
      if (!b) continue;
      if (a === b) best = Math.max(best, 100);
      else if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) best = Math.max(best, 84);
      else best = Math.max(best, Math.round(tokenSimilarity(a, b) * 76));
    }
  }

  const cYear = candidateYear(candidate);
  if (meta.year && cYear) {
    if (meta.year === cYear) best += 12;
    else if (Math.abs(meta.year - cYear) === 1) best += 3;
    else best -= 22;
  }
  return best;
}

async function searchAsiaFlix(query) {
  const url = `${API_URL}/drama/search?q=${encodeURIComponent(query)}&page=1&projections=${encodeURIComponent('["releaseYear","status","altNames"]')}`;
  const data = await fetchJson(url, { headers: API_HEADERS });
  if (!data) return [];
  if (Array.isArray(data.body)) return data.body;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

async function fetchDetails(slug) {
  if (!slug) return null;
  return await fetchJson(
    `${API_URL}/drama/detail?slug=${encodeURIComponent(slug)}`,
    { headers: API_HEADERS }
  );
}

async function findAsiaFlixTitle(meta) {
  const searchTerms = [...new Set([
    meta.title,
    meta.originalTitle,
    ...meta.aliases,
    String(meta.title || "").split(":")[0]
  ].map(x => String(x || "").trim()).filter(Boolean))].slice(0, 8);

  const bySlug = new Map();
  for (const term of searchTerms) {
    const rows = await searchAsiaFlix(term);
    for (const row of rows) {
      const slug = String(row && (row.slug || row.id || row.url) || "").trim();
      if (!slug) continue;
      const previous = bySlug.get(slug);
      const score = scoreCandidate(row, meta);
      if (!previous || score > previous.score) bySlug.set(slug, { row, score });
    }
    const strong = [...bySlug.values()].some(item => item.score >= 100);
    if (strong) break;
  }

  const ranked = [...bySlug.entries()]
    .map(([slug, value]) => ({ slug, row: value.row, score: value.score }))
    .filter(item => item.score >= 62)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const item of ranked) {
    const details = await fetchDetails(item.slug);
    if (!details) continue;
    const detailScore = Math.max(item.score, scoreCandidate(details, meta));
    if (detailScore >= 70) return { details, score: detailScore };
  }
  return null;
}

function episodeNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function findEpisode(details, mediaType, requestedEpisode) {
  const episodes = Array.isArray(details && details.episodes) ? details.episodes : [];
  if (!episodes.length) return null;
  if (mediaType === "movie") return episodes[0];

  const wanted = episodeNumber(requestedEpisode) || 1;
  return episodes.find(item => {
    const current = episodeNumber(item && item.number);
    return current !== null && Math.abs(current - wanted) < 0.001;
  }) || null;
}

function utf8Bytes(value) {
  const encoded = encodeURIComponent(String(value || ""));
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%" && i + 2 < encoded.length) {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

function base64Encode(value) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(value);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? chars[triple & 63] : "=";
  }
  return out;
}

function isDirectMediaUrl(url) {
  return /\.(m3u8|mp4|mkv)(?:$|[?#])/i.test(String(url || ""));
}

async function resolveServer(host) {
  const source = String(host && host.source || "Server").trim() || "Server";
  const hostUrl = String(host && host.url || "").trim();
  if (!hostUrl) return [];

  const value = base64Encode(hostUrl);
  const endpoint = `${API_URL}/drama/get-stream-url?value=${encodeURIComponent(value)}&server=${encodeURIComponent(source.toLowerCase())}`;
  const data = await fetchJson(endpoint, { headers: API_HEADERS });
  const files = data && Array.isArray(data.sources) ? data.sources : [];

  const resolved = files
    .map(file => ({
      source,
      url: String(file && file.url || "").trim(),
      isM3U8: Boolean(file && file.isM3U8)
    }))
    .filter(file => file.url);

  if (!resolved.length && isDirectMediaUrl(hostUrl)) {
    resolved.push({ source, url: hostUrl, isM3U8: /\.m3u8(?:$|[?#])/i.test(hostUrl) });
  }
  return resolved;
}

function qualityFromUrl(url) {
  const text = String(url || "");
  const matches = [...text.matchAll(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/gi)];
  if (!matches.length) return null;
  return `${Math.max(...matches.map(match => parseInt(match[1], 10)))}p`;
}

async function qualityFromHls(url) {
  const text = await fetchText(url, { headers: VIDEO_HEADERS });
  if (!text) return null;
  const heights = [...text.matchAll(/RESOLUTION=\d+x(\d+)/gi)]
    .map(match => parseInt(match[1], 10))
    .filter(Number.isFinite);
  if (heights.length) return `${Math.max(...heights)}p`;
  return qualityFromUrl(url);
}

async function buildStream(file, meta, details, requestedEpisode, mediaType) {
  const isHls = file.isM3U8 || /\.m3u8(?:$|[?#])/i.test(file.url);
  const quality = (isHls ? await qualityFromHls(file.url) : qualityFromUrl(file.url)) || "Auto";
  const showName = String(details && details.name || meta.title || PROVIDER_NAME).trim();
  const episodeLabel = mediaType === "movie" ? "Movie" : `Episode ${requestedEpisode}`;
  const sourceLabel = String(file.source || "Server").trim() || "Server";

  return {
    name: `${PROVIDER_NAME} • ${sourceLabel} • ${quality} • ${meta.originalLanguage} Audio`,
    title: `${showName} • ${episodeLabel} • ${PROVIDER_NAME}`,
    url: file.url,
    quality,
    provider: PROVIDER_NAME,
    type: isHls ? "m3u8" : "mp4",
    headers: VIDEO_HEADERS,
    language: meta.originalLanguage,
    subtitles: []
  };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const type = normalizedMediaType(mediaType);
    const seasonNumber = parseInt(season, 10) || 1;
    const episodeNumberRequested = episodeNumber(episode) || 1;

    // AsiaFlix's current v1 detail API exposes one flat episode list and no season coordinates.
    // Refuse later seasons instead of attaching the wrong flat episode number to a Nuvio season.
    if (type === "tv" && seasonNumber !== 1) return [];

    const tmdbId = await resolveTmdbId(inputId, type);
    if (!tmdbId) return [];

    const meta = await getTmdbInfo(tmdbId, type);
    if (!meta || !meta.title) return [];

    const target = await findAsiaFlixTitle(meta);
    if (!target || !target.details) return [];

    const selectedEpisode = findEpisode(target.details, type, episodeNumberRequested);
    if (!selectedEpisode) return [];

    const hosts = Array.isArray(selectedEpisode.streamUrls) ? selectedEpisode.streamUrls : [];
    if (!hosts.length) return [];

    const settled = await Promise.all(hosts.map(host => resolveServer(host).catch(() => [])));
    const files = settled.flat();
    if (!files.length) return [];

    const unique = [];
    const seen = new Set();
    for (const file of files) {
      const key = String(file.url || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(file);
    }

    const streams = await Promise.all(
      unique.map(file => buildStream(file, meta, target.details, episodeNumberRequested, type).catch(() => null))
    );

    return streams.filter(Boolean).sort((a, b) => {
      const aq = parseInt(String(a.quality || "").match(/\d+/)?.[0] || "0", 10);
      const bq = parseInt(String(b.quality || "").match(/\d+/)?.[0] || "0", 10);
      return bq - aq;
    });
  } catch (error) {
    console.log(`[AsiaFlix] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
