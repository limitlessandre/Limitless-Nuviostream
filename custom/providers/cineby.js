"use strict";

const PROVIDER_NAME = "Cineby";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const DOMAINS_URL = "https://raw.githubusercontent.com/sapariyaneel/nuvio-plugin/refs/heads/main/domains.json";
const FALLBACK_API_HOST = "https://api.speedracelight.com";
const CINEBY_ORIGIN = "https://www.cineby.at";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const API_HEADERS = {
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": CINEBY_ORIGIN,
  "Referer": `${CINEBY_ORIGIN}/`,
  "Sec-CH-UA": '"Not.A/Brand";v="99", "Chromium";v="147"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  "User-Agent": USER_AGENT
};

const PLAYBACK_HEADERS = {
  "Accept": "*/*",
  "Origin": CINEBY_ORIGIN,
  "Referer": `${CINEBY_ORIGIN}/`,
  "User-Agent": USER_AGENT
};

// Keep the first pass deliberately small: original-audio mirrors only.
// This avoids duplicate non-English audio sources and keeps QuickJS/network load low.
const ORIGINAL_AUDIO_SERVERS = [
  { name: "Yoru", endpoint: "cdn/sources-with-title" },
  { name: "Breach", endpoint: "m4uhd/sources-with-title" }
];

const MAGIC_BYTES = [0x6d, 0x76, 0x6d, 0x31]; // "mvm1"
const GOLDEN_RATIO = 0x9e3779b9;
let cachedDomains = null;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, skipSizeCheck: true });
  if (!response || !response.ok) return null;
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function getApiHost() {
  if (cachedDomains) {
    return String(cachedDomains.speedracelight || cachedDomains.cineby || FALLBACK_API_HOST).replace(/\/+$/, "");
  }
  try {
    cachedDomains = await fetchJson(DOMAINS_URL) || {};
  } catch (_) {
    cachedDomains = {};
  }
  return String(cachedDomains.speedracelight || cachedDomains.cineby || FALLBACK_API_HOST).replace(/\/+$/, "");
}

function fmix32(value) {
  value = value >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function rotl32(value, shift) {
  value = value >>> 0;
  shift &= 31;
  if (shift === 0) return value >>> 0;
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x1000193) >>> 0;
  }
  return fmix32(hash);
}

function makeKeystreamState(seed, mediaId) {
  const slots = new Array(61);
  let acc = fmix32(fnv1a32(seed) ^ fmix32(((mediaId >>> 0) ^ GOLDEN_RATIO) >>> 0)) >>> 0;

  for (let round = 0; round < 8; round++) {
    const index = acc % 61;
    acc = rotl32((acc + GOLDEN_RATIO) >>> 0, 7 + (round & 7));
    slots[index] = (acc ^ fmix32(acc)) >>> 0;
    acc = fmix32((acc + index) >>> 0);
  }

  return { slots, acc: fmix32((0xa5a5a5a5 ^ acc) >>> 0) >>> 0 };
}

function nextKeystreamWord(state, counter) {
  const slots = state.slots;
  const acc = state.acc >>> 0;
  const index = acc % 61;
  const initializedMask = index in slots ? -1 : 0;
  const slotValue = slots[index] >>> 0;
  const mixed = (slotValue ^ (Math.imul(GOLDEN_RATIO, counter + 1) >>> 0)) >>> 0;
  const combined = (((acc ^ mixed) >>> 0) | ((acc & mixed & initializedMask) >>> 0)) >>> 0;
  const word = (rotl32((combined + acc) >>> 0, index & 31) ^ rotl32(acc, Math.imul(index, 7) & 31)) >>> 0;
  const next = fmix32((word + GOLDEN_RATIO) >>> 0) >>> 0;
  slots[index] = next;
  state.acc = next;
  return next;
}

function generateKeystream(seed, mediaId, length) {
  const state = makeKeystreamState(seed, mediaId);
  const output = new Uint8Array(length);
  let position = 0;
  let counter = 0;

  while (position < length) {
    const word = nextKeystreamWord(state, counter++);
    output[position++] = word & 0xff;
    if (position < length) output[position++] = (word >>> 8) & 0xff;
    if (position < length) output[position++] = (word >>> 16) & 0xff;
    if (position < length) output[position++] = (word >>> 24) & 0xff;
  }
  return output;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function pureBase64Decode(value) {
  const clean = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i);
    if (ch === "=") break;
    const index = BASE64_CHARS.indexOf(ch);
    if (index < 0) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >>> bits) & 0xff);
    }
  }
  return output;
}

