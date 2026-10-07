"use strict";

// Standalone Limitless Nexus NetMirror provider.
// Transport reference: Sushan64/NetMirror-Extension master
// 40a3319ce03d9a6fb3a59aacf420341a24c4e630 (NetflixMirrorProvider.kt / Utils.kt).
// See docs/netmirror/INVESTIGATION.md for independent transport evidence.

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

// Deadlines cover the response body as well as connection establishment. Do not
// depend on AbortController support: older Nuvio bridges can ignore its signal.
function checkBudget(context) {
  if (context && (context.cancelled || Date.now() >= context.deadline)) throw new Error("NetMirror stage deadline");
}

async function bounded(ms, operation, cancel) {
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") throw new Error("Runtime timers unavailable");
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => { if (cancel) cancel(); reject(new Error("NetMirror timeout")); }, ms); })
    ]);
  } finally { clearTimeout(timer); }
}

async function request(url, options, context) {
  checkBudget(context);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = Math.max(1, Math.min(6000, context && context.deadline ? context.deadline - Date.now() : 6000));
  if (context && context.controllers && controller) context.controllers.add(controller);
  try {
    return await bounded(timeout, async () => {
      const response = await fetch(url, { ...(options || {}), timeout, ...(controller ? { signal: controller.signal } : {}) });
      if (!response || response.ok === false) throw new Error(`HTTP ${response && response.status || "error"}`);
      // Some host bridges expose only json(); keep that supported and bounded.
      const body = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
      checkBudget(context);
      return { ok: true, status: response.status, headers: response.headers, url: response.url || url,
        text: async () => body, json: async () => JSON.parse(body) };
    }, () => { if (controller) controller.abort(); });
  } finally { if (context && context.controllers) context.controllers.delete(controller); }
}

async function fetchJson(url, options, context) { return (await request(url, options, context)).json(); }

async function runStage(context, label, ms, operation) {
  const budget = { ...context, deadline: Math.min(context.deadline || Infinity, Date.now() + ms), controllers: new Set() };
  const stop = () => { budget.cancelled = true; budget.controllers.forEach(c => c.abort()); };
  try { checkBudget(budget); return await bounded(Math.max(1, budget.deadline - Date.now()), () => operation(budget), stop); }
  catch (error) { trace("stage-failed", { path: label, reason: clean(error.message) }); return []; }
  finally { stop(); }
}

