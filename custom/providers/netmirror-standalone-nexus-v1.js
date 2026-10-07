"use strict";

// Standalone Limitless Nexus NetMirror provider.
// Transport behavior is based on the previously pinned All-in-One-Nuvio
// implementation (commit 716057b2a0d55a634da88c1d0d2db7352df07c69),
// with Limitless-owned identity validation and season-aware matching.

const PROVIDER_NAME = "NetMirror";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const TMDB_API = "https://api.themoviedb.org/3";
const NET27_BASE = "https://net27.cc";
const NET27_PLAYBACK_REFERER = "https://videodownloader.site/";
const TMDB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const NET27_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const MOBILE_BASE = "https://net52.cc";
const MOBILE_APP_UA = "Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0";
const MOBILE_WEB_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.91 Safari/537.36 /OS.Gatu v3.0";

const PLATFORM_MAP = {
  netflix: { ott: "nf", label: "Netflix" },
  primevideo: { ott: "pv", label: "Prime Video" },
  hotstar: { ott: "hs", label: "Hotstar" },
  disney: { ott: "hs", label: "Disney+" }
};

const NEW_TV_BASE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Requested-With": "NetmirrorNewTV v1.0",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
  Accept: "application/json, text/plain, */*"
};

const NEW_TV_DOMAINS = [
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
];

let resolvedApiUrl = "";
let lastDiagnostics = [];
let mobileCookieJar = [];
let mobileVerifiedCookie = "";
let mobileVerifiedAt = 0;

function clean(value) { return String(value == null ? "" : value).trim(); }
function integer(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const match = clean(value).match(/-?\d+/);
  return match ? Number(match[0]) : null;
}
function yearOf(value) {
  const match = clean(value).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}
