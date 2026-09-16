"use strict";

// Re:ANIME Nexus season-aware resolver.
// Seasons 0/1 and movies stay on the previously validated resilient provider.
// For TV seasons > 1, resolve a distinct season-specific AniList record before
// asking Re:ANIME for episode servers. Never silently fall back to season 1.

const PROVIDER_NAME = "Re:ANIME";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/reanime-resilient-v2.js";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const FLIXCLOUD = "https://flixcloud.cc";
const ANILIST = "https://graphql.anilist.co";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const BASE_HEADERS = { "User-Agent":UA, "Accept":"*/*", "Accept-Language":"en-US,en;q=0.9" };
const FLIX_HEADERS = { ...BASE_HEADERS, "Origin":FLIXCLOUD, "Referer":`${FLIXCLOUD}/` };
let baseCache = null;
let identityCache = null;

async function request(url, options) {
  const response = await fetch(url, {
    ...(options || {}),
    headers:{ ...BASE_HEADERS, ...((options && options.headers) || {}) },
    skipSizeCheck:true
  });
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : "?"}`);
  return response;
}

async function fetchJson(url, options) {
  try { return JSON.parse(String(await (await request(url, options)).text() || "{}")); }
  catch (_) { return null; }
}

async function fetchText(url, options) {
  try { return String(await (await request(url, options)).text() || ""); }
  catch (_) { return ""; }
}

async function loadModule(url, expected) {
  try {
    const response = await fetch(url, { skipSizeCheck:true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    return exported && typeof exported[expected] === "function" ? exported : null;
  } catch (_) { return null; }
}

async function loadBase() {
  if (baseCache && typeof baseCache.getStreams === "function") return baseCache;
  baseCache = await loadModule(BASE_URL, "getStreams");
  return baseCache;
}

async function loadIdentity() {
  if (identityCache && typeof identityCache.resolveAnimeIdentity === "function") return identityCache;
  identityCache = await loadModule(IDENTITY_URL, "resolveAnimeIdentity");
  return identityCache;
}

function uniq(values) {
  const out = [], seen = new Set();
  for (const value of values || []) {
    const text = String(value == null ? "" : value).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(text);
  }
  return out;
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function titleValues(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(titleValues);
  if (typeof value === "object") return [value.english, value.romaji, value.userPreferred, value.native].filter(Boolean);
  return [String(value)];
}

function ordinal(n) {
  const value = Number(n || 0), mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function meaningfulTokens(value) {
  const stop = new Set(["the", "and", "of", "a", "an", "to", "season", "part", "cour", "tv", "anime"]);
  return normalize(value).split(" ").filter(token => token && !stop.has(token) && !/^\d+(?:st|nd|rd|th)?$/.test(token));
}

function stripSeasonSuffix(value) {
  return normalize(value)
    .replace(/\bseason\s+\d+\b/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)?\s+season\b/g, " ")
    .replace(/\bs\s*\d+\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function seasonHints(value) {
  const text = normalize(value), out = [];
  for (const re of [/\bseason\s+(\d+)\b/g, /\b(\d+)(?:st|nd|rd|th)?\s+season\b/g, /\bs\s*(\d+)\b/g]) {
    let match;
    while ((match = re.exec(text))) out.push(Number(match[1]));
  }
  return [...new Set(out.filter(Number.isFinite))];
}

function candidateTitles(media) {
  return uniq([].concat(titleValues(media && media.title)).concat(media && media.synonyms || []));
}

function baseOverlap(candidateText, aliases) {
  const hay = new Set(meaningfulTokens(stripSeasonSuffix(candidateText)));
  let best = 0;
  for (const alias of aliases || []) {
    const tokens = meaningfulTokens(stripSeasonSuffix(alias));
    if (!tokens.length) continue;
    const hits = tokens.filter(token => hay.has(token)).length;
    best = Math.max(best, hits / tokens.length);
  }
  return best;
}

function seasonCandidateScore(media, context) {
  if (!media || !context) return -1;
  const id = Number(media.id || 0) || 0;
  if (!id || id === Number(context.baseAniListId || 0)) return -1;

  const titles = candidateTitles(media);
  if (!titles.length) return -1;
  const joined = titles.join(" ");
  const hints = seasonHints(joined);
  if (hints.length && !hints.includes(context.seasonNumber)) return -1;

  const overlap = baseOverlap(joined, context.baseAliases);
  if (overlap < 0.55) return -1;

  const year = Number(media.seasonYear || 0) || 0;
  const yearExact = !!(context.seasonYear && year === context.seasonYear);
  const yearNear = !!(context.seasonYear && year && Math.abs(year - context.seasonYear) === 1);
  const explicit = hints.includes(context.seasonNumber);

  let generatedExact = false;
  const normalizedTitles = new Set(titles.map(normalize));
  for (const alias of context.baseAliases) {
    const base = stripSeasonSuffix(alias);
    if (!base) continue;
    const generated = [
      `${base} season ${context.seasonNumber}`,
      `${base} ${ordinal(context.seasonNumber)} season`
    ].map(normalize);
    if (generated.some(value => normalizedTitles.has(value))) { generatedExact = true; break; }
  }

  // A later season must have positive season evidence. Numeric season wording is
  // strongest; exact TMDB-season year plus strong title overlap is the conservative
  // fallback for sequels whose official title does not include a number.
  if (!explicit && !generatedExact && !(yearExact && overlap >= 0.8)) return -1;

  let score = Math.round(overlap * 70);
  if (explicit) score += 45;
  if (generatedExact) score += 35;
  if (yearExact) score += 25;
  else if (yearNear) score += 5;
  return score;
}

async function resolveTmdbId(inputId) {
  const raw = String(inputId || "").trim();
  const tmdb = raw.match(/^(?:tmdb:)?(\d+)$/i);
  if (tmdb) return Number(tmdb[1]);
  const imdb = raw.match(/^(?:imdb:)?(tt\d+)$/i);
  if (!imdb) return null;
  const found = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdb[1])}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const list = found && found.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
}

async function seasonContext(inputId, season, identity) {
  const tmdbId = await resolveTmdbId(inputId);
  if (!tmdbId) return null;
  const [show, data] = await Promise.all([
    fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`),
    fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${Number(season)}?api_key=${TMDB_API_KEY}`)
  ]);
  if (!show || !data) return null;

  const alt = show.alternative_titles && Array.isArray(show.alternative_titles.results)
    ? show.alternative_titles.results.map(item => item && item.title) : [];
  const firstEpisode = Array.isArray(data.episodes) ? data.episodes.find(item => item && item.air_date) : null;
  const yearText = String(data.air_date || (firstEpisode && firstEpisode.air_date) || "");
  const seasonYear = /^\d{4}/.test(yearText) ? Number(yearText.slice(0, 4)) : 0;
  const baseAliases = uniq([].concat(
    identity && identity.animeAliases || [],
    identity && identity.aliases || [],
    identity && identity.fallbackAliases || [],
    [identity && identity.title, identity && identity.originalTitle, show.name, show.original_name],
    alt
  )).filter(value => meaningfulTokens(stripSeasonSuffix(value)).length >= 2).slice(0, 24);
  if (!baseAliases.length) return null;
  return {
    tmdbId,
    seasonNumber:Number(season),
    seasonYear,
    seasonName:String(data.name || `Season ${season}`),
    baseAliases,
    baseAniListId:Number(identity && identity.anilistId || 0) || 0
  };
}

async function anilistPage(search, year) {
  const withYear = Number(year || 0) > 0;
  const query = withYear
    ? `query($search:String,$year:Int){Page(page:1,perPage:12){media(search:$search,type:ANIME,seasonYear:$year){id idMal seasonYear format episodes title{english romaji native userPreferred} synonyms}}}`
    : `query($search:String){Page(page:1,perPage:12){media(search:$search,type:ANIME){id idMal seasonYear format episodes title{english romaji native userPreferred} synonyms}}}`;
  const variables = withYear ? { search, year:Number(year) } : { search };
  const data = await fetchJson(ANILIST, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Accept":"application/json", "Origin":"https://anilist.co", "Referer":"https://anilist.co/" },
    body:JSON.stringify({ query, variables })
  });
  const media = data && data.data && data.data.Page && data.data.Page.media;
  return Array.isArray(media) ? media : [];
}

async function resolveSeasonTarget(inputId, season, identity) {
  const context = await seasonContext(inputId, season, identity);
  if (!context) return null;

  const searchTerms = [];
  for (const alias of context.baseAliases.slice(0, 10)) {
    const base = stripSeasonSuffix(alias);
    if (!base) continue;
    searchTerms.push(`${base} Season ${context.seasonNumber}`);
    searchTerms.push(`${base} ${ordinal(context.seasonNumber)} Season`);
  }
  // Also search the strongest parent aliases with the season year filter. This
  // catches official sequel names such as "Final Season" that omit a number.
  searchTerms.push(...context.baseAliases.slice(0, 5));

  const seen = new Map();
  for (const term of uniq(searchTerms).slice(0, 16)) {
    const batches = [];
    if (context.seasonYear) batches.push(await anilistPage(term, context.seasonYear));
    batches.push(await anilistPage(term, 0));
    for (const media of batches.flat()) {
      const id = Number(media && media.id || 0) || 0;
      if (!id || seen.has(id)) continue;
      const score = seasonCandidateScore(media, context);
      if (score >= 0) seen.set(id, { media, score });
    }
  }

  const ranked = [...seen.values()].sort((a,b) => b.score - a.score || Number(a.media.id) - Number(b.media.id));
  if (!ranked.length || ranked[0].score < 85) return null;
  // If two weakly-evidenced candidates are effectively tied, fail closed rather
  // than selecting the wrong cour/spinoff. Explicit numbered matches naturally
  // score above this ambiguity guard.
  if (ranked[1] && ranked[0].score - ranked[1].score < 5) {
    const topHints = seasonHints(candidateTitles(ranked[0].media).join(" "));
    if (!topHints.includes(context.seasonNumber)) return null;
  }

  const best = ranked[0].media;
  const title = candidateTitles(best)[0] || context.seasonName;
  return { anilistId:Number(best.id), title, source:"anilist-season", seasonYear:context.seasonYear };
}

function audioTag(dataType) {
  const type = String(dataType || "").toLowerCase();
  if (type === "dub" || type === "s-dub") return "DUB";
  if (type === "sub" || type === "s-sub") return "SUB";
  return "SOURCE";
}

function serverPreference(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("hd-2")) return 0;
  if (n.includes("hd-1")) return 1;
  if (n.includes("maze")) return 2;
  return 3;
}

function selectServers(servers) {
  const valid = (servers || []).filter(server => server && server.dataLink);
  if (!valid.length) return [];
  const best = valid.reduce((rank, server) => Math.min(rank, serverPreference(server.serverName)), 99);
  const chosen = [], counts = { DUB:0, SUB:0, SOURCE:0 }, seen = new Set();
  for (const server of valid.filter(item => serverPreference(item.serverName) === best)) {
    const tag = audioTag(server.dataType), link = String(server.dataLink || "");
    const key = `${tag}|${link}`;
    if (!link || seen.has(key) || counts[tag] >= 2) continue;
    seen.add(key); counts[tag]++; chosen.push(server);
  }
  return chosen;
}

async function fetchServers(anilistId, episode) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}/api/flix/${Number(anilistId)}/${Number(episode || 1)}`, {
      headers:{ "Accept":"application/json, text/plain, */*", "Referer":`${base}/home` }
    });
    if (data && data.success && Array.isArray(data.servers) && data.servers.length) return data.servers;
  }
  return [];
}