async function resolveApiUrl(context) {
  if (resolvedApiUrl) return resolvedApiUrl;
  for (const encoded of NEW_TV_DOMAINS) {
    checkBudget(context);
    const discoveryBase = safeAtob(encoded).replace(/\/$/, "");
    try {
      const data = await fetchJson(`${discoveryBase}/checknewtv.php`, {
        headers: NEW_TV_BASE_HEADERS
      }, context);
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

async function fetchEpisodesPage(seasonId, page, forcedSeason, platform, apiBase, context) {
  const episodes = [];
  let current = page;
  for (let guard = 0; guard < 100; guard++, current++) {
    const url = `${apiBase}/newtv/episodes.php?id=${encodeURIComponent(seasonId)}&page=${current}`;
    const data = await fetchJson(url, { headers: buildNewTvHeaders(platform.ott) }, context);
    addEpisodes(episodes, data && data.episodes, forcedSeason);
    if (!data || data.nextPageShow !== 1) break;
  }
  return episodes;
}

async function getAllEpisodes(postData, platform, apiBase, context, wantedSeason) {
  const episodes = [];
  const seasons = seasonEntries(postData);
  const selected = seasons.find(item => item.selected);
  const selectedSeasonId = selected && selected.id || postData && postData.nextPageSeason;
  const selectedSeasonNumber = selected ? selected.number : null;

  addEpisodes(episodes, postData && postData.episodes, selectedSeasonNumber);
  if (postData && postData.nextPageShow === 1 && selectedSeasonId && (wantedSeason == null || selectedSeasonNumber === wantedSeason)) {
    episodes.push(...await fetchEpisodesPage(selectedSeasonId, 2, selectedSeasonNumber, platform, apiBase, context));
  }
  for (const season of seasons) {
    if (!season.id || String(season.id) === String(selectedSeasonId) || wantedSeason != null && season.number !== wantedSeason) continue;
    episodes.push(...await fetchEpisodesPage(season.id, 1, season.number, platform, apiBase, context));
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
    runtimeSeconds: Math.max(0, Number(mediaType === "movie" ? data.runtime :
      (seasonData && Array.isArray(seasonData.episodes) && seasonData.episodes.find(item => Number(item.episode_number) === episode) || {}).runtime) || 0) * 60,
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
    if (!domain || host !== domain && !host.endsWith("." + domain) || !domain.includes(".")) continue;
    const pathMatch = clean(raw).match(/(?:^|;)\s*path=([^;]+)/i);
    const cookiePath = pathMatch ? pathMatch[1] : "/";
    const age = clean(raw).match(/(?:^|;)\s*max-age=(-?\d+)/i);
    const expiry = clean(raw).match(/(?:^|;)\s*expires=([^;]+)/i);
    const expiresAt = age ? Date.now() + Number(age[1]) * 1000 : expiry ? Date.parse(expiry[1]) : Infinity;
    const index = mobileCookieJar.findIndex(item => item.name === name && item.domain === domain && item.path === cookiePath);
    if (!value || /max-age\s*=\s*0/i.test(raw)) {
      if (index >= 0) mobileCookieJar.splice(index, 1);
      continue;
    }
    const item = { name, value, domain, path: cookiePath, hostOnly: !domainMatch, expiresAt, secure: /;\s*secure(?:;|$)/i.test(raw) };
    if (index >= 0) mobileCookieJar[index] = item;
    else mobileCookieJar.push(item);
  }
}

function mobileCookieHeader(url) {
  let host = "";
  let parsed;
  try { parsed = new URL(url); host = parsed.hostname.toLowerCase(); } catch (_) { return ""; }
  return mobileCookieJar
    .filter(item => (host === item.domain || !item.hostOnly && host.endsWith("." + item.domain)) &&
      (parsed.pathname === item.path || parsed.pathname.startsWith(item.path.endsWith("/") ? item.path : item.path + "/")) &&
      (!item.secure || parsed.protocol === "https:") && !(item.expiresAt <= Date.now()))
    .map(item => item.name + "=" + item.value)
    .join("; ");
}

async function mobileRequest(url, options, context) {
  const opts = options || {};
  const headers = { ...(opts.headers || {}) };
  const jar = mobileCookieHeader(url);
  if (jar) headers.Cookie = headers.Cookie ? headers.Cookie + "; " + jar : jar;
  const response = await request(url, { ...opts, headers }, context);
  mobileSetCookies(response && response.headers, response && response.url || url);
  return response;
}

function mobileCookie(name) {
  const row = mobileCookieJar.find(item => item.name === name);
  return row ? row.value : "";
}

async function mobileDelay(ms, context) {
  checkBudget(context);
  if (typeof setTimeout !== "function") throw new Error("Runtime timers unavailable");
  await new Promise(resolve => setTimeout(resolve, Math.min(ms, context && context.deadline ? Math.max(0, context.deadline - Date.now()) : ms)));
  checkBudget(context);
}

async function mobileBypass(context) {
  if (mobileVerifiedCookie && Date.now() - mobileVerifiedAt < 15 * 60 * 60 * 1000) return mobileVerifiedCookie;
  mobileCookieJar = [];
  mobileVerifiedCookie = "";
  try {
    const appHeaders = { "User-Agent": MOBILE_APP_UA, "X-Requested-With": "app.netmirror.netmirrornew" };
    const home = await mobileRequest(MOBILE_BASE + "/mobile/home?app=1", { headers: appHeaders }, context);
    const html = String(await home.text() || "");
    const match = html.match(/data-addhash\s*=\s*["']([^"']+)["']/i);
    if (!home.ok || !match) return "";

    const hash = match[1];
    const userver = await mobileRequest(
      "https://userver.net52.cc/?hee5=" + encodeURIComponent(hash) + "&a=y&t=" + Date.now(),
      { headers: appHeaders }, context
    );
    await userver.text();

    for (let attempt = 1; attempt <= 4; attempt++) {
      await mobileDelay(10000, context);
      const verify = await mobileRequest(MOBILE_BASE + "/mobile/verify2.php", {
        method: "POST",
        headers: {
          "User-Agent": MOBILE_APP_UA,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "verify=" + encodeURIComponent(hash)
      }, context);
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

async function mobileJson(url, headers, context) {
  const response = await mobileRequest(url, { headers }, context);
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

function mobileTrack(track, headers) {
  if (!track || !/(caption|sub)/i.test(clean(track.kind || track.type))) return null;
  return playback.normalizeSubtitle(track, { Referer: headers.Referer, "User-Agent": headers["User-Agent"] });
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

// Playback selection passed the pre-production repeated-fetch gate.
// Kept standalone: no downloaded helper code or module dependency at runtime.
const playback = (() => {
const baseline = { mediaIdentity };
const unique = values => [...new Set(values)].sort();
const text = value => String(value == null ? '' : value).trim();
const aliases = {eng:'en',kor:'ko',jpn:'ja',ara:'ar',ces:'cs',deu:'de',spa:'es',fra:'fr',por:'pt',zho:'zh',dan:'da',ell:'el',fin:'fi',heb:'he',hin:'hi',hrv:'hr',hun:'hu',ind:'id',ita:'it',msa:'ms',nob:'nb',nld:'nl',pol:'pl',ron:'ro',rus:'ru',swe:'sv',tam:'ta',tel:'te',tha:'th',tur:'tr',ukr:'uk',vie:'vi'};
const names = {Arabic:'ar',Czech:'cs',Danish:'da',German:'de',Greek:'el',English:'en',Spanish:'es','European Spanish':'es-ES','Latin American Spanish':'es-419',Finnish:'fi',French:'fr',Hebrew:'he',Hindi:'hi',Croatian:'hr',Hungarian:'hu',Indonesian:'id',Italian:'it',Japanese:'ja',Korean:'ko',Malay:'ms',Norwegian:'nb',Dutch:'nl',Polish:'pl','Brazilian Portuguese':'pt-BR',Portuguese:'pt',Romanian:'ro',Russian:'ru',Swedish:'sv',Thai:'th',Turkish:'tr',Ukrainian:'uk',Vietnamese:'vi','Chinese (Simplified)':'zh-Hans','Chinese (Traditional)':'zh-Hant','Filipino (Tagalog)':'fil',Catalan:'ca',Basque:'eu',Galician:'gl',Tamil:'ta',Telugu:'te'};
const known = new Set(Object.values(names).map(x=>x.split('-')[0]).concat(Object.values(aliases),'und'));

function language(value) {
  let raw=text(value).replace(/^\d+[-_]/,'').replace(/\.\[CC\]|\[CC\]|\(\d+\)/gi,'').replace(/_/g,'-').trim();
  const named=Object.entries(names).find(([name])=>name.toLowerCase()===raw.toLowerCase());
  if(named)return named[1];
  const parts=raw.split('-');const primary=aliases[parts[0].toLowerCase()]||parts[0].toLowerCase();
  if(!known.has(primary))return 'und';
  return [primary,...parts.slice(1).map(p=>p.length===2?p.toUpperCase():p.length===4?p[0].toUpperCase()+p.slice(1).toLowerCase():p)].join('-');
}

function normalizeSubtitle(track, headers={}) {
  const url=text(track.url||track.file||track.uri);if(!url)return null;
  let absolute;
  try {const parsed=new URL(url,'https://subscdn.top/');if(!/^https?:$/.test(parsed.protocol))return null;absolute=parsed.href;}catch{return null;}
  let file=new URL(absolute).pathname.split('/').pop();
  try {file=decodeURIComponent(file);}catch{}
  file=file.replace(/\.(?:srt|vtt|m3u8)$/i,'');
  const name=text(track.name||track.label);
  const code=[track.language,track.lang,file,name].map(language).find(x=>x!=='und')||'und';
  const baseName=Object.entries(names).find(([,value])=>value===code)?.[0]||code;
  let label=name||baseName;
  if(/\[CC\]/i.test(file)&&!/\[CC\]/i.test(label))label+=' [CC]';
  const edition=file.match(/\(\d+\)/);if(edition&&!label.includes(edition[0]))label+=' '+edition[0];
  return {url:absolute,language:code,name:label,headers:{...headers,...(track.headers||{})}};
}

function subtitleKey(track) {
  // Only the known NetMirror /files/<episode>/<episode>-lang.srt and
  // /subs/<episode>/lang.m3u8 routes are declared equivalent. No language-only merge.
  const url=new URL(track.url);const match=url.pathname.match(/^\/(?:files\/(\d+)\/\d+-|subs\/(\d+)\/)(.+)\.(?:srt|vtt|m3u8)$/i);
  const media=/(?:^|\.)subscdn\.top$/.test(url.hostname)&&match ? `${match[1]||match[2]}:${match[3].toLowerCase()}` : baseline.mediaIdentity(track.url);
  return `${language(track.language)}|${media}`;
}

function normalizeSubtitles(external=[], embedded=[], headers={}) {
  const result=new Map();
  // Separate caption files win for a proven identical track. Embedded-only
  // metadata remains in the intact HLS master and is also retained here.
  for(const [source,tracks]of [['external',external],['embedded',embedded]])for(const track of tracks){
    const normalized=normalizeSubtitle(track,headers);if(!normalized)continue;
    const key=subtitleKey(normalized);if(!result.has(key))result.set(key,{...normalized,source});
  }
  return [...result.values()];
}

function attributes(line) {
  return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m=>[m[1],m[2]??m[3]]));
}

function audioKey(track) {
  return JSON.stringify([language(track.language),track.name,track.characteristics||'',track.channels||'',track.default,track.autoselect,baseline.mediaIdentity(track.url||'')]);
}

function parsePlaylist(body,base) {
  if(!text(body).startsWith('#EXTM3U'))throw Error('not-hls');
  const lines=body.split(/\r?\n/).map(text),media=[],variants=[],segments=[];
  let duration=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(line.startsWith('#EXT-X-MEDIA:')){
      const a=attributes(line);
      media.push({type:a.TYPE,groupId:a['GROUP-ID'],language:language(a.LANGUAGE),name:a.NAME||'',url:a.URI?new URL(a.URI,base).href:'',
        characteristics:a.CHARACTERISTICS||'',channels:a.CHANNELS||'',default:a.DEFAULT==='YES',autoselect:a.AUTOSELECT==null?null:a.AUTOSELECT==='YES',forced:a.FORCED==='YES'});
    }
    if(line.startsWith('#EXT-X-STREAM-INF:')){
      const a=attributes(line);let next=i+1;while(next<lines.length&&!lines[next])next++;
      if(!lines[next]||lines[next].startsWith('#'))throw Error('missing-video-uri');
      const [width,height]=(a.RESOLUTION||'').split('x').map(Number);
      variants.push({url:new URL(lines[next],base).href,width:width||0,height:height||0,audio:a.AUDIO||'',subtitles:a.SUBTITLES||'',codecs:a.CODECS||''});
    }
    if(line.startsWith('#EXTINF:')){
      const seconds=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(seconds)||seconds<=0)throw Error('invalid-duration');
      duration+=seconds;let next=i+1;while(next<lines.length&&(!lines[next]||lines[next].startsWith('#')))next++;
      if(!lines[next])throw Error('missing-segment');segments.push(new URL(lines[next],base).href);
    }
  }
  const reachable=(type,field)=>media.filter(m=>m.type===type&&variants.some(v=>v[field]===m.groupId));
  const audio=new Map();for(const track of reachable('AUDIO','audio'))if(!audio.has(audioKey(track)))audio.set(audioKey(track),track);
  return {variants,audioTracks:[...audio.values()],subtitleTracks:reachable('SUBTITLES','subtitles'),duration,segments,endList:lines.includes('#EXT-X-ENDLIST')};
}

function identity(playlist) {
  return JSON.stringify({video:unique(playlist.variants.map(v=>JSON.stringify([baseline.mediaIdentity(v.url),v.width,v.height,v.codecs,v.audio,v.subtitles]))),
    audio:unique(playlist.audioTracks.map(audioKey)),
    subtitles:unique(playlist.subtitleTracks.map(t=>JSON.stringify([t.groupId,language(t.language),t.name,t.forced,t.default,t.autoselect,baseline.mediaIdentity(t.url)])))});
}

function durationPlausible(video, audios=[], runtimeSeconds) {
  if(!(video>0))return false;
  // Metadata is approximate: tolerate recaps, credits, alternate cuts and rounding.
  // Relative bounds preserve real short-form titles; there is no fixed minute floor.
  if(runtimeSeconds>0&&(video<runtimeSeconds*0.45&&runtimeSeconds-video>60||video>runtimeSeconds*1.9+120))return false;
  return audios.filter(x=>x>0).every(audio=>Math.abs(video-audio)<=Math.max(12,Math.max(video,audio)*0.15));
}

function signedQualitySource(url) {
  const params=new URL(url).searchParams;
  return /^(?:2160|1440|1080|720|480|360)p$/.test(params.get('q')||'')&&!!(params.get('in')||params.get('sign')||params.get('token'));
}

async function verifyCandidate(row, context, io) {
  const rounds=[],headers={...(row.headers||{})};const started=Date.now();
  const delays=io.delays||[0,1500,4000];
  if(delays.length<3)throw Error('at-least-three-rounds-required');
  try{
    let expected;
    for(const delay of delays){
      if(delay)await io.pause(delay);
      const response=await io.read(row.url,headers);
      const master=parsePlaylist(response.body,response.url||row.url);
      if(!master.variants.length)throw Error('no-video-rendition');
      const members=[...master.variants,...master.audioTracks,...master.subtitleTracks];
      if(context.episodeId&&members.some(m=>{const id=m.url.match(/\/(?:files|subs)\/(\d+)\//)?.[1];return id&&id!==String(context.episodeId);}))throw Error('episode-identity-mismatch');
      const fingerprint=identity(master);
      if(expected&&expected!==fingerprint)throw Error('master-mutated');expected=fingerprint;
      const selectedAudio=master.audioTracks.filter(t=>t.default||['en',language(context.originalLanguage).split('-')[0]].includes(language(t.language).split('-')[0]));
      const children=new Map();
      const get=async url=>{if(!children.has(url))children.set(url,io.read(url,headers).then(r=>parsePlaylist(r.body,r.url||url)));return children.get(url);};
      const audioMedia=await Promise.all(selectedAudio.filter(t=>t.url).map(async t=>{
        const child=await get(t.url);
        if(child.variants.length||!child.endList||!child.segments.length||!(child.duration>0))throw Error('invalid-audio-media');
        return {duration:child.duration,segments:child.segments.map(baseline.mediaIdentity)};
      }));
      const audioDurations=audioMedia.map(m=>m.duration);
      const audioIdentity=JSON.stringify(audioMedia.map(m=>m.segments));
      if(rounds.length&&rounds[0].audioIdentity!==audioIdentity)throw Error('audio-child-mutated');
      const video=[];
      for(const variant of master.variants){
        const codecs=variant.codecs.toLowerCase();
        const videoCodec=/avc[13]|hev1|hvc1|vp0?9|av01|mp4v/.test(codecs);
        if(codecs&&!videoCodec||!videoCodec&&!(variant.width>0&&variant.height>0))throw Error('audio-only-rendition');
        if(master.audioTracks.some(t=>baseline.mediaIdentity(t.url)===baseline.mediaIdentity(variant.url))||/\/a\/\d+\//.test(variant.url))throw Error('audio-only-rendition');
        const child=await get(variant.url);
        if(child.variants.length||!child.endList||!child.segments.length)throw Error('not-complete-video-media');
        if(!durationPlausible(child.duration,audioDurations,context.runtimeSeconds))throw Error('implausible-video-duration');
        video.push({url:variant.url,height:variant.height,duration:child.duration,segmentCount:child.segments.length,
          segmentIdentity:child.segments.map(baseline.mediaIdentity)});
      }
      // A child can switch media while the parent URL remains unchanged.
      const videoIdentity=JSON.stringify(video.map(v=>[baseline.mediaIdentity(v.url),v.segmentIdentity]));
      if(rounds.length&&(rounds[0].videoIdentity!==videoIdentity||video.some((v,i)=>Math.abs(v.duration-rounds[0].video[i].duration)>Math.max(2,v.duration*0.01))))throw Error('video-child-mutated');
      const subtitles=normalizeSubtitles(row.subtitles||[],master.subtitleTracks,headers);
      rounds.push({master,video,videoIdentity,audioIdentity,audioDurations,subtitles,fingerprint});
    }
    const last=rounds[rounds.length - 1];
    return {...row,headers,quality:Math.max(...last.video.map(v=>v.height))+'p',hls:last.master,audioTracks:last.master.audioTracks,
      embeddedSubtitles:last.master.subtitleTracks,subtitles:last.subtitles,
      validation:{stable:true,rounds:rounds.length,elapsedMs:Date.now()-started,signedQuality:signedQualitySource(row.url),video:last.video,audioDurations:last.audioDurations,fingerprint:last.fingerprint}};
  }catch(error){if(io.rejected)io.rejected({url:row.url,reason:error.message,completedRounds:rounds.length});return null;}
}

function selectCandidates(rows, context) {
  const valid=rows.filter(r=>r&&r.validation?.stable&&r.validation.rounds>=3&&r.validation.video?.length);
  const score=row=>[row.validation.signedQuality?1:0,row.validation.rounds,(row.audioTracks||[]).length,(row.subtitles||[]).length,Number.parseInt(row.quality)||0];
  valid.sort((a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;});
  const seen=new Set();
  return valid.filter(row=>{
    const key=JSON.stringify([context.tmdbId,context.season,context.episode,row.quality,
      unique(row.hls.variants.map(v=>baseline.mediaIdentity(v.url))),unique(row.audioTracks.map(audioKey)),unique(normalizeSubtitles(row.subtitles,row.embeddedSubtitles).map(subtitleKey))]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
}

return {language,normalizeSubtitle,normalizeSubtitles,subtitleKey,parsePlaylist,audioKey,identity,durationPlausible,signedQualitySource,verifyCandidate,selectCandidates};
})();

function hlsAttributes(line) {
  const result = {};
  const pattern = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = pattern.exec(line))) result[match[1]] = match[2] == null ? match[3] : match[2];
  return result;
}

function languageCode(value) { return playback.language(value); }

function parseHls(text, base) { return playback.parsePlaylist(text, base); }

function nativeHost(url) {
  try { return /^(?:[a-z0-9-]+\.)*(?:net52|net77|net22|net27)\.cc$/.test(new URL(url).hostname.toLowerCase()); } catch (_) { return false; }
}

function playbackHeaders(url, base) {
  const headers = { ...(base || {}) };
  for (const key of Object.keys(headers)) {
    if (/^(?:cookie|origin|x-requested-with|content-type)$/i.test(key)) delete headers[key];
  }
  if (nativeHost(url)) {
    headers.Origin = "https://net77.cc";
    const cookie = mobileCookieHeader(url);
    if (cookie) headers.Cookie = cookie;
  }
  return headers;
}

function mediaIdentity(value) {
  try {
    const url = new URL(value);
    // These CDN wrappers expose the same /files/<episode>/<rendition> asset.
    const nativeCdn = /(?:^|\.)(?:freecdn\d*|nm-cdn\d+)\.top$/.test(url.hostname);
    const file = nativeCdn && url.pathname.match(/\/files\/\d+\/.+/);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:sign|signature|token|expires|expiry|policy|key-pair-id)$/i.test(key) ||
          key === "in" && (nativeCdn || nativeHost(value)) ||
          key === "t" && /(?:^|\.)hakunaymatata\.com$/.test(url.hostname)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return (file ? "netmirror:" + file[0] : url.origin + url.pathname) + (url.search ? url.search : "");
  } catch (_) { return clean(value); }
}

function trackLanguages(tracks) { return unique((tracks || []).map(t => languageCode(t.language || t.lang))).sort(); }

function completeAudioMaster(row, context) {
  const languages = trackLanguages(row.audioTracks).map(code => code.split("-")[0]);
  const original = languageCode(context.originalLanguage).split("-")[0];
  return hasMultipleAudio(row) && languages.includes("en") && (original === "und" || languages.includes(original));
}

function semanticDedupe(rows, context) {
  const hls = playback.selectCandidates(rows.filter(row => row && row.hls), context);
  const plain = rows.filter(row => row && !row.hls);
  const seen = new Set();
  const selected = hls.concat(plain).filter(row => {
    if (row.hls) return true; // The richer audio/variant/subtitle key already ran above.
    const key = JSON.stringify([context.mediaType, context.tmdbId, context.season, context.episode,
      qualityNumber(row), mediaIdentity(row.url), trackLanguages(row.audioTracks && row.audioTracks.length ? row.audioTracks : [{language: row.audioLanguage}]),
      trackLanguages(row.subtitles)]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (selected.length < rows.length) trace("dedup", { reason: "stable-signed-source-preferred", before: rows.length, after: selected.length });
  return selected;
}

async function inspectHls(row, context, episodeId) {
  const headers = playbackHeaders(row.url, row.headers);
  delete headers.Cookie;
  delete headers.Origin;
  const inspected = await playback.verifyCandidate({ ...row, headers }, { ...context, episodeId }, {
    pause: ms => mobileDelay(ms, context),
    read: async (url, exportedHeaders) => {
      // Child requests use exactly the exported map too: no hidden jar/Origin.
      const response = await request(url, { headers: exportedHeaders }, context);
      return { url: response.url, body: await response.text() };
    },
    rejected: details => trace("hls-rejected", { episodeId, reason: details.reason, completedRounds: details.completedRounds })
  });
  if (!inspected) return null;
  trace("hls-accepted", { episodeId, height: qualityNumber(inspected),
    audioLanguages: trackLanguages(inspected.audioTracks), audioCount: inspected.audioTracks.length,
    subtitleLanguages: trackLanguages(inspected.subtitles), preservedMasterUrl: true,
    stabilityRounds: inspected.validation.rounds, signedQuality: inspected.validation.signedQuality,
    videoDurations: inspected.validation.video.map(v => v.duration) });
  return { ...inspected, type: "m3u8",
    // Embedded HLS subtitle manifests stay in the master. Avoid feeding .m3u8
    // URLs to Nuvio's external SRT/VTT subtitle loader.
    subtitles: inspected.subtitles.filter(track => track.source === "external") };
}

function playlistEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.playlist)) return payload.playlist;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return payload && Array.isArray(payload.sources) ? [payload] : [];
}

function playlistEpisodeMatches(entry, episodeId) {
  if (!entry) return false;
  if (entry.id != null && String(entry.id) !== String(episodeId)) return false;
  const poster = clean(entry.image2).match(/\/(\d+)\.(?:jpg|png|webp)(?:\?|$)/i);
  if (poster && poster[1] !== String(episodeId)) return false;
  return !(entry.sources || []).some(source => {
    const match = clean(source.file).match(/\/hls\/(\d+)\.m3u8/);
    return match && match[1] !== String(episodeId);
  });
}

async function fetchFromNetflixNative(context) {
  const match = context.shared && context.shared.netflixMatch;
  if (!match) return [];
  const headers = { "User-Agent": MOBILE_WEB_UA, Referer: "https://net77.cc/home", Origin: "https://net77.cc", "X-Requested-With": "XMLHttpRequest" };
  // The reference treats warm-up failures as recoverable: play.php can still
  // issue a token. Keep this path available when the home page is challenged.
  try { await mobileRequest("https://net77.cc/home", { headers }, context); } catch (_) { checkBudget(context); }
  try { await mobileRequest(`${MOBILE_BASE}/mobile/post.php?id=${encodeURIComponent(match.targetId)}&t=${Math.floor(Date.now() / 1000)}`, { headers }, context); } catch (_) { checkBudget(context); }
  const play = await mobileRequest("https://net77.cc/play.php", {
    method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: "id=" + encodeURIComponent(match.targetId)
  }, context);
  const token = await play.json();
  if (!token || !token.h) return [];
  const playlist = await mobileRequest(`${MOBILE_BASE}/playlist.php?id=${encodeURIComponent(match.targetId)}&t=${encodeURIComponent(context.title)}&tm=${Math.floor(Date.now() / 1000)}&h=${encodeURIComponent(token.h)}`, { headers }, context);
  const entries = playlistEntries(await playlist.json()).filter(entry => playlistEpisodeMatches(entry, match.targetId));
  const pending = [];
  for (const entry of entries) {
    const subtitles = (entry.tracks || []).map(t => mobileTrack(t, headers)).filter(Boolean);
    for (const source of entry.sources || []) {
      const url = mobileSourceUrl(source.file);
      if (!url) continue;
      pending.push(inspectHls({ url, headers, subtitles, title: context.title, name: "NetMirror (Netflix Native)",
        quality: mobileQuality(source.label, url), provider: "netmirror" }, context, match.targetId));
    }
  }
  return semanticDedupe((await Promise.all(pending)).filter(Boolean), context);
}

async function mobileMasterRows(sourceUrl, headers, subtitles, context, sourceMeta, episodeId) {
  const row = await inspectHls({ name: "NetMirror (Netflix Mobile)", title: context.title,
    url: sourceUrl, headers, subtitles, quality: mobileQuality(sourceMeta && sourceMeta.label, sourceUrl),
    provider: "netmirror", audioLanguage: mobileAudioLanguage(sourceUrl) }, context, episodeId);
  return row ? [row] : [];
}

async function fetchFromNetflixMobile(context, forceHd) {
  const cookie = await mobileBypass(context);
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
  let matched = context.shared && context.shared.netflixMatch ? { ...context.shared.netflixMatch, resultTitle: context.shared.netflixMatch.title } : null;

  for (const query of (matched ? [] : aliases)) {
    checkBudget(context);
    let search;
    try {
      search = await mobileJson(MOBILE_BASE + "/mobile/search.php?s=" + encodeURIComponent(query) + "&t=" + Math.floor(Date.now() / 1000), baseHeaders, context);
    } catch (_) {
      continue;
    }
    const results = Array.isArray(search && search.searchResult) ? search.searchResult : [];
    for (const result of results.slice(0, 12)) {
      if (!result || result.id == null) continue;
      let post;
      try {
        post = await mobileJson(MOBILE_BASE + "/mobile/post.php?id=" + encodeURIComponent(result.id) + "&t=" + Math.floor(Date.now() / 1000), baseHeaders, context);
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
      baseHeaders, context
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
      baseHeaders, context
    );
  } catch (error) {
    trace("rejection", { path: "mobile-netflix", reason: "mobile-playlist-failed", message: clean(error && error.message) });
    return [];
  }

  const entries = playlistEntries(payload).filter(entry => playlistEpisodeMatches(entry, matched.targetId));
  const subtitles = [];
  const seenSubtitles = new Set();
  const sourceRows = [];

  for (const entry of entries) {
    for (const track of (entry && entry.tracks) || []) {
      const mapped = mobileTrack(track, baseHeaders, context);
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

  const inspected = await Promise.all(sourceRows.map(item => mobileMasterRows(item.url, baseHeaders, subtitles, context, item.source, matched.targetId)));
  const rows = semanticDedupe(inspected.flat(), context);
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
    ? `${NET27_BASE}/api/embed-tmdb/${context.tmdbId}?type=tv&s=${context.season}&e=${context.episode}`
    : `${NET27_BASE}/api/embed-tmdb/${context.tmdbId}`;
  let data;
  try {
    data = await fetchJson(apiUrl, { headers: { Accept: "application/json, text/plain, */*", Referer: NET27_PLAYBACK_REFERER, "User-Agent": NET27_UA } }, context);
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
    return playback.normalizeSubtitle({ url, language: clean(caption && caption.lang), name: clean(caption && caption.name) }, playbackHeaders);
  }).filter(Boolean);
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
  const inspected = await Promise.all(rows.map(async row => /\.m3u8(?:[?#]|$)/i.test(row.url)
    ? inspectHls(row, context, null) : { ...row, type: "video" }));
  return semanticDedupe(inspected.filter(Boolean), context);
}

async function searchPlatform(platformKey, context, apiBase) {
  const platform = PLATFORM_MAP[platformKey];
  const found = new Map();
  for (let queryIndex = 0; queryIndex < context.queries.length; queryIndex++) {
    checkBudget(context);
    const query = context.queries[queryIndex];
    try {
      const url = `${apiBase}/newtv/search.php?s=${encodeURIComponent(query)}`;
      const data = await fetchJson(url, { headers: buildNewTvHeaders(platform.ott) }, context);
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
    }, context);
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
    try { enumerated = await getAllEpisodes(postData, platform, apiBase, context, ownership.providerSeason); }
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
  try { apiBase = await resolveApiUrl(context); }
  catch (error) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, reason: "api-discovery-failed", message: clean(error && error.message) });
    return [];
  }

  const searchCandidates = await searchPlatform(platformKey, context, apiBase);
  const inspected = [];
  for (const candidate of searchCandidates) {
    checkBudget(context);
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
  if (platformKey === "netflix") { context.shared = context.shared || {}; context.shared.netflixMatch = match; }
  let response;
  try {
    response = await fetchJson(`${apiBase}/newtv/player.php?id=${encodeURIComponent(match.targetId)}`, {
      headers: buildNewTvHeaders(platform.ott, { Usertoken: "" })
    }, context);
  } catch (error) {
    trace("rejection", { path: "newtv-generic", platform: platformKey, candidateTitle: match.title, candidateId: match.contentId, playerId: match.targetId, reason: "player-request-failed", message: clean(error && error.message) });
    return [];
  }
  if (!response || !/^https?:\/\//i.test(clean(response.video_link))) {
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
  const source = {
    name: `NetMirror (${platform.label})`, title: context.title,
    url: response.video_link, quality: "Auto",
    headers: { Referer: response.referer || apiBase, "User-Agent": NEW_TV_BASE_HEADERS["User-Agent"] }, provider: "netmirror"
  };
  if (/\.mp4(?:[?#]|$)/i.test(source.url)) return [attachAudioMetadata(source, response)];
  const row = await inspectHls(source, context, platformKey === "netflix" ? match.targetId : null);
  if (row && platformKey === "netflix") {
    // The request and any declared poster/source IDs must agree with the exact
    // Netflix episode selected above. Never combine subtitles by title alone.
    try {
      const payload = await mobileJson(`${MOBILE_BASE}/mobile/playlist.php?id=${encodeURIComponent(match.targetId)}&t=${encodeURIComponent(context.title)}&tm=${Math.floor(Date.now() / 1000)}`,
        { "User-Agent": MOBILE_WEB_UA, Referer: MOBILE_BASE + "/mobile/home?app=1" }, context);
      row.subtitles = playlistEntries(payload).filter(entry => playlistEpisodeMatches(entry, match.targetId))
        .flatMap(entry => (entry.tracks || []).map(t => mobileTrack(t, { Referer: MOBILE_BASE + "/mobile/home?app=1", "User-Agent": MOBILE_WEB_UA })).filter(Boolean));
    } catch (_) {}
  }
  return row ? [row] : [];
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
  const evidence = audioEvidence(row);
  if (hasMultipleAudio(row)) return "[DUAL]";
  const embedded = row && row.embeddedSubtitles && row.embeddedSubtitles.length > 0;
  const selectable = embedded || hasSelectableSubs(row);
  const languages = trackLanguages(row && row.audioTracks && row.audioTracks.length ? row.audioTracks : [{ language: row && row.audioLanguage }]);
  const english = languages.includes("en") || evidence.english;
  const nonEnglish = languages.some(l => l !== "en" && l !== "und");
  if (english) return selectable ? "[DUB+SUB]" : "[DUB]";
  if (nonEnglish && selectable) return "[SUB]";
  if (row && (row.hardSub === true || row.hardsub === true || row.isHardSub === true)) return "[HSUB]";
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
  const metadata = semanticDedupe(rows, context).map(row => {
    const quality = qualityLabel(qualityNumber(row));
    const tag = classification(row, context);
    const evidence = audioEvidence(row);
    trace("classification", {
      quality, tag, originalLanguage: clean(context && context.originalLanguage),
      audioLanguage: clean(row && (row.audioLanguage || row.language || row.lang)),
      audioType: clean(row && row.audioType),
      selectableSubtitles: hasSelectableSubs(row),
      multipleAudio: hasMultipleAudio(row),
      inferredEnglishFromTmdb: false
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

  context.deadline = Date.now() + 105000;
  context.shared = {};
  const settings = globalThis.SCRAPER_SETTINGS || {};
  const preferred = clean(settings.preferredPlatform) || "all";
  let platforms = ["netflix", "primevideo", "hotstar"];
  if (preferred === "disney") platforms = ["disney", "netflix", "primevideo"];
  else if (preferred !== "all" && PLATFORM_MAP[preferred]) platforms = [preferred, ...platforms.filter(item => item !== preferred)];
  for (const platformKey of platforms) {
    if (Date.now() >= context.deadline) break;
    trace("platform", { platform: platformKey, preferred, forceHd: settings.forceHd !== false });
    const primary = await runStage(context, "newtv-" + platformKey, 18000, c => fetchFromPlatform(platformKey, c));
    if (platformKey !== "netflix") { if (primary.length) return normalizeRows(primary, context); continue; }
    // A complete selectable-audio master is the preferred stream family. Do not
    // concatenate separate Net27 rows for languages already selectable here.
    if (primary.some(row => completeAudioMaster(row, context) && (row.embeddedSubtitles.length || hasSelectableSubs(row)))) return normalizeRows(primary, context);
    const native = await runStage(context, "native", 20000, c => fetchFromNetflixNative(c));
    if (native.some(row => completeAudioMaster(row, context))) return normalizeRows(native, context);
    const mobile = await runStage(context, "mobile", 65000, c => fetchFromNetflixMobile(c, settings.forceHd !== false));
    const hlsRows = primary.concat(native, mobile);
    const complete = hlsRows.filter(row => completeAudioMaster(row, context));
    if (complete.length) return normalizeRows(complete, context);
    const direct = await runStage(context, "net27", 8000, c => fetchFromNetflixDirect(c));
    if (hlsRows.length || direct.length) return normalizeRows(hlsRows.concat(direct), context);
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
  parseHls, semanticDedupe, mediaIdentity, inspectHls, playbackHeaders, request, runStage, playback,
  playlistEntries, playlistEpisodeMatches, mobileSetCookies, mobileCookieHeader,
  fetchFromNetflixMobile, fetchFromNetflixNative, fetchFromNetflixDirect,
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