function unique(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = clean(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function trace(event, details) {
  lastDiagnostics.push({ event, ...(details || {}) });
}
function diagnostics() { return lastDiagnostics.map(item => ({ ...item })); }

function safeAtob(encoded) {
  if (typeof atob === "function") return atob(encoded);
  if (typeof Buffer !== "undefined") return Buffer.from(encoded, "base64").toString("binary");
  throw new Error("No Base64 decoder available");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response || response.ok === false) throw new Error(`HTTP ${response && response.status || "error"}`);
  return await response.json();
}

async function resolveApiUrl() {
  if (resolvedApiUrl) return resolvedApiUrl;
  for (const encoded of NEW_TV_DOMAINS) {
    const discoveryBase = safeAtob(encoded).replace(/\/$/, "");
    try {
      const data = await fetchJson(`${discoveryBase}/checknewtv.php`, {
        headers: { ...NEW_TV_BASE_HEADERS, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      });
      if (!data || !data.token_hash) continue;
      const apiBase = safeAtob(data.token_hash).replace(/\/$/, "");
      if (!/^https:\/\//i.test(apiBase)) continue;
      resolvedApiUrl = apiBase;
      trace("newtv-discovery", { discoveryDomain: discoveryBase, apiBase });
      return resolvedApiUrl;
    } catch (_) {}
  }
  throw new Error("Failed to resolve NewTV API base URL");
}

function buildNewTvHeaders(ott, extra) {
  return { ...NEW_TV_BASE_HEADERS, Ott: ott, ...(extra || {}) };
}

function normalizeTitle(value) {
  let text = clean(value);
  try { text = text.normalize("NFKD"); } catch (_) {}
  return text
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleKey(value) {
  const normalized = normalizeTitle(value);
  return normalized || `raw:${clean(value).toLowerCase()}`;
}

function ordinal(number) {
  const n = Number(number);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function stripMatchingYear(title, validYears) {
  const raw = clean(title);
  const match = raw.match(/^(.*?)[\s(\[]+((?:19|20)\d{2})[)\]]?\s*$/);
  if (!match) return { title: raw, year: null, valid: true };
  const year = Number(match[2]);
  return { title: clean(match[1]), year, valid: validYears.has(year) };
}

function seasonMarker(title) {
  const raw = clean(title);
  const patterns = [
    /^(.*?)[\s:.-]+season\s+(\d+)\s*$/i,
    /^(.*?)[\s:.-]+(\d+)(?:st|nd|rd|th)\s+season\s*$/i,
    /^(.*?)[\s:.-]+s(?:eason)?\s*(\d+)\s*$/i,
    /^(.*?)[\s:.-]+series\s+(\d+)\s*$/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return { base: clean(match[1]), season: Number(match[2]) };
  }
  return null;
}

function aliasesFromTmdb(tmdbData, alternativeData, mediaType) {
  const primary = mediaType === "tv" ? clean(tmdbData.name) : clean(tmdbData.title);
  const original = mediaType === "tv" ? clean(tmdbData.original_name) : clean(tmdbData.original_title);
  const altList = alternativeData && (alternativeData.results || alternativeData.titles);
  const alternatives = Array.isArray(altList) ? altList.map(item => clean(item && item.title)) : [];
  return unique([primary, original, ...alternatives]).slice(0, 8);
}

function buildSearchQueries(context) {
  const aliases = context.aliases;
  const season = context.season;
  const queries = [];
  if (context.mediaType === "tv") {
    for (const alias of aliases.slice(0, 3)) {
      queries.push(`${alias} Season ${season}`);
      queries.push(`${alias} ${ordinal(season)} Season`);
    }
    const seasonName = clean(context.seasonName);
    if (seasonName && !/^season\s+\d+$/i.test(seasonName)) {
      for (const alias of aliases.slice(0, 2)) queries.push(`${alias} ${seasonName}`);
    }
  }
  queries.push(...aliases);
  return unique(queries).slice(0, 12);
}

function explicitMediaType(value) {
  const type = normalizeTitle(value);
  if (["t", "tv", "series", "show", "tv series"].includes(type)) return "tv";
  if (["m", "movie", "film"].includes(type)) return "movie";
  return "";
}

function candidateTitle(result, postData) {
  const fields = [
    result && result.title, result && result.name, result && result.original_title, result && result.original_name,
    postData && postData.title, postData && postData.name, postData && postData.original_title, postData && postData.original_name
  ];
  return fields.map(clean).find(Boolean) || "";
}

function candidateYear(result, postData) {
  const fields = [
    result && result.year, result && result.release_date, result && result.first_air_date,
    postData && postData.year, postData && postData.release_date, postData && postData.first_air_date
  ];
  for (const value of fields) {
    const year = yearOf(value);
    if (year) return year;
  }
  return null;
}

function scoreTitleOwnership(title, result, postData, context) {
  const validYears = new Set([context.parentYear, context.seasonYear].filter(Boolean));
  const yearInfo = stripMatchingYear(title, validYears);
  if (!yearInfo.valid) return { accepted: false, reason: "title-year-mismatch" };
  const aliasMap = new Map(context.aliases.map((alias, index) => [titleKey(alias), index]));
  const whole = titleKey(yearInfo.title);
  const directAliasIndex = aliasMap.has(whole) ? aliasMap.get(whole) : -1;
  const marker = seasonMarker(yearInfo.title);
  let layout = "";
  let providerSeason = context.season;
  let aliasIndex = directAliasIndex;
  let score = 0;

  if (marker && aliasMap.has(titleKey(marker.base))) {
    if (marker.season !== context.season) return { accepted: false, reason: "explicit-wrong-season" };
    layout = "separate-season";
    providerSeason = 1;
    aliasIndex = aliasMap.get(titleKey(marker.base));
    score = 320;
  } else if (directAliasIndex >= 0) {
    layout = "multi-season";
    score = 250;
  } else {
    return { accepted: false, reason: "title-not-owned" };
  }

  if (aliasIndex === 0) score += 20;
  else if (aliasIndex === 1) score += 10;
  if (yearInfo.year) score += 10;

  const declaredType = explicitMediaType(
    result && (result.media_type || result.content_type || result.type) ||
    postData && (postData.media_type || postData.content_type || postData.type)
  );
  if (declaredType && declaredType !== context.mediaType) return { accepted: false, reason: "media-type-mismatch" };
  if (declaredType === context.mediaType) score += 5;

  const listedYear = candidateYear(result, postData);
  if (listedYear) {
    const wantedYear = layout === "separate-season" ? context.seasonYear : context.parentYear;
    if (wantedYear && listedYear !== wantedYear) return { accepted: false, reason: "catalogue-year-mismatch" };
    if (wantedYear === listedYear) score += 10;
  }

  return { accepted: true, score, layout, providerSeason, title: yearInfo.title, listedYear };
}

function episodeNumber(item) {
  return integer(item && (item.ep != null ? item.ep : item.epNum != null ? item.epNum : item.episode_number));
}

function seasonNumber(item) {
  const values = item ? [item.sNum, item.season_number, item.seasonNumber, item.number, item.name, item.title] : [];
  for (const value of values) {
    const number = integer(value);
    if (number != null) return number;
  }
  return null;
}

function addEpisodes(target, rows, forcedSeason) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row || row.id == null) continue;
    const ep = episodeNumber(row);
    const season = forcedSeason != null ? forcedSeason : seasonNumber(row);
    if (ep == null || season == null) continue;
    target.push({ id: row.id, s: season, ep, raw: row });
  }
}

function seasonEntries(postData) {
  const seasons = Array.isArray(postData && postData.season) ? postData.season.filter(Boolean) : [];
  const explicit = seasons.map(seasonNumber);
  const containsZero = explicit.some(number => number === 0);
  return seasons.map((item, index) => ({
    item,
    id: item.id,
    number: explicit[index] != null ? explicit[index] : (containsZero ? index : index + 1),
    selected: item.selected === true
  }));
}

async function fetchEpisodesPage(seasonId, page, forcedSeason, platform, apiBase) {
  const episodes = [];
  let current = page;
  for (let guard = 0; guard < 100; guard++, current++) {
    const url = `${apiBase}/newtv/episodes.php?id=${encodeURIComponent(seasonId)}&page=${current}`;
    const data = await fetchJson(url, { headers: buildNewTvHeaders(platform.ott) });
    addEpisodes(episodes, data && data.episodes, forcedSeason);
    if (!data || data.nextPageShow !== 1) break;
  }
  return episodes;
}

async function getAllEpisodes(postData, platform, apiBase) {
  const episodes = [];
  const seasons = seasonEntries(postData);
  const selected = seasons.find(item => item.selected);
  const selectedSeasonId = selected && selected.id || postData && postData.nextPageSeason;
  const selectedSeasonNumber = selected ? selected.number : null;

  addEpisodes(episodes, postData && postData.episodes, selectedSeasonNumber);
  if (postData && postData.nextPageShow === 1 && selectedSeasonId) {
    episodes.push(...await fetchEpisodesPage(selectedSeasonId, 2, selectedSeasonNumber, platform, apiBase));
  }
  for (const season of seasons) {
    if (!season.id || String(season.id) === String(selectedSeasonId)) continue;
    episodes.push(...await fetchEpisodesPage(season.id, 1, season.number, platform, apiBase));
  }
  return { episodes, seasons };
}

function exactEpisode(episodes, season, episode) {
  const matches = episodes.filter(item => item && item.s === season && item.ep === episode);
  const ids = unique(matches.map(item => clean(item.id)));
  if (ids.length !== 1) return { match: null, reason: ids.length ? "ambiguous-episode-id" : "requested-episode-unavailable" };
  return { match: matches.find(item => clean(item.id) === ids[0]), reason: "" };
}

async function tmdbContext(tmdbId, mediaType, season, episode) {
  const headers = { "User-Agent": TMDB_UA, Accept: "application/json" };
  const data = await fetchJson(`${TMDB_API}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`, { headers });
  const title = mediaType === "tv" ? clean(data && data.name) : clean(data && data.title);
  if (!title) throw new Error("Could not fetch title from TMDB");

  let seasonData = null;
  if (mediaType === "tv") {
    try { seasonData = await fetchJson(`${TMDB_API}/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`, { headers }); }
    catch (_) {}
  }
  let alternativeData = null;
  try { alternativeData = await fetchJson(`${TMDB_API}/${mediaType}/${tmdbId}/alternative_titles?api_key=${TMDB_API_KEY}`, { headers }); }
  catch (_) {}

  const aliases = aliasesFromTmdb(data, alternativeData, mediaType);
  const parentDate = mediaType === "tv" ? data.first_air_date : data.release_date;
  const context = {
    tmdbId,
    mediaType,
    season,
    episode,
    title,
    aliases,
    parentYear: yearOf(parentDate),
    originalLanguage: clean(data && data.original_language).toLowerCase(),
    originCountries: Array.isArray(data && data.origin_country) ? data.origin_country.map(clean).filter(Boolean) : [],
    seasonName: clean(seasonData && seasonData.name),
    seasonYear: yearOf(seasonData && seasonData.air_date)
  };
  context.queries = buildSearchQueries(context);
  trace("tmdb", {
    tmdbId, mediaType, season, episode, title,
    originalTitle: mediaType === "tv" ? clean(data.original_name) : clean(data.original_title),
    originalLanguage: context.originalLanguage, originCountries: context.originCountries,
    seasonTitle: context.seasonName, seasonYear: context.seasonYear,
    aliases: context.aliases, queries: context.queries
  });
  return context;
}

function mobileSetCookies(headers, responseUrl) {
  if (!headers) return;
  let rows = [];
  try {
    if (typeof headers.getSetCookie === "function") rows = headers.getSetCookie();
  } catch (_) {}
  if (!rows.length && headers.get) {
    const raw = headers.get("set-cookie") || headers.get("Set-Cookie") || "";
    if (raw) rows = raw.split(/,(?=\s*[^;,\s]+=)/g);
  }
  let host = "";
  try { host = new URL(responseUrl).hostname.toLowerCase(); } catch (_) {}
  for (const raw of rows) {
    const pair = clean(raw).split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const domainMatch = clean(raw).match(/(?:^|;)\s*domain=([^;]+)/i);
    const domain = clean(domainMatch ? domainMatch[1] : host).replace(/^\./, "").toLowerCase();
    const index = mobileCookieJar.findIndex(item => item.name === name && item.domain === domain);
    if (!value || /max-age\s*=\s*0/i.test(raw)) {
      if (index >= 0) mobileCookieJar.splice(index, 1);
      continue;
    }
    const item = { name, value, domain };
    if (index >= 0) mobileCookieJar[index] = item;
    else mobileCookieJar.push(item);
  }
}

function mobileCookieHeader(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) {}
  return mobileCookieJar
    .filter(item => host === item.domain || host.endsWith("." + item.domain))
    .map(item => item.name + "=" + item.value)
    .join("; ");
}

async function mobileRequest(url, options) {
  const opts = options || {};
  const headers = { ...(opts.headers || {}) };
  const jar = mobileCookieHeader(url);
  if (jar) headers.Cookie = headers.Cookie ? headers.Cookie + "; " + jar : jar;
  const response = await fetch(url, { ...opts, headers });
  mobileSetCookies(response && response.headers, response && response.url || url);
  return response;
}

function mobileCookie(name) {
  const row = mobileCookieJar.find(item => item.name === name);
  return row ? row.value : "";
}

async function mobileDelay(ms) {
  if (typeof setTimeout === "function") return new Promise(resolve => setTimeout(resolve, ms));
  if (typeof SharedArrayBuffer === "function" && typeof Atomics !== "undefined" && typeof Atomics.wait === "function") {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      return;
    } catch (_) {}
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

async function mobileBypass() {
  if (mobileVerifiedCookie && Date.now() - mobileVerifiedAt < 15 * 60 * 60 * 1000) return mobileVerifiedCookie;
  mobileCookieJar = [];
  mobileVerifiedCookie = "";
  try {
    const appHeaders = { "User-Agent": MOBILE_APP_UA, "X-Requested-With": "app.netmirror.netmirrornew" };
    const home = await mobileRequest(MOBILE_BASE + "/mobile/home?app=1", { headers: appHeaders });
    const html = String(await home.text() || "");
    const match = html.match(/data-addhash\s*=\s*["']([^"']+)["']/i);
    if (!home.ok || !match) return "";

    const hash = match[1];
    const userver = await mobileRequest(
      "https://userver.net52.cc/?hee5=" + encodeURIComponent(hash) + "&a=y&t=" + Date.now(),
      { headers: appHeaders }
    );
    await userver.text();

    for (let attempt = 1; attempt <= 7; attempt++) {
      await mobileDelay(10000);
      const verify = await mobileRequest(MOBILE_BASE + "/mobile/verify2.php", {
        method: "POST",
        headers: {
          "User-Agent": MOBILE_APP_UA,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "verify=" + encodeURIComponent(hash)
      });
      const text = String(await verify.text() || "");
      let done = text.includes('"statusup":"All Done"');
      if (!done) {
        try { done = JSON.parse(text).statusup === "All Done"; } catch (_) {}
      }
      trace("mobile-verify", { attempt, done });
      if (!done) continue;
      const cookie = mobileCookie("t_hash_t");
      if (cookie) {
        mobileVerifiedCookie = cookie;
        mobileVerifiedAt = Date.now();
        return cookie;
      }
    }
  } catch (error) {
    trace("rejection", { path: "mobile-netflix", reason: "mobile-verification-failed", message: clean(error && error.message) });
  }
  return "";
}

async function mobileJson(url, headers) {
  const response = await mobileRequest(url, { headers });
  if (!response || !response.ok) throw new Error("HTTP " + (response && response.status || "error"));
  return response.json();
}

function mobileEpisodeNumber(item) {
  return integer(item && (item.ep != null ? item.ep : item.epNum != null ? item.epNum : item.episode_number));
}

function mobileSeasonNumber(item, fallback) {
  if (!item) return fallback;
  const values = [item.s, item.sNum, item.season, item.season_number, item.number, item.name, item.title];
  for (const value of values) {
    const number = integer(value);
    if (number != null) return number;
  }
  return fallback;
}

function mobileTrack(track, playbackHeaders) {
  if (!track || !/(caption|sub)/i.test(clean(track.kind || track.type))) return null;
  let url = clean(track.file || track.url || track.src || track.uri);
  if (!url) return null;
  if (url.startsWith("//")) url = "https:" + url;
  else if (url.startsWith("/")) url = MOBILE_BASE + url;
  if (!/^https?:\/\//i.test(url)) return null;
  const label = clean(track.label || track.name || track.lang || track.language) || "Unknown";
  return { url, language: clean(track.language || track.lang || label) || label, name: label, headers: playbackHeaders };
}

function mobileSourceUrl(file) {
  const raw = clean(file);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return "https:" + raw;
  return MOBILE_BASE + (raw.startsWith("/") ? "" : "/") + raw;
}

function mobileAudioLanguage(url) {
  try {
    const parsed = new URL(url);
    return clean(parsed.searchParams.get("lang"));
  } catch (_) {
    const match = clean(url).match(/[?&]lang=([^&#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function mobileQuality(label, url) {
  const text = clean(label) + " " + clean(url);
  const explicit = qualityNumber({ quality: text, name: text });
  if (explicit) return explicit + "p";
  if (/full\s*hd/i.test(text)) return "1080p";
  if (/mid\s*hd/i.test(text)) return "720p";
  if (/low\s*hd/i.test(text)) return "480p";
  return "Auto";
}

function resolveHlsUrl(value, base) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  try { return new URL(raw, base).toString(); } catch (_) { return ""; }
}

async function mobileMasterRows(sourceUrl, playbackHeaders, subtitles, context, sourceMeta) {
  try {
    const response = await fetch(sourceUrl, { headers: playbackHeaders });
    if (!response || !response.ok) return [];
    const text = String(await response.text() || "");
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
      const res = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith("#")) j++;
      if (j >= lines.length) continue;
      const url = resolveHlsUrl(lines[j], sourceUrl);
      if (!url) continue;
      const height = res ? Number(res[1]) : qualityNumber({ quality: lines[i], name: lines[i] });
      rows.push(attachAudioMetadata({
        name: "NetMirror (Netflix Mobile) - " + (height ? height + "p" : clean(sourceMeta && sourceMeta.label || "Auto")),
        title: context.title,
        url,
        quality: height ? height + "p" : mobileQuality(sourceMeta && sourceMeta.label, url),
        headers: playbackHeaders,
        subtitles,
        provider: "netmirror",
        type: "m3u8"
      }, { audioLanguage: mobileAudioLanguage(sourceUrl) || mobileAudioLanguage(url) }, sourceMeta));
    }
    return rows;
  } catch (_) {
    return [];
  }
}

async function fetchFromNetflixMobile(context, forceHd) {
  const cookie = await mobileBypass();
  if (!cookie) {
    trace("rejection", { path: "mobile-netflix", reason: "mobile-cookie-unavailable" });
    return [];
  }

  const baseHeaders = {
    "User-Agent": MOBILE_WEB_UA,
    "Accept": "*/*",
    "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
    "X-Requested-With": "app.netmirror.netmirrornew",
    "Referer": MOBILE_BASE + "/mobile/home?app=1",
    "Cookie": "t_hash_t=" + cookie + "; ott=nf" + (forceHd === false ? "" : "; hd=on")
  };

  const aliases = unique([context.title, ...context.aliases]).slice(0, 4);
  let matched = null;

  for (const query of aliases) {
    let search;
    try {
      search = await mobileJson(MOBILE_BASE + "/mobile/search.php?s=" + encodeURIComponent(query) + "&t=" + Math.floor(Date.now() / 1000), baseHeaders);
    } catch (_) {
      continue;
    }
    const results = Array.isArray(search && search.searchResult) ? search.searchResult : [];
    for (const result of results.slice(0, 12)) {
      if (!result || result.id == null) continue;
      let post;
      try {
        post = await mobileJson(MOBILE_BASE + "/mobile/post.php?id=" + encodeURIComponent(result.id) + "&t=" + Math.floor(Date.now() / 1000), baseHeaders);
      } catch (_) {
        continue;
      }

      const resultTitle = candidateTitle(result, post);
      const ownership = scoreTitleOwnership(resultTitle, result, post, context);
      if (!ownership.accepted) continue;

      let targetId = result.id;
      let mappedSeason = null;
      let mappedEpisode = null;

      if (context.mediaType === "tv") {
        const wantedSeason = ownership.providerSeason;
        const wantedEpisode = context.episode;
        const seasons = Array.isArray(post && post.season) ? post.season.filter(Boolean) : [];
        const selectedIndex = seasons.findIndex(item => item && item.selected === true);
        const fallbackSeason = selectedIndex >= 0 ? selectedIndex + 1 : wantedSeason;
        let episodeRow = (Array.isArray(post && post.episodes) ? post.episodes : []).find(item =>
          item && mobileEpisodeNumber(item) === wantedEpisode && mobileSeasonNumber(item, fallbackSeason) === wantedSeason
        );

        if (!episodeRow) {
          const seasonRow = seasons.find(item => mobileSeasonNumber(item, null) === wantedSeason);
          if (seasonRow && seasonRow.id) {
            for (let page = 1; page <= 30 && !episodeRow; page++) {
              let pageData;
              try {
                pageData = await mobileJson(
                  MOBILE_BASE + "/mobile/episodes.php?s=" + encodeURIComponent(seasonRow.id) +
                  "&series=" + encodeURIComponent(result.id) +
                  "&t=" + Math.floor(Date.now() / 1000) + "&page=" + page,
                  baseHeaders
                );
              } catch (_) {
                break;
              }
              episodeRow = (Array.isArray(pageData && pageData.episodes) ? pageData.episodes : []).find(item =>
                item && mobileEpisodeNumber(item) === wantedEpisode && mobileSeasonNumber(item, wantedSeason) === wantedSeason
              );
              if (!pageData || !pageData.nextPageShow || Number(pageData.nextPageShow) === 0) break;
            }
          }
        }

        if (!episodeRow || episodeRow.id == null) continue;
        targetId = episodeRow.id;
        mappedSeason = wantedSeason;
        mappedEpisode = wantedEpisode;
      } else {
        const isSeries = explicitMediaType(post && post.type) === "tv" ||
          Array.isArray(post && post.episodes) && post.episodes.filter(Boolean).length > 0;
        if (isSeries) continue;
        targetId = post && post.main_id || result.id;
      }

      matched = { result, post, ownership, resultTitle, targetId, mappedSeason, mappedEpisode };
      break;
    }
    if (matched) break;
  }

  if (!matched) {
    trace("rejection", { path: "mobile-netflix", reason: "mobile-title-or-episode-unavailable" });
    return [];
  }

  let payload;
  try {
    payload = await mobileJson(
      MOBILE_BASE + "/mobile/playlist.php?id=" + encodeURIComponent(matched.targetId) +
      "&t=" + encodeURIComponent(context.title) +
      "&tm=" + Math.floor(Date.now() / 1000),
      baseHeaders
    );
  } catch (error) {
    trace("rejection", { path: "mobile-netflix", reason: "mobile-playlist-failed", message: clean(error && error.message) });
    return [];
  }

  const entries = Array.isArray(payload) ? payload : (payload && (payload.playlist || payload.data)) || [];
  const subtitles = [];
  const seenSubtitles = new Set();
  const sourceRows = [];

  for (const entry of entries) {
    for (const track of (entry && entry.tracks) || []) {
      const mapped = mobileTrack(track, baseHeaders);
      if (!mapped || seenSubtitles.has(mapped.url)) continue;
      seenSubtitles.add(mapped.url);
      subtitles.push(mapped);
    }
    for (const source of (entry && entry.sources) || []) {
      const url = mobileSourceUrl(source && source.file);
      if (!url) continue;
      sourceRows.push({ source, url });
    }
  }

  trace("mobile-playlist", {
    path: "mobile-netflix",
    entryCount: entries.length,
    sourceCount: sourceRows.length,
    subtitleCount: subtitles.length,
    sourceLabels: sourceRows.map(item => clean(item.source && item.source.label)),
    sourceLanguages: unique(sourceRows.map(item => mobileAudioLanguage(item.url)).filter(Boolean)),
    entryKeys: unique(entries.flatMap(entry => Object.keys(entry || {}))).sort()
  });

  if (!sourceRows.length) return [];

  const auto = sourceRows.find(item => /auto/i.test(clean(item.source && item.source.label))) || sourceRows[0];
  const expanded = await mobileMasterRows(auto.url, baseHeaders, subtitles, context, auto.source);
  let rows = expanded;

  if (!rows.length) {
    rows = sourceRows.map(item => attachAudioMetadata({
      name: "NetMirror (Netflix Mobile) - " + clean(item.source && item.source.label || "Auto"),
      title: context.title,
      url: item.url,
      quality: mobileQuality(item.source && item.source.label, item.url),
      headers: baseHeaders,
      subtitles,
      provider: "netmirror",
      type: /m3u8/i.test(item.url) ? "m3u8" : "video"
    }, { audioLanguage: mobileAudioLanguage(item.url) }, item.source));
  }

  const seen = new Set();
  rows = rows.filter(row => row && row.url && !seen.has(row.url) && seen.add(row.url));
  trace("mobile-accepted", {
    path: "mobile-netflix",
    candidateTitle: matched.resultTitle,
    candidateId: matched.result && matched.result.id,
    playerId: matched.targetId,
    requestedSeason: context.season,
    requestedEpisode: context.episode,
    mappedProviderSeason: matched.mappedSeason,
    mappedProviderEpisode: matched.mappedEpisode,
    returnedRows: rows.length
  });
  return rows;
}

function directIdentity(data, context) {
  if (!data || data.ok !== true) return { accepted: false, reason: "direct-not-ok" };
  if (data.tmdbId != null && Number(data.tmdbId) !== context.tmdbId) return { accepted: false, reason: "direct-tmdb-mismatch" };
  if (data.type && explicitMediaType(data.type) && explicitMediaType(data.type) !== context.mediaType) {
    return { accepted: false, reason: "direct-media-type-mismatch" };
  }
  if (data.title && !context.aliases.map(titleKey).includes(titleKey(data.title))) {
    return { accepted: false, reason: "direct-title-mismatch" };
  }
  if (context.mediaType === "tv") {
    const returnedSeason = integer(data.currentSeason);
    const returnedEpisode = integer(data.currentEpisode);
    if (returnedSeason == null || returnedEpisode == null) return { accepted: false, reason: "direct-episode-identity-missing" };
    if (returnedSeason !== context.season || returnedEpisode !== context.episode) {
      return { accepted: false, reason: "direct-season-episode-mismatch", returnedSeason, returnedEpisode };
    }
  }
  return { accepted: true };
}

async function fetchFromNetflixDirect(context) {
  const apiUrl = context.mediaType === "tv"
    ? `${NET27_BASE}/api/embed-tmdb/${context.tmdbId}?type=tv&se=${context.season}&ep=${context.episode}`
    : `${NET27_BASE}/api/embed-tmdb/${context.tmdbId}`;
  let data;
  try {
    data = await fetchJson(apiUrl, { headers: { Accept: "application/json, text/plain, */*", Referer: `${NET27_BASE}/`, "User-Agent": NET27_UA } });
  } catch (error) {
    trace("rejection", { path: "net27-direct", platform: "netflix", reason: "direct-request-failed", message: clean(error && error.message) });
    return [];
  }

  trace("direct-metadata", {
    path: "net27-direct", platform: "netflix",
    responseKeys: data && typeof data === "object" ? Object.keys(data).sort() : [],
    streamKeys: Array.isArray(data && data.streams) ? unique(data.streams.filter(Boolean).flatMap(item => Object.keys(item || {}))).sort() : [],
    captionKeys: Array.isArray(data && data.captions) ? unique(data.captions.filter(Boolean).flatMap(item => Object.keys(item || {}))).sort() : []
  });

  const identity = directIdentity(data, context);
  trace(identity.accepted ? "direct-accepted" : "rejection", {
    path: "net27-direct", platform: "netflix", reason: identity.reason || "",
    requestedTmdbId: context.tmdbId, returnedTmdbId: data && data.tmdbId,
    requestedSeason: context.season, requestedEpisode: context.episode,
    returnedSeason: data && data.currentSeason, returnedEpisode: data && data.currentEpisode,
    returnedTitle: clean(data && data.title), subjectId: data && data.subjectId,
    detailPath: clean(data && data.detailPath), playerId: data && data.subjectId
  });
  if (!identity.accepted) return [];

  const playbackHeaders = { Referer: NET27_PLAYBACK_REFERER, "User-Agent": NET27_UA };
  const subtitles = (Array.isArray(data.captions) ? data.captions : []).map(caption => {
    let url = clean(caption && caption.url);
    if (url.startsWith("/")) url = `${NET27_BASE}${url}`;
    return { url, language: clean(caption && caption.lang) || "en", name: clean(caption && caption.name) || "English", headers: playbackHeaders };
  }).filter(item => /^https?:\/\//i.test(item.url));
  const rows = [];
  if (Array.isArray(data.streams) && data.streams.length) {
    for (const stream of data.streams) {
      if (!stream || !/^https?:\/\//i.test(clean(stream.url))) continue;
      rows.push(attachAudioMetadata({
        name: `NetMirror (Netflix) - ${stream.resolution}p`, title: context.title,
        url: stream.url, quality: `${stream.resolution}p`, headers: playbackHeaders,
        subtitles, provider: "netmirror"
      }, stream, data));
    }
  } else if (/^https?:\/\//i.test(clean(data.mp4))) {
    rows.push(attachAudioMetadata({ name: "NetMirror (Netflix) - Auto", title: context.title, url: data.mp4, quality: "Auto", headers: playbackHeaders, subtitles, provider: "netmirror" }, data));
  }
  return rows;
}

async function searchPlatform(platformKey, context, apiBase) {
  const platform = PLATFORM_MAP[platformKey];
  const found = new Map();
  for (let queryIndex = 0; queryIndex < context.queries.length; queryIndex++) {
    const query = context.queries[queryIndex];
    try {
      const url = `${apiBase}/newtv/search.php?s=${encodeURIComponent(query)}`;
      const data = await fetchJson(url, { headers: buildNewTvHeaders(platform.ott) });
      const results = Array.isArray(data && data.searchResult) ? data.searchResult : [];
      trace("search", {
        path: "newtv-generic", platform: platformKey, query, resultCount: results.length,
        candidates: results.filter(Boolean).map(result => ({
          id: result.id, title: clean(result.title || result.name),
          mediaType: clean(result.media_type || result.content_type || result.type), year: candidateYear(result, null)
        }))
      });
      for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
        const result = results[resultIndex];
        if (!result || result.id == null) continue;
        const key = clean(result.id);
        const existing = found.get(key);
        if (!existing || queryIndex < existing.queryIndex) found.set(key, { result, query, queryIndex, resultIndex });
      }
    } catch (error) {
      trace("rejection", { path: "newtv-generic", platform: platformKey, query, reason: "search-request-failed", message: clean(error && error.message) });
    }
  }
  return Array.from(found.values());
}

async function inspectCandidate(platformKey, candidate, context, apiBase) {
  const platform = PLATFORM_MAP[platformKey];
  const contentId = candidate.result.id;
  let postData;
  try {
    postData = await fetchJson(`${apiBase}/newtv/post.php?id=${encodeURIComponent(contentId)}`, {
      headers: buildNewTvHeaders(platform.ott, { Lastep: "", Usertoken: "" })
    });
  } catch (error) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, query: candidate.query, candidateId: contentId, reason: "post-request-failed", message: clean(error && error.message) });
    return null;
  }

  const title = candidateTitle(candidate.result, postData);
  const ownership = scoreTitleOwnership(title, candidate.result, postData, context);
  if (!ownership.accepted) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, query: candidate.query, candidateTitle: title, candidateId: contentId, reason: ownership.reason });
    return null;
  }

  let targetId = contentId;
  let seasonStructure = [];
  let mappedSeason = null;
  let mappedEpisode = null;
  if (context.mediaType === "tv") {
    let enumerated;
    try { enumerated = await getAllEpisodes(postData, platform, apiBase); }
    catch (error) {
      trace("rejection", { path: "newtv-generic", platform: platformKey, query: candidate.query, candidateTitle: title, candidateId: contentId, reason: "episode-enumeration-failed", message: clean(error && error.message) });
      return null;
    }
    seasonStructure = enumerated.seasons.map(item => ({ id: item.id, number: item.number, selected: item.selected }));
    const selected = exactEpisode(enumerated.episodes, ownership.providerSeason, context.episode);
    if (!selected.match) {
      trace("rejection", {
        path: "newtv-generic", platform: platformKey, query: candidate.query, candidateTitle: title, candidateId: contentId,
        candidateSeasonStructure: seasonStructure, requestedSeason: context.season, requestedEpisode: context.episode,
        mappedProviderSeason: ownership.providerSeason, reason: selected.reason
      });
      return null;
    }
    targetId = selected.match.id;
    mappedSeason = selected.match.s;
    mappedEpisode = selected.match.ep;
    ownership.score += ownership.layout === "separate-season" ? 25 : 15;
  } else {
    const isSeries = explicitMediaType(postData && postData.type) === "tv" ||
      Array.isArray(postData && postData.episodes) && postData.episodes.filter(Boolean).length > 0;
    if (isSeries) {
      trace("rejection", { path: "newtv-generic", platform: platformKey, query: candidate.query, candidateTitle: title, candidateId: contentId, reason: "movie-candidate-is-series" });
      return null;
    }
    targetId = postData && postData.main_id || contentId;
  }

  return {
    platformKey, platform, query: candidate.query, queryIndex: candidate.queryIndex,
    resultIndex: candidate.resultIndex, contentId, title, ownership, postData,
    targetId, seasonStructure, mappedSeason, mappedEpisode
  };
}

