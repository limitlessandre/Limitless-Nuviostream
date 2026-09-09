"use strict";

// Limitless Nexus AnikotoTV provider.
// Fast path: shared anime identity -> MegaPlay MAL/AniList mapping.
// Fallback: Anikoto site search -> anikotoapi.site series embeds.

const PROVIDER_NAME = "AnikotoTV";
const SITE = "https://anikototv.to";
const CATALOG = "https://anikotoapi.site";
const MEGAPLAY = "https://megaplay.buzz";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const MEDIA_SUFFIXES = [
  "megaplay.buzz", "mewstream.buzz", "lostproject.club", "voltara.click", "kotocdn.site",
  "akirax.buzz", "anizara.store", "kryntal.top", "mikora.top", "norami.top", "shiora.site",
  "shiora.top", "tiktokcdn.com", "trycloud.pro", "watching.onl"
];

let identityCache = null;
const seriesCache = new Map();

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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return MEDIA_SUFFIXES.some(function(suffix) {
    return host === suffix || host.endsWith("." + suffix);
  });
}

function validHttps(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch (_) {
    return null;
  }
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
  } catch (_) {
    return null;
  }
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
    const response = await fetch(IDENTITY_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.resolveAnimeIdentity !== "function") return null;
    identityCache = exported;
    return exported;
  } catch (_) {
    return null;
  }
}

function identityAliases(identity) {
  return uniq([].concat(identity && identity.animeAliases || [])
    .concat(identity && identity.aliases || [])
    .concat(identity && identity.fallbackAliases || [])
    .concat([identity && identity.title, identity && identity.originalTitle])).slice(0, 20);
}

function directEmbeds(identity, episode, mode) {
  const out = [];
  if (identity && identity.anilistId) out.push(MEGAPLAY + "/stream/ani/" + encodeURIComponent(identity.anilistId) + "/" + encodeURIComponent(episode) + "/" + mode);
  if (identity && identity.malId) out.push(MEGAPLAY + "/stream/mal/" + encodeURIComponent(identity.malId) + "/" + encodeURIComponent(episode) + "/" + mode);
  return uniq(out);
}

function base64UrlBytes(value) {
  try {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    if (typeof atob !== "function") return null;
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
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
    const key = await subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    const decrypted = new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv: iv }, key, encoded));
    const text = typeof TextDecoder !== "undefined" ? new TextDecoder().decode(decrypted) : String.fromCharCode.apply(null, Array.from(decrypted));
    const data = JSON.parse(text);
    return String(data && data.file || "");
  } catch (_) {
    return "";
  }
}

