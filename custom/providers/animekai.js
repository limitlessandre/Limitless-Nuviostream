"use strict";

const PROVIDER_NAME = "AnimeKai";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const API = "https://enc-dec.app/api";
const DB_API = "https://enc-dec.app/db/kai";
const KAI_AJAX = "https://animekai.to/ajax";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*"
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
    skipSizeCheck: true
  });
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response ? response.status : "?"}`);
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

async function getTmdbInfo(tmdbId, mediaType) {
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`
  );
  if (!data) return null;
  return {
    title: mediaType === "movie" ? (data.title || data.original_title || "Anime") : (data.name || data.original_name || "Anime"),
    imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : (data.imdb_id || "")
  };
}

async function resolveMalEpisode(imdbId, season, episode) {
  if (!imdbId) return null;
  return await fetchJson(
    `https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(imdbId)}&s=${season || 1}&e=${episode || 1}`
  );
}

async function malToAniList(malId) {
  if (!malId) return null;
  const query = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id title{english romaji}}}";
  const data = await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: parseInt(malId, 10) } })
  });
  return data && data.data && data.data.Media ? data.data.Media : null;
}

async function encryptKai(text) {
  const data = await fetchJson(`${API}/enc-kai?text=${encodeURIComponent(String(text))}`);
  return data && data.result ? data.result : null;
}

async function decryptKai(text) {
  const data = await fetchJson(`${API}/dec-kai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  return data && data.result ? data.result : null;
}

async function parseHtmlViaApi(html) {
  const data = await fetchJson(`${API}/parse-html`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: html })
  });
  return data && data.result ? data.result : null;
}

async function decryptMegaMedia(embedUrl) {
  const mediaUrl = String(embedUrl || "").replace(/\/e\//, "/media/");
  const mediaResponse = await fetchJson(mediaUrl, {
    headers: playbackHeadersFor(embedUrl)
  });
  if (!mediaResponse || !mediaResponse.result) return null;

  const data = await fetchJson(`${API}/dec-mega`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: mediaResponse.result, agent: USER_AGENT })
  });
  return data && data.result ? data.result : null;
}

function playbackHeadersFor(url) {
  let origin = "https://animekai.to";
  try {
    const match = String(url || "").match(/^(https?:\/\/[^/]+)/i);
    if (match) origin = match[1];
  } catch (_) {}
  return {
    "User-Agent": USER_AGENT,
    "Referer": `${origin}/`,
    "Origin": origin
  };
}

async function findInDatabase(anilistId) {
  const results = await fetchJson(`${DB_API}/find?anilist_id=${encodeURIComponent(anilistId)}`);
  return Array.isArray(results) && results.length ? results[0] : null;
}

function findEpisodeToken(dbData, episodeNumber) {
  const episodes = dbData && dbData.episodes ? dbData.episodes : {};
  const target = String(episodeNumber);
  const keys = Object.keys(episodes);

  // Prefer sub-labelled buckets, but fall back to any bucket because AnimeKai's
  // DB shape has changed over time and the token itself can expose all language groups.
  keys.sort((a, b) => Number(/sub/i.test(b)) - Number(/sub/i.test(a)));

  for (const key of keys) {
    const bucket = episodes[key] || {};
    if (bucket[target] && bucket[target].token) return bucket[target].token;
    for (const epKey of Object.keys(bucket)) {
      if (parseFloat(epKey) === parseFloat(target) && bucket[epKey] && bucket[epKey].token) {
        return bucket[epKey].token;
      }
    }
  }
  return null;
}

function normalizeQuality(value) {
  const text = String(value || "Auto");
  if (/2160|4k|uhd/i.test(text)) return "2160p";
  if (/1440/i.test(text)) return "1440p";
  if (/1080|fhd/i.test(text)) return "1080p";
  if (/720|\bhd\b/i.test(text)) return "720p";
  if (/480|\bsd\b/i.test(text)) return "480p";
  if (/360/i.test(text)) return "360p";
  return "Auto";
}

function qualityFromSource(source) {
  return normalizeQuality(
    source && (source.quality || source.label || source.name || source.file)
  );
}

function normalizeLanguage(label, url) {
  const text = `${label || ""} ${url || ""}`.toLowerCase().replace(/_/g, "-");
  if (/\benglish\b|(^|[^a-z])(en|eng)([- ]|[^a-z]|$)/i.test(text)) return { code: "en", display: "English" };
  if (/\bjapanese\b|(^|[^a-z])(ja|jp|jpn)([- ]|[^a-z]|$)/i.test(text)) return { code: "ja", display: "Japanese" };
  if (/\bkorean\b|(^|[^a-z])(ko|kr|kor)([- ]|[^a-z]|$)/i.test(text)) return { code: "ko", display: "Korean" };
  if (/\bchinese\b|\bmandarin\b|(^|[^a-z])(zh|zho|chi)([- ]|[^a-z]|$)/i.test(text)) return { code: "zh", display: "Chinese" };
  return null;
}

function subtitleTracks(mediaData, embedUrl) {
  const tracks = mediaData && Array.isArray(mediaData.tracks) ? mediaData.tracks : [];
  const headers = playbackHeadersFor(embedUrl);
  const result = [];
  const seen = new Set();

  for (const track of tracks) {
    if (!track || !track.file) continue;
    const kind = String(track.kind || "captions").toLowerCase();
    if (kind !== "captions" && kind !== "subtitles") continue;

    const lang = normalizeLanguage(track.label, track.file);
    if (!lang) continue;
    const key = `${lang.code}|${track.file}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let extra = "";
    if (/\bsdh\b|hearing/i.test(String(track.label || ""))) extra = " SDH";
    else if (/\bforced\b/i.test(String(track.label || ""))) extra = " Forced";

    result.push({
      url: track.file,
      language: lang.code,
      name: `${lang.display}${extra} [AnimeKai Source]`,
      headers
    });
  }
  return result;
}