function chooseCandidate(candidates) {
  if (!candidates.length) return { candidate: null, reason: "no-owned-candidate" };
  candidates.sort((a, b) =>
    b.ownership.score - a.ownership.score || a.queryIndex - b.queryIndex || a.resultIndex - b.resultIndex || clean(a.contentId).localeCompare(clean(b.contentId))
  );
  const best = candidates[0];
  const tied = candidates.filter(item => item.ownership.score === best.ownership.score && String(item.contentId) !== String(best.contentId));
  if (tied.length) return { candidate: null, reason: "ambiguous-top-candidates", tied: [best, ...tied] };
  return { candidate: best, reason: "" };
}

async function fetchFromPlatform(platformKey, context) {
  const platform = PLATFORM_MAP[platformKey];
  if (!platform) return [];
  let apiBase;
  try { apiBase = await resolveApiUrl(); }
  catch (error) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, reason: "api-discovery-failed", message: clean(error && error.message) });
    return [];
  }

  const searchCandidates = await searchPlatform(platformKey, context, apiBase);
  const inspected = [];
  for (const candidate of searchCandidates) {
    const owned = await inspectCandidate(platformKey, candidate, context, apiBase);
    if (owned) inspected.push(owned);
  }
  const chosen = chooseCandidate(inspected);
  if (!chosen.candidate) {
    trace("rejection", {
      path: "newtv-generic", platform: platformKey, reason: chosen.reason,
      candidateIds: chosen.tied ? chosen.tied.map(item => item.contentId) : []
    });
    return [];
  }

  const match = chosen.candidate;
  let response;
  try {
    response = await fetchJson(`${apiBase}/newtv/player.php?id=${encodeURIComponent(match.targetId)}`, {
      headers: buildNewTvHeaders(platform.ott, { Usertoken: "" })
    });
  } catch (error) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, candidateTitle: match.title, candidateId: match.contentId, playerId: match.targetId, reason: "player-request-failed", message: clean(error && error.message) });
    return [];
  }
  if (!response || response.status !== "ok" || !/^https?:\/\//i.test(clean(response.video_link))) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, candidateTitle: match.title, candidateId: match.contentId, playerId: match.targetId, reason: "player-source-unavailable" });
    return [];
  }

  trace("generic-accepted", {
    path: "newtv-generic", platform: platformKey, query: match.query,
    candidateTitle: match.title, candidateId: match.contentId,
    candidateSeasonStructure: match.seasonStructure,
    requestedSeason: context.season, requestedEpisode: context.episode,
    catalogueLayout: match.ownership.layout, mappedProviderSeason: match.mappedSeason,
    mappedProviderEpisode: match.mappedEpisode, internalEpisodeId: match.targetId,
    playerId: match.targetId
  });
  return [attachAudioMetadata({
    name: `NetMirror (${platform.label})`, title: context.title,
    url: response.video_link, quality: "Auto",
    headers: { Referer: response.referer || apiBase }, provider: "netmirror"
  }, response, match.postData)];
}

