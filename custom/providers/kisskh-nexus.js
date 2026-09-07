"use strict";

// KissKH Nexus test v0.1.0
// Current API shape follows debakarr/kisskh-dl 0.2.4 (Sep 4 2026), whose
// active site reference is kisskh.is. The Nuvio build keeps Yuzono's current
// Google Apps Script kkey bridge as the browserless authentication attempt.

const PROVIDER_NAME = "KissKH Test";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const STREAM_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
const DOMAINS = [
  "https://kisskh.is",
  "https://kisskh.ovh",
  "https://kisskh.do",
  "https://kisskh.co",
  "https://kisskh.id",
  "https://kisskh.la",
  "https://kisskh.nl"
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

function clean(value) { return String(value || "").trim(); }
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = Number(limit) || 175;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function yearOf(value) {
  const match = clean(value).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}
function normalizeTitle(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function slugify(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
function absoluteUrl(base, value) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = clean(base).match(/^(https?:\/\/[^/]+)/i);
  if (/^\/\//.test(raw)) return (/^https:/i.test(base) ? "https:" : "http:") + raw;
  if (raw[0] === "/") return origin ? origin[1] + raw : raw;
  const cleanBase = clean(base).split("#")[0].split("?")[0];
  const slash = cleanBase.lastIndexOf("/");
  return (slash >= 0 ? cleanBase.slice(0, slash + 1) : cleanBase + "/") + raw;
}

async function requestJson(url, referer, origin) {
  try {
    const headers = { ...BASE_HEADERS };
    if (referer) headers.Referer = referer;
    if (origin) headers.Origin = origin;
    const response = await fetch(url, { headers, redirect: "follow", skipSizeCheck: true });
    if (!response) return { ok: false, status: 0, data: null, error: "no response" };
    const status = response.status || 0;
    if (!response.ok) return { ok: false, status, data: null, error: `HTTP ${status}` };
    const data = await response.json();
    return { ok: true, status, data, error: "" };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: clean(error && error.message ? error.message : error) || "request error" };
  }
}

async function requestText(url, referer, origin) {
  try {
    const headers = { ...BASE_HEADERS, Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*" };
    if (referer) headers.Referer = referer;
    if (origin) headers.Origin = origin;
    const response = await fetch(url, { headers, redirect: "follow", skipSizeCheck: true });
    if (!response || !response.ok) return null;
    return String(await response.text() || "");
  } catch (_) { return null; }
}

async function resolveTmdbId(inputId, type) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;
  const r = await requestJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const rows = type === "movie" ? r.data && r.data.movie_results : r.data && r.data.tv_results;
  return Array.isArray(rows) && rows[0] && rows[0].id ? Number(rows[0].id) : null;
}

async function tmdbInfo(tmdbId, type) {
  const append = type === "movie" ? "alternative_titles,external_ids" : "alternative_titles,external_ids";
  const r = await requestJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=${append}`);
  const data = r.data;
  if (!r.ok || !data) return null;
  const title = type === "movie" ? clean(data.title || data.original_title) : clean(data.name || data.original_name);
  const original = type === "movie" ? clean(data.original_title || data.title) : clean(data.original_name || data.name);
  const aliases = [];
  const push = value => { const v = clean(value); if (v && !aliases.includes(v)) aliases.push(v); };
  push(title); push(original);
  const alt = data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results);
  if (Array.isArray(alt)) for (const item of alt) push(item && (item.title || item.name));
  return {
    id: Number(tmdbId), title, original, aliases: aliases.slice(0, 12),
    year: yearOf(type === "movie" ? data.release_date : data.first_air_date),
    episodeCount: Number(data.number_of_episodes || 0)
  };
}

function exactCandidateScore(item, meta) {
  const candidate = normalizeTitle(item && item.title);
  if (!candidate) return -1;
  let score = -1;
  for (const alias of meta.aliases || []) {
    if (candidate === normalizeTitle(alias)) { score = 100; break; }
  }
  if (score < 0) return score;
  const candidateYear = yearOf(item && item.title);
  if (candidateYear && meta.year && candidateYear === meta.year) score += 15;
  const count = Number(item && item.episodesCount || 0);
  if (count && meta.episodeCount && count === meta.episodeCount) score += 10;
  return score;
}

async function findMatch(meta) {
  const failures = [];
  const queryTerms = [];
  for (const alias of meta.aliases || []) {
    const q = clean(alias);
    if (q && !queryTerms.includes(q)) queryTerms.push(q);
    if (queryTerms.length >= 5) break;
  }

  for (const base of DOMAINS) {
    let reachable = false;
    let best = null;
    let bestScore = -1;
    let candidateCount = 0;
    for (const term of queryTerms) {
      const url = `${base}/api/DramaList/Search?q=${encodeURIComponent(term)}`;
      const r = await requestJson(url, `${base}/`, base);
      if (!r.ok || !Array.isArray(r.data)) {
        failures.push(`${base.replace(/^https?:\/\//, "")}=${r.error || `HTTP ${r.status || "ERR"}`}`);
        break;
      }
      reachable = true;
      candidateCount += r.data.length;
      for (const item of r.data) {
        const score = exactCandidateScore(item, meta);
        if (score > bestScore) { bestScore = score; best = item; }
      }
      if (bestScore >= 100) break;
    }
    if (reachable && best && bestScore >= 100) return { base, item: best, score: bestScore, candidateCount, failures };
    if (reachable) failures.push(`${base.replace(/^https?:\/\//, "")}=reachable-no-exact-match`);
  }
  return { base: "", item: null, score: -1, candidateCount: 0, failures };
}

async function getDetail(base, dramaId) {
  return requestJson(`${base}/api/DramaList/Drama/${encodeURIComponent(dramaId)}?isq=false`, `${base}/`, base);
}

function pickEpisode(detail, type, season, episode) {
  const eps = Array.isArray(detail && detail.episodes) ? detail.episodes.slice() : [];
  if (!eps.length) return null;
  eps.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
  if (type === "movie") return eps[eps.length - 1];
  if (Number(season || 1) !== 1) return null;
  const wanted = Number(episode || 1);
  return eps.find(ep => Number(ep && ep.number) === wanted) || null;
}

function episodeReferer(base, title, dramaId, epId, episode) {
  const slug = slugify(title) || "Drama";
  return `${base}/Drama/${slug}/Episode-${Number(episode || 1)}?id=${encodeURIComponent(dramaId)}&ep=${encodeURIComponent(epId)}&page=0&pageSize=100`;
}

async function requestStreamKey(epId, referer) {
  return requestJson(`${STREAM_KEY_API}${encodeURIComponent(epId)}&version=2.8.10`, referer);
}

function collectSourceUrls(data) {
  const out = [];
  for (const key of ["Video", "Video_tmp", "ThirdParty"]) {
    const value = clean(data && data[key]);
    if (/^https?:\/\//i.test(value) && !out.includes(value)) out.push(value);
  }
  return out;
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

function inferHeight(text) {
  const m = clean(text).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}

async function expandHls(url, referer, origin) {
  if (!/\.m3u8(?:$|[?#])/i.test(url)) return [];
  const text = await requestText(url, referer, origin);
  if (!text || !/#EXT-X-STREAM-INF/i.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/#EXT-X-STREAM-INF/i.test(lines[i])) continue;
    const res = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
    let next = i + 1;
    while (next < lines.length && (!clean(lines[next]) || clean(lines[next])[0] === "#")) next++;
    if (next >= lines.length) continue;
    const child = absoluteUrl(url, clean(lines[next]));
    if (!/^https?:\/\//i.test(child)) continue;
    const height = res ? Number(res[1]) : inferHeight(child);
    out.push({ url: child, height });
  }
  return out;
}

function diag(label, detail, base) {
  const root = clean(base) || DOMAINS[0];
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 190)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${root}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB", `Unable to resolve ${inputId} to TMDB ${type}`)];
  const meta = await tmdbInfo(tmdbId, type);
  if (!meta || !meta.title) return [diag("TMDB", `TMDB ${type} ${tmdbId} returned no usable title`)];

  if (type === "tv" && Number(season || 1) !== 1) {
    return [diag("SEASON UNSUPPORTED", `${meta.title} • S${Number(season || 1)} • initial KissKH test only maps season 1 safely`)];
  }

  const match = await findMatch(meta);
  if (!match.item || !match.base) {
    return [diag("NO EXACT MATCH", `${meta.title} • TMDB ${tmdbId} • ${match.failures.slice(0, 5).join(" • ") || "no API result"}`)];
  }

  const detailResult = await getDetail(match.base, match.item.id);
  if (!detailResult.ok || !detailResult.data) {
    return [diag("DETAIL FAILED", `${match.item.title} • id=${match.item.id} • ${detailResult.error || `HTTP ${detailResult.status || "ERR"}`}`, match.base)];
  }
  const detail = detailResult.data;
  if (normalizeTitle(detail.title) !== normalizeTitle(match.item.title)) {
    return [diag("DETAIL MISMATCH", `${match.item.title} → ${clean(detail.title) || "unknown"}`, match.base)];
  }

  const target = pickEpisode(detail, type, season, episode);
  if (!target) {
    return [diag("NO EPISODE", `${detail.title} • ${type === "movie" ? "movie" : `S${Number(season || 1)}E${Number(episode || 1)}`} • episodes=${Array.isArray(detail.episodes) ? detail.episodes.length : 0}`, match.base)];
  }

  const referer = episodeReferer(match.base, detail.title, match.item.id, target.id, episode);
  const keyResult = await requestStreamKey(target.id, referer);
  const key = clean(keyResult.data && keyResult.data.key);
  if (!keyResult.ok || !key) {
    return [
      diag("MATCH OK", `${detail.title} • id=${match.item.id} • episode=${target.number} • epId=${target.id} • domain=${match.base.replace(/^https?:\/\//, "")}`, match.base),
      diag("KEY FAILED", `${keyResult.error || `HTTP ${keyResult.status || "ERR"}`} • current site may require browser-generated kkey`, match.base)
    ];
  }

  const streamUrl = `${match.base}/api/DramaList/Episode/${encodeURIComponent(target.id)}.png?err=false&ts=null&time=null&kkey=${encodeURIComponent(key)}`;
  const streamResult = await requestJson(streamUrl, referer, match.base);
  if (!streamResult.ok || !streamResult.data) {
    return [
      diag("MATCH OK", `${detail.title} • id=${match.item.id} • episode=${target.number} • epId=${target.id}`, match.base),
      diag("KEY OK", `key received • ${String(key).length} chars`, match.base),
      diag("VIDEO FAILED", streamResult.error || `HTTP ${streamResult.status || "ERR"}`, match.base)
    ];
  }

  const sources = collectSourceUrls(streamResult.data);
  if (!sources.length) {
    return [
      diag("MATCH OK", `${detail.title} • id=${match.item.id} • episode=${target.number} • epId=${target.id}`, match.base),
      diag("KEY OK", `key received • ${String(key).length} chars`, match.base),
      diag("NO VIDEO", `stream JSON returned no Video/Video_tmp/ThirdParty URL`, match.base)
    ];
  }

  const rows = [];
  const seen = new Set();
  for (const source of sources) {
    const variants = await expandHls(source, referer, match.base);
    const choices = variants.length ? variants : [{ url: source, height: inferHeight(source) }];
    for (const choice of choices) {
      if (!choice.url || seen.has(choice.url)) continue;
      seen.add(choice.url);
      const height = Number(choice.height || 0);
      rows.push({
        name: `${PROVIDER_NAME} • ${qualityTier(height)}`,
        title: `${detail.title} • Episode ${target.number}`,
        url: choice.url,
        quality: height ? `${height}p` : "Auto",
        language: "Japanese",
        headers: { Referer: referer, Origin: match.base, "User-Agent": USER_AGENT },
        provider: PROVIDER_NAME,
        type: /\.mp4(?:$|[?#])/i.test(choice.url) ? "mp4" : "m3u8",
        subtitles: []
      });
    }
  }

  rows.push(diag("MATCH OK", `${detail.title} • id=${match.item.id} • episode=${target.number} • epId=${target.id} • domain=${match.base.replace(/^https?:\/\//, "")}`, match.base));
  rows.push(diag("KEY OK", `browserless key bridge succeeded • ${String(key).length} chars`, match.base));
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
