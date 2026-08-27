"use strict";

const PROVIDER_NAME = "Re:ANIME";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz"];
const FLIXCLOUD = "https://flixcloud.cc";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

const FLIX_HEADERS = {
  ...BASE_HEADERS,
  "Referer": `${FLIXCLOUD}/`
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
  if (!data) return null;
  const list = mediaType === "movie" ? data.movie_results : data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function getTmdbInfo(tmdbId, mediaType) {
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`
  );
  if (!data) return null;

  return {
    title: mediaType === "movie"
      ? (data.title || data.original_title || "Anime")
      : (data.name || data.original_name || "Anime"),
    imdbId: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || ""
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
  const query = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native} format}}";
  const data = await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: parseInt(malId, 10) } })
  });
  return data && data.data && data.data.Media ? data.data.Media : null;
}

function audioLabel(dataType) {
  const type = String(dataType || "").toLowerCase();
  if (type === "dub") return { tag: "DUB", language: "English" };
  if (type === "sub") return { tag: "SUB", language: "Japanese" };
  return { tag: type ? type.toUpperCase() : "SOURCE", language: "Unknown" };
}

function serverRank(server) {
  const type = String(server && server.dataType || "").toLowerCase();
  const name = String(server && server.serverName || "").toLowerCase();
  let score = 0;
  if (type === "dub") score += 40;
  if (type === "sub") score += 30;
  if (name.includes("hd-1")) score += 20;
  if (name.includes("hd-2")) score += 10;
  return score;
}

function extractAid(dataLink) {
  const match = String(dataLink || "").match(/\/e\/([a-z0-9]+)/i);
  return match ? match[1] : null;
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1] || match[0] : null;
}

async function resolveDirectDownload(server) {
  const aid = extractAid(server && server.dataLink);
  if (!aid) return null;

  const dataText = await fetchText(`${FLIXCLOUD}/d/${aid}/__data.json`, { headers: FLIX_HEADERS });
  if (!dataText) return null;

  const fileId = firstMatch(dataText, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const token = firstMatch(dataText, /(eyJ[\w-]+\.[\w-]+\.[\w-]+)/);
  const fetchBase = firstMatch(dataText, /(https:\/\/fetch\d*\.flixcloud\.cc)/i) || FLIXCLOUD;
  const resolution = firstMatch(dataText, /(\d{3,4}p)/i) || "Original";
  if (!fileId || !token) return null;

  const audio = audioLabel(server.dataType);
  const serverName = String(server.serverName || "Direct").trim() || "Direct";
  const streamUrl = `${fetchBase}/download/${fileId}?token=${encodeURIComponent(token)}`;

  return {
    name: `${PROVIDER_NAME} • ${serverName} • ${resolution} • ${audio.language} [${audio.tag}] • MKV`,
    title: `${PROVIDER_NAME} ${audio.language} [${audio.tag}]`,
    url: streamUrl,
    quality: resolution,
    provider: PROVIDER_NAME,
    type: "mp4",
    headers: FLIX_HEADERS,
    language: audio.language,
    subtitles: []
  };
}

async function fetchReAnimeServers(anilistId, episodeNumber) {
  for (const baseUrl of REANIME_DOMAINS) {
    const referer = `${baseUrl}/home`;
    const data = await fetchJson(`${baseUrl}/api/flix/${anilistId}/${episodeNumber}`, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Referer": referer
      }
    });
    if (data && data.success && Array.isArray(data.servers) && data.servers.length) {
      return { baseUrl, servers: data.servers };
    }
  }
  return null;
}

function qualityRank(value) {
  const match = String(value || "").match(/\d{3,4}/);
  return match ? parseInt(match[0], 10) : 0;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const type = normalizedMediaType(mediaType);
    const tmdbId = await resolveTmdbId(inputId, type);
    if (!tmdbId) return [];

    const tmdb = await getTmdbInfo(tmdbId, type);
    if (!tmdb || !tmdb.imdbId) return [];

    // Convert Nuvio/TMDB season numbering to the exact MAL anime + episode.
    // This avoids title mutation and split-cour/season guessing.
    const mapping = await resolveMalEpisode(
      tmdb.imdbId,
      type === "movie" ? 1 : (parseInt(season, 10) || 1),
      type === "movie" ? 1 : (parseFloat(episode) || 1)
    );
    if (!mapping || !mapping.mal_id) return [];

    const anilist = await malToAniList(mapping.mal_id);
    if (!anilist || !anilist.id) return [];

    const mappedEpisode = type === "movie"
      ? 1
      : (parseFloat(mapping.mal_episode) || parseFloat(episode) || 1);

    const reanime = await fetchReAnimeServers(anilist.id, mappedEpisode);
    if (!reanime) return [];

    // Re:ANIME's HLS path currently requires FlixCloud segment XOR/proxy handling.
    // The direct MKV path is plaintext and portable to Nuvio, so Nexus starts there.
    const orderedServers = reanime.servers.slice().sort((a, b) => serverRank(b) - serverRank(a));
    const settled = await Promise.all(
      orderedServers.map(server => resolveDirectDownload(server).catch(() => null))
    );

    const animeTitle = anilist.title && (anilist.title.english || anilist.title.romaji || anilist.title.native)
      ? (anilist.title.english || anilist.title.romaji || anilist.title.native)
      : tmdb.title;

    const seen = new Set();
    return settled
      .filter(Boolean)
      .filter(stream => {
        if (!stream.url || seen.has(stream.url)) return false;
        seen.add(stream.url);
        stream.title = `${animeTitle} • Episode ${mappedEpisode} • ${stream.title}`;
        return true;
      })
      .sort((a, b) => {
        const langA = a.language === "English" ? 1 : 0;
        const langB = b.language === "English" ? 1 : 0;
        if (langA !== langB) return langB - langA;
        return qualityRank(b.quality) - qualityRank(a.quality);
      });
  } catch (error) {
    console.log(`[Re:ANIME] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
