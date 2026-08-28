"use strict";

const PROVIDER_NAME = "Re:ANIME";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const FLIXCLOUD = "https://flixcloud.cc";
const ENC_DEC_API = "https://enc-dec.app/api";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BASE_HEADERS = { "User-Agent": USER_AGENT, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9" };
const FLIX_HEADERS = { ...BASE_HEADERS, "Origin": FLIXCLOUD, "Referer": `${FLIXCLOUD}/` };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...BASE_HEADERS, ...(options.headers || {}) }, skipSizeCheck: true });
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : "?"} for ${url}`);
  return response;
}

async function fetchJson(url, options = {}) {
  try { return await (await request(url, options)).json(); } catch (_) { return null; }
}

async function fetchText(url, options = {}) {
  try { return String(await (await request(url, options)).text() || ""); } catch (_) { return ""; }
}

function normalizedMediaType(mediaType) {
  return String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const list = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function getTmdbInfo(tmdbId, mediaType) {
  const data = await fetchJson(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`);
  if (!data) return null;
  return {
    title: mediaType === "movie" ? (data.title || data.original_title || "Anime") : (data.name || data.original_name || "Anime"),
    originalTitle: mediaType === "movie" ? (data.original_title || data.title || "") : (data.original_name || data.name || ""),
    imdbId: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || ""
  };
}

async function resolveMalEpisode(imdbId, season, episode) {
  if (!imdbId) return null;
  return await fetchJson(`https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(imdbId)}&s=${season || 1}&e=${episode || 1}`);
}

async function malToAniList(malId) {
  if (!malId) return null;
  const query = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id title{english romaji native}}}";
  const data = await fetchJson("https://graphql.anilist.co", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { idMal: parseInt(malId, 10) } })
  });
  return data && data.data && data.data.Media ? data.data.Media : null;
}