function scalarField(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" || typeof value === "number") {
        const normalized = clean(value);
        if (normalized) return normalized;
      }
    }
  }
  return "";
}

function arrayField(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (Array.isArray(source[key]) && source[key].filter(Boolean).length) return source[key];
    }
  }
  return null;
}

function attachAudioMetadata(row, ...sources) {
  const language = scalarField(sources, ["audioLanguage", "audio_language", "audioLang", "audio_lang", "language", "lang"]);
  const audioType = scalarField(sources, ["audioType", "audio_type", "audioLabel", "audio_label"]);
  const audio = scalarField(sources, ["audio"]);
  const audioTracks = arrayField(sources, ["audioTracks", "audio_tracks", "audios", "audio_streams"]);
  const explicitDub = sources.some(source => source && typeof source === "object" &&
    (source.isDubbed === true || source.dubbed === true || source.dub === true));
  const explicitDual = sources.some(source => source && typeof source === "object" &&
    (source.dualAudio === true || source.dual_audio === true || source.isDualAudio === true));

  if (language) row.audioLanguage = language;
  if (audioType) row.audioType = audioType;
  else if (explicitDub) row.audioType = "dub";
  else if (explicitDual) row.audioType = "dual";
  if (audio) row.audio = audio;
  if (audioTracks) row.audioTracks = audioTracks;
  return row;
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const match = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return match ? Number(match[1]) : 0;
}

