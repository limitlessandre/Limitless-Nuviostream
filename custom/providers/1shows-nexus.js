"use strict";

// 1Shows Nexus probe v0.1.0
// Playback path follows the current Aug/Sep 2026 VidZee API used by 1Shows-family streams.
// Reference behavior: core.vidzee.wtf /streams/* with e=0 plaintext responses,
// named servers, and player.vidzee.wtf as the required stream Referer.

const PROVIDER_NAME = "1Shows Test";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const API_BASE = "https://core.vidzee.wtf";
const PLAYER_ORIGIN = "https://player.vidzee.wtf";
const STREAM_REFERER = `${PLAYER_ORIGIN}/`;
const SERVERS = ["dcloud", "tik", "ipcloud", "v6:Hindi"];
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function clean(value) { return String(value == null ? "" : value).trim(); }
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = Number(limit) || 190;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function absoluteUrl(base, value) {
  try { return new URL(value, base).toString(); } catch (_) { return clean(value); }
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return "unknown-host"; }
}
function inferHeight(text) {
  const m = clean(text).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}
function qualityTier(height) {
  const h = Number(height || 0);
  if (h >= 2160) return `4K ${h}p`;
  if (h >= 1440) return `Enhanced QHD ${h}p`;
  if (h >= 1080) return `FHD ${h}p`;
  if (h >= 720) return `HD ${h}p`;
  if (h >= 540) return `HD-Low ${h}p`;
  if (h >= 480) return `SD ${h}p`;
  if (h >= 360) return `SD-Low ${h}p`;
  if (h > 0) return `SD-Very Low ${h}p`;
  return "Unknown Auto";
}

async function requestJson(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/plain,*/*",
        "Referer": STREAM_REFERER,
        "Origin": PLAYER_ORIGIN
      },
      redirect: "follow",
      skipSizeCheck: true
    });
    if (!response) return { ok: false, status: 0, data: null, error: "no response" };
    const status = Number(response.status || 0);
    if (!response.ok) return { ok: false, status, data: null, error: `HTTP ${status || "ERR"}` };
    const data = await response.json();
    return { ok: true, status, data, error: "" };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: clean(error && error.message ? error.message : error) || "request error" };
  }
}

async function requestText(url, extraHeaders) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
        "Referer": STREAM_REFERER,
        "Origin": PLAYER_ORIGIN,
        ...(extraHeaders || {})
      },
      redirect: "follow",
      skipSizeCheck: true
    });
    if (!response || !response.ok) return "";
    return String(await response.text() || "");
  } catch (_) { return ""; }
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;
  const r = await requestJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const rows = mediaType === "movie" ? r.data && r.data.movie_results : r.data && r.data.tv_results;
  return Array.isArray(rows) && rows[0] && rows[0].id ? Number(rows[0].id) : null;
}

function buildApiUrl(tmdbId, mediaType, season, episode, server) {
  const path = mediaType === "tv"
    ? `/streams/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`
    : `/streams/movie/${encodeURIComponent(tmdbId)}`;
  return `${API_BASE}${path}?s=${encodeURIComponent(server)}&e=0`;
}

function diag(label, detail) {
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 205)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${PLAYER_ORIGIN}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function expandHls(sourceUrl, apiHeaders) {
  if (!/\.m3u8(?:$|[?#])/i.test(sourceUrl)) return [];
  const text = await requestText(sourceUrl, apiHeaders);
  if (!text || !/#EXT-X-STREAM-INF/i.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/#EXT-X-STREAM-INF/i.test(lines[i])) continue;
    const resolution = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
    let next = i + 1;
    while (next < lines.length && (!clean(lines[next]) || clean(lines[next])[0] === "#")) next++;
    if (next >= lines.length) continue;
    const url = absoluteUrl(sourceUrl, clean(lines[next]));
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ url, height: resolution ? Number(resolution[1]) : inferHeight(url) });
  }
  return out;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB FAILED", `input=${inputId} • type=${type}`)];

  const s = Number(season || 1);
  const e = Number(episode || 1);
  const probes = await Promise.all(SERVERS.map(async server => {
    const url = buildApiUrl(tmdbId, type, s, e, server);
    const result = await requestJson(url);
    const data = result.data;
    const streamUrl = clean(data && data.url);
    const language = clean(data && data.language) || (server.toLowerCase().includes("hindi") ? "Hindi" : "Unknown");
    const apiHeaders = data && data.headers && typeof data.headers === "object" ? data.headers : {};
    return { server, result, streamUrl, language, apiHeaders };
  }));

  const rows = [];
  const failures = [];
  const seen = new Set();
  let successCount = 0;

  for (const probe of probes) {
    if (!probe.result.ok || !/^https?:\/\//i.test(probe.streamUrl)) {
      failures.push(`${probe.server}=${probe.result.error || "no-url"}`);
      continue;
    }
    successCount++;
    const playbackHeaders = {
      "User-Agent": USER_AGENT,
      "Referer": STREAM_REFERER,
      "Origin": PLAYER_ORIGIN,
      ...probe.apiHeaders
    };
    const variants = await expandHls(probe.streamUrl, probe.apiHeaders);
    const choices = variants.length ? variants : [{ url: probe.streamUrl, height: inferHeight(probe.streamUrl) }];
    for (const choice of choices) {
      const url = clean(choice && choice.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const height = Number(choice.height || 0);
      rows.push({
        name: `${PROVIDER_NAME} • ${qualityTier(height)} • ${probe.server}`,
        title: `TMDB ${tmdbId}${type === "tv" ? ` • S${s}E${e}` : " • Movie"}`,
        url,
        quality: height ? `${height}p` : "Auto",
        language: probe.language,
        headers: playbackHeaders,
        provider: PROVIDER_NAME,
        type: /\.mp4(?:$|[?#])/i.test(url) ? "mp4" : "m3u8",
        subtitles: []
      });
    }
    rows.push(diag("SERVER OK", `${probe.server} • ${probe.language} • ${hostOf(probe.streamUrl)}`));
  }

  rows.sort((a, b) => {
    const aq = parseInt(String(a.quality || "").match(/\d+/)?.[0] || "0", 10);
    const bq = parseInt(String(b.quality || "").match(/\d+/)?.[0] || "0", 10);
    return bq - aq;
  });

  rows.push(diag("REQUEST", `TMDB ${tmdbId} • ${type}${type === "tv" ? ` • S${s}E${e}` : ""} • servers=${successCount}/${SERVERS.length}`));
  if (failures.length) rows.push(diag("SERVER FAIL", failures.join(" • ")));
  if (!rows.some(row => row && row.quality && row.quality !== "DIAG")) rows.push(diag("NO STREAM", `No playable VidZee/1Shows source returned for TMDB ${tmdbId}`));
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