function extractAid(link) {
  const match = String(link || "").match(/\/e\/([a-z0-9]+)/i);
  return match ? match[1] : "";
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? (match[1] || match[0]) : "";
}

function qualityRank(value) {
  const match = String(value || "").match(/\d{3,4}/);
  return match ? Number(match[0]) : 0;
}

async function resolveDirectAsset(server) {
  const aid = extractAid(server && server.dataLink);
  if (!aid) return null;
  const text = await fetchText(`${FLIXCLOUD}/d/${aid}/__data.json`, { headers:FLIX_HEADERS });
  if (!text) return null;
  const fileId = firstMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const token = firstMatch(text, /(eyJ[\w-]+\.[\w-]+\.[\w-]+)/);
  const base = firstMatch(text, /(https:\/\/fetch\d*\.flixcloud\.cc)/i) || FLIXCLOUD;
  const resolution = firstMatch(text, /(\d{3,4}p)/i) || "Original";
  if (!fileId || !token) return null;
  return {
    fileId, token, base, resolution,
    serverName:String(server.serverName || "Server"),
    audioTag:audioTag(server.dataType),
    url:`${base}/download/${fileId}?token=${encodeURIComponent(token)}`
  };
}

function classify(tags) {
  if (tags.has("SUB") && tags.has("DUB")) return { key:"dual", label:"Dual Audio + Subs", language:"Multi" };
  if (tags.has("DUB")) return { key:"dub", label:"English Dub", language:"English" };
  if (tags.has("SUB")) return { key:"sub", label:"Japanese + Subs", language:"Japanese" };
  return { key:"source", label:"Source", language:"Unknown" };
}

