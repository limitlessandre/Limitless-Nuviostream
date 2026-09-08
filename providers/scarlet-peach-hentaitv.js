"use strict";

const PROVIDER_NAME = "Scarlet Peach - HentaiTV";
const CATALOG_BASE = "https://scarlet-peach-catalog.limitlessandre.workers.dev";
const HENTAITV_BASE = "https://hentai.tv";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function clean(value) { return String(value == null ? "" : value).trim(); }
function short(value, max) { const text = clean(value).replace(/\s+/g, " "); const n = Number(max) || 180; return text.length > n ? text.slice(0, n - 1) + "…" : text; }
function diag(label, detail) {
  const text = clean(detail);
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${text ? ` • ${short(text, 180)}` : ""}`,
    title: text || `${PROVIDER_NAME} diagnostic`,
    url: `${HENTAITV_BASE}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(the|animation|ova)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreTitle(target, candidate) {
  const a = normalize(target), b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = new Set(a.split(" ")), right = new Set(b.split(" "));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(left.size, right.size, 1);
}

function decodeHtml(value) {
  return String(value || "").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function parseEpisodeNumber(value) {
  const text = String(value || "");
  const match = text.match(/(?:episode|ep)[-\s_]*(\d+)(?:\D*$)/i) || text.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function cleanSeriesTitle(value) {
  return decodeHtml(value).replace(/\s+(?:episode|ep)\s*\d+.*$/i, "").replace(/\s*[-–—:]\s*(?:episode|ep)\s*\d+.*$/i, "").trim();
}

function mediaUrlsFromHtml(html) {
  if (!html) return [];
  const normalized = String(html).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const urls = normalized.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
  return [...new Set(urls.map((url) => url.replace(/[),;]+$/, "")).filter((url) => /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url)))];
}

function videoSlugVariations(episodeSlug) {
  const base = String(episodeSlug || "").replace(/-episode-(\d+)$/i, "-$1");
  const out = [base];
  for (const prefix of ["ova-", "ona-", "special-"]) if (base.toLowerCase().startsWith(prefix)) out.unshift(base.slice(prefix.length));
  if (/^1ldk-jk-/i.test(base)) out.unshift(base.replace(/^1ldk-jk-/i, "1ldk-+-jk-"));
  return [...new Set(out.filter(Boolean))];
}

function toStream(url) {
  const quality = String(url).match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i)?.[1];
  const container = /\.m3u8(?:[?#]|$)/i.test(url) ? "HLS" : /\.mp4(?:[?#]|$)/i.test(url) ? "MP4" : "";
  const details = [quality ? `${quality}p` : "", container].filter(Boolean).join(" • ");
  return { name: details ? `${PROVIDER_NAME} • ${details}` : PROVIDER_NAME, title: details ? `${PROVIDER_NAME} • ${details}` : PROVIDER_NAME, url, provider: PROVIDER_NAME };
}

async function safeFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, skipSizeCheck: true, headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9", ...(options.headers || {}) } });
  } catch (_) { return null; }
}

async function getCatalogMeta(inputId) {
  if (!/^(mal|anilist|sp):/i.test(String(inputId || ""))) return { meta: null, error: `unsupported id ${inputId}` };
  const url = `${CATALOG_BASE}/meta/series/${encodeURIComponent(inputId)}.json`;
  const response = await safeFetch(url, { headers: { Accept: "application/json" } });
  if (!response) return { meta: null, error: "catalog request failed" };
  if (!response.ok) return { meta: null, error: `catalog HTTP ${response.status}` };
  try {
    const payload = await response.json();
    return payload && payload.meta ? { meta: payload.meta, error: "" } : { meta: null, error: "catalog meta missing" };
  } catch (_) { return { meta: null, error: "catalog invalid JSON" }; }
}

