"use strict";

const PROVIDER_NAME = "Scarlet Peach - HentaiTV";
const CATALOG_BASE = "https://scarlet-peach-catalog.limitlessandre.workers.dev";
const HENTAITV_BASE = "https://hentai.tv";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|animation|ova)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreTitle(target, candidate) {
  const a = normalize(target);
  const b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(left.size, right.size, 1);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseEpisodeNumber(value) {
  const text = String(value || "");
  const match = text.match(/(?:episode|ep)[-\s_]*(\d+)(?:\D*$)/i) || text.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function cleanSeriesTitle(value) {
  return decodeHtml(value)
    .replace(/\s+(?:episode|ep)\s*\d+.*$/i, "")
    .replace(/\s*[-–—:]\s*(?:episode|ep)\s*\d+.*$/i, "")
    .trim();
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
  for (const prefix of ["ova-", "ona-", "special-"]) {
    if (base.toLowerCase().startsWith(prefix)) out.unshift(base.slice(prefix.length));
  }
  if (/^1ldk-jk-/i.test(base)) out.unshift(base.replace(/^1ldk-jk-/i, "1ldk-+-jk-"));
  return [...new Set(out.filter(Boolean))];
}

function toStream(url) {
  const quality = String(url).match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i)?.[1];
  const container = /\.m3u8(?:[?#]|$)/i.test(url) ? "HLS" : /\.mp4(?:[?#]|$)/i.test(url) ? "MP4" : "";
  const details = [quality ? `${quality}p` : "", container].filter(Boolean).join(" • ");
  return { name: details ? `${PROVIDER_NAME} • ${details}` : PROVIDER_NAME, title: details ? `${PROVIDER_NAME} • ${details}` : PROVIDER_NAME, url };
}

async function safeFetch(url, options = {}) {
  try {
    return await fetch(url, {
      ...options,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        ...(options.headers || {})
      }
    });
  } catch (_) {
    return null;
  }
}

async function getCatalogMeta(inputId) {
  if (!/^(mal|anilist|sp):/i.test(String(inputId || ""))) return null;
  const url = `${CATALOG_BASE}/meta/series/${encodeURIComponent(inputId)}.json`;
  const response = await safeFetch(url, { headers: { Accept: "application/json" } });
  if (!response || !response.ok) return null;
  try {
    const payload = await response.json();
    return payload && payload.meta ? payload.meta : null;
  } catch (_) {
    return null;
  }
}

async function searchHentaiTv(title) {
  const endpoint = `${HENTAITV_BASE}/wp-json/wp/v2/episodes?search=${encodeURIComponent(title)}&per_page=50&_fields=id,slug,title,date`;
  const response = await safeFetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response || !response.ok) return [];

  let payload;
  try { payload = await response.json(); } catch (_) { return []; }
  if (!Array.isArray(payload)) return [];

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

  return [...grouped.values()].filter((item) => item.score >= 0.55).sort((a, b) => b.score - a.score);
}

async function resolveEpisodeSlug(meta, episode) {
  const searches = [meta.name].filter(Boolean);
  for (const query of searches) {
    const matches = await searchHentaiTv(query);
    for (const match of matches) {
      if (match.episodes && match.episodes[episode]) return match.episodes[episode];
    }
  }
  return null;
}

async function resolveStreamsFromSlug(slug) {
  const pageUrl = `${HENTAITV_BASE}/hentai/${slug}/`;
  const page = await safeFetch(pageUrl, { headers: { Accept: "text/html,*/*;q=0.8", Cookie: "inter=1" } });
  if (page && page.ok) {
    try {
      const html = await page.text();
      const direct = mediaUrlsFromHtml(html).map(toStream);
      if (direct.length) return direct;
    } catch (_) {}
  }

  for (const videoSlug of videoSlugVariations(slug)) {
    const url = `https://r2.1hanime.com/${videoSlug}.mp4`;
    const head = await safeFetch(url, { method: "HEAD", redirect: "follow" });
    if (head && head.ok) return [toStream(url)];
    if (head && (head.status === 403 || head.status === 405)) {
      const ranged = await safeFetch(url, { method: "GET", redirect: "follow", headers: { Range: "bytes=0-0" } });
      if (ranged && (ranged.ok || ranged.status === 206)) return [toStream(url)];
    }
  }
  return [];
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    if (!/^(mal|anilist|sp):/i.test(String(inputId || ""))) return [];
    const ep = Number.isInteger(Number(episode)) && Number(episode) > 0 ? Number(episode) : 1;
    const meta = await getCatalogMeta(inputId);
    if (!meta || !meta.name) return [];
    const slug = await resolveEpisodeSlug(meta, ep);
    if (!slug) return [];
    return await resolveStreamsFromSlug(slug);
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