function buildStreams(assets, animeTitle, episode) {
  const groups = new Map();
  for (const asset of (assets || []).filter(Boolean)) {
    const key = `${asset.base}|${asset.fileId}`;
    let group = groups.get(key);
    if (!group) { group = { ...asset, tags:new Set(), index:groups.size }; groups.set(key, group); }
    group.tags.add(asset.audioTag);
    if (qualityRank(asset.resolution) > qualityRank(group.resolution)) group.resolution = asset.resolution;
  }
  return [...groups.values()].map(group => {
    const classification = classify(group.tags);
    return {
      name:`${PROVIDER_NAME} • ${group.serverName} • ${group.resolution} • ${classification.label} • MKV`,
      title:`${animeTitle} • Episode ${episode} • ${PROVIDER_NAME} • ${classification.label}`,
      url:group.url,
      quality:group.resolution,
      provider:PROVIDER_NAME,
      type:"mp4",
      headers:FLIX_HEADERS,
      language:classification.language,
      subtitles:[],
      _rank:classification.key === "dual" ? 0 : classification.key === "dub" ? 1 : classification.key === "sub" ? 2 : 3,
      _index:group.index
    };
  }).sort((a,b) => a._rank - b._rank || qualityRank(b.quality) - qualityRank(a.quality) || a._index - b._index)
    .map(row => { delete row._rank; delete row._index; return row; });
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  const seasonNumber = Number(season || 0);

  // Preserve the already-validated paths for movies, Season 0 specials and Season 1.
  if (type === "movie" || seasonNumber <= 1) {
    const base = await loadBase();
    return base ? base.getStreams(inputId, mediaType, season, episode) : [];
  }

  try {
    const helper = await loadIdentity();
    if (!helper) return [];
    const identity = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    if (!identity || !identity.isAnime) return [];

    const target = await resolveSeasonTarget(inputId, seasonNumber, identity);
    if (!target || !target.anilistId) return [];

    const resolvedEpisode = Number(episode || 1);
    const servers = selectServers(await fetchServers(target.anilistId, resolvedEpisode));
    if (!servers.length) return [];
    const assets = await Promise.all(servers.map(server => resolveDirectAsset(server).catch(() => null)));
    return buildStreams(assets, target.title || identity.title || "Anime", resolvedEpisode);
  } catch (error) {
    console.log(`[${PROVIDER_NAME}] season ${seasonNumber}: ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams,
    __test:{ ordinal, stripSeasonSuffix, seasonHints, seasonCandidateScore, baseOverlap }
  };
} else globalThis.getStreams = getStreams;
