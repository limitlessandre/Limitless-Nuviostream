"use strict";

// Limitless Nexus standalone KissKH provider v0.1.0
// No runtime dependency on Eclipsia/Codeberg. Uses KissKH APIs directly plus
// EncDec's maintained KissKH token/decryption service.

const PROVIDER_NAME = "KissKH Standalone";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const ENC_API = "https://enc-dec.app/api";
const DOMAINS = [
  "https://kisskh.ovh",
  "https://kisskh.do",
  "https://kisskh.co",
  "https://kisskh.id",
  "https://kisskh.la"
];
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function clean(v) { return String(v == null ? "" : v).trim(); }
function mediaTypeOf(v) { return String(v || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function yearOf(v) { const m = clean(v).match(/(?:19|20)\d{2}/); return m ? Number(m[0]) : 0; }
function normalizeTitle(v) {
  let s = clean(v).toLowerCase();
  try { s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return s
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function slugify(v) {
  let s = clean(v).toLowerCase();
  try { s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
function uniquePush(arr, v) { const s = clean(v); if (s && !arr.includes(s)) arr.push(s); }
function absoluteUrl(base, value) {
  try { return new URL(clean(value), base).href; } catch (_) { return clean(value); }
}
function languageName(code) {
  const c = clean(code).toLowerCase();
  const map = { ja: "Japanese", ko: "Korean", zh: "Chinese", th: "Thai", en: "English", id: "Indonesian" };
  return map[c] || clean(code) || "Unknown";
}
function subtitleLanguage(label) {
  const l = clean(label);
  if (/indonesia/i.test(l)) return "Indonesian";
  return l || "Unknown";
}

async function requestJson(url, headers) {
  try {
    const r = await fetch(url, { headers: headers || {}, redirect: "follow", skipSizeCheck: true });
    if (!r || !r.ok) return { ok: false, status: Number(r && r.status || 0), data: null };
    return { ok: true, status: Number(r.status || 200), data: await r.json() };
  } catch (_) { return { ok: false, status: 0, data: null }; }
}
async function requestText(url, headers) {
  try {
    const r = await fetch(url, { headers: headers || {}, redirect: "follow", skipSizeCheck: true });
    if (!r || !r.ok) return { ok: false, status: Number(r && r.status || 0), text: "" };
    return { ok: true, status: Number(r.status || 200), text: String(await r.text() || "") };
  } catch (_) { return { ok: false, status: 0, text: "" }; }
}
function siteHeaders(base, referer) {
  return {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Referer": referer || (base + "/"),
    "Origin": base
  };
}
function playbackHeaders(base) {
  return { "User-Agent": USER_AGENT, "Referer": base + "/", "Origin": base };
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
  const r = await requestJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,external_ids`);
  if (!r.ok || !r.data) return null;
  const d = r.data;
  const title = type === "movie" ? clean(d.title || d.original_title) : clean(d.name || d.original_name);
  const original = type === "movie" ? clean(d.original_title || d.title) : clean(d.original_name || d.name);
  const aliases = [];
  uniquePush(aliases, title); uniquePush(aliases, original);
  const alt = d.alternative_titles && (d.alternative_titles.titles || d.alternative_titles.results);
  if (Array.isArray(alt)) for (const item of alt) uniquePush(aliases, item && (item.title || item.name));
  return {
    id: Number(tmdbId), title, aliases: aliases.slice(0, 20),
    year: yearOf(type === "movie" ? d.release_date : d.first_air_date),
    episodeCount: Number(d.number_of_episodes || 0),
    originalLanguage: clean(d.original_language)
  };
}
function aliasSet(meta) { return new Set((meta.aliases || []).map(normalizeTitle).filter(Boolean)); }
function exactOwnedTitle(candidate, meta) { return aliasSet(meta).has(normalizeTitle(candidate)); }
function searchTerms(meta) {
  const out = [];
  for (const alias of meta.aliases || []) {
    uniquePush(out, alias);
    uniquePush(out, alias.replace(/[-‐‑‒–—]+/g, " ").replace(/\s+/g, " "));
    uniquePush(out, alias.replace(/[-‐‑‒–—]+/g, "").replace(/\s+/g, " "));
    if (out.length >= 12) break;
  }
  return out.slice(0, 12);
}
async function exactCandidates(base, meta) {
  const found = [];
  const seen = new Set();
  for (const term of searchTerms(meta)) {
    const r = await requestJson(`${base}/api/DramaList/Search?q=${encodeURIComponent(term)}&type=0`, siteHeaders(base));
    if (!r.ok || !Array.isArray(r.data)) continue;
    for (const item of r.data) {
      if (!item || !item.id || !exactOwnedTitle(item.title, meta)) continue;
      const key = String(item.id);
      if (!seen.has(key)) { seen.add(key); found.push(item); }
    }
    if (found.length) break;
  }
  return found;
}
async function detailFor(base, item) {
  if (!item || !item.id) return null;
  const r = await requestJson(`${base}/api/DramaList/Drama/${encodeURIComponent(item.id)}?isq=false`, siteHeaders(base));
  return r.ok && r.data ? r.data : null;
}
function scoreDetail(detail, meta) {
  if (!detail || !exactOwnedTitle(detail.title, meta)) return -1;
  let score = 100;
  const y = yearOf(detail.releaseDate);
  if (y && meta.year && y === meta.year) score += 20;
  const count = Array.isArray(detail.episodes) ? detail.episodes.length : Number(detail.episodesCount || 0);
  if (count && meta.episodeCount && count === meta.episodeCount) score += 10;
  return score;
}
function pickEpisode(detail, type, season, episode) {
  const eps = Array.isArray(detail && detail.episodes) ? detail.episodes.slice() : [];
  if (!eps.length) return null;
  eps.sort((a, b) => Number(a && a.number || 0) - Number(b && b.number || 0));
  if (type === "movie") return eps[eps.length - 1] || eps[0];
  if (Number(season || 1) !== 1) return null;
  const wanted = Number(episode || 1);
  return eps.find(ep => Number(ep && ep.number) === wanted) || null;
}
function episodeReferer(base, detail, item, ep, episode) {
  return `${base}/Drama/${slugify(detail.title || item.title)}/Episode-${Number(episode || ep.number || 1)}?id=${encodeURIComponent(item.id)}&ep=${encodeURIComponent(ep.id)}&page=0&pageSize=100`;
}

async function encToken(id, type) {
  const r = await requestJson(`${ENC_API}/enc-kisskh?text=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`, { "User-Agent": USER_AGENT, "Accept": "application/json" });
  const result = clean(r.data && r.data.result);
  return r.ok && Number(r.data && r.data.status) === 200 && result ? result : "";
}
async function episodeSources(base, epId, referer) {
  const key = await encToken(epId, "vid");
  if (!key) return null;
  const url = `${base}/api/DramaList/Episode/${encodeURIComponent(epId)}.png?err=false&ts=&time=&kkey=${encodeURIComponent(key)}`;
  const r = await requestJson(url, siteHeaders(base, referer));
  return r.ok && r.data ? r.data : null;
}
async function subtitleTracks(base, epId) {
  const key = await encToken(epId, "sub");
  if (!key) return [];
  const r = await requestJson(`${base}/api/Sub/${encodeURIComponent(epId)}?kkey=${encodeURIComponent(key)}`, siteHeaders(base));
  if (!r.ok || !Array.isArray(r.data)) return [];
  const out = [];
  const seen = new Set();
  for (const item of r.data) {
    const src = clean(item && item.src);
    if (!/^https?:\/\//i.test(src)) continue;
    const label = subtitleLanguage(item && item.label);
    const url = /\.txt(?:\d)?(?:$|[?#])/i.test(src)
      ? `${ENC_API}/dec-kisskh?url=${encodeURIComponent(src)}`
      : src;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, language: label, name: label });
  }
  return out;
}

function collectSources(data) {
  const out = [];
  const seen = new Set();
  for (const key of ["Video", "Video_tmp", "ThirdParty"]) {
    const url = clean(data && data[key]);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url); out.push({ key, url });
  }
  return out;
}
function inferHeight(text) {
  const m = clean(text).match(/(?:^|[^0-9])(4320|2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}
function qualityTier(h) {
  const n = Number(h || 0);
  if (n >= 4320) return `2x4K 8K ${n}p`;
  if (n >= 2160) return `4K ${n}p`;
  if (n >= 1440) return `Enhanced QHD ${n}p`;
  if (n >= 1080) return `FHD ${n}p`;
  if (n >= 720) return `HD ${n}p`;
  if (n >= 540) return `HD-Low ${n}p`;
  if (n >= 480) return `SD ${n}p`;
  if (n >= 360) return `SD-Low ${n}p`;
  if (n > 0) return `SD-Very Low ${n}p`;
  return "Unknown Auto";
}
function parseMaster(text, baseUrl) {
  if (!/#EXT-X-STREAM-INF/i.test(text || "")) return [];
  const lines = String(text).split(/\r?\n/); const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/#EXT-X-STREAM-INF/i.test(lines[i])) continue;
    const res = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
    let j = i + 1;
    while (j < lines.length && (!clean(lines[j]) || clean(lines[j]).startsWith("#"))) j++;
    if (j >= lines.length) continue;
    const url = absoluteUrl(baseUrl, clean(lines[j]));
    if (/^https?:\/\//i.test(url)) out.push({ url, height: res ? Number(res[1]) : inferHeight(url) });
  }
  return out;
}
async function directChoices(source, headers) {
  const url = source.url;
  if (/\.m3u8(?:$|[?#])/i.test(url)) {
    const r = await requestText(url, { ...headers, "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*" });
    if (!r.ok) return [];
    const variants = parseMaster(r.text, url);
    if (variants.length) return variants.map(v => ({ ...v, key: source.key, type: "m3u8" }));
    if (/#EXTM3U/i.test(r.text)) return [{ url, height: inferHeight(url), key: source.key, type: "m3u8" }];
    return [];
  }
  if (/\.mp4(?:$|[?#])/i.test(url)) return [{ url, height: inferHeight(url), key: source.key, type: "mp4" }];
  return [];
}
function sourceTag(key) {
  if (key === "Video_tmp") return "Fallback";
  if (key === "ThirdParty") return "ThirdParty";
  return "";
}
function rowName(height, subtitles, key) {
  const bits = [PROVIDER_NAME, qualityTier(height)];
  if (subtitles && subtitles.length) bits.push("[SUB]");
  const tag = sourceTag(key); if (tag) bits.push(tag);
  return bits.join(" • ");
}

async function resolveOnDomain(base, meta, type, season, episode) {
  const candidates = await exactCandidates(base, meta);
  if (!candidates.length) return [];
  let best = null;
  for (const item of candidates.slice(0, 4)) {
    const detail = await detailFor(base, item);
    const score = scoreDetail(detail, meta);
    if (score < 100) continue;
    if (!best || score > best.score) best = { item, detail, score };
  }
  if (!best) return [];
  const target = pickEpisode(best.detail, type, season, episode);
  if (!target || !target.id) return [];
  const referer = episodeReferer(base, best.detail, best.item, target, episode);
  const data = await episodeSources(base, target.id, referer);
  if (!data) return [];
  const subs = await subtitleTracks(base, target.id);
  const headers = playbackHeaders(base);
  const rows = [];
  const seen = new Set();
  for (const source of collectSources(data)) {
    const choices = await directChoices(source, headers);
    for (const c of choices) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      rows.push({
        name: rowName(c.height, subs, c.key),
        title: `${best.detail.title || best.item.title} • Episode ${target.number || episode || 1}`,
        url: c.url,
        quality: c.height ? `${c.height}p` : "Auto",
        language: languageName(meta.originalLanguage),
        headers,
        provider: PROVIDER_NAME,
        type: c.type,
        subtitles: subs
      });
    }
  }
  return rows;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [];
  const meta = await tmdbInfo(tmdbId, type);
  if (!meta || !meta.title) return [];
  if (type === "tv" && Number(season || 1) !== 1) return [];

  // Domain failover is sequential and fail-closed. The first domain that produces
  // an exact-owned, playable episode wins; stale/search-only mirrors are skipped.
  for (const base of DOMAINS) {
    const rows = await resolveOnDomain(base, meta, type, season, episode);
    if (rows.length) return rows;
  }
  return [];
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