async function searchHentaiTv(title) {
  const endpoint = `${HENTAITV_BASE}/wp-json/wp/v2/episodes?search=${encodeURIComponent(title)}&per_page=50&_fields=id,slug,title,date`;
  const response = await safeFetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response) return { rows: [], error: "search request failed" };
  if (!response.ok) return { rows: [], error: `search HTTP ${response.status}` };
  let payload;
  try { payload = await response.json(); } catch (_) { return { rows: [], error: "search invalid JSON" }; }
  if (!Array.isArray(payload)) return { rows: [], error: "search payload unexpected" };

  const grouped = new Map();
  for (const item of payload) {
    const slug = String(item && item.slug || "");
    const rendered = decodeHtml(item && item.title && item.title.rendered || "");
    if (!slug || !rendered) continue;
    const episodeNumber = parseEpisodeNumber(slug) || parseEpisodeNumber(rendered);
    const seriesTitle = cleanSeriesTitle(rendered);
    if (!seriesTitle) continue;
    const key = normalize(seriesTitle);
    if (!grouped.has(key)) grouped.set(key, { title: seriesTitle, episodes: {}, score: scoreTitle(title, seriesTitle) });
    if (episodeNumber) grouped.get(key).episodes[episodeNumber] = slug;
  }
  return { rows: [...grouped.values()].filter((item) => item.score >= 0.45).sort((a, b) => b.score - a.score), error: "" };
}

function titleQueries(name) {
  const raw = clean(name), out = [];
  function add(v) { v = clean(v); if (v && !out.includes(v)) out.push(v); }
  add(raw);
  add(raw.split(/[:–—]/)[0]);
  const words = raw.replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) add(words.slice(0, Math.min(4, words.length)).join(" "));
  if (words.length) add(words[0]);
  return out;
}

async function resolveEpisodeSlug(meta, episode) {
  let lastError = "";
  for (const query of titleQueries(meta.name)) {
    const result = await searchHentaiTv(query);
    if (result.error) lastError = result.error;
    for (const match of result.rows) if (match.episodes && match.episodes[episode]) return { slug: match.episodes[episode], query, match: match.title, error: "" };
  }
  return { slug: null, query: titleQueries(meta.name).join(" | "), match: "", error: lastError || "no title/episode match" };
}

async function resolveStreamsFromSlug(slug) {
  const pageUrl = `${HENTAITV_BASE}/hentai/${slug}/`;
  const page = await safeFetch(pageUrl, { headers: { Accept: "text/html,*/*;q=0.8", Cookie: "inter=1" } });
  if (page && page.ok) {
    try { const direct = mediaUrlsFromHtml(await page.text()).map(toStream); if (direct.length) return { streams: direct, error: "" }; } catch (_) {}
  }
  for (const videoSlug of videoSlugVariations(slug)) {
    const url = `https://r2.1hanime.com/${videoSlug}.mp4`;
    const head = await safeFetch(url, { method: "HEAD", redirect: "follow" });
    if (head && head.ok) return { streams: [toStream(url)], error: "" };
    if (head && (head.status === 403 || head.status === 405)) {
      const ranged = await safeFetch(url, { method: "GET", redirect: "follow", headers: { Range: "bytes=0-0" } });
      if (ranged && (ranged.ok || ranged.status === 206)) return { streams: [toStream(url)], error: "" };
    }
  }
  return { streams: [], error: page ? `no media source; page HTTP ${page.status}` : "episode page request failed" };
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    if (!/^(mal|anilist|sp):/i.test(String(inputId || ""))) return [diag("ID", `unsupported input=${inputId} type=${mediaType}`)];
    const ep = Number.isInteger(Number(episode)) && Number(episode) > 0 ? Number(episode) : 1;
    const catalog = await getCatalogMeta(inputId);
    if (!catalog.meta || !catalog.meta.name) return [diag("CATALOG", `${catalog.error || "metadata unavailable"} • id=${inputId}`)];
    const resolved = await resolveEpisodeSlug(catalog.meta, ep);
    if (!resolved.slug) return [diag("MATCH", `${resolved.error} • title=${catalog.meta.name} • ep=${ep} • queries=${resolved.query}`)];
    const playback = await resolveStreamsFromSlug(resolved.slug);
    if (!playback.streams.length) return [diag("PLAYBACK", `${playback.error} • slug=${resolved.slug} • match=${resolved.match}`)];
    return playback.streams;
  } catch (error) {
    return [diag("ERROR", clean(error && error.message ? error.message : error) || "unexpected provider failure")];
  }
}

module.exports = { getStreams };