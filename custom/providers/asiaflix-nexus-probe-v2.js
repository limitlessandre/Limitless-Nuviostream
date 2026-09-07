"use strict";

// AsiaFlix Nexus probe v0.2.1
// Fast probe path: TMDB -> direct AsiaFlix slug/detail -> search fallback -> episode -> stream resolver.
// Avoids re-running the full base provider after diagnostics so Nuvio does not time out on duplicate work.

const PROVIDER_NAME = "AsiaFlix Test";
const BASE_URL = "https://asiaflix.net";
const API_URL = "https://api.asiaflix.net/v1";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const API_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Access-Control": "web"
};
const VIDEO_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Referer": `${BASE_URL}/`,
  "Origin": BASE_URL
};

function clean(value) { return String(value == null ? "" : value).trim(); }
function short(value, limit) {
  const text = clean(value).replace(/\s+/g, " ");
  const max = Number(limit) || 205;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function mediaTypeOf(value) { return String(value || "tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function normalizeTitle(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/\b(the|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function slugify(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function yearOf(value) {
  const m = clean(value).match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}
function languageName(code) {
  const key = clean(code).toLowerCase();
  const names = { ja: "Japanese", ko: "Korean", zh: "Chinese", th: "Thai", tl: "Filipino", fil: "Filipino", en: "English", vi: "Vietnamese", id: "Indonesian", ms: "Malay" };
  return names[key] || (key ? key.toUpperCase() : "Original");
}
function titleTokens(value) { return new Set(normalizeTitle(value).split(" ").filter(token => token.length > 1)); }
function tokenSimilarity(a, b) {
  const aa = titleTokens(a), bb = titleTokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common++;
  return common / Math.max(aa.size, bb.size);
}
function candidateNames(row) {
  let alt = [];
  if (Array.isArray(row && row.altNames)) alt = row.altNames;
  else if (row && typeof row.altNames === "string") alt = [row.altNames];
  return [...new Set([row && row.name, row && row.title, ...alt].map(clean).filter(Boolean))];
}
function candidateYear(row) {
  return yearOf(row && (row.releaseYear || row.year || row.releaseDate || row.aired || row.firstAirDate));
}
function scoreCandidate(row, meta) {
  const names = candidateNames(row);
  if (!names.length) return -100;
  let best = 0;
  for (const expected of meta.aliases || []) {
    const a = normalizeTitle(expected);
    if (!a) continue;
    for (const source of names) {
      const b = normalizeTitle(source);
      if (!b) continue;
      if (a === b) best = Math.max(best, 100);
      else if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) best = Math.max(best, 84);
      else best = Math.max(best, Math.round(tokenSimilarity(a, b) * 76));
    }
  }
  const cy = candidateYear(row);
  if (meta.year && cy) {
    if (meta.year === cy) best += 12;
    else if (Math.abs(meta.year - cy) === 1) best += 3;
    else best -= 22;
  }
  return best;
}
function slugFromRow(row) {
  const direct = clean(row && row.slug);
  if (direct) return direct;
  const url = clean(row && row.url);
  if (url) {
    const m = url.match(/\/drama\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]);
  }
  const id = clean(row && row.id);
  if (id && !/^\d+$/.test(id)) return id;
  return "";
}

async function fetchJson(url, headers) {
  try {
    const response = await fetch(url, { headers: { ...API_HEADERS, ...(headers || {}) }, redirect: "follow", skipSizeCheck: true });
    if (!response) return { ok: false, status: 0, data: null, error: "no response" };
    const status = Number(response.status || 0);
    if (!response.ok) return { ok: false, status, data: null, error: `HTTP ${status || "ERR"}` };
    return { ok: true, status, data: await response.json(), error: "" };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: clean(error && error.message ? error.message : error) || "request error" };
  }
}

async function resolveTmdbId(inputId, type) {
  const raw = clean(inputId);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^tt\d+$/i.test(raw)) return null;
  const r = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, {});
  const list = type === "movie" ? r.data && r.data.movie_results : r.data && r.data.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
}

