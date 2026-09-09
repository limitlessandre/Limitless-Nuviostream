"use strict";

// AnikotoTV Nexus v2.0.4.
// Standalone resolver built from the Sep 2026 in-app diagnostic path proven in Nuvio:
// identity -> MegaPlay embed -> getSources -> AES-256-CBC enc decrypt -> native media URL.

const PROVIDER_NAME = "AnikotoTV";
const SITE = "https://anikototv.to";
const CATALOG = "https://anikotoapi.site";
const MEGAPLAY = "https://megaplay.buzz";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

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

function validHttps(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = String(url.hostname || "").toLowerCase();
    if (!host || host === "localhost" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return null;
    const m = host.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return null;
    return url;
  } catch (_) { return null; }
}

async function requestText(url, options) {
  try {
    const opts = options || {};
    const response = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {})
      },
      redirect: "follow",
      skipSizeCheck: true
    });
    if (!response || !response.ok) return "";
    return String(await response.text() || "");
  } catch (_) { return ""; }
}

async function requestJson(url, options) {
  const text = await requestText(url, options);
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

async function loadIdentity() {
  if (identityCache && typeof identityCache.resolveAnimeIdentity === "function") return identityCache;
  try {
    const source = await requestText(IDENTITY_URL, { headers:{ "Accept":"text/plain,*/*" } });
    if (!source) return null;
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.resolveAnimeIdentity !== "function") return null;
    identityCache = exported;
    return exported;
  } catch (_) { return null; }
}

function base64UrlBytes(token) {
  try {
    const base64 = String(token || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    if (typeof atob === "function") {
      const raw = atob(padded);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }

    const input = padded.replace(/=+$/g, "");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    let acc = 0, bits = 0;
    for (let i = 0; i < input.length; i++) {
      const n = alphabet.indexOf(input.charAt(i));
      if (n < 0) return null;
      acc = (acc << 6) | n;
      bits += 6;
      while (bits >= 8) {
        bits -= 8;
        bytes.push((acc >> bits) & 255);
        acc = bits ? (acc & ((1 << bits) - 1)) : 0;
      }
    }
    return new Uint8Array(bytes);
  } catch (_) { return null; }
}

async function decryptEnc(token) {
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) return "";
    const cipher = base64UrlBytes(token);
    if (!cipher || !cipher.length || cipher.length % 16 !== 0) return "";

    const keyBytes = new Uint8Array(32);
    const prefix = "i?LMTAx0Q6,:}50U";
    for (let i = 0; i < prefix.length; i++) keyBytes[i] = prefix.charCodeAt(i);
    const iv = new Uint8Array([87,48,59,50,55,84,111,97,85,112,108,95,80,37,39,99]);
    const key = await subtle.importKey("raw", keyBytes, { name:"AES-CBC" }, false, ["decrypt"]);
    const plain = new Uint8Array(await subtle.decrypt({ name:"AES-CBC", iv }, key, cipher));
    const text = typeof TextDecoder !== "undefined"
      ? new TextDecoder().decode(plain)
      : String.fromCharCode.apply(null, Array.from(plain));
    const data = JSON.parse(text);
    return String(data && data.file || "").trim();
  } catch (_) { return ""; }
}

