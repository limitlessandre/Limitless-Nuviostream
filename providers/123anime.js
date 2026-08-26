"use strict";

/*
 * Limitless Nuvio port of the AniYomi 123Anime extension.
 * Upstream reference: yuzono/anime-extensions (Apache-2.0)
 * Ported to Nuvio's getStreams(TMDB/type/season/episode) provider interface.
 *
 * Limitless 1.1.7 remains on the known-good 1.1.2 mirror/search/extractor path.
 * Identity-only changes:
 * - later seasons are selected from the returned title family, then base-season bleed is blocked
 * - split Part/Cour records also recognize bare ordinal suffixes such as "2nd"
 * - the original 1.1.2 123animehub.cc fallback is restored in its original position
 */

const cheerio = require("cheerio-without-node-native");

const NAME = "123Anime";
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const MAP = "https://id-mapping-api-malid.hf.space/api/resolve";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const MIRRORS = [
  "https://123anime.ru",
  "https://123anime.la",
  "https://123anime.cc",
  "https://123anime.info",
  "https://123animehub.cc",
  "https://w1.123animes.ru"
];

const H = {
  "User-Agent": UA,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

let basePromise = null;

async function req(url, opt = {}, timeout = 12000) {
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(timeout)
    : undefined;
  const r = await fetch(url, {
    ...opt,
    headers: { ...H, ...(opt.headers || {}) },
    signal,
    redirect: "follow",
    skipSizeCheck: true
  });
  if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : "?"}`);
  return r;
}

async function text(url, opt = {}, timeout) {
  try { return await (await req(url, opt, timeout)).text(); }
  catch (e) {
    console.log(`[${NAME}] ${e && e.message ? e.message : e}`);
    return null;
  }
}

async function json(url, opt = {}, timeout) {
  try { return await (await req(url, opt, timeout)).json(); }
  catch (e) {
    console.log(`[${NAME}] ${e && e.message ? e.message : e}`);
    return null;
  }
}

function origin(url) {
  try { return new URL(url).origin; } catch (_) { return null; }
}

function abs(url, base) {
  if (!url) return null;
  try { return new URL(url, base).toString(); } catch (_) { return null; }
}

async function resolveBase() {
  if (basePromise) return basePromise;
  basePromise = (async () => {
    for (const candidate of MIRRORS) {
      try {
        const r = await req(candidate + "/home", { headers: { "Referer": candidate + "/" } }, 9000);
        const body = await r.text();
        if (!/film-list|widget|hotnew|ranking/i.test(body)) continue;
        const finalBase = origin(r.url) || candidate;
        console.log(`[${NAME}] mirror ${finalBase}`);
        return finalBase;
      } catch (_) {}
    }
    return null;
  })();
  return basePromise;
}

function mediaType(t) {
  return String(t || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

async function tmdbId(id, type) {
  id = String(id || "").trim();
  if (/^\d+$/.test(id)) return +id;
  if (!/^tt\d+$/i.test(id)) return null;
  const d = await json(`https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?api_key=${TMDB_KEY}&external_source=imdb_id`);
  const list = type === "movie" ? d && d.movie_results : d && d.tv_results;
  return list && list[0] && list[0].id ? +list[0].id : null;
}

async function tmdbInfo(id, type) {
  const d = await json(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&append_to_response=external_ids`);
  if (!d) return null;
  return {
    title: type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name),
    original: type === "movie" ? d.original_title : d.original_name,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    genres: Array.isArray(d.genres) ? d.genres.map(x => x.id) : []
  };
}

async function malMap(imdb, s, e) {
  return imdb ? json(`${MAP}?id=${encodeURIComponent(imdb)}&s=${encodeURIComponent(s)}&e=${encodeURIComponent(e)}`) : null;
}

