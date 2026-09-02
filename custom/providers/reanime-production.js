"use strict";

const PROVIDER_NAME = "Re:ANIME";
const BASE_PROVIDER_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/reanime.js";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const FLIXCLOUD = "https://flixcloud.cc";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

const FLIX_HEADERS = {
  ...BASE_HEADERS,
  "Origin": FLIXCLOUD,
  "Referer": `${FLIXCLOUD}/`
};

let cachedBase = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
    skipSizeCheck: true
  });
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : "?"} for ${url}`);
  return response;
}

async function fetchJson(url, options = {}) {
  try { return await (await request(url, options)).json(); } catch (_) { return null; }
}

async function fetchText(url, options = {}) {
  try { return String(await (await request(url, options)).text() || ""); } catch (_) { return ""; }
}

async function loadBase() {
  if (cachedBase && typeof cachedBase.getStreams === "function") return cachedBase;
  try {
    const response = await fetch(BASE_PROVIDER_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const localRequire = function(name) { throw new Error(`Unsupported nested require: ${name}`); };
    const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
    const exported = factory(mod, mod.exports, localRequire) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedBase = exported;
    return cachedBase;
  } catch (_) {
    return null;
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return [value.english, value.romaji, value.native, value.userPreferred]
      .filter(Boolean)
      .join(" ");
  }
  return String(value);
}

function slugFromCandidate(candidate) {
  return String(candidate && (candidate.anime_id || candidate.animeId || candidate.slug || candidate.id) || "").trim();
}

function significantTokens(value) {
  const stop = new Set(["the", "and", "episode", "special", "season", "part", "cour", "jobless", "reincarnation"]);
  return normalize(value)
    .split(" ")
    .filter(token => token.length >= 4 && !stop.has(token));
}

function candidateScore(candidate, specialName, showTitle) {
  const hay = normalize([
    titleText(candidate && candidate.title),
    candidate && candidate.name,
    candidate && candidate.english_title,
    candidate && candidate.romaji_title,
    candidate && candidate.alternative_title,
    candidate && candidate.anime_id,
    candidate && candidate.slug
  ].filter(Boolean).join(" "));
  if (!hay) return 0;

  const specialTokens = significantTokens(specialName);
  if (!specialTokens.length || !specialTokens.every(token => hay.includes(token))) return 0;

  let score = 80 + specialTokens.length * 5;
  const showTokens = significantTokens(showTitle).slice(0, 4);
  for (const token of showTokens) if (hay.includes(token)) score += 3;
  if (/\bepisode\s*0\b|\bspecial\b|\bova\b/.test(hay)) score += 8;
  return score;
}

async function resolveTmdbId(inputId) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const list = data && data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function getTmdbShow(tmdbId) {
  const data = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
  if (!data) return null;
  return { title: data.name || data.original_name || "Anime", originalTitle: data.original_name || data.name || "" };
}

async function getTmdbSpecial(tmdbId, episode) {
  return await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/0/episode/${encodeURIComponent(String(episode))}?api_key=${TMDB_API_KEY}`);
}

