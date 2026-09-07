"use strict";

// 123MoviesFree Nexus probe v0.1.0
// Stage 1: resolve Nuvio metadata to TMDB, locate the site's movie/season page,
// and inspect the real player surface without treating lazy-loaded images as players.

const PROVIDER_NAME = "123MoviesFree";
const ROOT = "https://123moviesfree.net";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

function clean(value) { return String(value || "").trim(); }
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function yearOf(value) { const m = clean(value).match(/(19|20)\d{2}/); return m ? parseInt(m[0], 10) : null; }
function originOf(url) { const m = clean(url).match(/^(https?:\/\/[^/]+)/i); return m ? m[1] : ""; }
function hostOf(url) { const m = clean(url).match(/^https?:\/\/([^/]+)/i); return m ? m[1] : "unknown-host"; }
function short(value, limit) { const text = clean(value).replace(/\s+/g, " "); const max = parseInt(limit, 10) || 170; return text.length > max ? text.slice(0, max - 1) + "…" : text; }

function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) { return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }

function normalizeTitle(value) {
  let text = stripTags(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/\b(hd|sd|cam|eps?|episode)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  let text = stripTags(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}

function absoluteUrl(baseUrl, candidate) {
  const raw = decodeHtml(candidate);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return (/^https:/i.test(baseUrl) ? "https:" : "http:") + raw;
  const origin = originOf(baseUrl);
  if (raw.charAt(0) === "/") return origin ? origin + raw : raw;
  const base = clean(baseUrl).split("#")[0].split("?")[0];
  const slash = base.lastIndexOf("/");
  return (slash >= 0 ? base.slice(0, slash + 1) : base + "/") + raw;
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: HEADERS, skipSizeCheck: true });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch (_) { return null; }
}

async function fetchPage(url, referer) {
  try {
    const headers = { ...HEADERS };
    if (referer) headers.Referer = referer;
    const response = await fetch(url, { headers, redirect: "follow", skipSizeCheck: true });
    const status = response ? response.status : 0;
    const ok = Boolean(response && response.ok);
    const text = response ? String(await response.text() || "") : "";
    const finalUrl = clean(response && response.url) || url;
    return { ok, status, text, finalUrl, error: "" };
  } catch (error) {
    return { ok: false, status: 0, text: "", finalUrl: url, error: clean(error && error.message ? error.message : error) };
  }
}

async function resolveTmdbId(inputId, mediaType) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const rows = mediaType === "movie" ? data && data.movie_results : data && data.tv_results;
  return Array.isArray(rows) && rows[0] && rows[0].id ? parseInt(rows[0].id, 10) : null;
}

async function tmdbInfo(tmdbId, mediaType, season) {
  const data = await fetchJson(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`);
  if (!data) return null;
  const title = mediaType === "movie" ? clean(data.title || data.original_title) : clean(data.name || data.original_name);
  const original = mediaType === "movie" ? clean(data.original_title || data.title) : clean(data.original_name || data.name);
  const baseYear = yearOf(mediaType === "movie" ? data.release_date : data.first_air_date);
  let seasonYear = baseYear;
  let seasonName = "";
  if (mediaType === "tv") {
    const s = parseInt(season, 10) || 1;
    const seasonData = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s}?api_key=${TMDB_API_KEY}`);
    if (seasonData) {
      seasonYear = yearOf(seasonData.air_date) || baseYear;
      seasonName = clean(seasonData.name);
    }
  }
  return { id: tmdbId, title, original, year: baseYear, seasonYear, seasonName };
}

function extractCandidates(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    const href = absoluteUrl(pageUrl, m[1]);
    if (!href || !/\/(?:movie|season)\//i.test(href)) continue;
    const text = stripTags(m[2]);
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, text });
    if (out.length >= 80) break;
  }
  return out;
}

function scoreCandidate(candidate, meta, mediaType, season) {
  const pathOkay = mediaType === "movie" ? /\/movie\//i.test(candidate.href) : /\/season\//i.test(candidate.href);
  if (!pathOkay) return -100;
  const wanted = normalizeTitle(meta.title);
  const original = normalizeTitle(meta.original);
  const text = normalizeTitle(candidate.text + " " + candidate.href);
  let score = 0;
  if (wanted && text.includes(wanted)) score = 80;
  if (original && text.includes(original)) score = Math.max(score, 80);
  const wantedWords = wanted.split(" ").filter(Boolean);
  if (score < 80 && wantedWords.length) {
    let hits = 0;
    for (const word of wantedWords) if (word.length > 1 && text.split(" ").includes(word)) hits++;
    score = Math.max(score, Math.round((hits / wantedWords.length) * 70));
  }
  if (mediaType === "tv") {
    const s = parseInt(season, 10) || 1;
    const sm = (candidate.text + " " + candidate.href).match(/season[-\s]*(\d+)/i);
    if (sm) score += parseInt(sm[1], 10) === s ? 30 : -55;
  }
  return score;
}

