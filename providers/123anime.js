"use strict";

/*
 * Limitless Nuvio port of the AniYomi 123Anime extension.
 * Upstream reference: yuzono/anime-extensions (Apache-2.0)
 * Ported to Nuvio's getStreams(TMDB/type/season/episode) provider interface.
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
  try {
    return await (await req(url, opt, timeout)).text();
  } catch (e) {
    console.log(`[${NAME}] ${e && e.message ? e.message : e}`);
    return null;
  }
}

async function json(url, opt = {}, timeout) {
  try {
    return await (await req(url, opt, timeout)).json();
  } catch (e) {
    console.log(`[${NAME}] ${e && e.message ? e.message : e}`);
    return null;
  }
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return null;
  }
}

function abs(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch (_) {
    return null;
  }
}

async function resolveBase() {
  if (basePromise) return basePromise;

  basePromise = (async () => {
    for (const candidate of MIRRORS) {
      try {
        const r = await req(candidate + "/home", {
          headers: { "Referer": candidate + "/" }
        }, 9000);
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

  const d = await json(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?api_key=${TMDB_KEY}&external_source=imdb_id`
  );
  const list = type === "movie" ? d && d.movie_results : d && d.tv_results;
  return list && list[0] && list[0].id ? +list[0].id : null;
}

async function tmdbInfo(id, type) {
  const d = await json(
    `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&append_to_response=external_ids`
  );
  if (!d) return null;

  return {
    title: type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name),
    original: type === "movie" ? d.original_title : d.original_name,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    genres: Array.isArray(d.genres) ? d.genres.map(x => x.id) : []
  };
}

async function malMap(imdb, s, e) {
  return imdb
    ? json(`${MAP}?id=${encodeURIComponent(imdb)}&s=${encodeURIComponent(s)}&e=${encodeURIComponent(e)}`)
    : null;
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

async function malAliases(mal) {
  if (!mal) return [];
  const d = await json(`https://api.jikan.moe/v4/anime/${encodeURIComponent(mal)}`, {}, 15000);
  const a = d && d.data;
  if (!a) return [];
  return uniq([
    a.title,
    a.title_english,
    a.title_japanese,
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
  if (!mal) return uniq([tmdb && tmdb.title, tmdb && tmdb.original]);

  const parts = await Promise.all([
    malAliases(mal),
    aniAliases(mal),
    kitsuAliases(mal)
  ]);

  return uniq([
    mapping && mapping.anime_title,
    ...parts[0],
    ...parts[1],
    ...parts[2],
    tmdb && tmdb.title,
    tmdb && tmdb.original
  ]).slice(0, 20);
}

function cardMode(nodeText, title) {
  return /\bdub\b/i.test(`${title || ""} ${nodeText || ""}`) ? "dub" : "sub";
}

async function searchExact(base, aliases) {
  for (const alias of uniq(aliases).slice(0, 10)) {
    const url = `${base}/filter?sort=default&keyword=${encodeURIComponent(alias)}`;
    const h = await text(url, { headers: { "Referer": base + "/" } }, 12000);
    if (!h) continue;

    const $ = cheerio.load(h);
    const hits = [];
    const seen = new Set();

    $("div.film-list div.item, div.item").each((_, el) => {
      const node = $(el);
      const link = node.find("a.poster[href], a.thumb[href]").first();
      const nameEl = node.find("a.name").first();
      const title = (nameEl.text() || link.find("img").attr("alt") || "").trim();
      const href = link.attr("href") || nameEl.attr("href");
      if (!title || !href) return;
      if (clean(title) !== clean(alias)) return;

      const full = abs(href, base);
      if (!full || seen.has(full)) return;
      seen.add(full);
      hits.push({
        title,
        url: full,
        mode: cardMode(node.text(), title)
      });
    });

    if (hits.length) {
      hits.sort((a, b) => Number(a.mode === "dub") - Number(b.mode === "dub"));
      return hits;
    }
  }

  return [];
}

function animeSlug(candidateUrl) {
  try {
    const p = new URL(candidateUrl).pathname.replace(/\/+$/, "");
    const m = p.match(/\/anime\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  } catch (_) {
    return null;
  }
}

async function episodeSheet(base, slug) {
  const d = await json(
    `${base}/ajax/film/sv?id=${encodeURIComponent(slug)}`,
    {
      headers: {
        "Referer": `${base}/anime/${slug}`,
        "X-Requested-With": "XMLHttpRequest"
      }
    },
    15000
  );

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
    if (!id) return;
    servers.push({ id, label: n.text().trim() || `Server ${servers.length + 1}` });
  });

  return { episodes, servers };
}

async function episodeInfo(base, slug, ep, serverId) {
  return json(
    `${base}/ajax/episode/info?epr=${encodeURIComponent(slug)}/${encodeURIComponent(ep)}/${encodeURIComponent(serverId)}`,
    {
      headers: {
        "Referer": `${base}/anime/${slug}`,
        "X-Requested-With": "XMLHttpRequest"
      }
    },
    15000
  );
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
    try {
      const parsed = JSON.parse(s);
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch (_) {
      values = [s];
    }
  }

  const byLang = new Map();
  for (const item of values) {
    const obj = typeof item === "string" ? { url: item } : (item || {});
    const rawUrl = obj.file || obj.url || obj.src;
    const u = abs(rawUrl, base);
    if (!u || !/\.(?:vtt|srt|ass)(?:$|[?#])/i.test(u)) continue;
    let l = language(obj.label || obj.name || obj.language || obj.lang, u);
    if (!l && assumeEnglish) l = ["en", "English"];
    if (!l || byLang.has(l[0])) continue;
    byLang.set(l[0], {
      url: u,
      language: l[0],
      lang: l[0],
      name: `${l[1]} [123Anime Soft Subtitle]`,
      headers
    });
  }

  return Array.from(byLang.values());
}

function sourceUrl(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    const s = payload.trim();
    if (/^https?:\/\//i.test(s)) return s;
    try {
      return sourceUrl(JSON.parse(s));
    } catch (_) {
      return null;
    }
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const u = sourceUrl(item);
      if (u) return u;
    }
    return null;
  }
  if (typeof payload === "object") {
    return sourceUrl(payload.file || payload.url || payload.src || payload.sources);
  }
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
  const n = $("#mg-player[data-id]").first();
  const id = n.attr("data-id");
  if (id) return id;
  const m = String(body).match(/<div[^>]*(?:id=["']mg-player["'][^>]*data-id|data-id)=["']([A-Za-z0-9+/=]{8,})["'][^>]*>/i);
  return m ? m[1] : null;
}

async function getSources(baseUrl, path, id, referer) {
  const d = await json(
    `${baseUrl}${path}?id=${encodeURIComponent(id)}`,
    { headers: { "Referer": referer, "Origin": baseUrl } },
    12000
  );
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

async function resolveSbv2(embedBase, token) {
  const page = `${embedBase}/sbv2/${token}`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;

  const id = playerDataId(body);
  if (id) {
    const u = await getSources(embedBase, "/sbv2/getSources", id, page);
    if (u) return u;
  }

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

function makeStream(url, mode, server, variant, tracks, headers, ctx) {
  if (!url) return null;
  const q = quality(url);
  const tag = mode === "dub" ? "DUB" : (tracks.length ? "SUB + Soft Subs" : "SUB");
  return {
    name: `${NAME} | ${q} [${tag}] • ${server} ${variant}`,
    title: `${ctx.title} • S${ctx.s}E${ctx.e} • ${mode === "dub" ? "English Dub" : "Japanese"}`,
    url,
    quality: q,
    provider: NAME,
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
  if (!embedUrl) return [];
  const embedBase = origin(embedUrl);
  if (!embedBase) return [];

  const headers = {
    "User-Agent": UA,
    "Referer": embedBase + "/",
    "Origin": embedBase
  };
  const tracks = subtitleTracks(info.subtitle, embedBase, headers, mode === "sub");

  if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(embedUrl)) {
    const s = makeStream(embedUrl, mode, server.label, "Direct", tracks, headers, ctx);
    return s ? [s] : [];
  }

  const body = await text(embedUrl, { headers: { "Referer": base + "/" } }, 12000);
  if (!body) return [];

  const token = tokenFromEmbed(body);
  if (!token) {
    const direct = findMedia(body);
    const s = makeStream(direct, mode, server.label, "Embed", tracks, headers, ctx);
    return s ? [s] : [];
  }

  const results = await Promise.all([
    resolveJw(embedBase, token),
    resolveSbv2(embedBase, token)
  ]);

  const out = [];
  const seen = new Set();
  const variants = ["JW", "SBv2"];
  for (let i = 0; i < results.length; i++) {
    const u = results[i];
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const s = makeStream(u, mode, server.label, variants[i], tracks, headers, ctx);
    if (s) out.push(s);
  }
  return out;
}

async function candidateStreams(base, candidate, targetEp, ctx) {
  const slug = animeSlug(candidate.url);
  if (!slug) return [];

  const sheet = await episodeSheet(base, slug);
  if (!sheet || !sheet.episodes.some(x => Math.abs(x - targetEp) < 0.001)) return [];
  if (!sheet.servers.length) return [];

  const all = await Promise.all(
    sheet.servers.slice(0, 8).map(server =>
      extractServer(base, slug, targetEp, server, candidate.mode, ctx).catch(() => [])
    )
  );
  return all.flat();
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

    // 123Anime is anime/animation only. This deliberately rejects live-action
    // false positives such as Nuvio's generic Matrix test item.
    if (tmdb.genres.length && !tmdb.genres.includes(16)) return [];

    const mapping = await malMap(tmdb.imdb, s, e);
    const mal = mapping && mapping.mal_id ? +mapping.mal_id : null;
    const targetEp = mapping && mapping.mal_episode != null
      ? parseFloat(mapping.mal_episode)
      : e;

    const aliases = await titleAliases(mal, tmdb, mapping);
    if (!aliases.length) return [];

    const base = await resolveBase();
    if (!base) return [];

    console.log(`[${NAME}] aliases ${aliases.slice(0, 10).join(" | ")}`);
    const candidates = await searchExact(base, aliases);
    if (!candidates.length) return [];

    const ctx = {
      title: candidates[0].title || aliases[0] || tmdb.title,
      s,
      e
    };

    const all = await Promise.all(
      candidates.slice(0, 6).map(c => candidateStreams(base, c, targetEp, ctx).catch(() => []))
    );

    const seen = new Set();
    const out = all.flat().filter(stream => {
      const key = `${stream.url}|${stream.language}|${stream.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    out.sort((a, b) => {
      const dub = Number(/\[DUB\]/i.test(b.name)) - Number(/\[DUB\]/i.test(a.name));
      if (dub) return dub;
      const qa = parseInt(a.quality, 10) || 0;
      const qb = parseInt(b.quality, 10) || 0;
      return qb - qa;
    });

    return out;
  } catch (e) {
    console.log(`[${NAME}] ${e && e.message ? e.message : e}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