function clean(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\[\]【】〖〗]/g, " ")
    .replace(/\b(dub|dubbed)\b/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (!value) continue;
    const s = String(value).trim();
    const key = clean(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function roman(number) {
  const n = Number(number);
  const table = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return Number.isInteger(n) && n > 0 && n < table.length ? table[n] : String(number || "");
}

function ordinal(number) {
  const n = Number(number);
  if (!Number.isFinite(n)) return String(number || "");
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

async function malAliases(mal) {
  if (!mal) return [];
  const d = await json(`https://api.jikan.moe/v4/anime/${encodeURIComponent(mal)}`, {}, 15000);
  const a = d && d.data;
  if (!a) return [];
  return uniq([
    a.title, a.title_english, a.title_japanese,
    ...(Array.isArray(a.title_synonyms) ? a.title_synonyms : []),
    ...(Array.isArray(a.titles) ? a.titles.map(x => x && x.title) : [])
  ]);
}

async function aniAliases(mal) {
  if (!mal) return [];
  const query = `query($idMal:Int){Media(idMal:$idMal,type:ANIME){title{english romaji native} synonyms}}`;
  const d = await json("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: +mal } })
  }, 12000);
  const media = d && d.data && d.data.Media;
  if (!media) return [];
  return uniq([
    media.title && media.title.english,
    media.title && media.title.romaji,
    media.title && media.title.native,
    ...(Array.isArray(media.synonyms) ? media.synonyms : [])
  ]);
}

async function kitsuAliases(mal) {
  if (!mal) return [];
  const d = await json(
    `https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${encodeURIComponent(mal)}&include=item`,
    { headers: { "Accept": "application/vnd.api+json" } },
    15000
  );
  const included = d && Array.isArray(d.included) ? d.included : [];
  const anime = included.find(x => x && x.type === "anime");
  const a = anime && anime.attributes;
  if (!a) return [];
  return uniq([
    a.canonicalTitle,
    ...(a.titles && typeof a.titles === "object" ? Object.values(a.titles) : []),
    ...(Array.isArray(a.abbreviatedTitles) ? a.abbreviatedTitles : [])
  ]);
}

async function titleAliases(mal, tmdb, mapping) {
  if (!mal) return uniq([mapping && mapping.anime_title, tmdb && tmdb.title, tmdb && tmdb.original]);
  const parts = await Promise.all([malAliases(mal), aniAliases(mal), kitsuAliases(mal)]);
  return uniq([
    mapping && mapping.anime_title,
    ...parts[0], ...parts[1], ...parts[2],
    tmdb && tmdb.title, tmdb && tmdb.original
  ]).slice(0, 20);
}

function generatedSeasonAliases(tmdb, season) {
  const s = Number(season) || 1;
  if (s <= 1) return [];
  const out = [];
  for (const base of uniq([tmdb && tmdb.title, tmdb && tmdb.original]).slice(0, 4)) {
    out.push(`${base} Season ${s}`);
    out.push(`${base} ${ordinal(s)} Season`);
    out.push(`${base} ${roman(s)}`);
  }
  return uniq(out);
}

function cardMode(nodeText, title) {
  return /\bdub\b/i.test(`${title || ""} ${nodeText || ""}`) ? "dub" : "sub";
}

function parseCards(base, html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const hits = [];
  const seen = new Set();
  $("div.film-list div.item, div.item").each((_, el) => {
    const node = $(el);
    const link = node.find("a.poster[href], a.thumb[href]").first();
    const nameEl = node.find("a.name").first();
    const title = (nameEl.text() || link.find("img").attr("alt") || "").trim();
    const href = link.attr("href") || nameEl.attr("href");
    if (!title || !href) return;
    const full = abs(href, base);
    if (!full || seen.has(full)) return;
    seen.add(full);
    hits.push({ title, url: full, mode: cardMode(node.text(), title) });
  });
  return hits;
}

async function searchCards(base, query) {
  const url = `${base}/filter?sort=default&keyword=${encodeURIComponent(query)}`;
  const h = await text(url, { headers: { "Referer": base + "/" } }, 12000);
  return parseCards(base, h);
}

async function searchExact(base, aliases) {
  for (const alias of uniq(aliases).slice(0, 10)) {
    const hits = (await searchCards(base, alias)).filter(item => clean(item.title) === clean(alias));
    if (hits.length) {
      hits.sort((a, b) => Number(a.mode === "dub") - Number(b.mode === "dub"));
      return hits;
    }
  }
  return [];
}

const ROMAN_SEASON = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10
};

function explicitSeasonInfo(value) {
  const title = clean(value);
  const patterns = [
    /^(.*)\s+season\s+(\d+)$/,
    /^(.*)\s+(\d+)(?:st|nd|rd|th)\s+season$/,
    /^(.*)\s+(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/
  ];

  for (const pattern of patterns) {
    const m = title.match(pattern);
    if (!m) continue;
    const season = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : ROMAN_SEASON[m[2]];
    if (season > 0) return { root: m[1].trim(), season };
  }

  return { root: title, season: 1 };
}

function baseTitleKeys(tmdb) {
  return new Set(uniq([tmdb && tmdb.title, tmdb && tmdb.original]).map(clean));
}

async function searchSeasonFamily(base, tmdb, season) {
  const wanted = Number(season) || 1;
  const bases = uniq([tmdb && tmdb.title, tmdb && tmdb.original]).slice(0, 4);
  const baseKeys = new Set(bases.map(clean));
  const found = [];
  const seen = new Set();

  for (const query of bases) {
    const cards = await searchCards(base, query);
    for (const card of cards) {
      const info = explicitSeasonInfo(card.title);
      if (info.season !== wanted || !baseKeys.has(info.root)) continue;
      if (seen.has(card.url)) continue;
      seen.add(card.url);
      found.push(card);
    }
  }

  found.sort((a, b) => Number(a.mode === "dub") - Number(b.mode === "dub"));
  return found;
}

async function searchMappedLaterSeason(base, aliases, tmdb) {
  const rejected = baseTitleKeys(tmdb);
  for (const alias of uniq(aliases).slice(0, 10)) {
    const key = clean(alias);
    if (!key || rejected.has(key)) continue;
    const hits = (await searchCards(base, alias)).filter(item => {
      const itemKey = clean(item.title);
      return itemKey === key && !rejected.has(itemKey);
    });
    if (hits.length) {
      hits.sort((a, b) => Number(a.mode === "dub") - Number(b.mode === "dub"));
      return hits;
    }
  }
  return [];
}

const WORD_PART = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

function splitTitleInfo(value) {
  const title = clean(value);
  const patterns = [
    /^(.*)\s+(?:part|cour)\s+(\d+)$/,
    /^(.*)\s+(\d+)(?:st|nd|rd|th)\s+(?:part|cour)$/,
    /^(.*)\s+(first|second|third|fourth|fifth)\s+(?:part|cour)$/,
    /^(.*)\s+(?:part|cour)\s+(first|second|third|fourth|fifth)$/,
    /^(.*)\s+(\d+)(?:st|nd|rd|th)$/
  ];
  for (const pattern of patterns) {
    const m = title.match(pattern);
    if (!m) continue;
    const index = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : WORD_PART[m[2]];
    if (index > 0) return { root: m[1].trim(), part: index, explicit: true };
  }
  return { root: title, part: 1, explicit: false };
}

function rawFamilyRoot(value) {
  let title = String(value || "").trim().replace(/\s*\((?:dub|dubbed|sub|subbed)\)\s*$/i, "");
  const suffixes = [
    /\s+(?:part|cour)\s+\d+\s*$/i,
    /\s+\d+(?:st|nd|rd|th)\s+(?:part|cour)\s*$/i,
    /\s+(?:first|second|third|fourth|fifth)\s+(?:part|cour)\s*$/i,
    /\s+(?:part|cour)\s+(?:first|second|third|fourth|fifth)\s*$/i,
    /\s+\d+(?:st|nd|rd|th)\s*$/i
  ];
  for (const suffix of suffixes) {
    if (suffix.test(title)) return title.replace(suffix, "").trim();
  }
  return title;
}

function familyRoots(aliases) {
  const out = [];
  const seen = new Set();
  for (const alias of uniq(aliases).slice(0, 12)) {
    const raw = rawFamilyRoot(alias);
    const key = clean(raw);
    if (!raw || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, clean: key });
  }
  return out.slice(0, 8);
}

async function searchCourFamily(base, aliases) {
  const roots = familyRoots(aliases);
  const found = [];
  const seen = new Set();

  for (const root of roots) {
    const queries = uniq([
      root.raw,
      `${root.raw} Part 1`,
      `${root.raw} Part 2`,
      `${root.raw} 1st Cour`,
      `${root.raw} 2nd Cour`,
      `${root.raw} First Cour`,
      `${root.raw} Second Cour`,
      `${root.raw} 1st`,
      `${root.raw} 2nd`
    ]);

    for (const query of queries) {
      const cards = await searchCards(base, query);
      for (const card of cards) {
        const info = splitTitleInfo(card.title);
        if (info.root !== root.clean) continue;
        if (seen.has(card.url)) continue;
        seen.add(card.url);
        found.push({ ...card, part: info.part, explicitPart: info.explicit });
      }
    }
  }

  found.sort((a, b) => (a.part - b.part) || Number(a.mode === "dub") - Number(b.mode === "dub"));
  return found;
}

function animeSlug(candidateUrl) {
  try {
    const p = new URL(candidateUrl).pathname.replace(/\/+$/, "");
    const m = p.match(/\/anime\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  } catch (_) { return null; }
}

async function episodeSheet(base, slug) {
  const d = await json(`${base}/ajax/film/sv?id=${encodeURIComponent(slug)}`, {
    headers: { "Referer": `${base}/anime/${slug}`, "X-Requested-With": "XMLHttpRequest" }
  }, 15000);
  const html = d && (d.html || d.result);
  if (!html) return null;
  const $ = cheerio.load(html);
  const episodes = [];
  $("ul.episodes.range li a[data-id]").each((_, el) => {
    const n = $(el);
    const dataId = n.attr("data-id") || "";
    const raw = n.text().trim() || dataId.split("/").pop() || "";
    const num = parseFloat(raw);
    if (Number.isFinite(num)) episodes.push(num);
  });
  const servers = [];
  $("span.tab[data-name]").each((_, el) => {
    const n = $(el);
    const id = String(n.attr("data-name") || "").trim();
    if (id) servers.push({ id, label: n.text().trim() || `Server ${servers.length + 1}` });
  });
  return { episodes, servers };
}

async function episodeInfo(base, slug, ep, serverId) {
  return json(`${base}/ajax/episode/info?epr=${encodeURIComponent(slug)}/${encodeURIComponent(ep)}/${encodeURIComponent(serverId)}`, {
    headers: { "Referer": `${base}/anime/${slug}`, "X-Requested-With": "XMLHttpRequest" }
  }, 15000);
}

function language(label, url) {
  const s = `${label || ""} ${url || ""}`.toLowerCase();
  if (/english|(^|[^a-z])(en|eng)([^a-z]|$)/.test(s)) return ["en", "English"];
  if (/japanese|(^|[^a-z])(ja|jp|jpn)([^a-z]|$)/.test(s)) return ["ja", "Japanese"];
  if (/spanish|(^|[^a-z])(es|spa)([^a-z]|$)/.test(s)) return ["es", "Spanish"];
  if (/french|(^|[^a-z])(fr|fra)([^a-z]|$)/.test(s)) return ["fr", "French"];
  return null;
}

function subtitleTracks(raw, base, headers, assumeEnglish) {
  if (!raw) return [];
  let values = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "object") values = [raw];
  else {
    const s = String(raw).trim();
    if (!s) return [];
    try { const parsed = JSON.parse(s); values = Array.isArray(parsed) ? parsed : [parsed]; }
    catch (_) { values = [s]; }
  }
  const byLang = new Map();
  for (const item of values) {
    const obj = typeof item === "string" ? { url: item } : (item || {});
    const u = abs(obj.file || obj.url || obj.src, base);
    if (!u || !/\.(?:vtt|srt|ass)(?:$|[?#])/i.test(u)) continue;
    let l = language(obj.label || obj.name || obj.language || obj.lang, u);
    if (!l && assumeEnglish) l = ["en", "English"];
    if (!l || byLang.has(l[0])) continue;
    byLang.set(l[0], { url: u, language: l[0], lang: l[0], name: `${l[1]} [SOFTSUB]`, headers });
  }
  return Array.from(byLang.values());
}

function sourceUrl(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    const s = payload.trim();
    if (/^https?:\/\//i.test(s)) return s;
    try { return sourceUrl(JSON.parse(s)); } catch (_) { return null; }
  }
  if (Array.isArray(payload)) {
    for (const item of payload) { const u = sourceUrl(item); if (u) return u; }
    return null;
  }
  if (typeof payload === "object") return sourceUrl(payload.file || payload.url || payload.src || payload.sources);
  return null;
}

function findMedia(body) {
  if (!body) return null;
  const m = String(body).match(/["'`](https?:\/\/[^"'`\s]+\.(?:m3u8|mp4)(?:[^"'`\s]*)?)["'`]/i);
  return m ? m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/") : null;
}

function playerDataId(body) {
  if (!body) return null;
  const $ = cheerio.load(body);
  const id = $("#mg-player[data-id]").first().attr("data-id");
  if (id) return id;
  const m = String(body).match(/<div[^>]*(?:id=["']mg-player["'][^>]*data-id|data-id)=["']([A-Za-z0-9+/=]{8,})["'][^>]*>/i);
  return m ? m[1] : null;
}

async function getSources(baseUrl, path, id, referer) {
  const d = await json(`${baseUrl}${path}?id=${encodeURIComponent(id)}`, { headers: { "Referer": referer, "Origin": baseUrl } }, 12000);
  return sourceUrl(d && (d.sources || d.source || d));
}

async function resolveJw(embedBase, token) {
  const page = `${embedBase}/hs/${token}`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;
  const id = playerDataId(body);
  if (id) {
    const primary = await getSources(embedBase, "/hs/getSources_z", id, page);
    if (primary) return primary;
    const fallback = await getSources(embedBase, "/hs/getSources", id, page);
    if (fallback) return fallback;
  }
  return findMedia(body);
}

async function resolveLegacy(embedBase, token) {
  const page = `${embedBase}/hs/${token}?pl_usn=1`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;
  const raw = cheerio.load(body)("#sources").first().text().trim();
  if (raw) { const parsed = sourceUrl(raw); if (parsed) return parsed; }
  return findMedia(body);
}

async function resolveSbv2(embedBase, token) {
  const page = `${embedBase}/sbv2/${token}`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;
  const id = playerDataId(body);
  if (id) { const u = await getSources(embedBase, "/sbv2/getSources", id, page); if (u) return u; }
  return findMedia(body);
}

function tokenFromEmbed(body) {
  if (!body) return null;
  const z = String(body).match(/var\s+zrpart2\s*=\s*["']([A-Za-z0-9+/=]+)["']/i);
  if (z) return z[1];
  const h = String(body).match(/[`"']\/hs\/([A-Za-z0-9+/=]+)[`"']/i);
  return h ? h[1] : null;
}

function quality(url) {
  const m = String(url || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p(?:[^0-9]|$)/i);
  return m ? `${m[1]}p` : "HD";
}

async function normalizeHls(url, headers) {
  const fallback = { url, quality: quality(url) };
  if (!url || !/m3u8/i.test(String(url))) return fallback;
  const body = await text(url, { headers }, 10000);
  if (!body || !body.trimStart().startsWith("#EXTM3U")) return fallback;
  const lines = body.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const res = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i);
    const bw = lines[i].match(/BANDWIDTH=(\d+)/i);
    let uri = null;
    for (let j = i + 1; j < lines.length; j++) { if (!lines[j].startsWith("#")) { uri = lines[j]; break; } }
    if (uri) variants.push({ uri, height: res ? parseInt(res[2], 10) : 0, bandwidth: bw ? parseInt(bw[1], 10) : 0 });
  }
  if (!variants.length) return fallback;
  variants.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
  const best = variants[0];
  let child = abs(best.uri, url);
  if (!child) return fallback;
  if (!/\.m3u8(?:$|[?#])/i.test(child)) child += (child.includes("?") ? "&" : "?") + "nuvio.m3u8";
  return { url: child, quality: best.height ? `${best.height}p` : fallback.quality };
}

function makeStream(url, mode, server, variant, tracks, headers, ctx, qualityOverride) {
  if (!url) return null;
  const q = qualityOverride || quality(url);
  const tag = mode === "dub" ? (tracks.length ? "DUB+SUBS" : "DUB") : (tracks.length ? "HARDSUB+SUBS" : "HARDSUB");
  return {
    name: `${NAME} | ${q} [${tag}] • ${server} ${variant}`,
    title: `${ctx.title} • S${ctx.s}E${ctx.e} • ${mode === "dub" ? "English Dub" : "Japanese Hard Sub"}`,
    url, quality: q, provider: NAME,
    type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4",
    headers,
    language: mode === "dub" ? "English" : "Japanese",
    subtitles: tracks
  };
}

async function extractServer(base, slug, ep, server, mode, ctx) {
  const info = await episodeInfo(base, slug, ep, server.id);
  if (!info || !info.target) return [];
  const embedUrl = abs(info.target, base);
  const embedBase = origin(embedUrl);
  if (!embedUrl || !embedBase) return [];
  const headers = { "User-Agent": UA, "Referer": embedBase + "/", "Origin": embedBase };
  const tracks = subtitleTracks(info.subtitle, embedBase, headers, mode === "sub");

  if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(embedUrl)) {
    const s = makeStream(embedUrl, mode, server.label, "Direct", tracks, headers, ctx);
    return s ? [s] : [];
  }

  const body = await text(embedUrl, { headers: { "Referer": base + "/" } }, 12000);
  if (!body) return [];
  const token = tokenFromEmbed(body);
  if (!token) {
    const s = makeStream(findMedia(body), mode, server.label, "Embed", tracks, headers, ctx);
    return s ? [s] : [];
  }

  const results = await Promise.all([resolveJw(embedBase, token), resolveLegacy(embedBase, token), resolveSbv2(embedBase, token)]);
  const out = [];
  const seen = new Set();
  const variants = ["JW", "Legacy", "SBv2"];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) continue;
    const normalized = await normalizeHls(results[i], headers);
    if (!normalized.url || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    const stream = makeStream(normalized.url, mode, server.label, variants[i], tracks, headers, ctx, normalized.quality);
    if (stream) out.push(stream);
  }
  return out;
}

async function candidateStreams(base, candidate, targetEp, ctx, knownSheet) {
  const slug = animeSlug(candidate.url);
  if (!slug) return [];
  const sheet = knownSheet || await episodeSheet(base, slug);
  if (!sheet || !sheet.episodes.some(x => Math.abs(x - targetEp) < 0.001) || !sheet.servers.length) return [];
  const all = await Promise.all(sheet.servers.slice(0, 8).map(server =>
    extractServer(base, slug, targetEp, server, candidate.mode, ctx).catch(() => [])
  ));
  return all.flat();
}

function sortedRegularEpisodes(sheet) {
  return Array.from(new Set((sheet && sheet.episodes || [])
    .filter(x => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b)));
}

async function courFallbackStreams(base, aliases, requestedEpisode, ctx) {
  const family = await searchCourFamily(base, aliases);
  if (!family.length) return [];

  const enriched = [];
  for (const candidate of family.slice(0, 20)) {
    const slug = animeSlug(candidate.url);
    if (!slug) continue;
    const sheet = await episodeSheet(base, slug);
    const ordered = sortedRegularEpisodes(sheet);
    if (!sheet || !ordered.length || !sheet.servers.length) continue;
    enriched.push({ ...candidate, sheet, ordered });
  }
  if (!enriched.length) return [];

  console.log(`[${NAME}] cour family ${enriched.map(x => `${x.title}[${x.mode}:p${x.part}:${x.ordered.length}]`).join(" | ")}`);

  const selections = [];
  for (const mode of ["sub", "dub"]) {
    const modeItems = enriched.filter(x => x.mode === mode).sort((a, b) => a.part - b.part);
    if (!modeItems.length) continue;

    const bestByPart = new Map();
    for (const item of modeItems) if (!bestByPart.has(item.part)) bestByPart.set(item.part, item);
    const parts = Array.from(bestByPart.values()).sort((a, b) => a.part - b.part);
    if (!parts.length || parts[0].part !== 1) continue;

    let offset = 0;
    for (const item of parts) {
      const localPosition = requestedEpisode - offset;
      if (localPosition >= 1 && localPosition <= item.ordered.length) {
        const localEpisode = item.ordered[Math.floor(localPosition) - 1];
        selections.push({ item, localEpisode });
        console.log(`[${NAME}] stitched S${ctx.s}E${ctx.e} -> ${item.title} ${mode} local E${localEpisode} (part ${item.part}, offset ${offset})`);
        break;
      }
      offset += item.ordered.length;
    }
  }

  const all = await Promise.all(selections.map(({ item, localEpisode }) =>
    candidateStreams(base, item, localEpisode, { ...ctx, title: item.title }, item.sheet).catch(() => [])
  ));
  return all.flat();
}

function semanticStreamKey(stream) {
  const headerKey = Object.entries(stream.headers || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.toLowerCase()}=${v}`).join("&");
  const subtitleKey = (stream.subtitles || []).map(sub => `${sub.language || sub.lang || ""}|${sub.url || ""}`).sort().join(",");
  return `${stream.url}|${stream.language || ""}|${headerKey}|${subtitleKey}`;
}

function finalize(streams) {
  const seen = new Set();
  const out = (streams || []).filter(stream => {
    const key = semanticStreamKey(stream);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  out.sort((a, b) => {
    const dub = Number(/\[DUB(?:\+SUBS)?\]/i.test(b.name)) - Number(/\[DUB(?:\+SUBS)?\]/i.test(a.name));
    if (dub) return dub;
    return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
  });
  return out;
}

async function getStreams(inputId, type = "tv", season = 1, episode = 1) {
  try {
    type = mediaType(type);
    const s = type === "movie" ? 1 : (parseInt(season, 10) || 1);
    const e = type === "movie" ? 1 : (parseFloat(episode) || 1);
    const tid = await tmdbId(inputId, type);
    if (!tid) return [];
    const tmdb = await tmdbInfo(tid, type);
    if (!tmdb || !tmdb.title) return [];
    if (tmdb.genres.length && !tmdb.genres.includes(16)) return [];

    const mapping = await malMap(tmdb.imdb, s, e);
    const mal = mapping && mapping.mal_id ? +mapping.mal_id : null;
    const targetEp = mapping && mapping.mal_episode != null ? parseFloat(mapping.mal_episode) : e;
    const aliases = await titleAliases(mal, tmdb, mapping);
    if (!aliases.length) return [];
    const base = await resolveBase();
    if (!base) return [];

    console.log(`[${NAME}] request ${tmdb.title} S${s}E${e} mapMAL=${mal || "?"} mapEp=${Number.isFinite(targetEp) ? targetEp : "?"}`);

    if (type === "tv" && s > 1) {
      let seasonCandidates = await searchSeasonFamily(base, tmdb, s);
      if (!seasonCandidates.length) {
        const seasonAliases = generatedSeasonAliases(tmdb, s);
        seasonCandidates = await searchExact(base, seasonAliases);
      }

      if (seasonCandidates.length) {
        const seasonCtx = { title: seasonCandidates[0].title || tmdb.title, s, e };
        const seasonAll = await Promise.all(seasonCandidates.slice(0, 6).map(c =>
          candidateStreams(base, c, e, seasonCtx).catch(() => [])
        ));
        const seasonStreams = finalize(seasonAll.flat());
        if (seasonStreams.length) {
          console.log(`[${NAME}] explicit season-family match ${seasonCtx.title} for S${s}E${e}`);
          return seasonStreams;
        }
      }
    }

    console.log(`[${NAME}] aliases ${aliases.slice(0, 10).join(" | ")}`);
    const candidates = type === "tv" && s > 1
      ? await searchMappedLaterSeason(base, aliases, tmdb)
      : await searchExact(base, aliases);
    const ctx = { title: candidates[0] && candidates[0].title || aliases[0] || tmdb.title, s, e };
    if (candidates.length) {
      const directAll = await Promise.all(candidates.slice(0, 6).map(c => candidateStreams(base, c, targetEp, ctx).catch(() => [])));
      const direct = finalize(directAll.flat());
      if (direct.length) return direct;
      console.log(`[${NAME}] exact candidate produced no stream for S${s}E${e}; trying cour stitching`);
    } else {
      console.log(`[${NAME}] exact title miss for S${s}E${e}; trying cour stitching`);
    }

    if (type !== "tv") return [];
    const stitched = await courFallbackStreams(base, aliases, e, { title: aliases[0] || tmdb.title, s, e });
    return finalize(stitched);
  } catch (e) {
    console.log(`[${NAME}] ${e && e.message ? e.message : e}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
