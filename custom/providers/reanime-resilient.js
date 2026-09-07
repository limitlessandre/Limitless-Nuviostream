"use strict";

const PROVIDER_NAME = "Re:ANIME";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const FLIXCLOUD = "https://flixcloud.cc";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const BASE_HEADERS = { "User-Agent":UA, "Accept":"*/*", "Accept-Language":"en-US,en;q=0.9" };
const FLIX_HEADERS = { ...BASE_HEADERS, "Origin":FLIXCLOUD, "Referer":`${FLIXCLOUD}/` };
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

async function loadIdentity() {
  if (identityCache && typeof identityCache.resolveAnimeIdentity === "function") return identityCache;
  try {
    const response = await fetch(IDENTITY_URL, { skipSizeCheck:true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.resolveAnimeIdentity !== "function") return null;
    identityCache = exported;
    return exported;
  } catch (_) { return null; }
}

function uniq(values) {
  const seen = new Set();
  return (values || []).filter(value => {
    const text = String(value || "").trim();
    if (!text) return false;
    const key = text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleValues(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "object") return [value.english, value.romaji, value.userPreferred, value.native].filter(Boolean);
  return [String(value)];
}

function strictTitleMatch(candidate, aliases) {
  const values = titleValues(candidate);
  for (const value of values) {
    const a = normalize(value);
    if (!a) continue;
    for (const alias of aliases || []) if (a === normalize(alias)) return true;
  }
  return false;
}

async function reanimeApi(path) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}${path}`, { headers:{ "Accept":"application/json, text/plain, */*", "Referer":`${base}/home` } });
    if (data) return data;
  }
  return null;
}

function searchResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function candidateSlug(candidate) {
  return String(candidate && (candidate.anime_id || candidate.animeId || candidate.slug || candidate.id) || "").trim();
}

async function resolveCatalogTarget(identity) {
  if (identity.anilistId) {
    return {
      anilistId:Number(identity.anilistId),
      title:(identity.animeAliases && identity.animeAliases[0]) || identity.title,
      source:"anilist"
    };
  }

  const seen = new Set();
  for (const term of (identity.aliases || []).slice(0, 10)) {
    const search = await reanimeApi(`/api/v1/search?q=${encodeURIComponent(term)}&limit=15&offset=0`);
    for (const candidate of searchResults(search)) {
      const slug = candidateSlug(candidate);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const detail = await reanimeApi(`/api/v1/anime/${encodeURIComponent(slug)}`);
      if (!detail) continue;

      const detailTmdb = Number(detail.themoviedb_id || detail.tmdb_id || 0) || 0;
      const detailImdb = String(detail.imdb_id || "").toLowerCase();
      const requestedImdb = String(identity.imdbId || "").toLowerCase();
      const exactId = (detailTmdb && detailTmdb === Number(identity.tmdbId)) || (requestedImdb && detailImdb === requestedImdb);
      const detailTitle = detail.title || candidate.title || candidate.name;
      const exactTitle = strictTitleMatch(detailTitle, identity.aliases || []);
      if (!exactId && !exactTitle) continue;

      const anilistId = Number(detail.anilist_id || detail.anilistId || candidate.anilist_id || 0) || 0;
      if (!anilistId) continue;
      const display = titleValues(detailTitle)[0] || identity.title;
      return { anilistId, title:display, source:exactId ? "tmdb-imdb-fallback" : "strict-title-fallback" };
    }
  }
  return null;
}

function significantTokens(value) {
  const stop = new Set(["the", "and", "episode", "special", "season", "part", "cour", "ova", "tv"]);
  return normalize(value).split(" ").filter(token => token.length >= 4 && !stop.has(token));
}

function explicitFalse(value) {
  return value === false || value === 0 || String(value).toLowerCase() === "false" || String(value) === "0";
}

function specialInfoRow(label, detail, candidate) {
  const status = String((detail && detail.status) || (candidate && candidate.status) || "").trim();
  const suffix = status ? ` • Source status: ${status}` : "";
  return {
    name:`${PROVIDER_NAME} • INFO • No Episode on Source`,
    title:`${label} • Re:ANIME catalog entry exists, but no playable episode is currently available${suffix}`,
    url:"https://reanime.to/favicon.ico",
    quality:"Info",
    provider:PROVIDER_NAME,
    type:"mp4",
    language:"Unavailable",
    subtitles:[]
  };
}

async function resolveTmdbSpecial(inputId, episode) {
  const raw = String(inputId || "").trim();
  let tmdbId = /^\d+$/.test(raw) ? Number(raw) : null;
  if (!tmdbId && /^tt\d+$/i.test(raw)) {
    const found = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const list = found && found.tv_results;
    tmdbId = Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
  }
  if (!tmdbId) return null;

  const show = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
  const special = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/0/episode/${encodeURIComponent(String(episode || 1))}?api_key=${TMDB_API_KEY}`);
  if (!show || !special || !special.name) return null;
  return {
    tmdbId,
    showTitle:show.name || show.original_name || "",
    originalShowTitle:show.original_name || show.name || "",
    specialTitle:special.name,
    label:special.name
  };
}