async function fetchReAnimeApi(path) {
  for (const base of REANIME_DOMAINS) {
    const data = await fetchJson(`${base}${path}`, {
      headers: { "Accept": "application/json, text/plain, */*", "Referer": `${base}/home` }
    });
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

async function searchReAnime(term) {
  let data = await fetchReAnimeApi(`/api/v1/search?q=${encodeURIComponent(term)}&limit=15&offset=0`);
  let results = searchResults(data);
  if (results.length) return results;
  data = await fetchReAnimeApi(`/api/search?q=${encodeURIComponent(term)}&limit=15&offset=0`);
  return searchResults(data);
}

async function findNativeSpecial(show, special) {
  const terms = [...new Set([
    `${show.title} ${special.name || ""}`.trim(),
    special.name,
    `${show.originalTitle} ${special.name || ""}`.trim()
  ].filter(Boolean))];

  const checked = new Set();
  const ranked = [];

  for (const term of terms) {
    const results = await searchReAnime(term);
    for (const candidate of results) {
      const slug = slugFromCandidate(candidate);
      if (!slug || checked.has(slug)) continue;
      checked.add(slug);
      const score = candidateScore(candidate, special.name, show.title);
      if (score > 0) ranked.push({ slug, candidate, score });
    }
    if (ranked.some(item => item.score >= 100)) break;
  }

  ranked.sort((a, b) => b.score - a.score);

  for (const match of ranked.slice(0, 5)) {
    const watch = await fetchReAnimeApi(`/api/watch/${encodeURIComponent(match.slug)}/1`);
    if (!watch) continue;
    const links = Array.isArray(watch.episode_links) ? watch.episode_links : [];
    if (!links.length) continue;
    return {
      slug: match.slug,
      title: titleText(watch.anime && watch.anime.title) || titleText(match.candidate.title) || special.name,
      servers: links
    };
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
  const bestRank = valid.reduce((best, server) => Math.min(best, serverPreference(server.serverName)), 99);
  const preferred = valid.filter(server => serverPreference(server.serverName) === bestRank);
  const selected = [];
  const seen = new Set();
  const counts = { DUB: 0, SUB: 0, SOURCE: 0 };
  for (const server of preferred) {
    const tag = audioTag(server.dataType);
    const link = String(server.dataLink || "");
    const key = `${tag}|${link}`;
    if (!link || seen.has(key) || counts[tag] >= 2) continue;
    seen.add(key);
    counts[tag]++;
    selected.push(server);
  }
  return selected;
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

async function resolveDirectAsset(server) {
  const aid = extractAid(server && server.dataLink);
  if (!aid) return null;
  const text = await fetchText(`${FLIXCLOUD}/d/${aid}/__data.json`, { headers: FLIX_HEADERS });
  if (!text) return null;
  const fileId = firstMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const token = firstMatch(text, /(eyJ[\w-]+\.[\w-]+\.[\w-]+)/);
  const base = firstMatch(text, /(https:\/\/fetch\d*\.flixcloud\.cc)/i) || FLIXCLOUD;
  const resolution = firstMatch(text, /(\d{3,4}p)/i) || "Original";
  if (!fileId || !token) return null;
  return {
    fileId,
    base,
    resolution,
    serverName: String(server.serverName || "Server").trim() || "Server",
    audioTag: audioTag(server.dataType),
    url: `${base}/download/${fileId}?token=${encodeURIComponent(token)}`
  };
}

function classify(group) {
  const sub = group.tags.has("SUB");
  const dub = group.tags.has("DUB");
  if (sub && dub) return { key: "dual", label: "Dual Audio + Subs", language: "Multi" };
  if (dub) return { key: "dub", label: "English Dub", language: "English" };
  if (sub) return { key: "sub", label: "Japanese + Subs", language: "Japanese" };
  return { key: "source", label: "Source", language: "Unknown" };
}

function buildStreams(assets, specialTitle) {
  const grouped = new Map();
  for (const asset of assets.filter(Boolean)) {
    const key = `${asset.base}|${asset.fileId}`;
    let group = grouped.get(key);
    if (!group) {
      group = { ...asset, tags: new Set(), index: grouped.size };
      grouped.set(key, group);
    }
    group.tags.add(asset.audioTag);
    if (qualityRank(asset.resolution) > qualityRank(group.resolution)) group.resolution = asset.resolution;
  }

  return [...grouped.values()].map(group => {
    const meta = classify(group);
    return {
      name: `${PROVIDER_NAME} • ${group.serverName} • ${group.resolution} • ${meta.label} • MKV`,
      title: `${specialTitle} • ${PROVIDER_NAME} • ${meta.label}`,
      url: group.url,
      quality: group.resolution,
      provider: PROVIDER_NAME,
      type: "mp4",
      headers: FLIX_HEADERS,
      language: meta.language,
      subtitles: [],
      _rank: ({ dual: 0, dub: 1, sub: 2, source: 3 })[meta.key] ?? 9,
      _index: group.index
    };
  }).sort((a, b) => a._rank - b._rank || qualityRank(b.quality) - qualityRank(a.quality) || a._index - b._index)
    .map(stream => {
      delete stream._rank;
      delete stream._index;
      return stream;
    });
}

async function seasonZeroFallback(inputId, episode) {
  const tmdbId = await resolveTmdbId(inputId);
  if (!tmdbId) return [];
  const show = await getTmdbShow(tmdbId);
  const special = await getTmdbSpecial(tmdbId, episode);
  if (!show || !special || !special.name) return [];

  const native = await findNativeSpecial(show, special);
  if (!native) return [];

  const servers = selectServers(native.servers);
  if (!servers.length) return [];
  const assets = await Promise.all(servers.map(server => resolveDirectAsset(server).catch(() => null)));
  return buildStreams(assets, special.name);
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const base = await loadBase();
  if (base && typeof base.getStreams === "function") {
    try {
      const normal = await base.getStreams(inputId, mediaType, season, episode);
      if (Array.isArray(normal) && normal.length) return normal;
    } catch (_) {}
  }

  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie" || Number(season) !== 0) return [];

  try {
    return await seasonZeroFallback(inputId, episode);
  } catch (error) {
    console.log(`[Re:ANIME] Season 0 fallback: ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