function serverPriority(type) {
  const text = String(type || "").toLowerCase();
  if (text.includes("sub") || text.includes("hsub")) return 0;
  if (text.includes("dub")) return 1;
  return 2;
}

async function resolveServer(serverType, serverKey, serverData) {
  const lid = serverData && serverData.lid;
  if (!lid) return [];

  const encryptedLid = await encryptKai(lid);
  if (!encryptedLid) return [];
  const view = await fetchJson(`${KAI_AJAX}/links/view?id=${encodeURIComponent(lid)}&_=${encodeURIComponent(encryptedLid)}`);
  if (!view || !view.result) return [];

  const decrypted = await decryptKai(view.result);
  if (!decrypted || !decrypted.url) return [];

  const mediaData = await decryptMegaMedia(decrypted.url);
  if (!mediaData || !Array.isArray(mediaData.sources)) return [];

  // Keep subtitles tied to THIS exact server/encode. Never pool them across mirrors.
  const subtitles = subtitleTracks(mediaData, decrypted.url);
  const headers = playbackHeadersFor(decrypted.url);
  const serverName = serverData.name || serverData.title || serverData.label || `Server ${serverKey}`;
  const languageType = /dub/i.test(serverType) ? "DUB" : /sub|hsub/i.test(serverType) ? "SUB" : String(serverType || "Source").toUpperCase();

  const streams = [];
  for (const source of mediaData.sources) {
    if (!source || !source.file || !/^https?:\/\//i.test(source.file)) continue;
    const quality = qualityFromSource(source);
    streams.push({
      name: `${PROVIDER_NAME} • ${languageType} • ${serverName} • ${quality}`,
      title: `${PROVIDER_NAME} ${languageType}`,
      url: source.file,
      quality,
      provider: PROVIDER_NAME,
      type: /\.m3u8(?:$|[?#])/i.test(source.file) ? "m3u8" : "mp4",
      headers,
      language: languageType === "DUB" ? "English" : "Japanese",
      subtitles
    });
  }
  return streams;
}

async function resolveTokenStreams(token) {
  const encryptedToken = await encryptKai(token);
  if (!encryptedToken) return [];

  const list = await fetchJson(`${KAI_AJAX}/links/list?token=${encodeURIComponent(token)}&_=${encodeURIComponent(encryptedToken)}`);
  if (!list || !list.result) return [];
  const servers = await parseHtmlViaApi(list.result);
  if (!servers || typeof servers !== "object") return [];

  const jobs = [];
  const serverTypes = Object.keys(servers).sort((a, b) => serverPriority(a) - serverPriority(b));
  for (const serverType of serverTypes) {
    const group = servers[serverType] || {};
    for (const serverKey of Object.keys(group)) {
      jobs.push(resolveServer(serverType, serverKey, group[serverKey]).catch(() => []));
    }
  }

  const settled = await Promise.all(jobs);
  const combined = settled.flat();
  const seen = new Set();
  return combined.filter(stream => {
    const key = `${stream.url}|${stream.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const normalizedType = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
    const tmdbId = await resolveTmdbId(inputId, normalizedType);
    if (!tmdbId) return [];

    const tmdb = await getTmdbInfo(tmdbId, normalizedType);
    if (!tmdb || !tmdb.imdbId) return [];

    const mapping = await resolveMalEpisode(
      tmdb.imdbId,
      normalizedType === "movie" ? 1 : (parseInt(season, 10) || 1),
      normalizedType === "movie" ? 1 : (parseFloat(episode) || 1)
    );
    if (!mapping || !mapping.mal_id) return [];

    const anilist = await malToAniList(mapping.mal_id);
    if (!anilist || !anilist.id) return [];

    const dbData = await findInDatabase(anilist.id);
    if (!dbData) return [];

    const mappedEpisode = normalizedType === "movie" ? 1 : (mapping.mal_episode || episode || 1);
    const token = findEpisodeToken(dbData, mappedEpisode);
    if (!token) return [];

    const streams = await resolveTokenStreams(token);
    const title = anilist.title && (anilist.title.english || anilist.title.romaji) ? (anilist.title.english || anilist.title.romaji) : tmdb.title;
    streams.forEach(stream => {
      stream.title = `${title} • Episode ${mappedEpisode}`;
    });
    return streams;
  } catch (error) {
    console.log(`[AnimeKai] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