async function fetchReAnimeApi(path) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}${path}`, { headers: { "Accept": "application/json, text/plain, */*", "Referer": `${base}/home` } });
    if (data) return data;
  }
  return null;
}

async function findMovieByExactIdentity(tmdbId, meta) {
  const terms = [...new Set([meta.title, meta.originalTitle, String(meta.title || "").split(":")[0]].filter(Boolean))];
  const checked = new Set();
  for (const term of terms) {
    const search = await fetchReAnimeApi(`/api/v1/search?q=${encodeURIComponent(term)}&limit=12&offset=0`);
    const results = search && Array.isArray(search.results) ? search.results : [];
    for (const candidate of results) {
      const slug = String(candidate.anime_id || candidate.animeId || candidate.id || "").trim();
      if (!slug || checked.has(slug)) continue;
      checked.add(slug);
      const item = await fetchReAnimeApi(`/api/v1/anime/${encodeURIComponent(slug)}`);
      if (!item) continue;
      const itemTmdb = parseInt(item.themoviedb_id || item.tmdb_id || 0, 10) || 0;
      const itemImdb = String(item.imdb_id || "").toLowerCase();
      if (itemTmdb !== tmdbId && (!meta.imdbId || itemImdb !== String(meta.imdbId).toLowerCase())) continue;
      const id = parseInt(item.anilist_id || 0, 10) || 0;
      if (!id) continue;
      const title = item.title || candidate.title || {};
      return { id, title: { english: title.english || meta.title, romaji: title.romaji || meta.originalTitle, native: title.native || "" } };
    }
  }
  return null;
}

function audioLabel(dataType) {
  const type = String(dataType || "").toLowerCase();
  if (type === "dub" || type === "s-dub") return { tag: "DUB", language: "English" };
  if (type === "sub" || type === "s-sub") return { tag: "SUB", language: "Japanese" };
  return { tag: type ? type.toUpperCase() : "SOURCE", language: "Unknown" };
}

function serverPreference(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("hd-2")) return 0;
  if (n.includes("hd-1")) return 1;
  if (n.includes("maze")) return 2;
  return 3;
}

function selectServers(servers) {
  const ordered = (servers || []).filter(s => s && s.dataLink).sort((a, b) => {
    const aa = audioLabel(a.dataType).tag === "DUB" ? 0 : 1;
    const bb = audioLabel(b.dataType).tag === "DUB" ? 0 : 1;
    return aa !== bb ? aa - bb : serverPreference(a.serverName) - serverPreference(b.serverName);
  });
  const result = [], seen = new Set(), counts = { DUB: 0, SUB: 0, SOURCE: 0 };
  for (const server of ordered) {
    const audio = audioLabel(server.dataType).tag;
    const key = `${audio}|${String(server.serverName || "server").toLowerCase()}`;
    if (seen.has(key) || counts[audio] >= 2) continue;
    seen.add(key); counts[audio]++; result.push(server);
  }
  return result.slice(0, 5);
}

function extractAid(dataLink) {
  const match = String(dataLink || "").match(/\/e\/([a-z0-9]+)/i);
  return match ? match[1] : null;
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1] || match[0] : null;
}

function qualityRank(value) {
  const match = String(value || "").match(/\d{3,4}/);
  return match ? parseInt(match[0], 10) : 0;
}

async function resolveDirectDownload(server) {
  const aid = extractAid(server && server.dataLink);
  if (!aid) return null;
  const text = await fetchText(`${FLIXCLOUD}/d/${aid}/__data.json`, { headers: FLIX_HEADERS });
  const fileId = firstMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const token = firstMatch(text, /(eyJ[\w-]+\.[\w-]+\.[\w-]+)/);
  const base = firstMatch(text, /(https:\/\/fetch\d*\.flixcloud\.cc)/i) || FLIXCLOUD;
  const resolution = firstMatch(text, /(\d{3,4}p)/i) || "Original";
  if (!fileId || !token) return null;
  const audio = audioLabel(server.dataType), serverName = String(server.serverName || "Direct");
  return {
    name: `${PROVIDER_NAME} • ${serverName} • ${resolution} • ${audio.language} [${audio.tag}] • MKV`,
    title: `${PROVIDER_NAME} ${audio.language} [${audio.tag}]`,
    url: `${base}/download/${fileId}?token=${encodeURIComponent(token)}`,
    quality: resolution, provider: PROVIDER_NAME, type: "mp4", headers: FLIX_HEADERS, language: audio.language, subtitles: []
  };
}

function json5ToJson(value) {
  return String(value || "").replace(/([{,]\s*)([\w_]+)(\s*:)/g, '$1"$2"$3').replace(/,\s*([}\]])/g, "$1").replace(/:\s*undefined\b/g, ": null");
}

function extractSoftSubs(html) {
  const out = [], seen = new Set();
  const re = /\{\s*url:\s*"([^"]+)"\s*,\s*language:\s*"([^"]+)"[^}]*\}/g;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    const url = m[1], label = m[2].replace(/\\u0028/g, "(").replace(/\\u0029/g, ")");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const low = label.toLowerCase();
    const language = low.includes("english") ? "en" : low.includes("japanese") ? "ja" : low.includes("korean") ? "ko" : low.includes("chinese") || low.includes("mandarin") ? "zh" : "und";
    out.push({ url, language, name: `${label} [Re:ANIME Soft Subtitle]`, headers: FLIX_HEADERS });
  }
  return out;
}

async function resolveHlsFallback(server) {
  const embed = String(server && server.dataLink || "");
  if (!/^https?:\/\//i.test(embed)) return null;
  const html = await fetchText(embed, { headers: { ...FLIX_HEADERS, "Accept": "text/html,application/json,*/*" } });
  const match = html.match(/type:\s*"data",\s*data:\s*(\{.*?\})\s*,\s*uses:/s);
  if (!match) return null;
  let data;
  try { data = JSON.parse(json5ToJson(match[1])); } catch (_) { return null; }
  const subtitles = extractSoftSubs(html);
  delete data.subtitles; delete data.intro_chapter; delete data.outro_chapter;

  const token = await fetchJson(`${ENC_DEC_API}/dec-flixcloud?type=token`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data })
  });
  if (!token || token.status !== 200 || !token.result || !token.result.token) return null;
  const encrypted = await fetchJson(`${FLIXCLOUD}/api/m3u8/${encodeURIComponent(token.result.token)}`, { headers: FLIX_HEADERS });
  if (!encrypted) return null;
  const stream = await fetchJson(`${ENC_DEC_API}/dec-flixcloud?type=stream`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { context: token.result.context, stream_response: encrypted } })
  });
  if (!stream || stream.status !== 200 || !stream.result || !stream.result.stream) return null;
  const w = stream.result.context && stream.result.context.w_payload;
  if (!w) return null;
  const audio = audioLabel(server.dataType), serverName = String(server.serverName || "HLS");
  return {
    name: `${PROVIDER_NAME} • ${serverName} • Auto • ${audio.language} [${audio.tag}] • HLS`,
    title: `${PROVIDER_NAME} ${audio.language} [${audio.tag}]`,
    url: `${ENC_DEC_API}/parse-flixcloud?url=${encodeURIComponent(stream.result.stream)}&w_payload=${encodeURIComponent(w)}`,
    quality: "Auto", provider: PROVIDER_NAME, type: "m3u8", headers: FLIX_HEADERS, language: audio.language, subtitles
  };
}

async function resolveServer(server) {
  return await resolveDirectDownload(server).catch(() => null) || await resolveHlsFallback(server).catch(() => null);
}

async function fetchReAnimeServers(anilistId, episodeNumber) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}/api/flix/${anilistId}/${episodeNumber}`, { headers: { "Accept": "application/json, text/plain, */*", "Referer": `${base}/home` } });
    if (data && data.success && Array.isArray(data.servers) && data.servers.length) return data.servers;
  }
  return [];
}