function qualityLabel(height) {
  if (height >= 4320) return `2x4K 8K ${height}p`;
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `Enhanced QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 540) return `HD-Low ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height >= 360) return `SD-Low ${height}p`;
  if (height > 0) return `SD-Very Low ${height}p`;
  return "Unknown Auto";
}

function subtitleTrack(track) {
  if (!track) return false;
  if (typeof track === "string") return !!track.trim();
  const kind = clean(track.kind || track.type).toLowerCase();
  if (kind && !/(sub|caption|text|vtt|srt)/.test(kind)) return false;
  return !!(track.url || track.file || track.src || track.uri);
}

function hasSelectableSubs(row) {
  return [row && row.subtitles, row && row.subtitleTracks, row && row.captions, row && row.tracks]
    .some(group => Array.isArray(group) && group.some(subtitleTrack));
}

function hasMultipleAudio(row) {
  if ([row && row.audioTracks, row && row.audios].some(group => Array.isArray(group) && group.filter(Boolean).length > 1)) return true;
  const tracks = Array.isArray(row && row.tracks) ? row.tracks : [];
  return tracks.filter(track => track && typeof track === "object" && /audio/i.test(clean(track.kind || track.type))).length > 1;
}

function audioEvidence(row) {
  const languageText = [row && row.audioLanguage, row && row.language, row && row.lang]
    .filter(Boolean).join(" ").toLowerCase();
  const descriptiveText = [row && row.audio, row && row.audioType]
    .filter(Boolean).join(" ").toLowerCase();
  const allText = `${languageText} ${descriptiveText}`.trim();
  const explicitDub = /\[dub(?:\+sub)?\]|english\s*dub|\bdubbed\b|\bdub\b/.test(allText);
  const english = explicitDub || /(?:^|[^a-z])(?:en|eng|english)(?:[^a-z]|$)/i.test(languageText) ||
    /\benglish\b/i.test(descriptiveText);
  return {
    explicitDub,
    english,
    hasLanguageEvidence: !!languageText,
    languageText,
    descriptiveText
  };
}