function specialCandidateScore(candidate, special) {
  const hay = normalize([
    ...titleValues(candidate && candidate.title),
    candidate && candidate.name,
    candidate && candidate.english_title,
    candidate && candidate.romaji_title,
    candidate && candidate.alternative_title,
    candidate && candidate.anime_id,
    candidate && candidate.slug
  ].filter(Boolean).join(" "));
  if (!hay) return 0;

  const specialTokens = significantTokens(special.specialTitle);
  if (!specialTokens.length || !specialTokens.every(token => hay.includes(token))) return 0;
  let score = 80 + specialTokens.length * 5;
  const showTokens = significantTokens(special.showTitle);
  let showHits = 0;
  for (const token of showTokens.slice(0, 6)) if (hay.includes(token)) showHits += 1;
  if (showTokens.length && !showHits) return 0;
  score += showHits * 3;
  if (/\bspecial\b|\bova\b|\bepisode\s*0\b/.test(hay)) score += 8;
  return score;
}

async function resolveSpecialCatalogTarget(inputId, episode) {
  const special = await resolveTmdbSpecial(inputId, episode);
  if (!special) return null;

  const terms = uniq([
    `${special.showTitle} ${special.specialTitle}`,
    `${special.originalShowTitle} ${special.specialTitle}`,
    special.specialTitle
  ]);
  const ranked = [], seen = new Set();
  for (const term of terms) {
    const search = await reanimeApi(`/api/v1/search?q=${encodeURIComponent(term)}&limit=15&offset=0`);
    for (const candidate of searchResults(search)) {
      const slug = candidateSlug(candidate);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const score = specialCandidateScore(candidate, special);
      if (score > 0) ranked.push({ candidate, slug, score });
    }
  }
  ranked.sort((a,b) => b.score - a.score);

  for (const match of ranked.slice(0, 5)) {
    const detail = await reanimeApi(`/api/v1/anime/${encodeURIComponent(match.slug)}`);
    if (!detail) continue;
    if (explicitFalse(match.candidate && match.candidate.can_watch) || explicitFalse(detail.can_watch)) {
      return { info:specialInfoRow(special.label, detail, match.candidate) };
    }
    const anilistId = Number(detail.anilist_id || detail.anilistId || match.candidate.anilist_id || 0) || 0;
    if (!anilistId) continue;
    const display = titleValues(detail.title || match.candidate.title || match.candidate.name)[0] || special.label;
    return { target:{ anilistId, title:display, source:"season-0-special" }, resolvedEpisode:1 };
  }
  return null;
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
  for (const server of valid.filter(x => serverPreference(x.serverName) === best)) {
    const tag = audioTag(server.dataType), link = String(server.dataLink || "");
    const key = `${tag}|${link}`;
    if (!link || seen.has(key) || counts[tag] >= 2) continue;
    seen.add(key); counts[tag]++; chosen.push(server);
  }
  return chosen;
}

function extractAid(link) {
  const m = String(link || "").match(/\/e\/([a-z0-9]+)/i);
  return m ? m[1] : "";
}

function firstMatch(text, regex) {
  const m = String(text || "").match(regex);
  return m ? (m[1] || m[0]) : "";
}

function qualityRank(value) {
  const m = String(value || "").match(/\d{3,4}/);
  return m ? Number(m[0]) : 0;
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
    const c = classify(group.tags);
    return {
      name:`${PROVIDER_NAME} • ${group.serverName} • ${group.resolution} • ${c.label} • MKV`,
      title:`${animeTitle} • Episode ${episode} • ${PROVIDER_NAME} • ${c.label}`,
      url:group.url,
      quality:group.resolution,
      provider:PROVIDER_NAME,
      type:"mp4",
      headers:FLIX_HEADERS,
      language:c.language,
      subtitles:[],
      _rank:c.key === "dual" ? 0 : c.key === "dub" ? 1 : c.key === "sub" ? 2 : 3,
      _index:group.index
    };
  }).sort((a,b) => a._rank - b._rank || qualityRank(b.quality) - qualityRank(a.quality) || a._index - b._index)
    .map(row => { delete row._rank; delete row._index; return row; });
}

async function fetchServers(anilistId, episode) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}/api/flix/${anilistId}/${episode}`, { headers:{ "Accept":"application/json, text/plain, */*", "Referer":`${base}/home` } });
    if (data && data.success && Array.isArray(data.servers) && data.servers.length) return data.servers;
  }
  return [];
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";

    // Season 0 entries are separate anime/special records on Re:ANIME, not episode
    // numbers on the parent TV AniList id. Resolve them by TMDB's special episode
    // title first so S0E1/S0E2 cannot silently fall through to the main show's E1.
    if (type !== "movie" && Number(season) === 0) {
      const special = await resolveSpecialCatalogTarget(inputId, episode);
      if (!special) return [];
      if (special.info) return [special.info];
      const servers = selectServers(await fetchServers(special.target.anilistId, special.resolvedEpisode));
      if (!servers.length) return [];
      const assets = await Promise.all(servers.map(server => resolveDirectAsset(server).catch(() => null)));
      return buildStreams(assets, special.target.title, special.resolvedEpisode);
    }

    const helper = await loadIdentity();
    if (!helper) return [];
    const identity = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    if (!identity || !identity.isAnime) return [];

    const target = await resolveCatalogTarget(identity);
    if (!target || !target.anilistId) return [];
    const resolvedEpisode = identity.type === "movie" ? 1 : Number(identity.mappedEpisode || episode || 1);
    const servers = selectServers(await fetchServers(target.anilistId, resolvedEpisode));
    if (!servers.length) return [];
    const assets = await Promise.all(servers.map(server => resolveDirectAsset(server).catch(() => null)));
    return buildStreams(assets, target.title || identity.title || "Anime", resolvedEpisode);
  } catch (error) {
    console.log(`[${PROVIDER_NAME}] ${error && error.message ? error.message : error}`);
    return [];
  }
}

module.exports = { getStreams };
