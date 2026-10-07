"use strict";

// NetMirror production provider.
// Fast Net27/Aoneroom path. Emits independently verified Original + English Dub rows.
// Never uses the slow mobile bootstrap and fails closed when a requested subject is not returned.

const NAME = "NetMirror";
const BASE = "https://net27.cc";
const AONE = "https://h5-api.aoneroom.com";
const API_REFERER = "https://net27.cc/";
const PLAYBACK_REFERER = "https://videodownloader.site/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";

function clean(v) { return String(v == null ? "" : v).trim(); }
function integer(v) { const m = clean(v).match(/-?\d+/); return m ? Number(m[0]) : null; }
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
async function json(url, extraHeaders) {
  const r = await fetch(url, { headers: { Accept: "application/json, text/plain, */*", Referer: API_REFERER, "User-Agent": UA, ...(extraHeaders || {}) } });
  if (!r || r.ok === false) throw new Error(`HTTP ${r && r.status || "error"}`);
  return typeof r.json === "function" ? r.json() : JSON.parse(await r.text());
}
function identity(data, tmdbId, type, season, episode) {
  if (!data || data.ok !== true) return false;
  if (data.tmdbId != null && Number(data.tmdbId) !== tmdbId) return false;
  if (type === "tv" && (integer(data.currentSeason) !== season || integer(data.currentEpisode) !== episode)) return false;
  return true;
}
function subtitle(c) {
  let url = clean(c && c.url);
  if (!url) return null;
  if (url.startsWith("/")) url = BASE + url;
  let language = clean(c.lang || c.language).toLowerCase().replace(/_/g, "-");
  if (language === "in-id") language = "id";
  language = language.replace(/[^a-z0-9-]/g, "") || "und";
  return { url, language, name: clean(c.name) || language, headers: { Referer: API_REFERER, "User-Agent": UA } };
}
function sameSubject(data, variant) {
  if (!variant) return true;
  if (variant.dubSubjectId != null && data.subjectId != null && String(data.subjectId) !== String(variant.dubSubjectId)) return false;
  if (clean(variant.detailPath) && clean(data.detailPath) && clean(data.detailPath) !== clean(variant.detailPath)) return false;
  return true;
}
function queryFor(variant, defaults) {
  if (!variant) return "";
  const p = [];
  const sid = variant.dubSubjectId;
  const dp = clean(variant.detailPath);
  if (sid != null) {
    p.push("dubSubjectId=" + encodeURIComponent(sid));
    p.push("dub=" + encodeURIComponent(sid));
  }
  if (dp) {
    p.push("detailPath=" + encodeURIComponent(dp));
    p.push("dubdp=" + encodeURIComponent(dp));
  }
  if (defaults && defaults.defaultSubjectId != null) p.push("sid=" + encodeURIComponent(defaults.defaultSubjectId));
  if (defaults && clean(defaults.defaultDetailPath)) p.push("dp=" + encodeURIComponent(defaults.defaultDetailPath));
  return p.length ? "&" + p.join("&") : "";
}
async function enrichEnglishVariant(vd, variant) {
  if (!variant || !vd || !clean(vd.defaultDetailPath)) return variant;
  try {
    const d = await json(AONE + "/wefeed-h5api-bff/detail?detailPath=" + encodeURIComponent(vd.defaultDetailPath), {
      Origin: BASE, Referer: API_REFERER
    });
    const dubs = d && d.data && d.data.subject && Array.isArray(d.data.subject.dubs) ? d.data.subject.dubs : [];
    const exact = dubs.find(x => String(x && x.subjectId) === String(variant.dubSubjectId));
    if (exact && clean(exact.detailPath)) return { ...variant, detailPath: clean(exact.detailPath), lanCode: clean(exact.lanCode), verifiedDub: true };
  } catch (_) {}
  return variant;
}
function tagFor(kind, subtitles, originalLanguage) {
  if (kind === "english" || (kind === "original" && originalLanguage === "en"))
    return subtitles.length ? "[DUB+SUB]" : "[DUB]";
  return subtitles.length ? "[SUB]" : "[UNK]";
}
async function tmdbOriginalLanguage(tmdbId, type) {
  try {
    const data = await json(`${TMDB_API_URL}/${type === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`);
    return clean(data && data.original_language).toLowerCase();
  } catch (_) { return ""; }
}
function rowsFor(data, variant, kind, originalLanguage) {
  const subtitles = (Array.isArray(data.captions) ? data.captions : []).map(subtitle).filter(Boolean);
  const tag = tagFor(kind, subtitles, originalLanguage);
  const label = kind === "english" ? "English Dub" : "Original";
  const headers = { Referer: PLAYBACK_REFERER, "User-Agent": UA };
  const streams = Array.isArray(data.streams) ? data.streams.filter(x => x && /^https?:\/\//i.test(clean(x.url))) : [];
  const rows = streams.map(stream => {
    const h = integer(stream.resolution);
    return {
      name: `${NAME} • ${qualityLabel(h)} • ${tag} • ${label}`,
      title: clean(data.title), url: clean(stream.url), quality: h ? `${h}p` : "Auto",
      type: "video", headers, subtitles, provider: "netmirror",
      audioLanguage: kind === "english" ? "en" : "", audioType: kind === "english" ? "dub" : "original"
    };
  });
  if (!rows.length && /^https?:\/\//i.test(clean(data.mp4))) {
    const h = integer(data.resolution);
    rows.push({
      name: `${NAME} • ${qualityLabel(h)} • ${tag} • ${label}`,
      title: clean(data.title), url: clean(data.mp4), quality: h ? `${h}p` : "Auto",
      type: "video", headers, subtitles, provider: "netmirror",
      audioLanguage: kind === "english" ? "en" : "", audioType: kind === "english" ? "dub" : "original"
    });
  }
  return rows;
}

async function getStreams(inputId, mediaType = "movie", season = 1, episode = 1) {
  const tmdbId = integer(clean(inputId).replace(/^tmdb:/i, ""));
  const type = clean(mediaType).toLowerCase() === "tv" ? "tv" : "movie";
  const s = type === "tv" ? integer(season) : null;
  const e = type === "tv" ? integer(episode) : null;
  if (!tmdbId || (type === "tv" && (!s || !e))) return [];

  const originalLanguage = await tmdbOriginalLanguage(tmdbId, type);

  const basePath = type === "tv"
    ? `${BASE}/api/embed-tmdb/${tmdbId}?type=tv&se=${s}&ep=${e}`
    : `${BASE}/api/embed-tmdb/${tmdbId}?type=movie`;

  // Movies currently keep the old single-path behavior until variant topology is proven there.
  if (type !== "tv") {
    try {
      const data = await json(basePath);
      if (!identity(data, tmdbId, type, s, e) || data.noSource === true || clean(data.mode).toLowerCase() === "none") return [];
      return rowsFor(data, null, "original", originalLanguage).sort((a,b) => integer(b.quality) - integer(a.quality));
    } catch (_) { return []; }
  }

  let vd;
  try { vd = await json(`${BASE}/api/variants-tmdb/tv/${tmdbId}?se=${s}&ep=${e}`); }
  catch (_) { return []; }
  const variants = Array.isArray(vd && vd.variants) ? vd.variants.filter(Boolean) : [];
  const original = variants.find(v => String(v.dubSubjectId) === String(vd.defaultSubjectId))
    || variants.find(v => /^default$/i.test(clean(v.language))) || null;
  let english = variants.find(v => /english\s*dub/i.test(clean(v.language))) || null;
  english = await enrichEnglishVariant(vd, english);

  const requests = [];
  if (english) requests.push({ variant: english, kind: "english" });
  if (original) requests.push({ variant: original, kind: "original" });
  if (!requests.length) requests.push({ variant: null, kind: "original" });

  const out = [];
  for (const req of requests) {
    try {
      const data = await json(basePath + queryFor(req.variant, vd));
      if (!identity(data, tmdbId, type, s, e)) continue;
      if (data.noSource === true || clean(data.mode).toLowerCase() === "none") continue;
      // Critical Stage-6 guard: a dub row exists only if Net27 actually returned that exact dub subject/path.
      if (!sameSubject(data, req.variant)) continue;
      out.push(...rowsFor(data, req.variant, req.kind, originalLanguage));
    } catch (_) {}
  }

  // English first, then original; highest resolution first within each lane.
  return out.sort((a,b) => {
    const ae = a.audioType === "dub" ? 1 : 0, be = b.audioType === "dub" ? 1 : 0;
    return be - ae || integer(b.quality) - integer(a.quality);
  });
}

async function onSettings() { return []; }

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
