"use strict";

// Limitless Nexus AnikotoTV provider.
// Current flow (Sep 2026):
// 1) Resolve anime identity through the shared MAL/AniList-first helper.
// 2) Match Anikoto's provider series ID from /filter search results.
// 3) Prefer anikotoapi.site /series/{id} episode_embed_id/embed_url data.
// 4) Fall back to Anikoto's cookie-aware AJAX episode/server endpoints.
// 5) Resolve MegaPlay embeds to native HLS/MP4, including encrypted `enc` source payloads.

const PROVIDER_NAME = "AnikotoTV";
const SITE = "https://anikototv.to";
const CATALOG = "https://anikotoapi.site";
const MEGAPLAY = "https://megaplay.buzz";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const MEDIA_SUFFIXES = [
  "megaplay.buzz", "vidtube.site", "akirax.buzz", "anizara.store", "kryntal.top",
  "lostproject.club", "mikora.top", "norami.top", "shiora.site", "shiora.top",
  "tiktokcdn.com", "trycloud.pro", "watching.onl", "mewstream.buzz", "voltara.click",
  "kotocdn.site"
];

let identityCache = null;
let sessionCache = { cookie: "", expires: 0 };
const searchCache = new Map();
const seriesCache = new Map();

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values) {
  const out = [], seen = new Set();
  for (const value of values || []) {
    const text = String(value == null ? "" : value).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(?:season|part|cour)\s*([0-9]+)\b/g, " $1 ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactTitle(candidate, aliases) {
  const c = normalize(candidate);
  return !!c && (aliases || []).some(alias => normalize(alias) === c);
}

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return MEDIA_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

function validHttps(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch (_) { return null; }
}

async function request(url, options) {
  try {
    const opts = options || {};
    return await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {})
      },
      skipSizeCheck: true
    });
  } catch (_) { return null; }
}

async function fetchText(url, options) {
  const response = await request(url, options);
  if (!response || !response.ok) return "";
  try { return String(await response.text() || ""); }
  catch (_) { return ""; }
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (_) { return null; }
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
    return identityCache;
  } catch (_) { return null; }
}