async function findTitlePage(baseOrigin, meta, mediaType, season) {
  const searchUrl = `${baseOrigin}/?s=${encodeURIComponent(meta.title)}`;
  const search = await fetchPage(searchUrl, `${baseOrigin}/`);
  let candidates = search.ok ? extractCandidates(search.text, search.finalUrl) : [];
  let source = "search";

  if (!candidates.length) {
    const y = mediaType === "tv" ? meta.seasonYear : meta.year;
    if (y) {
      const releaseUrl = `${baseOrigin}/release/${y}/`;
      const release = await fetchPage(releaseUrl, `${baseOrigin}/`);
      if (release.ok) candidates = extractCandidates(release.text, release.finalUrl);
      source = `release-${y}`;
    }
  }

  const ranked = candidates
    .map(item => ({ ...item, score: scoreCandidate(item, meta, mediaType, season) }))
    .filter(item => item.score >= 45)
    .sort((a, b) => b.score - a.score);
  return { source, candidates, ranked, best: ranked[0] || null, searchStatus: search.status || 0 };
}

function collect(html, regex, groupIndex, limit) {
  const out = [];
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(String(html || ""))) !== null) {
    const value = decodeHtml(m[groupIndex || 1]);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= (limit || 16)) break;
  }
  return out;
}

function analyzePlayerPage(html, pageUrl) {
  const text = String(html || "");
  const iframes = [];
  const iframeRe = /<iframe\b([^>]*)>/gi;
  let frame;
  while ((frame = iframeRe.exec(text)) !== null) {
    const attrs = frame[1] || "";
    const src = attrs.match(/(?:src|data-src)=["']([^"']+)["']/i);
    if (!src) continue;
    const url = absoluteUrl(pageUrl, src[1]);
    if (url && !/\.(?:jpe?g|png|gif|webp|svg)(?:$|[?#])/i.test(url) && !iframes.includes(url)) iframes.push(url);
  }
  const direct = collect(text, /["'](https?:\/\/[^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi, 1, 12);
  const serverValues = collect(text, /data-(?:server|video|embed|url|link)=["']([^"']+)["']/gi, 1, 20)
    .filter(value => !/\.(?:jpe?g|png|gif|webp|svg)(?:$|[?#])/i.test(value));
  const ajax = collect(text, /["']([^"']*(?:admin-ajax\.php|\/ajax\/|\/embed\/|\/player\/)[^"']*)["']/gi, 1, 16);
  const serverMarkers = (text.match(/server\s*[1-9]/gi) || []).length;
  return { iframes, direct, serverValues, ajax, serverMarkers };
}

function diag(label, detail, origin) {
  const base = clean(origin) || ROOT;
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 190)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${base.replace(/\/$/, "")}/favicon.ico`,
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
  if (!tmdbId) return [diag("TMDB", `Unable to resolve ${inputId} to a TMDB ${type} id`)];
  const meta = await tmdbInfo(tmdbId, type, season);
  if (!meta || !meta.title) return [diag("TMDB", `TMDB ${type} ${tmdbId} returned no title`)];

  const home = await fetchPage(ROOT);
  if (!home.ok || !home.text) {
    const detail = home.error ? home.error : `HTTP ${home.status || "ERR"}`;
    return [diag("FETCH BLOCKED", `root=${detail}`, ROOT)];
  }
  const baseOrigin = originOf(home.finalUrl) || ROOT;
  const found = await findTitlePage(baseOrigin, meta, type, season);
  const wanted = type === "movie" ? "movie" : `S${parseInt(season, 10) || 1}E${parseInt(episode, 10) || 1}`;
  const rows = [diag("ROOT OK", `${hostOf(home.finalUrl)} • HTTP ${home.status}`, baseOrigin)];

  if (!found.best) {
    rows.push(diag("NO MATCH", `${meta.title} • TMDB ${tmdbId} • ${wanted} • source=${found.source} • candidates=${found.candidates.length}`, baseOrigin));
    return rows;
  }

  rows.push(diag("MATCH", `${meta.title} • ${wanted} • source=${found.source} • score=${found.best.score} • ${short(found.best.href, 120)}`, baseOrigin));
  const page = await fetchPage(found.best.href, home.finalUrl);
  if (!page.ok || !page.text) {
    rows.push(diag("TITLE BLOCKED", `${hostOf(found.best.href)} • HTTP ${page.status || "ERR"}${page.error ? ` • ${page.error}` : ""}`, baseOrigin));
    return rows;
  }

  const scan = analyzePlayerPage(page.text, page.finalUrl);
  rows.push(diag("PLAYER SCAN", `${hostOf(page.finalUrl)} • HTTP ${page.status} • iframes=${scan.iframes.length} • direct=${scan.direct.length} • serverData=${scan.serverValues.length} • ajax=${scan.ajax.length} • serverMarkers=${scan.serverMarkers}`, originOf(page.finalUrl) || baseOrigin));
  if (scan.iframes.length) rows.push(diag("IFRAME HOST", `${hostOf(scan.iframes[0])} • ${short(scan.iframes[0], 120)}`, originOf(page.finalUrl) || baseOrigin));
  else if (scan.serverValues.length) rows.push(diag("SERVER DATA", short(scan.serverValues[0], 150), originOf(page.finalUrl) || baseOrigin));
  else if (scan.ajax.length) rows.push(diag("AJAX", short(scan.ajax[0], 150), originOf(page.finalUrl) || baseOrigin));
  else if (scan.direct.length) rows.push(diag("MEDIA HOST", hostOf(scan.direct[0]), originOf(page.finalUrl) || baseOrigin));
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
