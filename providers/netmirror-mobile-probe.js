"use strict";

// Lab-only NetMirror mobile API probe.
// Purpose: inspect current /mobile/* playlist payloads for hidden audio,
// language, server, mirror, source, and track metadata without touching Nexus.

const PROVIDER_NAME = "NetMirror Mobile Probe";
const BASE = "https://net52.cc";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const TMDB_API = "https://api.themoviedb.org/3";
const APP_UA = "Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0";
const WEB_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.91 Safari/537.36 /OS.Gatu v3.0";
const PLATFORM = { ott: "nf", search: "/mobile/search.php", post: "/mobile/post.php", episodes: "/mobile/episodes.php", playlist: "/mobile/playlist.php" };

let cookieJar = [];
let verifiedCookie = "";
let verifiedAt = 0;

function clean(v) { return String(v == null ? "" : v).trim(); }
function now() { return Math.floor(Date.now() / 1000); }
function normalize(v) {
  try { return clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  catch (_) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
}
function delay(ms) {
  if (typeof setTimeout === "function") return new Promise(resolve => setTimeout(resolve, ms));
  const end = Date.now() + ms;
  while (Date.now() < end) {}
  return Promise.resolve();
}
function setCookies(headers, responseUrl) {
  if (!headers) return;
  let raw = [];
  try {
    if (typeof headers.getSetCookie === "function") raw = headers.getSetCookie();
  } catch (_) {}
  if (!raw.length) {
    const one = headers.get && (headers.get("set-cookie") || headers.get("Set-Cookie"));
    if (one) raw = one.split(/,(?=\s*[^;,\s]+=)/g);
  }
  let host = "";
  try { host = new URL(responseUrl).hostname.toLowerCase(); } catch (_) {}
  for (const line of raw) {
    const pair = clean(line).split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const dm = clean(line).match(/(?:^|;)\s*domain=([^;]+)/i);
    const domain = clean(dm ? dm[1] : host).replace(/^\./, "").toLowerCase();
    const idx = cookieJar.findIndex(c => c.name === name && c.domain === domain);
    if (!value || /max-age\s*=\s*0/i.test(line)) {
      if (idx >= 0) cookieJar.splice(idx, 1);
      continue;
    }
    const item = { name, value, domain };
    if (idx >= 0) cookieJar[idx] = item; else cookieJar.push(item);
  }
}
function cookieHeader(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) {}
  return cookieJar.filter(c => host === c.domain || host.endsWith("." + c.domain)).map(c => c.name + "=" + c.value).join("; ");
}
async function request(url, options) {
  const opts = options || {};
  const headers = { ...(opts.headers || {}) };
  const jar = cookieHeader(url);
  if (jar) headers.Cookie = headers.Cookie ? headers.Cookie + "; " + jar : jar;
  const response = await fetch(url, { ...opts, headers });
  setCookies(response.headers, response.url || url);
  return response;
}
function getCookie(name) {
  const row = cookieJar.find(c => c.name === name);
  return row ? row.value : "";
}
async function bypass() {
  if (verifiedCookie && Date.now() - verifiedAt < 15 * 60 * 60 * 1000) return verifiedCookie;
  cookieJar = [];
  verifiedCookie = "";
  try {
    const appHeaders = { "User-Agent": APP_UA, "X-Requested-With": "app.netmirror.netmirrornew" };
    const home = await request(BASE + "/mobile/home?app=1", { headers: appHeaders });
    const html = await home.text();
    const match = html.match(/data-addhash\s*=\s*["']([^"']+)["']/i);
    if (!home.ok || !match) return "";
    const hash = match[1];
    const u = await request("https://userver.net52.cc/?hee5=" + encodeURIComponent(hash) + "&a=y&t=" + Date.now(), { headers: appHeaders });
    await u.text();

    for (let attempt = 1; attempt <= 7; attempt++) {
      await delay(10000);
      const verify = await request(BASE + "/mobile/verify2.php", {
        method: "POST",
        headers: {
          "User-Agent": APP_UA,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "verify=" + encodeURIComponent(hash)
      });
      const text = await verify.text();
      let done = text.includes('"statusup":"All Done"');
      if (!done) {
        try { done = JSON.parse(text).statusup === "All Done"; } catch (_) {}
      }
      if (!done) continue;
      const cookie = getCookie("t_hash_t");
      if (cookie) {
        verifiedCookie = cookie;
        verifiedAt = Date.now();
        return cookie;
      }
    }
  } catch (_) {}
  return "";
}
async function getJson(url, headers) {
  const response = await request(url, { headers });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}
function episodeNum(item) {
  if (!item) return null;
  const v = item.ep != null ? item.ep : item.epNum != null ? item.epNum : item.episode_number;
  const m = clean(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}
function seasonNum(item, fallback) {
  if (!item) return fallback || null;
  for (const v of [item.s, item.sNum, item.season, item.season_number]) {
    const m = clean(v).match(/\d+/);
    if (m) return Number(m[0]);
  }
  return fallback || null;
}
function interestingObject(obj, depth) {
  if (!obj || typeof obj !== "object" || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 6).map(v => interestingObject(v, depth + 1));
  const out = {};
  for (const key of Object.keys(obj)) {
    if (/(audio|lang|language|server|mirror|source|track|quality|label|file|url|type|kind)/i.test(key)) {
      const value = obj[key];
      if (typeof value === "object") out[key] = interestingObject(value, depth + 1);
      else out[key] = value;
    }
  }
  return out;
}
function compact(value, max) {
  let text = "";
  try { text = JSON.stringify(value); } catch (_) { text = String(value); }
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}
function diag(title, detail) {
  return {
    name: PROVIDER_NAME + " • DIAG",
    title: title + (detail ? " • " + detail : ""),
    url: BASE + "/favicon.ico",
    quality: "DIAG",
    provider: "netmirror-mobile-probe",
    type: "mp4"
  };
}
function playableRows(entries, headers) {
  const rows = [];
  const seen = new Set();
  for (const entry of entries) {
    for (const source of (entry && entry.sources) || []) {
      const file = clean(source && source.file);
      if (!file) continue;
      const url = /^https?:\/\//i.test(file) ? file : file.startsWith("//") ? "https:" + file : BASE + (file.startsWith("/") ? "" : "/") + file;
      if (seen.has(url)) continue;
      seen.add(url);
      rows.push({
        name: PROVIDER_NAME + " • PLAYABLE • " + clean(source.label || "Auto"),
        title: compact(interestingObject({ source, entry }, 0), 800),
        url,
        quality: clean(source.label || "Auto"),
        headers,
        provider: "netmirror-mobile-probe",
        type: /m3u8/i.test(url) ? "m3u8" : "video"
      });
      if (rows.length >= 2) return rows;
    }
  }
  return rows;
}
async function resolveTarget(title, mediaType, season, episode, headers) {
  const search = await getJson(BASE + PLATFORM.search + "?s=" + encodeURIComponent(title) + "&t=" + now(), headers);
  const results = Array.isArray(search && search.searchResult) ? search.searchResult : [];
  if (!results.length) return { error: "No Netflix search results" };
  const wanted = normalize(title);
  results.sort((a, b) => {
    const score = x => normalize(x && (x.t || x.title)) === wanted ? 0 : normalize(x && (x.t || x.title)).includes(wanted) ? 1 : 2;
    return score(a) - score(b);
  });
  const result = results[0];
  const post = await getJson(BASE + PLATFORM.post + "?id=" + encodeURIComponent(result.id) + "&t=" + now(), headers);
  let targetId = result.id;

  if (mediaType === "tv") {
    const wantedSeason = Number(season || 1);
    const wantedEpisode = Number(episode || 1);
    const seasons = Array.isArray(post.season) ? post.season : [];
    const selectedIndex = seasons.findIndex(s => s && s.selected === true);
    const fallbackSeason = selectedIndex >= 0 ? selectedIndex + 1 : wantedSeason;
    let ep = (Array.isArray(post.episodes) ? post.episodes : []).find(x => x && episodeNum(x) === wantedEpisode && seasonNum(x, fallbackSeason) === wantedSeason);
    if (!ep) {
      const srow = seasons.find(s => seasonNum(s, null) === wantedSeason);
      if (srow && srow.id) {
        for (let page = 1; page <= 30 && !ep; page++) {
          const data = await getJson(BASE + PLATFORM.episodes + "?s=" + encodeURIComponent(srow.id) + "&series=" + encodeURIComponent(result.id) + "&t=" + now() + "&page=" + page, headers);
          ep = (Array.isArray(data.episodes) ? data.episodes : []).find(x => x && episodeNum(x) === wantedEpisode && seasonNum(x, wantedSeason) === wantedSeason);
          if (!data.nextPageShow || Number(data.nextPageShow) === 0) break;
        }
      }
    }
    if (!ep || !ep.id) return { error: "Requested episode not found", result, post };
    targetId = ep.id;
  }
  return { result, post, targetId };
}
async function getStreams(tmdbId, mediaType, season, episode) {
  const rows = [];
  try {
    const type = mediaType === "tv" ? "tv" : "movie";
    const tmdb = await getJson(TMDB_API + "/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, { "User-Agent": WEB_UA, Accept: "application/json" });
    const title = type === "tv" ? tmdb.name : tmdb.title;
    if (!title) return [diag("TMDB title unavailable", String(tmdbId))];

    const cookie = await bypass();
    if (!cookie) return [diag("Cookie verification failed", "mobile flow did not verify")];

    const headers = {
      "User-Agent": WEB_UA,
      "Accept": "*/*",
      "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
      "X-Requested-With": "app.netmirror.netmirrornew",
      "Cookie": "t_hash_t=" + cookie + "; ott=nf; hd=on",
      "Referer": BASE + "/mobile/home?app=1"
    };

    const target = await resolveTarget(title, type, season, episode, headers);
    if (target.error) return [diag(target.error, title)];

    const playlistUrl = BASE + PLATFORM.playlist + "?id=" + encodeURIComponent(target.targetId) + "&t=" + encodeURIComponent(title) + "&tm=" + now();
    const payload = await getJson(playlistUrl, headers);
    const entries = Array.isArray(payload) ? payload : (payload && (payload.playlist || payload.data)) || [];

    rows.push(diag("Playlist shape", "top=" + compact(Array.isArray(payload) ? ["<array>"] : Object.keys(payload || {}), 300) + " entries=" + entries.length));
    entries.slice(0, 6).forEach((entry, index) => {
      rows.push(diag("Entry " + (index + 1) + " keys", compact(Object.keys(entry || {}), 500)));
      const interesting = interestingObject(entry, 0);
      if (Object.keys(interesting || {}).length) rows.push(diag("Entry " + (index + 1) + " audio/server metadata", compact(interesting, 1200)));
    });

    if (!entries.length) rows.push(diag("No playlist entries", compact(payload, 1000)));
    rows.push(...playableRows(entries, headers));
    return rows.slice(0, 18);
  } catch (error) {
    return [diag("Probe failed", clean(error && error.message))];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