function base64UrlToBytes(value) {
  let normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const binary = typeof atob === "function" ? atob(normalized) : pureBase64Decode(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function utf8BytesToString(bytes) {
  let output = "";
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i++];
    if (first < 0x80) {
      output += String.fromCharCode(first);
    } else if ((first & 0xe0) === 0xc0) {
      const second = bytes[i++];
      output += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
    } else if ((first & 0xf0) === 0xe0) {
      const second = bytes[i++];
      const third = bytes[i++];
      output += String.fromCharCode(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
    } else if ((first & 0xf8) === 0xf0) {
      const second = bytes[i++];
      const third = bytes[i++];
      const fourth = bytes[i++];
      let codePoint = ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
      codePoint -= 0x10000;
      output += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    }
  }
  return output;
}

function decryptPayload(encryptedText, seed, mediaId) {
  const encrypted = base64UrlToBytes(encryptedText);
  const keystream = generateKeystream(seed, mediaId, encrypted.length);
  const decoded = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) decoded[i] = encrypted[i] ^ keystream[i];

  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (decoded[i] !== MAGIC_BYTES[i]) throw new Error("Cineby payload signature mismatch");
  }

  return JSON.parse(utf8BytesToString(decoded.slice(MAGIC_BYTES.length)));
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;

  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  const data = await fetchJson(url);
  if (!data) return null;
  const list = mediaType === "tv" ? data.tv_results : data.movie_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function getTmdbMeta(tmdbId, mediaType) {
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const data = await fetchJson(url);
  if (!data) return null;

  const title = mediaType === "tv" ? data.name : data.title;
  const date = mediaType === "tv" ? data.first_air_date : data.release_date;
  if (!title) return null;

  return {
    title,
    year: date ? String(date).slice(0, 4) : "",
    imdbId: (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || "",
    totalSeasons: mediaType === "tv" ? (parseInt(data.number_of_seasons, 10) || 0) : 0
  };
}

function normalizeQuality(value) {
  const raw = String(value || "Auto").trim();
  if (/2160|4k/i.test(raw)) return "2160p";
  if (/1440/i.test(raw)) return "1440p";
  if (/1080/i.test(raw)) return "1080p";
  if (/720/i.test(raw)) return "720p";
  if (/480/i.test(raw)) return "480p";
  if (/360/i.test(raw)) return "360p";
  return raw || "Auto";
}

function subtitleLanguage(rawLabel, url) {
  const text = `${rawLabel || ""} ${url || ""}`.toLowerCase().replace(/_/g, "-");

  if (/\benglish\b|(^|[^a-z])(en|eng)([- ]|[^a-z]|$)/i.test(text)) return { code: "en", display: "English" };
  if (/\bjapanese\b|(^|[^a-z])(ja|jp|jpn)([- ]|[^a-z]|$)/i.test(text)) return { code: "ja", display: "Japanese" };
  if (/\bkorean\b|(^|[^a-z])(ko|kr|kor)([- ]|[^a-z]|$)/i.test(text)) return { code: "ko", display: "Korean" };
  if (/\bchinese\b|\bmandarin\b|(^|[^a-z])(zh|zho|chi)([- ]|[^a-z]|$)|简体|繁體|简中|繁中/i.test(text)) return { code: "zh", display: "Chinese" };
  return null;
}

function normalizeSubtitles(payload) {
  const source = [];
  if (payload && Array.isArray(payload.subtitles)) source.push(...payload.subtitles);
  if (payload && Array.isArray(payload.tracks)) source.push(...payload.tracks);

  const result = [];
  const seen = new Set();

  for (const item of source) {
    if (!item) continue;
    const url = String(item.url || item.file || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;

    const rawLabel = String(item.language || item.lang || item.label || item.name || "").trim();
    const lang = subtitleLanguage(rawLabel, url);
    if (!lang) continue;

    const extra = /\bsdh\b|hearing/i.test(rawLabel) ? " SDH" : /\bforced\b/i.test(rawLabel) ? " Forced" : "";
    const name = `${lang.display}${extra} [Cineby Source]`;
    const key = `${lang.code}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      url,
      language: lang.code,
      name,
      headers: PLAYBACK_HEADERS
    });
  }

  return result;
}

function qualityRank(value) {
  if (/auto|adaptive/i.test(String(value || ""))) return 4000;
  const match = String(value || "").match(/\d{3,4}/);
  return match ? parseInt(match[0], 10) : 0;
}

async function fetchServer(apiHost, server, tmdbId, mediaType, meta, seed, season, episode) {
  const params = new URLSearchParams({
    // Cineby's current player double-encodes title values.
    title: encodeURIComponent(meta.title),
    mediaType,
    year: meta.year || "",
    totalSeasons: String(meta.totalSeasons || 0),
    episodeId: String(mediaType === "tv" ? (episode || 1) : 1),
    seasonId: String(mediaType === "tv" ? (season || 1) : 1),
    tmdbId: String(tmdbId),
    imdbId: meta.imdbId || "",
    enc: "2",
    seed
  });

  const url = `${apiHost}/${server.endpoint}?${params.toString()}`;
  const response = await fetch(url, { headers: API_HEADERS, skipSizeCheck: true });
  if (!response || !response.ok) throw new Error(`${server.name} HTTP ${response ? response.status : "?"}`);

  const text = String(await response.text() || "").trim();
  if (!text) return [];

  let payload;
  try {
    payload = text.charAt(0) === "{" ? JSON.parse(text) : decryptPayload(text, seed, tmdbId);
  } catch (error) {
    throw new Error(`${server.name} decrypt failed: ${error && error.message ? error.message : error}`);
  }

  const subtitles = normalizeSubtitles(payload);
  const sources = payload && Array.isArray(payload.sources) ? payload.sources : [];
  const out = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source) continue;
    const streamUrl = String(source.url || source.file || "").trim();
    if (!/^https?:\/\//i.test(streamUrl)) continue;

    const quality = normalizeQuality(source.quality || source.label || source.title || "Auto");
    out.push({
      name: `${PROVIDER_NAME} • ${server.name} • ${quality}`,
      title: `${PROVIDER_NAME} ${server.name}`,
      url: streamUrl,
      quality,
      provider: PROVIDER_NAME,
      type: /\.m3u8(?:$|[?#])/i.test(streamUrl) ? "m3u8" : "mp4",
      headers: PLAYBACK_HEADERS,
      subtitles
    });
  }

  return out;
}

async function getStreams(inputId, mediaType = "movie", season = null, episode = null) {
  try {
    const type = String(mediaType || "movie").toLowerCase();
    const normalizedType = type === "tv" || type === "series" || type === "show" ? "tv" : "movie";
    const tmdbId = await resolveTmdbId(inputId, normalizedType);
    if (!tmdbId) return [];

    const meta = await getTmdbMeta(tmdbId, normalizedType);
    if (!meta) return [];

    const apiHost = await getApiHost();
    const seedResponse = await fetchJson(`${apiHost}/seed?mediaId=${tmdbId}`, { headers: API_HEADERS });
    const seed = seedResponse && seedResponse.seed ? String(seedResponse.seed) : "";
    if (!seed) return [];

    // Yoru is the preferred original-audio source. Only touch Breach if Yoru
    // fails or returns nothing, which keeps provider load much smaller.
    for (const server of ORIGINAL_AUDIO_SERVERS) {
      try {
        const streams = await fetchServer(apiHost, server, tmdbId, normalizedType, meta, seed, season, episode);
        if (streams.length) {
          const seen = new Set();
          return streams
            .filter(stream => {
              if (!stream.url || seen.has(stream.url)) return false;
              seen.add(stream.url);
              return true;
            })
            .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
        }
      } catch (error) {
        console.log(`[Cineby] ${server.name}: ${error && error.message ? error.message : error}`);
      }
    }

    return [];
  } catch (error) {
    console.log(`[Cineby] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
