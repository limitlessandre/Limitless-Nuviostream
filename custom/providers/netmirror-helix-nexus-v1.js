"use strict";

// NetMirror Helix experimental provider.
// Purpose: device-test Net27's cold variant-aware MP4 path without touching production NetMirror.
// This provider deliberately fails closed on title/episode identity mismatches and never uses the slow mobile bootstrap.

const NAME = "NetMirror Helix";
const BASE = "https://net27.cc";
const API_REFERER = "https://net27.cc/";
const PLAYBACK_REFERER = "https://videodownloader.site/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function clean(v) { return String(v == null ? "" : v).trim(); }
function integer(v) { const m = clean(v).match(/-?\d+/); return m ? Number(m[0]) : null; }
function norm(v) {
  let s = clean(v);
  try { s = s.normalize("NFKD"); } catch (_) {}
  return s.replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[’'`]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function qualityLabel(h) {
  h = Number(h) || 0;
  if (h >= 4320) return `2x4K 8K ${h}p`;
  if (h >= 2160) return `4K ${h}p`;
  if (h >= 1440) return `Enhanced QHD ${h}p`;
  if (h >= 1080) return `FHD ${h}p`;
  if (h >= 720) return `HD ${h}p`;
  if (h >= 540) return `HD-Low ${h}p`;
  if (h >= 480) return `SD ${h}p`;
  if (h >= 360) return `SD-Low ${h}p`;
  return h ? `SD-Very Low ${h}p` : "Unknown Auto";
}
async function json(url) {
  const r = await fetch(url, { headers: { Accept: "application/json, text/plain, */*", Referer: API_REFERER, "User-Agent": UA } });
  if (!r || r.ok === false) throw new Error(`HTTP ${r && r.status || "error"}`);
  return typeof r.json === "function" ? r.json() : JSON.parse(await r.text());
}
function identity(data, tmdbId, type, season, episode) {
  if (!data || data.ok !== true) return false;
  if (data.tmdbId != null && Number(data.tmdbId) !== tmdbId) return false;
  if (type === "tv") {
    if (integer(data.currentSeason) !== season || integer(data.currentEpisode) !== episode) return false;
  }
  return true;
}
function subtitle(c) {
  let url = clean(c && c.url);
  if (!url) return null;
  if (url.startsWith("/")) url = BASE + url;
  let language = clean(c.lang || c.language).toLowerCase().replace(/_/g, "-");
  if (language === "in-id") language = "id";
  language = language.replace(/[^a-z0-9-]/g, "") || "und";
  return {
    url,
    language,
    name: clean(c.name) || language,
    headers: { Referer: API_REFERER, "User-Agent": UA }
  };
}
function chooseVariant(variants) {
  const rows = Array.isArray(variants) ? variants.filter(Boolean) : [];
  const englishDub = rows.find(v => /english\s*dub/i.test(clean(v.language)));
  if (englishDub) return englishDub;
  const english = rows.find(v => /\benglish\b/i.test(clean(v.language)));
  if (english) return english;
  return rows.find(v => /^default$/i.test(clean(v.language))) || rows[0] || null;
}
function variantQuery(v) {
  if (!v) return "";
  const p = [];
  if (v.dubSubjectId != null) p.push("dubSubjectId=" + encodeURIComponent(v.dubSubjectId));
  if (clean(v.detailPath)) p.push("detailPath=" + encodeURIComponent(v.detailPath));
  return p.length ? "&" + p.join("&") : "";
}
function tagFor(v, subtitles) {
  const label = clean(v && v.language);
  if (/english\s*dub/i.test(label)) return subtitles.length ? "[DUB+SUB]" : "[DUB]";
  return "[UNK]";
}

async function getStreams(inputId, mediaType = "movie", season = 1, episode = 1) {
  const tmdbId = integer(clean(inputId).replace(/^tmdb:/i, ""));
  const type = clean(mediaType).toLowerCase() === "tv" ? "tv" : "movie";
  const s = type === "tv" ? integer(season) : null;
  const e = type === "tv" ? integer(episode) : null;
  if (!tmdbId || (type === "tv" && (!s || !e))) return [];

  let variant = null;
  if (type === "tv") {
    try {
      const vd = await json(`${BASE}/api/variants-tmdb/tv/${tmdbId}?se=${s}&ep=${e}`);
      variant = chooseVariant(vd && vd.variants);
    } catch (_) {}
  }

  const basePath = type === "tv"
    ? `${BASE}/api/embed-tmdb/${tmdbId}?type=tv&se=${s}&ep=${e}`
    : `${BASE}/api/embed-tmdb/${tmdbId}?type=movie`;
  let data;
  try { data = await json(basePath + variantQuery(variant)); }
  catch (_) { return []; }
  if (!identity(data, tmdbId, type, s, e)) return [];

  // Stage-5 found a false-positive Teach response whose IDs matched but title did not.
  // When the API exposes no source, fail closed rather than manufacturing a row.
  if (data.noSource === true || clean(data.mode).toLowerCase() === "none") return [];

  const subtitles = (Array.isArray(data.captions) ? data.captions : []).map(subtitle).filter(Boolean);
  const tag = tagFor(variant, subtitles);
  const variantLabel = clean(variant && variant.language) || "Default";
  const headers = { Referer: PLAYBACK_REFERER, "User-Agent": UA };
  const streams = Array.isArray(data.streams) ? data.streams.filter(x => x && /^https?:\/\//i.test(clean(x.url))) : [];
  const rows = streams.map(stream => {
    const h = integer(stream.resolution);
    return {
      name: `${NAME} • ${qualityLabel(h)} • ${tag} • ${variantLabel}`,
      title: clean(data.title),
      url: clean(stream.url),
      quality: h ? `${h}p` : "Auto",
      type: "video",
      headers,
      subtitles,
      provider: "netmirror-helix",
      audioLanguage: /english/i.test(variantLabel) ? "en" : "",
      audioType: /dub/i.test(variantLabel) ? "dub" : ""
    };
  });
  if (!rows.length && /^https?:\/\//i.test(clean(data.mp4))) {
    const h = integer(data.resolution);
    rows.push({
      name: `${NAME} • ${qualityLabel(h)} • ${tag} • ${variantLabel}`,
      title: clean(data.title), url: clean(data.mp4), quality: h ? `${h}p` : "Auto",
      type: "video", headers, subtitles, provider: "netmirror-helix",
      audioLanguage: /english/i.test(variantLabel) ? "en" : "",
      audioType: /dub/i.test(variantLabel) ? "dub" : ""
    });
  }
  return rows.sort((a,b) => integer(b.quality) - integer(a.quality));
}

async function onSettings() { return []; }

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