async function tmdbInfo(tmdbId, type) {
  const r = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,external_ids`, {});
  if (!r.ok || !r.data) return null;
  const data = r.data;
  const title = clean(type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name));
  const original = clean(type === "movie" ? (data.original_title || data.title) : (data.original_name || data.name));
  const altRows = data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results);
  const aliases = [];
  const push = value => { const v = clean(value); if (v && !aliases.includes(v)) aliases.push(v); };
  push(title); push(original);
  if (Array.isArray(altRows)) for (const row of altRows) push(row && (row.title || row.name));
  return {
    id: tmdbId,
    title,
    aliases: aliases.slice(0, 12),
    year: yearOf(type === "movie" ? data.release_date : data.first_air_date),
    language: languageName(data.original_language)
  };
}

async function searchAsiaFlix(query) {
  const url = `${API_URL}/drama/search?q=${encodeURIComponent(query)}&page=1&projections=${encodeURIComponent('["releaseYear","status","altNames"]')}`;
  const r = await fetchJson(url, {});
  if (!r.ok || !r.data) return { ok: false, rows: [], error: r.error || `HTTP ${r.status || "ERR"}` };
  const data = r.data;
  const rows = Array.isArray(data.body) ? data.body : Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
  return { ok: true, rows, error: "" };
}
function fetchDetails(slug) { return fetchJson(`${API_URL}/drama/detail?slug=${encodeURIComponent(slug)}`, {}); }

async function findTarget(meta) {
  const directSlugs = [...new Set((meta.aliases || []).map(slugify).filter(Boolean))].slice(0, 4);
  const directNotes = [];
  for (const slug of directSlugs) {
    const r = await fetchDetails(slug);
    if (!r.ok || !r.data) {
      directNotes.push(`${slug}=${r.error || "no-detail"}`);
      continue;
    }
    const score = scoreCandidate(r.data, meta);
    directNotes.push(`${slug}=HTTP${r.status}/score${score}`);
    if (score >= 70) return { details: r.data, slug, score, via: "direct", notes: directNotes };
  }

  const terms = [...new Set([meta.title, ...(meta.aliases || [])].map(clean).filter(Boolean))].slice(0, 4);
  const candidates = new Map();
  const searchNotes = [];
  for (const term of terms) {
    const result = await searchAsiaFlix(term);
    if (!result.ok) {
      searchNotes.push(`${term}=ERR ${result.error}`);
      continue;
    }
    searchNotes.push(`${term}=${result.rows.length}`);
    for (const item of result.rows) {
      const slug = slugFromRow(item);
      if (!slug) continue;
      const score = scoreCandidate(item, meta);
      const previous = candidates.get(slug);
      if (!previous || score > previous.score) candidates.set(slug, { row: item, score });
    }
    if ([...candidates.values()].some(item => item.score >= 100)) break;
  }

  const ranked = [...candidates.entries()]
    .map(([slug, value]) => ({ slug, row: value.row, score: value.score }))
    .sort((a, b) => b.score - a.score);
  for (const item of ranked.slice(0, 5)) {
    if (item.score < 62) continue;
    const r = await fetchDetails(item.slug);
    if (!r.ok || !r.data) continue;
    const score = Math.max(item.score, scoreCandidate(r.data, meta));
    if (score >= 70) return { details: r.data, slug: item.slug, score, via: "search", notes: searchNotes, ranked };
  }
  return { details: null, via: "none", notes: directNotes, searchNotes, ranked };
}

function findEpisode(details, type, episode) {
  const eps = Array.isArray(details && details.episodes) ? details.episodes : [];
  if (!eps.length) return null;
  if (type === "movie") return eps[0];
  const wanted = Number(episode || 1);
  return eps.find(ep => Math.abs(Number(ep && ep.number) - wanted) < 0.001) || null;
}

function utf8Bytes(value) {
  const encoded = encodeURIComponent(String(value || ""));
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%" && i + 2 < encoded.length) { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  return bytes;
}
function base64Encode(value) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(value);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63] + chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? chars[triple & 63] : "=";
  }
  return out;
}
function isDirectMediaUrl(url) { return /\.(m3u8|mp4|mkv)(?:$|[?#])/i.test(clean(url)); }
async function resolveServer(host) {
  const source = clean(host && host.source) || "Server";
  const hostUrl = clean(host && host.url);
  if (!hostUrl) return [];
  const endpoint = `${API_URL}/drama/get-stream-url?value=${encodeURIComponent(base64Encode(hostUrl))}&server=${encodeURIComponent(source.toLowerCase())}`;
  const r = await fetchJson(endpoint, {});
  const files = r.ok && r.data && Array.isArray(r.data.sources) ? r.data.sources : [];
  const resolved = files.map(file => ({ source, url: clean(file && file.url), isM3U8: Boolean(file && file.isM3U8) })).filter(file => file.url);
  if (!resolved.length && isDirectMediaUrl(hostUrl)) resolved.push({ source, url: hostUrl, isM3U8: /\.m3u8(?:$|[?#])/i.test(hostUrl) });
  return resolved;
}
function inferHeight(text) {
  const m = clean(text).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
}
function tier(height) {
  const h = Number(height || 0);
  if (h >= 2160) return `4K ${h}p`;
  if (h >= 1440) return `Enhanced QHD ${h}p`;
  if (h >= 1080) return `FHD ${h}p`;
  if (h >= 720) return `HD ${h}p`;
  if (h >= 540) return `HD-Low ${h}p`;
  if (h >= 480) return `SD ${h}p`;
  if (h >= 360) return `SD-Low ${h}p`;
  return h > 0 ? `SD-Very Low ${h}p` : "Unknown Auto";
}
function diag(label, detail) {
  return {
    name: `${PROVIDER_NAME} • DIAG ${label}${detail ? ` • ${short(detail, 205)}` : ""}`,
    title: clean(detail) || `${PROVIDER_NAME} diagnostic`,
    url: `${BASE_URL}/favicon.ico`,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const type = mediaTypeOf(mediaType);
  const s = Number(season || 1), e = Number(episode || 1);
  const rows = [];

  if (type === "tv" && s !== 1) return [diag("SEASON UNSUPPORTED", `S${s} • current AsiaFlix API exposes a flat episode list` )];

  const tmdbId = await resolveTmdbId(inputId, type);
  if (!tmdbId) return [diag("TMDB FAILED", `input=${inputId} • type=${type}`)];
  const meta = await tmdbInfo(tmdbId, type);
  if (!meta || !meta.title) return [diag("TMDB FAILED", `TMDB ${tmdbId} returned no title`)];
  rows.push(diag("TMDB", `${meta.title} • TMDB ${tmdbId} • year=${meta.year || "?"} • aliases=${meta.aliases.length}`));

  const target = await findTarget(meta);
  if (!target || !target.details) {
    const ranked = target && Array.isArray(target.ranked) ? target.ranked : [];
    const samples = ranked.slice(0, 4).map(item => `${clean(item.row && item.row.name)}(${item.score})`).filter(Boolean);
    rows.push(diag("SEARCH", `${(target && target.searchNotes || []).slice(0,4).join(" • ")}${samples.length ? ` • top=${samples.join(" | ")}` : ""}`));
    rows.push(diag("NO MATCH", `${meta.title} • direct=${(target && target.notes || []).slice(0,3).join(" | ") || "none"}`));
    return rows;
  }

  const details = target.details;
  const detailName = clean(details && details.name) || meta.title;
  const eps = Array.isArray(details && details.episodes) ? details.episodes : [];
  rows.push(diag("MATCH OK", `${detailName} • slug=${target.slug} • score=${target.score} • via=${target.via} • episodes=${eps.length}`));

  const selectedEpisode = findEpisode(details, type, e);
  if (!selectedEpisode) {
    rows.push(diag("NO EPISODE", `${detailName} • ${type === "tv" ? `S${s}E${e}` : "movie"} • episodes=${eps.length}`));
    return rows;
  }
  const hosts = Array.isArray(selectedEpisode.streamUrls) ? selectedEpisode.streamUrls : [];
  rows.push(diag("EPISODE OK", `${detailName} • episode=${selectedEpisode.number} • hosts=${hosts.length}${hosts.length ? ` • ${hosts.slice(0,4).map(h => clean(h && h.source) || "Server").join(" | ")}` : ""}`));
  if (!hosts.length) return rows.concat(diag("NO STREAM", "Episode matched but source listed no stream hosts"));

  const settled = await Promise.all(hosts.slice(0, 6).map(host => resolveServer(host).catch(() => [])));
  const files = settled.flat();
  const seen = new Set();
  const playable = [];
  for (const file of files) {
    const url = clean(file && file.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const height = inferHeight(`${url} ${file.source || ""}`);
    playable.push({
      name: `${PROVIDER_NAME} • ${tier(height)}${file.source ? ` • ${clean(file.source)}` : ""}`,
      title: `${detailName} • ${type === "tv" ? `Episode ${e}` : "Movie"}`,
      url,
      quality: height ? `${height}p` : "Auto",
      language: meta.language,
      headers: VIDEO_HEADERS,
      provider: PROVIDER_NAME,
      type: file.isM3U8 || /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4",
      subtitles: []
    });
  }
  playable.sort((a, b) => (parseInt(String(b.quality).match(/\d+/)?.[0] || "0", 10) - parseInt(String(a.quality).match(/\d+/)?.[0] || "0", 10)));
  if (playable.length) rows.unshift(...playable);
  rows.push(diag(playable.length ? "STREAMS OK" : "NO STREAM", `${detailName} • resolved=${playable.length}/${hosts.length} hosts`));
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