function classification(row, context) {
  const text = [row && row.name, row && row.audio, row && row.audioType, row && row.audioLanguage, row && row.language, row && row.lang]
    .filter(Boolean).join(" ").toLowerCase();
  const dual = hasMultipleAudio(row) || /dual\s*audio|\[dual\]|\bdual\b/.test(text);
  const selectable = hasSelectableSubs(row);
  const evidence = audioEvidence(row);
  const hardSub = /\[hsub\]|hard[\s-]*subs?|hardsub/.test(text);

  // Nexus uses [DUB] as the user-facing English-audio bucket. Actual stream/provider
  // metadata wins. When NetMirror exposes no audio-language evidence, English-original
  // content from TMDB is treated as English default audio.
  const tmdbEnglish = clean(context && context.originalLanguage).toLowerCase() === "en";
  const inferredEnglish = !evidence.hasLanguageEvidence && tmdbEnglish;
  const englishAudio = evidence.english || inferredEnglish;

  if (dual) return "[DUAL]";
  if (selectable) return englishAudio ? "[DUB+SUB]" : "[SUB]";
  if (englishAudio) return "[DUB]";
  if (hardSub) return "[HSUB]";
  return "[UNK]";
}

function serviceLabel(row) {
  const text = `${row && row.name || ""} ${row && row.provider || ""}`;
  const known = [
    [/\bnetflix\b/i, "Netflix"], [/\b(?:amazon\s*)?prime(?:\s*video)?\b/i, "Prime Video"],
    [/\bdisney\s*\+|\bdisneyplus\b/i, "Disney+"], [/\bjio\s*hotstar\b|\bjiohotstar\b/i, "JioHotstar"],
    [/\bhotstar\b/i, "Hotstar"], [/\bhulu\b/i, "Hulu"], [/\b(?:hbo\s*)?max\b/i, "Max"]
  ];
  for (const pair of known) if (pair[0].test(text)) return pair[1];
  return "";
}