function collectSourceEntries(value, out, depth) {
  if (depth > 5 || value == null) return;
  if (typeof value === "string") {
    out.push({ url: value, quality: "Auto" });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSourceEntries(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const direct = value.file || value.url || value.src;
  if (typeof direct === "string") {
    out.push({
      url: direct,
      quality: String(value.label || value.quality || value.resolution || "Auto")
    });
  }
  for (const key of ["sources", "source", "links"]) {
    if (value[key] != null) collectSourceEntries(value[key], out, depth + 1);
  }
}

function subtitleLanguage(label) {
  const text = String(label || "").toLowerCase();
  if (/eng|english/.test(text)) return "eng";
  if (/jpn|japanese/.test(text)) return "jpn";
  if (/spa|spanish/.test(text)) return "spa";
  if (/fre|fra|french/.test(text)) return "fra";
  return "und";
}

function collectTracks(value, out, depth) {
  if (depth > 5 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTracks(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const kind = String(value.kind || value.type || "").toLowerCase();
  const file = value.file || value.url || value.src;
  if (typeof file === "string" && (!kind || /caption|subtitle|\bsub\b/.test(kind))) {
    const url = validHttps(file);
    if (url && hostAllowed(url.hostname)) {
      out.push({
        id: String(value.label || value.title || "Subtitle"),
        url: url.href,
        language: subtitleLanguage(value.label || value.title)
      });
    }
  }
}

async function parseSourcePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [];
  collectSourceEntries(payload.sources, candidates, 0);
  collectSourceEntries(payload.source, candidates, 0);
  collectSourceEntries(payload.links, candidates, 0);
  if (!candidates.length && payload.enc) {
    const decrypted = await decryptEnc(payload.enc);
    if (decrypted) candidates.push({ url: decrypted, quality: "Auto" });
  }

  const seen = new Set();
  let selected = null;
  for (const row of candidates) {
    const url = validHttps(row && row.url);
    if (!url || seen.has(url.href) || !hostAllowed(url.hostname)) continue;
    seen.add(url.href);
    if (!/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url.href)) continue;
    selected = { url: url.href, quality: row.quality || "Auto" };
    break;
  }
  if (!selected) return null;

  const subtitles = [];
  collectTracks(payload.tracks, subtitles, 0);
  collectTracks(payload.captions, subtitles, 0);
  collectTracks(payload.subtitles, subtitles, 0);
  const subSeen = new Set();
  const uniqueSubs = subtitles.filter(function(row) {
    if (!row || !row.url || subSeen.has(row.url)) return false;
    subSeen.add(row.url);
    return true;
  });

  return { url: selected.url, quality: selected.quality, subtitles: uniqueSubs };
}

async function resolveMegaPlay(embedValue) {
  const embed = validHttps(embedValue);
  if (!embed || !["megaplay.buzz", "vidtube.site"].includes(embed.hostname.toLowerCase())) return null;

  const html = await fetchText(embed.href, {
    headers: {
      "Accept": "text/html,application/json,text/plain,*/*",
      "Referer": MEGAPLAY + "/"
    }
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
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": embed.origin,
      "Referer": embed.href
    }
  });
  const source = await parseSourcePayload(payload);
  if (!source) return null;
  return {
    ...source,
    headers: { "Referer": MEGAPLAY + "/", "Origin": MEGAPLAY, "User-Agent": UA },
    embed: embed.href
  };
}

function qualityTier(value) {
  const text = String(value || "Auto");
  const n = Number((text.match(/(2160|1440|1080|720|576|540|480|360|240)/) || [])[1]) || 0;
  if (n >= 2160) return "4K " + n + "p";
  if (n >= 1440) return "QHD " + n + "p";
  if (n >= 1080) return "FHD " + n + "p";
  if (n >= 720) return "HD " + n + "p";
  if (n >= 480) return "SD " + n + "p";
  return "Auto";
}

function streamRow(identity, season, episode, mode, resolved, server) {
  const hasSubs = Array.isArray(resolved.subtitles) && resolved.subtitles.some(function(row) {
    return row.language === "eng" || row.language === "und";
  });
  const audio = mode === "dub" ? (hasSubs ? "DUB+SUBS" : "DUB") : "SOFTSUB";
  const show = String(identity.title || (identity.animeAliases && identity.animeAliases[0]) || "Anime");
  const isHls = /\.m3u8(?:$|[?#])/i.test(resolved.url);
  const seasonNumber = Number(season || 1);
  const episodeLabel = "S" + String(seasonNumber).padStart(2, "0") + "E" + String(Number(episode || 1)).padStart(2, "0");
  return {
    name: PROVIDER_NAME + " • " + qualityTier(resolved.quality) + " • " + audio + " • " + (server || "MegaPlay"),
    title: show + " • " + episodeLabel,
    url: resolved.url,
    quality: resolved.quality || "Auto",
    language: mode === "dub" ? "English" : "Japanese",
    provider: PROVIDER_NAME,
    type: isHls ? "m3u8" : "mp4",
    headers: resolved.headers,
    subtitles: resolved.subtitles || []
  };
}

async function resolveFirst(candidates) {
  const seen = new Set();
  for (const candidate of candidates || []) {
    const url = validHttps(candidate && candidate.url);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    const resolved = await resolveMegaPlay(url.href);
    if (resolved) return { resolved: resolved, server: candidate.server || "MegaPlay" };
  }
  return null;
}

async function resolveDirect(identity, episode, mode) {
  return resolveFirst(directEmbeds(identity, episode, mode).map(function(url) {
    return { url: url, server: "Identity" };
  }));
}

function parseSearchCandidates(html) {
  const text = String(html || "");
  const out = [], seen = new Set();
  const itemRe = /<div\b[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bitem\b|$)/gi;
  let item;
  while ((item = itemRe.exec(text)) && out.length < 80) {
    const chunk = item[0];
    const id = Number((chunk.match(/class=["'][^"']*\bposter\b[^"']*["'][^>]*data-tip=["'](\d+)["']/i) || chunk.match(/data-tip=["'](\d+)["']/i) || [])[1]);
    const nameTag = chunk.match(/<[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/i);
    const title = cleanText(nameTag && nameTag[0]);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: id, title: title });
  }
  return out;
}

async function findSeries(identity) {
  const aliases = identityAliases(identity);
  for (const term of aliases.slice(0, 2)) {
    const html = await fetchText(SITE + "/filter?keyword=" + encodeURIComponent(term), {
      headers: { "Accept": "text/html,application/xhtml+xml", "Referer": SITE + "/" }
    });
    const candidates = parseSearchCandidates(html);
    const exact = candidates.filter(function(row) {
      return aliases.some(function(alias) { return normalize(alias) === normalize(row.title); });
    }).slice(0, 3);
    for (const row of exact) {
      const cached = seriesCache.get(row.id);
      if (cached && cached.expires > Date.now()) return cached.value;
      const raw = await fetchJson(CATALOG + "/series/" + encodeURIComponent(row.id), {
        headers: { "Accept": "application/json", "Referer": CATALOG + "/" }
      });
      const data = raw && raw.data ? raw.data : null;
      if (!data || !Array.isArray(data.episodes)) continue;
      const value = { id: row.id, episodes: data.episodes };
      seriesCache.set(row.id, { value: value, expires: Date.now() + 5 * 60 * 1000 });
      return value;
    }
  }
  return null;
}

function seriesCandidates(series, episode, mode) {
  if (!series || !Array.isArray(series.episodes)) return [];
  const row = series.episodes.find(function(item) { return Number(item && item.number) === Number(episode); });
  if (!row) return [];
  const out = [];
  const embeds = row.embed_url && typeof row.embed_url === "object" ? row.embed_url : {};
  if (embeds[mode]) out.push({ url: String(embeds[mode]), server: "Catalog" });
  const embedId = String(row.episode_embed_id || row.embed_id || "").trim();
  if (embedId) out.push({ url: MEGAPLAY + "/stream/s-2/" + encodeURIComponent(embedId) + "/" + mode, server: "Catalog" });
  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const helper = await loadIdentity();
    if (!helper) return [];
    const type = String(mediaType || "tv").toLowerCase();
    const requestedEpisode = type === "movie" ? 1 : Number(episode || 1);
    const identity = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    if (!identity || !identity.isAnime) return [];
    const mappedEpisode = type === "movie" ? 1 : Number(identity.mappedEpisode || requestedEpisode || 1);

    // Fast path first. This avoids expensive Anikoto catalog work when MegaPlay already
    // maps the MAL/AniList identity directly, which is the normal current path.
    const direct = await Promise.all([
      resolveDirect(identity, mappedEpisode, "dub"),
      resolveDirect(identity, mappedEpisode, "sub")
    ]);
    const rows = [];
    if (direct[0]) rows.push(streamRow(identity, season, requestedEpisode, "dub", direct[0].resolved, direct[0].server));
    if (direct[1]) rows.push(streamRow(identity, season, requestedEpisode, "sub", direct[1].resolved, direct[1].server));
    if (rows.length) return rows;

    // Catalog fallback only after the direct path fails. This keeps provider latency
    // low while still recovering titles that need Anikoto's own episode embed ID.
    const series = await findSeries(identity);
    if (!series) return [];
    const catalog = await Promise.all([
      resolveFirst(seriesCandidates(series, mappedEpisode, "dub")),
      resolveFirst(seriesCandidates(series, mappedEpisode, "sub"))
    ]);
    if (catalog[0]) rows.push(streamRow(identity, season, requestedEpisode, "dub", catalog[0].resolved, catalog[0].server));
    if (catalog[1]) rows.push(streamRow(identity, season, requestedEpisode, "sub", catalog[1].resolved, catalog[1].server));
    return rows;
  } catch (err) {
    try { console.error("[" + PROVIDER_NAME + "]", err && err.message || err); } catch (_) {}
    return [];
  }
}

module.exports = { getStreams: getStreams };