function cookieHeader(response) {
  try {
    if (!response || !response.headers) return "";
    if (typeof response.headers.getSetCookie === "function") {
      const rows = response.headers.getSetCookie();
      if (Array.isArray(rows) && rows.length) return rows.map(x => String(x).split(";")[0]).filter(Boolean).join("; ");
    }
    const raw = response.headers.get && response.headers.get("set-cookie");
    if (!raw) return "";
    return String(raw).split(/,(?=[^;,]+=)/).map(x => x.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (_) { return ""; }
}

async function sessionCookie() {
  if (sessionCache.expires > Date.now()) return sessionCache.cookie;
  let cookie = "";
  try {
    const response = await request(`${SITE}/home`, {
      headers: { "Accept":"text/html,application/xhtml+xml" }
    });
    cookie = cookieHeader(response);
  } catch (_) {}
  sessionCache = { cookie, expires: Date.now() + 5 * 60 * 1000 };
  return cookie;
}

async function siteJson(path) {
  const cookie = await sessionCookie();
  const headers = {
    "Accept":"application/json,text/plain,*/*",
    "X-Requested-With":"XMLHttpRequest",
    "Referer":`${SITE}/`
  };
  if (cookie) headers.Cookie = cookie;
  return fetchJson(`${SITE}${path}`, { headers });
}

function parseSearchCandidates(html) {
  const out = [], seen = new Set();
  const markers = [];
  const markerRe = /data-tip=["'](\d+)["']/gi;
  let m;
  while ((m = markerRe.exec(String(html || ""))) && markers.length < 120) markers.push({ id:Number(m[1]), index:m.index });
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : Math.min(String(html || "").length, start + 7000);
    const chunk = String(html || "").slice(start, end);
    const open = chunk.match(/<[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>/i);
    if (!open) continue;
    const titleMatch = chunk.slice(open.index || 0).match(/^<[^>]+>([\s\S]*?)<\//i);
    const title = cleanText(titleMatch && titleMatch[1]);
    if (!title || seen.has(markers[i].id)) continue;
    const jp = (open[0].match(/data-jp=["']([^"']*)["']/i) || [])[1] || "";
    seen.add(markers[i].id);
    out.push({ id:markers[i].id, title, alternative:cleanText(jp) });
  }
  return out;
}

async function searchAnikoto(term) {
  const key = normalize(term);
  if (!key) return [];
  const cached = searchCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const html = await fetchText(`${SITE}/filter?keyword=${encodeURIComponent(term)}`, {
    headers:{ "Accept":"text/html,application/xhtml+xml", "Referer":`${SITE}/` }
  });
  const value = parseSearchCandidates(html);
  searchCache.set(key, { value, expires:Date.now() + 5 * 60 * 1000 });
  return value;
}

function seriesData(raw) {
  const data = raw && raw.data ? raw.data : raw;
  if (!data || typeof data !== "object") return null;
  const anime = data.anime && typeof data.anime === "object" ? data.anime : {};
  const id = Number(anime.id || data.id || 0) || null;
  const anilistId = Number(anime.ani_id || anime.anilist_id || anime.anilistId || data.ani_id || 0) || null;
  const malId = Number(anime.mal_id || anime.malId || data.mal_id || 0) || null;
  const title = String(anime.title || data.title || "").trim();
  const alternative = String(anime.alternative || anime.alternative_title || data.alternative || "").trim();
  const episodesRaw = Array.isArray(data.episodes) ? data.episodes : [];
  const episodes = episodesRaw.map(row => {
    const number = Number(row && (row.number != null ? row.number : row.episode));
    const embed = row && row.embed_url && typeof row.embed_url === "object" ? row.embed_url : {};
    return {
      number,
      title:String(row && row.title || "").trim(),
      embedId:String(row && (row.episode_embed_id || row.embed_id || "") || "").trim(),
      sub:String(embed.sub || row && row.sub_embed || "").trim(),
      dub:String(embed.dub || row && row.dub_embed || "").trim()
    };
  }).filter(row => Number.isFinite(row.number) && row.number > 0);
  return { id, anilistId, malId, title, alternative, episodes };
}

async function loadSeries(id) {
  const key = Number(id);
  if (!key) return null;
  const cached = seriesCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const raw = await fetchJson(`${CATALOG}/series/${key}`, {
    headers:{ "Accept":"application/json", "Referer":`${CATALOG}/` }
  });
  const value = seriesData(raw);
  seriesCache.set(key, { value, expires:Date.now() + (value ? 10 * 60 * 1000 : 30 * 1000) });
  return value;
}

function identityAliases(identity) {
  return uniq([].concat(identity && identity.animeAliases || [])
    .concat(identity && identity.aliases || [])
    .concat(identity && identity.fallbackAliases || [])
    .concat([identity && identity.title, identity && identity.originalTitle])).slice(0, 24);
}

function seriesScore(series, identity) {
  if (!series) return -1;
  if (identity.anilistId && series.anilistId && Number(identity.anilistId) === Number(series.anilistId)) return 1200;
  if (identity.malId && series.malId && Number(identity.malId) === Number(series.malId)) return 1150;
  const aliases = identityAliases(identity);
  if (exactTitle(series.title, aliases)) return 900;
  if (exactTitle(series.alternative, aliases)) return 880;
  return -1;
}

async function findSeries(identity) {
  const aliases = identityAliases(identity);
  const candidates = new Map();
  for (const term of aliases.slice(0, 4)) {
    const rows = await searchAnikoto(term);
    for (const row of rows) {
      const titleMatch = exactTitle(row.title, aliases) || exactTitle(row.alternative, aliases);
      if (!candidates.has(row.id) || titleMatch) candidates.set(row.id, { ...row, titleMatch });
    }
    if ([...candidates.values()].some(x => x.titleMatch)) break;
  }
  const ordered = [...candidates.values()].sort((a,b) => Number(b.titleMatch) - Number(a.titleMatch)).slice(0, 10);
  let best = null, bestScore = -1;
  for (const candidate of ordered) {
    const series = await loadSeries(candidate.id);
    const score = seriesScore(series, identity);
    if (score > bestScore) { best = series; bestScore = score; }
    if (score >= 1150) break;
  }
  return bestScore >= 0 ? best : null;
}

function parseSiteEpisodes(raw) {
  if (!raw || Number(raw.status) !== 200 || typeof raw.result !== "string") return [];
  const out = [], seen = new Set();
  const re = /<a\b([^>]*\bdata-ids=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(raw.result)) && out.length < 2000) {
    const attrs = m[1];
    const id = (attrs.match(/data-ids=["']([^"']+)["']/i) || [])[1] || "";
    const number = Number((attrs.match(/data-num=["']([^"']+)["']/i) || [])[1]);
    if (!id || !Number.isFinite(number) || number <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      number,
      sub:/data-sub=["']1["']/i.test(attrs),
      dub:/data-dub=["']1["']/i.test(attrs),
      title:cleanText(m[2])
    });
  }
  return out;
}

function parseServerList(raw) {
  const result = { sub:[], dub:[] };
  if (!raw || Number(raw.status) !== 200 || typeof raw.result !== "string") return result;
  const tokenRe = /<[^>]*data-type=["'](sub|dub|hsub)["'][^>]*>|<li\b([^>]*data-link-id=["'][^"']+["'][^>]*)>([\s\S]*?)<\/li>/gi;
  let current = "", m;
  const seen = { sub:new Set(), dub:new Set() };
  while ((m = tokenRe.exec(raw.result))) {
    if (m[1]) { current = m[1].toLowerCase() === "hsub" ? "sub" : m[1].toLowerCase(); continue; }
    if (current !== "sub" && current !== "dub") continue;
    const attrs = m[2] || "";
    const linkId = (attrs.match(/data-link-id=["']([^"']+)["']/i) || [])[1] || "";
    if (!linkId || seen[current].has(linkId)) continue;
    seen[current].add(linkId);
    result[current].push({ linkId, label:cleanText(m[3]) || current.toUpperCase() });
  }
  return result;
}

async function ajaxEmbeds(seriesId, wantedEpisode) {
  const episodes = parseSiteEpisodes(await siteJson(`/ajax/episode/list/${encodeURIComponent(seriesId)}`));
  const current = episodes.find(x => Number(x.number) === Number(wantedEpisode));
  if (!current) return { sub:[], dub:[] };
  const servers = parseServerList(await siteJson(`/ajax/server/list?servers=${encodeURIComponent(current.id)}`));
  const out = { sub:[], dub:[] };
  for (const mode of ["sub", "dub"]) {
    for (const server of servers[mode].slice(0, 3)) {
      const row = await siteJson(`/ajax/server?get=${encodeURIComponent(server.linkId)}`);
      const url = row && Number(row.status) === 200 && row.result && row.result.url ? String(row.result.url) : "";
      if (url) out[mode].push({ url, label:server.label });
    }
  }
  return out;
}

function validEmbed(value, mode) {
  const url = validHttps(value);
  if (!url || !["megaplay.buzz", "vidtube.site"].includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const returnedMode = String(parts[parts.length - 1] || "").toLowerCase();
  if (parts[0] !== "stream" || returnedMode !== mode) return null;
  return url;
}

function base64UrlBytes(value) {
  try {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    if (typeof atob === "function") {
      const raw = atob(padded), out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }
    return null;
  } catch (_) { return null; }
}

async function decryptEnc(token) {
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) return "";
    const encoded = base64UrlBytes(token);
    if (!encoded) return "";
    const keyBytes = new Uint8Array(32);
    const prefix = "i?LMTAx0Q6,:}50U";
    for (let i = 0; i < prefix.length; i++) keyBytes[i] = prefix.charCodeAt(i);
    const iv = new Uint8Array([87,48,59,50,55,84,111,97,85,112,108,95,80,37,39,99]);
    const key = await subtle.importKey("raw", keyBytes, { name:"AES-CBC" }, false, ["decrypt"]);
    const decrypted = new Uint8Array(await subtle.decrypt({ name:"AES-CBC", iv }, key, encoded));
    const text = typeof TextDecoder !== "undefined" ? new TextDecoder().decode(decrypted) : String.fromCharCode(...decrypted);
    const data = JSON.parse(text);
    return String(data && data.file || "");
  } catch (_) { return ""; }
}

function subtitleLanguage(label) {
  const text = String(label || "").toLowerCase();
  if (/eng|english/.test(text)) return "eng";
  if (/jpn|japanese/.test(text)) return "jpn";
  if (/spa|spanish/.test(text)) return "spa";
  if (/fre|fra|french/.test(text)) return "fra";
  return "und";
}

async function parseSourcePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  let file = payload.sources && typeof payload.sources === "object" ? payload.sources.file : "";
  if (!file && payload.enc) file = await decryptEnc(payload.enc);
  const mediaUrl = validHttps(file);
  if (!mediaUrl || !hostAllowed(mediaUrl.hostname) || !/\.(?:m3u8|mp4)(?:$|[?#])/i.test(mediaUrl.href)) return null;
  const subtitles = [];
  const seen = new Set();
  for (const track of Array.isArray(payload.tracks) ? payload.tracks : []) {
    const kind = String(track && track.kind || "").toLowerCase();
    if (kind !== "captions" && kind !== "subtitles") continue;
    const url = validHttps(track && track.file);
    if (!url || !hostAllowed(url.hostname) || seen.has(url.href)) continue;
    seen.add(url.href);
    subtitles.push({ id:String(track.label || "Subtitle"), url:url.href, language:subtitleLanguage(track.label) });
  }
  return { url:mediaUrl.href, subtitles };
}

async function resolveMegaPlay(embedValue) {
  const embed = validHttps(embedValue);
  if (!embed || !["megaplay.buzz", "vidtube.site"].includes(embed.hostname.toLowerCase())) return null;
  const html = await fetchText(embed.href, {
    headers:{ "Accept":"text/html,application/xhtml+xml", "Referer":`${SITE}/` }
  });
  if (!html) return null;
  let sourceId = (html.match(/\bdata-id=["'](\d+)["']/i) || [])[1] || "";
  if (!sourceId) sourceId = (html.match(/<title>\s*File\s+(\d+)\s*-/i) || [])[1] || "";
  if (!sourceId) return null;
  const sourceUrl = new URL("/stream/getSources", embed.origin);
  sourceUrl.searchParams.set("id", sourceId);
  const selector = embed.searchParams.get("s");
  if (selector && /^[a-z0-9_-]{1,32}$/i.test(selector)) sourceUrl.searchParams.set("s", selector);
  const payload = await fetchJson(sourceUrl.href, {
    headers:{
      "Accept":"application/json,text/plain,*/*",
      "X-Requested-With":"XMLHttpRequest",
      "Origin":embed.origin,
      "Referer":embed.href
    }
  });
  const source = await parseSourcePayload(payload);
  if (!source) return null;
  return {
    ...source,
    headers:{ "Referer":`${embed.origin}/`, "Origin":embed.origin, "User-Agent":UA },
    embed:embed.href
  };
}

async function detectQuality(url, headers) {
  if (!/\.m3u8(?:$|[?#])/i.test(String(url || ""))) return /\.mp4/i.test(String(url || "")) ? "1080p" : "Auto";
  try {
    const text = await fetchText(url, { headers:headers || {} });
    let max = 0, m;
    const re = /RESOLUTION=\d+x(\d+)/gi;
    while ((m = re.exec(text))) max = Math.max(max, Number(m[1]) || 0);
    return max ? `${max}p` : "Auto";
  } catch (_) { return "Auto"; }
}

function qualityTier(quality) {
  const n = Number((String(quality || "").match(/(\d{3,4})/) || [])[1]) || 0;
  if (n >= 2160) return `4K ${n}p`;
  if (n >= 1440) return `QHD ${n}p`;
  if (n >= 1080) return `FHD ${n}p`;
  if (n >= 720) return `HD ${n}p`;
  if (n >= 480) return `SD ${n}p`;
  return quality && quality !== "Auto" ? String(quality) : "Auto";
}

function directIdentityEmbeds(identity, episode, mode) {
  const out = [];
  if (identity.anilistId) out.push(`${MEGAPLAY}/stream/ani/${encodeURIComponent(identity.anilistId)}/${encodeURIComponent(episode)}/${mode}`);
  if (identity.malId) out.push(`${MEGAPLAY}/stream/mal/${encodeURIComponent(identity.malId)}/${encodeURIComponent(episode)}/${mode}`);
  return uniq(out);
}

function seriesEmbeds(series, episode, mode) {
  if (!series) return [];
  const row = (series.episodes || []).find(x => Number(x.number) === Number(episode));
  if (!row) return [];
  const out = [];
  if (row[mode]) out.push(row[mode]);
  if (row.embedId) out.push(`${MEGAPLAY}/stream/s-2/${encodeURIComponent(row.embedId)}/${mode}`);
  return uniq(out);
}

async function resolveMode(identity, series, episode, mode, ajaxRows) {
  const candidates = [];
  for (const value of seriesEmbeds(series, episode, mode)) candidates.push({ url:value, server:"Catalog" });
  for (const row of (ajaxRows && ajaxRows[mode]) || []) candidates.push({ url:row.url, server:row.label || "Anikoto" });
  for (const value of directIdentityEmbeds(identity, episode, mode)) candidates.push({ url:value, server:"Identity Fallback" });

  const seen = new Set();
  for (const candidate of candidates.slice(0, 8)) {
    const embed = validEmbed(candidate.url, mode);
    if (!embed || seen.has(embed.href)) continue;
    seen.add(embed.href);
    const resolved = await resolveMegaPlay(embed.href);
    if (!resolved) continue;
    const quality = await detectQuality(resolved.url, resolved.headers);
    return { ...resolved, quality, server:candidate.server };
  }
  return null;
}

function streamRow(identity, season, episode, mode, resolved) {
  const tier = qualityTier(resolved.quality);
  const hasSubs = Array.isArray(resolved.subtitles) && resolved.subtitles.some(x => x.language === "eng" || x.language === "und");
  const audio = mode === "dub" ? (hasSubs ? "DUB+SUBS" : "DUB") : "SOFTSUB";
  const show = String(identity.title || (identity.animeAliases && identity.animeAliases[0]) || "Anime");
  const mediaType = /\.m3u8(?:$|[?#])/i.test(resolved.url) ? "m3u8" : "mp4";
  const episodeLabel = season == null ? `Episode ${episode}` : `S${String(Number(season || 1)).padStart(2,"0")}E${String(Number(episode || 1)).padStart(2,"0")}`;
  return {
    name:`${PROVIDER_NAME} • ${tier} • ${audio} • ${resolved.server}`,
    title:`${show} • ${episodeLabel}`,
    url:resolved.url,
    quality:resolved.quality || "Auto",
    language:mode === "dub" ? "English" : "Japanese",
    provider:PROVIDER_NAME,
    type:mediaType,
    headers:resolved.headers,
    subtitles:resolved.subtitles || []
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const helper = await loadIdentity();
    if (!helper) return [];
    const type = String(mediaType || "tv").toLowerCase();
    const ep = type === "movie" ? 1 : Number(episode || 1);
    const identity = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    if (!identity || !identity.isAnime) return [];

    const series = await findSeries(identity);
    let ajaxRows = { sub:[], dub:[] };
    if (series && series.id) {
      try { ajaxRows = await ajaxEmbeds(series.id, ep); } catch (_) {}
    }

    const [dub, sub] = await Promise.all([
      resolveMode(identity, series, ep, "dub", ajaxRows),
      resolveMode(identity, series, ep, "sub", ajaxRows)
    ]);

    const rows = [];
    if (dub) rows.push(streamRow(identity, season, ep, "dub", dub));
    if (sub) rows.push(streamRow(identity, season, ep, "sub", sub));
    return rows;
  } catch (err) {
    try { console.error(`[${PROVIDER_NAME}]`, err && err.message || err); } catch (_) {}
    return [];
  }
}

module.exports = { getStreams };