function normalizeRows(rows, context) {
  const metadata = rows.map(row => {
    const quality = qualityLabel(qualityNumber(row));
    const tag = classification(row, context);
    const evidence = audioEvidence(row);
    trace("classification", {
      quality, tag, originalLanguage: clean(context && context.originalLanguage),
      audioLanguage: clean(row && (row.audioLanguage || row.language || row.lang)),
      audioType: clean(row && row.audioType),
      selectableSubtitles: hasSelectableSubs(row),
      multipleAudio: hasMultipleAudio(row),
      inferredEnglishFromTmdb: !evidence.hasLanguageEvidence && clean(context && context.originalLanguage).toLowerCase() === "en"
    });
    return { row, quality, tag, service: serviceLabel(row) };
  });
  const serviceSets = {};
  for (const item of metadata) {
    const key = `${item.quality}|${item.tag}`;
    if (!serviceSets[key]) serviceSets[key] = new Set();
    if (item.service) serviceSets[key].add(item.service);
  }
  return metadata.map(item => {
    const key = `${item.quality}|${item.tag}`;
    const showService = serviceSets[key].size > 1 && item.service;
    return { ...item.row, name: `${PROVIDER_NAME} • ${item.quality} • ${item.tag}${showService ? ` • ${item.service}` : ""}` };
  });
}