function sourceIdFromHtml(html) {
  const text = String(html || "");
  return (text.match(/\bdata-id=["'](\d+)["']/i) || text.match(/<title>\s*File\s+(\d+)\s*-/i) || [])[1] || "";
}

function subtitleLanguage(label) {
  const text = String(label || "").toLowerCase();
  if (/eng|english/.test(text)) return "eng";
  if (/jpn|japanese/.test(text)) return "jpn";
  if (/spa|spanish/.test(text)) return "spa";
  if (/fre|fra|french/.test(text)) return "fra";
  return "und";
}

function subtitleRows(payload) {
  const out = [], seen = new Set();
  for (const track of Array.isArray(payload && payload.tracks) ? payload.tracks : []) {
    const kind = String(track && track.kind || "").toLowerCase();
    if (kind && kind !== "captions" && kind !== "subtitles") continue;
    const url = validHttps(track && track.file);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({
      id:String(track.label || "Subtitle"),
      url:url.href,
      language:subtitleLanguage(track.label)
    });
  }
  return out;
}

function plainSourceFile(payload) {
  if (!payload || typeof payload !== "object") return "";
  const sources = payload.sources;
  if (sources && typeof sources === "object" && typeof sources.file === "string") return sources.file;
  if (typeof sources === "string") return sources;
  if (Array.isArray(sources)) {
    for (const row of sources) {
      if (typeof row === "string") return row;
      if (row && typeof row === "object" && typeof (row.file || row.url || row.src) === "string") return row.file || row.url || row.src;
    }
  }
  return "";
}

async function resolveMegaPlay(embedUrl) {
  const embed = validHttps(embedUrl);
  if (!embed) return null;

  const html = await requestText(embed.href, {
    headers:{
      "Accept":"text/html,application/json,text/plain,*/*",
      "Referer":MEGAPLAY + "/"
    }
  });
  const sourceId = sourceIdFromHtml(html);
  if (!sourceId) return null;

  const payload = await requestJson(MEGAPLAY + "/stream/getSources?id=" + encodeURIComponent(sourceId), {
    headers:{
      "Accept":"application/json,text/plain,*/*",
      "X-Requested-With":"XMLHttpRequest",
      "Origin":MEGAPLAY,
      "Referer":embed.href,
      "Sec-Fetch-Site":"same-origin",
      "Sec-Fetch-Mode":"cors",
      "Sec-Fetch-Dest":"empty"
    }
  });
  if (!payload) return null;

  let file = plainSourceFile(payload);
  if (!file && payload.enc) file = await decryptEnc(payload.enc);
  const media = validHttps(file);
  if (!media) return null;

  return {
    url:media.href,
    subtitles:subtitleRows(payload),
    headers:{ "Referer":MEGAPLAY + "/", "Origin":MEGAPLAY, "User-Agent":UA }
  };
}

function directCandidates(identity, episode, mode) {
  const out = [];
  if (identity && identity.anilistId) out.push(MEGAPLAY + "/stream/ani/" + encodeURIComponent(identity.anilistId) + "/" + encodeURIComponent(episode) + "/" + mode);
  if (identity && identity.malId) out.push(MEGAPLAY + "/stream/mal/" + encodeURIComponent(identity.malId) + "/" + encodeURIComponent(episode) + "/" + mode);
  return uniq(out);
}

function aliases(identity) {
  return uniq([].concat(identity && identity.animeAliases || [])
    .concat(identity && identity.aliases || [])
    .concat(identity && identity.fallbackAliases || [])
    .concat([identity && identity.title, identity && identity.originalTitle])).slice(0, 16);
}

function parseSearch(html) {
  const text = String(html || ""), out = [], seen = new Set();
  const re = /data-tip=["'](\d+)["']/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 50) {
    const id = Number(m[1]);
    if (!id || seen.has(id)) continue;
    const chunk = text.slice(m.index, Math.min(text.length, m.index + 5000));
    const title = cleanText((chunk.match(/<[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || "");
    if (!title) continue;
    seen.add(id);
    out.push({ id, title });
  }
  return out;
}

async function catalogCandidates(identity, episode, mode) {
  const names = aliases(identity);
  for (const term of names.slice(0, 3)) {
    const html = await requestText(SITE + "/filter?keyword=" + encodeURIComponent(term), {
      headers:{ "Accept":"text/html,application/xhtml+xml", "Referer":SITE + "/" }
    });
    const rows = parseSearch(html).filter(row => names.some(name => normalize(name) === normalize(row.title))).slice(0, 4);
    for (const row of rows) {
      let series = seriesCache.get(row.id);
      if (!series || series.expires <= Date.now()) {
        const payload = await requestJson(CATALOG + "/series/" + encodeURIComponent(row.id), { headers:{ "Accept":"application/json" } });
        const data = payload && payload.data;
        series = data && Array.isArray(data.episodes) ? { episodes:data.episodes, expires:Date.now() + 300000 } : null;
        if (series) seriesCache.set(row.id, series);
      }
      if (!series) continue;
      const ep = series.episodes.find(item => Number(item && item.number) === Number(episode));
      if (!ep) continue;
      const candidates = [];
      if (ep.embed_url && ep.embed_url[mode]) candidates.push(String(ep.embed_url[mode]));
      if (ep.episode_embed_id) candidates.push(MEGAPLAY + "/stream/s-2/" + encodeURIComponent(ep.episode_embed_id) + "/" + mode);
      if (candidates.length) return uniq(candidates);
    }
  }
  return [];
}

async function resolveMode(identity, episode, mode) {
  for (const embed of directCandidates(identity, episode, mode)) {
    const resolved = await resolveMegaPlay(embed);
    if (resolved) return { ...resolved, server:"Identity" };
  }
  const fallback = await catalogCandidates(identity, episode, mode);
  for (const embed of fallback) {
    const resolved = await resolveMegaPlay(embed);
    if (resolved) return { ...resolved, server:"Catalog" };
  }
  return null;
}

function row(identity, season, requestedEpisode, mode, resolved) {
  const hasSubs = resolved.subtitles.some(x => x.language === "eng" || x.language === "und");
  const audio = mode === "dub" ? (hasSubs ? "DUB+SUBS" : "DUB") : "SOFTSUB";
  const show = String(identity.title || (identity.animeAliases && identity.animeAliases[0]) || "Anime");
  const episodeLabel = "S" + String(Number(season || 1)).padStart(2, "0") + "E" + String(Number(requestedEpisode || 1)).padStart(2, "0");
  const isMp4 = /\.mp4(?:$|[?#])/i.test(resolved.url);
  return {
    name:PROVIDER_NAME + " • Auto • " + audio + " • " + resolved.server,
    title:show + " • " + episodeLabel,
    url:resolved.url,
    quality:"Auto",
    language:mode === "dub" ? "English" : "Japanese",
    provider:PROVIDER_NAME,
    type:isMp4 ? "mp4" : "m3u8",
    headers:resolved.headers,
    subtitles:resolved.subtitles
  };
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

    const [dub, sub] = await Promise.all([
      resolveMode(identity, mappedEpisode, "dub"),
      resolveMode(identity, mappedEpisode, "sub")
    ]);
    const out = [];
    if (dub) out.push(row(identity, season, requestedEpisode, "dub", dub));
    if (sub) out.push(row(identity, season, requestedEpisode, "sub", sub));
    return out;
  } catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