async function resolveTarget(tmdbId, type, tmdb, season, episode) {
  const mapping = await resolveMalEpisode(tmdb.imdbId, type === "movie" ? 1 : (parseInt(season, 10) || 1), type === "movie" ? 1 : (parseFloat(episode) || 1));
  if (mapping && mapping.mal_id) {
    const anilist = await malToAniList(mapping.mal_id);
    if (anilist && anilist.id) return { anilist, episode: type === "movie" ? 1 : (parseFloat(mapping.mal_episode) || parseFloat(episode) || 1) };
  }
  if (type === "movie") {
    const anilist = await findMovieByExactIdentity(tmdbId, tmdb);
    if (anilist) return { anilist, episode: 1 };
  }
  return null;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const type = normalizedMediaType(mediaType);
    const tmdbId = await resolveTmdbId(inputId, type);
    if (!tmdbId) return [];
    const tmdb = await getTmdbInfo(tmdbId, type);
    if (!tmdb) return [];
    const target = await resolveTarget(tmdbId, type, tmdb, season, episode);
    if (!target) return [];
    const servers = selectServers(await fetchReAnimeServers(target.anilist.id, target.episode));
    if (!servers.length) return [];
    const settled = await Promise.all(servers.map(resolveServer));
    const animeTitle = target.anilist.title && (target.anilist.title.english || target.anilist.title.romaji || target.anilist.title.native) || tmdb.title;
    const seen = new Set();
    return settled.filter(Boolean).filter(stream => {
      const key = `${stream.url}|${stream.language}|${stream.type}`;
      if (!stream.url || seen.has(key)) return false;
      seen.add(key); stream.title = `${animeTitle} • Episode ${target.episode} • ${stream.title}`; return true;
    }).sort((a, b) => {
      const dubA = a.language === "English" ? 1 : 0, dubB = b.language === "English" ? 1 : 0;
      if (dubA !== dubB) return dubB - dubA;
      const mkvA = /MKV/i.test(a.name) ? 1 : 0, mkvB = /MKV/i.test(b.name) ? 1 : 0;
      if (mkvA !== mkvB) return mkvB - mkvA;
      return qualityRank(b.quality) - qualityRank(a.quality);
    });
  } catch (error) {
    console.log(`[Re:ANIME] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