async function getStreams(inputId, mediaType = "movie", season = 1, episode = 1) {
  lastDiagnostics = [];
  const tmdbId = integer(clean(inputId).replace(/^tmdb:/i, ""));
  const type = clean(mediaType).toLowerCase() === "tv" ? "tv" : "movie";
  const requestedSeason = type === "tv" ? integer(season) : null;
  const requestedEpisode = type === "tv" ? integer(episode) : null;
  trace("request", { requestedTmdbId: tmdbId, requestedMediaType: type, requestedSeason, requestedEpisode });
  if (!tmdbId || type === "tv" && (!requestedSeason || !requestedEpisode)) {
    trace("rejection", { reason: "invalid-request" });
    return [];
  }

  let context;
  try { context = await tmdbContext(tmdbId, type, requestedSeason, requestedEpisode); }
  catch (error) {
    trace("rejection", { reason: "tmdb-metadata-failed", message: clean(error && error.message) });
    return [];
  }

  const settings = globalThis.SCRAPER_SETTINGS || {};
  const preferred = clean(settings.preferredPlatform) || "all";
  let platforms = ["netflix", "primevideo", "hotstar", "disney"];
  if (preferred !== "all" && PLATFORM_MAP[preferred]) platforms = [preferred, ...platforms.filter(item => item !== preferred)];

  for (const platformKey of platforms) {
    trace("platform", { platform: platformKey, preferred, forceHd: settings.forceHd !== false });
    if (platformKey === "netflix") {
      // Keep both Netflix stream families when available:
      // - current mobile playlist: English-selected audio + captions
      // - Net27 direct: original-language audio + captions
      // This preserves separate [DUB+SUB] and [SUB] choices instead of treating
      // the original-language stream as a fallback that disappears when dub works.
      const [mobile, direct] = await Promise.all([
        fetchFromNetflixMobile(context, settings.forceHd !== false),
        fetchFromNetflixDirect(context)
      ]);
      const seenNetflixUrls = new Set();
      const netflixRows = mobile.concat(direct).filter(row => {
        const url = clean(row && row.url);
        if (!url || seenNetflixUrls.has(url)) return false;
        seenNetflixUrls.add(url);
        return true;
      });
      if (netflixRows.length) return normalizeRows(netflixRows, context);
    }
    const generic = await fetchFromPlatform(platformKey, context);
    if (generic.length) return normalizeRows(generic, context);
  }
  return [];
}

async function onSettings() {
  return [
    { type: "header", label: "Source Selection" },
    {
      type: "select", key: "preferredPlatform", label: "Preferred Streaming Source",
      description: "Select which platform to try first. If content isn't found, others will be searched as fallback.",
      options: [
        { label: "All Sources (Ordered)", value: "all" }, { label: "Netflix", value: "netflix" },
        { label: "Prime Video", value: "primevideo" }, { label: "Hotstar / Disney+", value: "hotstar" }
      ],
      defaultValue: "all"
    },
    { type: "header", label: "Advanced" },
    {
      type: "toggle", key: "forceHd", label: "Force HD Quality",
      description: "Attempts to force the player into HD mode when possible.", defaultValue: true
    }
  ];
}

const testApi = {
  normalizeTitle, titleKey, seasonMarker, scoreTitleOwnership, buildSearchQueries, exactEpisode,
  classification, audioEvidence, attachAudioMetadata, diagnostics,
  reset() {
    resolvedApiUrl = "";
    lastDiagnostics = [];
    mobileCookieJar = [];
    mobileVerifiedCookie = "";
    mobileVerifiedAt = 0;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings, __test: testApi };
else {
  globalThis.getStreams = getStreams;
  globalThis.onSettings = onSettings;
}
