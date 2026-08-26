"use strict";

/*
 * Limitless 123Anime NEXT 2.0.0-alpha.1
 * Clean multi-source rebuild. The stable 1.1.7 provider remains separate.
 *
 * Architecture references (ideas / independently implemented behavior):
 * - yuzono/anime-extensions 123Anime (Apache-2.0)
 * - mdtahseen7/123anime-api (MIT)
 * - NuvioMedia/NuvioTV ExternalExtensionRunner matching approach (reference only)
 * - PD-Codes/MediaForge Aniwaves endpoint research (GPL-3.0 reference only; no copied code)
 */

const cheerio = require("cheerio-without-node-native");

const NAME = "123Anime NEXT";
const VERSION = "2.0.0-alpha.1";
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const MAP = "https://id-mapping-api-malid.hf.space/api/resolve";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const MAX_QUERY_TITLES = 4;
const MAX_CANDIDATES = 14;
const MIN_SCORE = 0.58;

const SOURCES = [
  { id: "ru", label: "ru", base: "https://123anime.ru", adapter: "legacy123", routes: ["filter", "search"] },
  { id: "la", label: "la", base: "https://123anime.la", adapter: "legacy123", routes: ["search", "filter"] },
  { id: "cc", label: "cc", base: "https://123anime.cc", adapter: "legacy123", routes: ["filter", "search"] },
  { id: "info", label: "info", base: "https://123anime.info", adapter: "legacy123", routes: ["filter", "search"] },
  { id: "hub", label: "hub", base: "https://123animehub.cc", adapter: "legacy123", routes: ["search", "filter"] },
  { id: "w1", label: "w1", base: "https://w1.123animes.ru", adapter: "legacy123", routes: ["filter", "search"] },
  { id: "aniwaves", label: "aniwaves", base: "https://aniwaves.ru", adapter: "aniwaves" },
  // Cataloged from the same source-family research, but intentionally isolated
  // until its exact episode/server API is verified. Discovery is still useful
  // for diagnostics and future adapter work; it can never win extraction today.
  { id: "guts", label: "guts", base: "https://guts.to", adapter: "guts" }
];

const H = {
  "User-Agent": UA,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

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

async function text(url, opt = {}, timeout = 12000) {
  try { return await (await req(url, opt, timeout)).text(); }
  catch (e) {
    console.log(`[${NAME}] ${url} -> ${e && e.message ? e.message : e}`);
    return null;
  }
}

async function json(url, opt = {}, timeout = 12000) {
  try { return await (await req(url, opt, timeout)).json(); }
  catch (e) {
    console.log(`[${NAME}] ${url} -> ${e && e.message ? e.message : e}`);
    return null;
  }
}

function mediaType(t) {
  return String(t || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

function abs(url, base) {
  if (!url) return null;
  try { return new URL(url, base).toString(); } catch (_) { return null; }
}

function origin(url) {
  try { return new URL(url).origin; } catch (_) { return null; }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\[\]【】〖〗]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value) {
  return normalize(value)
    .replace(/\b(?:dub|dubbed|sub|subbed|uncut|uncensored|english)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (!value) continue;
    const raw = String(value).trim();
    const key = normalizeLoose(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const WORD_NUM = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

function parseNumToken(token) {
  const t = String(token || "").toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^\d+(?:st|nd|rd|th)$/.test(t)) return parseInt(t, 10);
  if (ROMAN[t]) return ROMAN[t];
  if (WORD_NUM[t]) return WORD_NUM[t];
  return null;
}

function titleShape(value) {
  let raw = normalizeLoose(value);
  let season = null;
  let part = null;

  const partPatterns = [
    /\b(?:part|cour)\s+(\d+|first|second|third|fourth|fifth)\b/,
    /\b(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth)\s+(?:part|cour)\b/
  ];
  for (const re of partPatterns) {
    const m = raw.match(re);
    if (m) { part = parseNumToken(m[1]); raw = raw.replace(re, " "); break; }
  }

  const seasonPatterns = [
    /\bseason\s+(\d+)\b/,
    /\b(\d+(?:st|nd|rd|th))\s+season\b/,
    /\b(?:series)\s+(\d+)\b/
  ];
  for (const re of seasonPatterns) {
    const m = raw.match(re);
    if (m) { season = parseNumToken(m[1]); raw = raw.replace(re, " "); break; }
  }

  // Roman season markers are common both at the end (Youjo Senki II) and
  // before a subtitle (Mushoku Tensei II Isekai...). Ignore a bare "I"
  // because it is too ambiguous in English titles.
  if (season == null) {
    let m = raw.match(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/);
    if (m) { season = ROMAN[m[1]]; raw = raw.slice(0, m.index).trim(); }
    else {
      m = raw.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
      if (m) { season = ROMAN[m[1]]; raw = `${raw.slice(0, m.index)} ${raw.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim(); }
    }
  }

  // Bare ordinal suffixes are common in this family ("... 2nd"). Treat them as
  // a part marker by default. A desired explicit season still outranks it later.
  if (part == null && season == null) {
    const m = raw.match(/\s+(\d+(?:st|nd|rd|th))$/);
    if (m) { part = parseNumToken(m[1]); raw = raw.slice(0, m.index).trim(); }
  }

  raw = raw.replace(/\b(?:tv|series)\b$/g, " ").replace(/\s+/g, " ").trim();
  return { root: raw, season, part, full: normalizeLoose(value) };
}

function levenshtein(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function similarity(a, b) {
  a = normalizeLoose(a); b = normalizeLoose(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  if (shorter >= 5 && (a.includes(b) || b.includes(a))) {
    const ratio = shorter / longer;
    if (ratio >= 0.72) return 0.82 + (ratio - 0.72) * 0.5;
  }
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / longer);
}

async function tmdbId(inputId, type) {
  const id = String(inputId || "").trim();
  if (/^\d+$/.test(id)) return +id;
  if (!/^tt\d+$/i.test(id)) return null;
  const d = await json(`https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?api_key=${TMDB_KEY}&external_source=imdb_id`);
  const list = type === "movie" ? d && d.movie_results : d && d.tv_results;
  return list && list[0] && list[0].id ? +list[0].id : null;
}

async function tmdbInfo(id, type) {
  const d = await json(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&append_to_response=external_ids,alternative_titles`);
  if (!d) return null;
  const altObj = d.alternative_titles;
  const alt = Array.isArray(altObj && altObj.results) ? altObj.results.map(x => x && x.title) : [];
  const date = type === "movie" ? d.release_date : d.first_air_date;
  return {
    title: type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name),
    original: type === "movie" ? d.original_title : d.original_name,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    year: /^\d{4}/.test(date || "") ? parseInt(date.slice(0, 4), 10) : null,
    genres: Array.isArray(d.genres) ? d.genres.map(x => x.id) : [],
    alternatives: alt
  };
}

async function malMap(imdb, s, e) {
  return imdb ? json(`${MAP}?id=${encodeURIComponent(imdb)}&s=${encodeURIComponent(s)}&e=${encodeURIComponent(e)}`) : null;
}

async function jikanAliases(mal) {
  if (!mal) return [];
  const d = await json(`https://api.jikan.moe/v4/anime/${encodeURIComponent(mal)}`, {}, 14000);
  const a = d && d.data;
  if (!a) return [];
  return uniq([
    a.title, a.title_english, a.title_japanese,
    ...(Array.isArray(a.title_synonyms) ? a.title_synonyms : []),
    ...(Array.isArray(a.titles) ? a.titles.map(x => x && x.title) : [])
  ]);
}

async function aniListAliases(mal) {
  if (!mal) return [];
  const query = `query($idMal:Int){Media(idMal:$idMal,type:ANIME){title{english romaji native} synonyms}}`;
  const d = await json("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: +mal } })
  }, 12000);
  const m = d && d.data && d.data.Media;
  return m ? uniq([m.title && m.title.english, m.title && m.title.romaji, m.title && m.title.native, ...(m.synonyms || [])]) : [];
}

async function kitsuAliases(mal) {
  if (!mal) return [];
  const d = await json(
    `https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${encodeURIComponent(mal)}&include=item`,
    { headers: { "Accept": "application/vnd.api+json" } },
    14000
  );
  const anime = d && Array.isArray(d.included) ? d.included.find(x => x && x.type === "anime") : null;
  const a = anime && anime.attributes;
  return a ? uniq([a.canonicalTitle, ...(a.titles ? Object.values(a.titles) : []), ...(a.abbreviatedTitles || [])]) : [];
}

function ordinal(n) {
  n = Number(n);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function explicitSeasonAliases(base, season) {
  if (!base || !season || season <= 1) return [];
  const romans = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return uniq([`${base} Season ${season}`, `${base} ${ordinal(season)} Season`, `${base} ${romans[season] || season}`]);
}

async function buildIdentity(tmdb, mapping, s) {
  const mal = mapping && mapping.mal_id ? +mapping.mal_id : null;
  const richer = mal ? await Promise.all([jikanAliases(mal), aniListAliases(mal), kitsuAliases(mal)]) : [[], [], []];
  const all = uniq([
    mapping && mapping.anime_title,
    ...richer[0], ...richer[1], ...richer[2],
    tmdb && tmdb.title,
    tmdb && tmdb.original,
    ...(tmdb && tmdb.alternatives || [])
  ]).slice(0, 28);

  const mappedTitle = mapping && mapping.anime_title ? String(mapping.anime_title) : "";
  const mappedShape = titleShape(mappedTitle);
  let desiredSeason = mappedShape.season;
  let desiredPart = mappedShape.part;
  if (desiredSeason == null && desiredPart == null && s > 1) desiredSeason = s;

  const roots = uniq(all.map(x => titleShape(x).root).filter(Boolean));
  const queries = uniq([
    mappedTitle,
    tmdb && tmdb.title,
    tmdb && tmdb.original,
    all.find(x => /[a-z]/i.test(x || "") && normalizeLoose(x) !== normalizeLoose(mappedTitle)),
    ...(s > 1 ? explicitSeasonAliases(tmdb && tmdb.title, s) : [])
  ]).slice(0, MAX_QUERY_TITLES);

  return { mal, aliases: all, roots, queries, desiredSeason, desiredPart, mappedShape };
}

function inferCardMode(title, nodeText, node) {
  const t = `${title || ""} ${nodeText || ""}`.toLowerCase();
  const explicitDub = /\b(?:dub|dubbed)\b/.test(String(title || "").toLowerCase());
  if (explicitDub) return "dub";
  if (node && node.find && node.find(".is-dub, [class*='dub']").length && !node.find(".is-sub, [class*='sub']").length) return "dub";
  return /\bdub\b/.test(t) && !/\bsub\b/.test(t) ? "dub" : "sub";
}

function parseLegacyCards(source, html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  const selectors = [".film-list .item", ".film_list-wrap .item", ".flw-item", ".anime-list .item", ".items .item", "div.item"];
  let nodes = null;
  for (const selector of selectors) {
    const n = $(selector);
    if (n.length) { nodes = n; break; }
  }
  if (!nodes) return out;
  nodes.each((_, el) => {
    const node = $(el);
    const link = node.find("a.poster[href], a.thumb[href], .film-poster a[href], a.name[href], .film-name a[href], a[href*='/anime/']").first();
    const nameEl = node.find("a.name, .film-name a, .dynamic-name, .title a, h3 a").first();
    const title = (nameEl.text() || nameEl.attr("data-jtitle") || link.attr("data-jtitle") || link.find("img").attr("alt") || node.find("img").attr("alt") || "").trim();
    const href = link.attr("href") || nameEl.attr("href");
    if (!title || !href) return;
    const url = abs(href, source.base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      source, adapter: source.adapter, title, url,
      mode: inferCardMode(title, node.text(), node),
      year: null
    });
  });
  return out;
}

async function searchLegacyRoute(source, query, route) {
  const q = encodeURIComponent(query);
  const url = route === "search"
    ? `${source.base}/search?keyword=${q}`
    : `${source.base}/filter?sort=default&keyword=${q}`;
  const h = await text(url, { headers: { "Referer": source.base + "/" } }, 10000);
  return parseLegacyCards(source, h);
}

async function discoverLegacy(source, queries) {
  const jobs = [];
  for (const q of queries) for (const route of source.routes || ["filter"]) jobs.push(searchLegacyRoute(source, q, route));
  const settled = await Promise.allSettled(jobs);
  const out = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const card of r.value || []) {
      const key = card.url;
      if (seen.has(key)) continue;
      seen.add(key); out.push(card);
    }
  }
  return out;
}

async function discoverAniwaves(source, queries) {
  const jobs = queries.map(async q => {
    const d = await json(`${source.base}/ajax/anime/search?keyword=${encodeURIComponent(q)}`, {
      headers: { "Referer": source.base + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
    }, 10000);
    const html = d && d.result && (d.result.html || d.result) || "";
    if (!html) return [];
    const $ = cheerio.load(html);
    const cards = [];
    $("a.item[href]").each((_, el) => {
      const n = $(el);
      const title = (n.find(".name.d-title, .name, [data-jp]").first().text() || n.attr("data-jtitle") || n.find("img").attr("alt") || "").trim();
      const href = n.attr("href");
      if (title && href) cards.push({ source, adapter: source.adapter, title, url: abs(href, source.base), mode: "mixed", year: null });
    });
    return cards;
  });
  const settled = await Promise.allSettled(jobs);
  const seen = new Set(); const out = [];
  for (const r of settled) if (r.status === "fulfilled") for (const c of r.value || []) {
    if (!c.url || seen.has(c.url)) continue; seen.add(c.url); out.push(c);
  }
  return out;
}

async function discoverGuts(source, queries) {
  // Discovery only until the episode/server API is independently verified.
  const jobs = queries.map(async q => {
    const h = await text(`${source.base}/search?keyword=${encodeURIComponent(q)}`, { headers: { "Referer": source.base + "/" } }, 10000);
    if (!h) return [];
    const $ = cheerio.load(h);
    const cards = [];
    $("a[href*='/anime/']").each((_, el) => {
      const n = $(el);
      const href = n.attr("href");
      const title = (n.attr("title") || n.find(".name, .film-name, .d-title").first().text() || n.find("img").attr("alt") || n.text() || "").trim();
      if (href && title && title.length < 180) cards.push({ source, adapter: source.adapter, title, url: abs(href, source.base), mode: "mixed", year: null });
    });
    return cards;
  });
  const settled = await Promise.allSettled(jobs);
  const seen = new Set(); const out = [];
  for (const r of settled) if (r.status === "fulfilled") for (const c of r.value || []) {
    if (!c.url || seen.has(c.url)) continue; seen.add(c.url); out.push(c);
  }
  return out;
}

async function discoverSource(source, queries) {
  try {
    if (source.adapter === "legacy123") return await discoverLegacy(source, queries);
    if (source.adapter === "aniwaves") return await discoverAniwaves(source, queries);
    if (source.adapter === "guts") return await discoverGuts(source, queries);
    return [];
  } catch (e) {
    console.log(`[${NAME}] ${source.id} discovery failed: ${e && e.message ? e.message : e}`);
    return [];
  }
}

function markerCompatibility(cardShape, identity, requestedSeason) {
  let delta = 0;
  let reject = false;

  if (identity.desiredSeason != null) {
    if (cardShape.season != null) {
      if (cardShape.season === identity.desiredSeason) delta += 0.22;
      else reject = true;
    } else if (cardShape.part != null && identity.desiredPart == null) {
      delta -= 0.10;
    } else {
      // Later-season request must not silently collapse to the plain base title.
      // A continuous-number source can still qualify when it exposes an explicit
      // season record whose episode labels are absolute; the episode-position
      // translation happens later. A truly unmarked base card is not safe.
      if (identity.desiredSeason > 1) reject = true;
    }
  } else if (requestedSeason <= 1 && cardShape.season != null && cardShape.season > 1) {
    reject = true;
  }

  if (identity.desiredPart != null) {
    if (cardShape.part != null) {
      if (cardShape.part === identity.desiredPart) delta += 0.24;
      else reject = true;
    } else if (cardShape.season != null && requestedSeason <= 1) {
      delta -= 0.16;
    } else {
      // If the mapping says this request belongs to Part/Cour 2+, the plain
      // base record is unsafe because provider-local E1 would be the wrong cour.
      if (identity.desiredPart > 1) reject = true;
      else delta -= 0.16;
    }
  } else if (requestedSeason <= 1 && cardShape.part != null && cardShape.part > 1) {
    // A Part 2 record should not beat the base record for early S1 episodes.
    delta -= 0.12;
  }

  return { delta, reject };
}

function scoreCard(card, identity, tmdb, requestedSeason) {
  const shape = titleShape(card.title);
  let best = 0;
  let bestAlias = "";
  for (const alias of identity.aliases) {
    const aShape = titleShape(alias);
    let s = similarity(card.title, alias);
    const rootSim = similarity(shape.root, aShape.root);
    s = Math.max(s, rootSim * 0.94);
    if (normalizeLoose(card.title) === normalizeLoose(alias)) s = 1;
    if (s > best) { best = s; bestAlias = alias; }
  }

  const rootBest = identity.roots.reduce((m, r) => Math.max(m, similarity(shape.root, r)), 0);
  best = Math.max(best, rootBest * 0.93);

  const markers = markerCompatibility(shape, identity, requestedSeason);
  if (markers.reject) return { score: 0, reject: true, shape, bestAlias };

  let score = best + markers.delta;
  if (card.adapter === "guts") score -= 0.03;
  score = Math.max(0, Math.min(1.25, score));
  return { score, reject: false, shape, bestAlias };
}

function rankCandidates(cards, identity, tmdb, requestedSeason) {
  const ranked = [];
  const seen = new Set();
  for (const card of cards) {
    if (!card || !card.url) continue;
    const key = `${card.source.id}|${card.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scored = scoreCard(card, identity, tmdb, requestedSeason);
    if (!scored.reject && scored.score >= MIN_SCORE) ranked.push({ ...card, ...scored });
  }
  ranked.sort((a, b) => b.score - a.score);

  const selected = [];
  const counts = new Map();
  for (const item of ranked) {
    const count = counts.get(item.source.id) || 0;
    if (count >= 2) continue;
    selected.push(item); counts.set(item.source.id, count + 1);
    if (selected.length >= MAX_CANDIDATES) break;
  }
  if (selected.length < MAX_CANDIDATES) {
    for (const item of ranked) {
      if (selected.includes(item)) continue;
      selected.push(item);
      if (selected.length >= MAX_CANDIDATES) break;
    }
  }
  return selected;
}

function animeSlug(url) {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    const m = p.match(/\/anime\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  } catch (_) { return null; }
}

async function legacyEpisodeSheet(card) {
  const slug = animeSlug(card.url);
  if (!slug) return null;
  const d = await json(`${card.source.base}/ajax/film/sv?id=${encodeURIComponent(slug)}`, {
    headers: { "Referer": card.url, "X-Requested-With": "XMLHttpRequest" }
  }, 14000);
  const html = d && (d.html || d.result);
  if (!html) return null;
  const $ = cheerio.load(html);
  const episodes = [];
  $("ul.episodes.range li a[data-id]").each((_, el) => {
    const n = $(el); const dataId = n.attr("data-id") || "";
    const raw = n.text().trim() || dataId.split("/").pop() || "";
    const num = parseFloat(raw); if (Number.isFinite(num)) episodes.push(num);
  });
  const servers = [];
  $("span.tab[data-name]").each((_, el) => {
    const n = $(el); const id = String(n.attr("data-name") || "").trim();
    if (id) servers.push({ id, label: n.text().trim() || `Server ${servers.length + 1}` });
  });
  return { slug, episodes: Array.from(new Set(episodes)).sort((a, b) => a - b), servers };
}

function aniwavesSeriesId(url) {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    const m = p.match(/\/watch\/(?:[a-z0-9-]*-)?(\d+)$/i);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

async function aniwavesEpisodeSheet(card) {
  const id = aniwavesSeriesId(card.url);
  if (!id) return null;
  const d = await json(`${card.source.base}/ajax/episode/list/${encodeURIComponent(id)}`, {
    headers: { "Referer": card.url, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
  }, 14000);
  const html = d && d.result || "";
  if (!html) return null;
  const $ = cheerio.load(html);
  const episodes = [];
  $("a[data-num]").each((_, el) => {
    const n = $(el); const num = parseFloat(n.attr("data-num"));
    if (Number.isFinite(num)) episodes.push({ number: num, hasSub: n.attr("data-sub") === "1", hasDub: n.attr("data-dub") === "1" });
  });
  episodes.sort((a, b) => a.number - b.number);
  return { seriesId: id, episodes };
}

function chooseEpisodeNumber(ordered, mappedEpisode, requestedEpisode) {
  const nums = (ordered || []).map(x => typeof x === "number" ? x : x.number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mapped = Number(mappedEpisode);
  if (Number.isFinite(mapped) && nums.some(x => Math.abs(x - mapped) < 0.001)) return mapped;

  // Position fallback solves continuous-number records: mapped/local E1 can be the
  // first item even when the provider labels it #12, #25, etc.
  if (Number.isFinite(mapped) && mapped >= 1 && mapped <= nums.length && Number.isInteger(mapped)) return nums[mapped - 1];

  const requested = Number(requestedEpisode);
  if (Number.isFinite(requested) && nums.some(x => Math.abs(x - requested) < 0.001)) return requested;
  if (Number.isFinite(requested) && requested >= 1 && requested <= nums.length && Number.isInteger(requested)) return nums[requested - 1];
  return null;
}

async function legacyEpisodeInfo(card, slug, ep, serverId) {
  return json(`${card.source.base}/ajax/episode/info?epr=${encodeURIComponent(slug)}/${encodeURIComponent(ep)}/${encodeURIComponent(serverId)}`, {
    headers: { "Referer": card.url, "X-Requested-With": "XMLHttpRequest" }
  }, 14000);
}

function sourceUrl(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    const s = payload.trim();
    if (/^https?:\/\//i.test(s)) return s;
    try { return sourceUrl(JSON.parse(s)); } catch (_) { return null; }
  }
  if (Array.isArray(payload)) { for (const item of payload) { const u = sourceUrl(item); if (u) return u; } return null; }
  if (typeof payload === "object") return sourceUrl(payload.file || payload.url || payload.src || payload.sources || payload.source);
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

function tokenFromEmbed(body) {
  if (!body) return null;
  const z = String(body).match(/var\s+zrpart2\s*=\s*["']([A-Za-z0-9+/=]+)["']/i);
  if (z) return z[1];
  const h = String(body).match(/[`"']\/hs\/([A-Za-z0-9+/=]+)[`"']/i);
  return h ? h[1] : null;
}

async function getSources(embedBase, path, id, referer) {
  const d = await json(`${embedBase}${path}?id=${encodeURIComponent(id)}`, { headers: { "Referer": referer, "Origin": embedBase } }, 12000);
  return sourceUrl(d && (d.sources || d.source || d));
}

async function resolveJw(embedBase, token) {
  const page = `${embedBase}/hs/${token}`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;
  const id = playerDataId(body);
  if (id) return await getSources(embedBase, "/hs/getSources_z", id, page) || await getSources(embedBase, "/hs/getSources", id, page) || findMedia(body);
  return findMedia(body);
}

async function resolveLegacyPlayer(embedBase, token) {
  const page = `${embedBase}/hs/${token}?pl_usn=1`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;
  const raw = cheerio.load(body)("#sources").first().text().trim();
  return sourceUrl(raw) || findMedia(body);
}

async function resolveSbv2(embedBase, token) {
  const page = `${embedBase}/sbv2/${token}`;
  const body = await text(page, { headers: { "Referer": embedBase + "/" } }, 12000);
  if (!body) return null;
  const id = playerDataId(body);
  return id ? await getSources(embedBase, "/sbv2/getSources", id, page) || findMedia(body) : findMedia(body);
}

function subtitleTracks(raw, base, headers) {
  if (!raw) return [];
  let values;
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "object") values = [raw];
  else {
    try { const p = JSON.parse(String(raw)); values = Array.isArray(p) ? p : [p]; }
    catch (_) { values = [String(raw)]; }
  }
  const out = []; const seen = new Set();
  for (const item of values) {
    const obj = typeof item === "string" ? { url: item } : item || {};
    const u = abs(obj.file || obj.url || obj.src, base);
    if (!u || !/\.(?:vtt|srt|ass)(?:$|[?#])/i.test(u) || seen.has(u)) continue;
    seen.add(u);
    const l = String(obj.label || obj.name || obj.language || obj.lang || "English");
    out.push({ url: u, language: /ja|japan/i.test(l) ? "ja" : "en", lang: /ja|japan/i.test(l) ? "ja" : "en", name: `${l} [SOFTSUB]`, headers });
  }
  return out;
}

function quality(url) {
  const m = String(url || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p(?:[^0-9]|$)/i);
  return m ? `${m[1]}p` : "HD";
}

async function normalizeHls(url, headers) {
  const fallback = { url, quality: quality(url) };
  if (!url || !/\.m3u8(?:$|[?#])/i.test(String(url))) return fallback;
  const body = await text(url, { headers }, 9000);
  if (!body || !body.trimStart().startsWith("#EXTM3U")) return fallback;
  const lines = body.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const res = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i);
    let uri = null;
    for (let j = i + 1; j < lines.length; j++) if (!lines[j].startsWith("#")) { uri = lines[j]; break; }
    if (uri) variants.push({ url: abs(uri, url), height: res ? +res[2] : 0 });
  }
  if (!variants.length) return fallback;
  variants.sort((a, b) => b.height - a.height);
  return { url: variants[0].url || url, quality: variants[0].height ? `${variants[0].height}p` : fallback.quality };
}

function makeStream(url, mode, source, server, variant, tracks, headers, ctx, q) {
  if (!url) return null;
  const dub = mode === "dub";
  const tag = dub ? (tracks.length ? "DUB+SUBS" : "DUB") : (tracks.length ? "HARDSUB+SUBS" : "HARDSUB");
  const qualityLabel = q || quality(url);
  return {
    name: `${NAME} | ${source.label} | ${qualityLabel} [${tag}] • ${server} ${variant}`,
    title: `${ctx.title} • S${ctx.s}E${ctx.e} • ${dub ? "English Dub" : "Japanese"}`,
    url, quality: qualityLabel, provider: NAME,
    type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4",
    headers, language: dub ? "English" : "Japanese", subtitles: tracks
  };
}

async function resolveEmbed(card, embedUrl, mode, server, tracks, ctx) {
  if (!embedUrl) return [];
  const embedBase = origin(embedUrl);
  if (!embedBase) return [];
  const headers = { "User-Agent": UA, "Referer": embedBase + "/", "Origin": embedBase };
  if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(embedUrl)) {
    const n = await normalizeHls(embedUrl, headers);
    const stream = makeStream(n.url, mode, card.source, server, "Direct", tracks, headers, ctx, n.quality);
    return stream ? [stream] : [];
  }
  const body = await text(embedUrl, { headers: { "Referer": card.source.base + "/" } }, 12000);
  if (!body) return [];
  const token = tokenFromEmbed(body);
  const urls = token
    ? await Promise.all([resolveJw(embedBase, token), resolveLegacyPlayer(embedBase, token), resolveSbv2(embedBase, token)])
    : [findMedia(body)];
  const labels = token ? ["JW", "Legacy", "SBv2"] : ["Embed"];
  const out = []; const seen = new Set();
  for (let i = 0; i < urls.length; i++) {
    if (!urls[i]) continue;
    const n = await normalizeHls(urls[i], headers);
    if (!n.url || seen.has(n.url)) continue;
    seen.add(n.url);
    const stream = makeStream(n.url, mode, card.source, server, labels[i], tracks, headers, ctx, n.quality);
    if (stream) out.push(stream);
  }
  return out;
}

async function streamsLegacy(card, mappedEpisode, requestedEpisode, ctx) {
  const sheet = await legacyEpisodeSheet(card);
  if (!sheet || !sheet.servers.length) return [];
  const ep = chooseEpisodeNumber(sheet.episodes, mappedEpisode, requestedEpisode);
  if (ep == null) return [];
  const jobs = sheet.servers.slice(0, 6).map(async server => {
    const info = await legacyEpisodeInfo(card, sheet.slug, ep, server.id);
    if (!info || !info.target) return [];
    const embed = abs(info.target, card.source.base);
    const tracks = subtitleTracks(info.subtitle, origin(embed) || card.source.base, { "User-Agent": UA, "Referer": origin(embed) ? origin(embed) + "/" : card.source.base + "/" });
    return resolveEmbed(card, embed, card.mode === "dub" ? "dub" : "sub", server.label, tracks, ctx);
  });
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

async function streamsAniwaves(card, mappedEpisode, requestedEpisode, ctx) {
  const sheet = await aniwavesEpisodeSheet(card);
  if (!sheet || !sheet.episodes.length) return [];
  const ep = chooseEpisodeNumber(sheet.episodes, mappedEpisode, requestedEpisode);
  if (ep == null) return [];
  const d = await json(`${card.source.base}/ajax/server/list?servers=${encodeURIComponent(sheet.seriesId)}&eps=${encodeURIComponent(ep)}`, {
    headers: { "Referer": card.url, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
  }, 14000);
  const html = d && d.result || "";
  if (!html) return [];
  const $ = cheerio.load(html);
  const jobs = [];
  $(".type[data-type]").each((_, el) => {
    const block = $(el); const type = String(block.attr("data-type") || "").toLowerCase();
    if (type !== "sub" && type !== "dub") return;
    block.find("li[data-link-id]").slice(0, 3).each((__, li) => {
      const n = $(li); const linkId = n.attr("data-link-id"); const server = n.text().trim() || "Server";
      if (!linkId) return;
      jobs.push((async () => {
        const resolved = await json(`${card.source.base}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=1`, {
          headers: { "Referer": card.url, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
        }, 14000);
        const embed = resolved && resolved.result && resolved.result.url;
        return resolveEmbed(card, embed, type, server, [], ctx);
      })());
    });
  });
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

async function candidateStreams(card, mappedEpisode, requestedEpisode, ctx) {
  if (card.adapter === "legacy123") return streamsLegacy(card, mappedEpisode, requestedEpisode, ctx);
  if (card.adapter === "aniwaves") return streamsAniwaves(card, mappedEpisode, requestedEpisode, ctx);
  return [];
}

function streamKey(stream) {
  const hk = Object.entries(stream.headers || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k.toLowerCase()}=${v}`).join("&");
  const sk = (stream.subtitles || []).map(x => `${x.language || x.lang || ""}|${x.url || ""}`).sort().join(",");
  return `${stream.url}|${stream.language || ""}|${hk}|${sk}`;
}

function finalize(streams) {
  const out = []; const seen = new Set();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const key = streamKey(stream); if (seen.has(key)) continue;
    seen.add(key); out.push(stream);
  }
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
    const mappedEpisode = mapping && mapping.mal_episode != null ? parseFloat(mapping.mal_episode) : e;
    const identity = await buildIdentity(tmdb, mapping, s);
    if (!identity.queries.length || !identity.aliases.length) return [];

    console.log(`[${NAME}] v${VERSION} ${tmdb.title} S${s}E${e} MAL=${identity.mal || "?"} mappedEp=${mappedEpisode}`);
    console.log(`[${NAME}] queries: ${identity.queries.join(" | ")}`);

    const discovered = await Promise.allSettled(SOURCES.map(source => discoverSource(source, identity.queries)));
    const cards = discovered.flatMap(r => r.status === "fulfilled" ? r.value : []);
    const candidates = rankCandidates(cards, identity, tmdb, s);

    console.log(`[${NAME}] discovered=${cards.length} plausible=${candidates.length}`);
    for (const c of candidates.slice(0, 12)) console.log(`[${NAME}] candidate ${c.source.id} ${c.score.toFixed(2)} ${c.title}`);
    if (!candidates.length) return [];

    const jobs = candidates.map(c => candidateStreams(c, mappedEpisode, e, { title: c.title, s, e }).catch(() => []));
    const settled = await Promise.allSettled(jobs);
    const streams = finalize(settled.flatMap(r => r.status === "fulfilled" ? r.value : []));
    console.log(`[${NAME}] resolved ${streams.length} stream(s)`);
    return streams;
  } catch (e) {
    console.log(`[${NAME}] fatal: ${e && e.message ? e.message : e}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams,
    __test: { normalize, normalizeLoose, titleShape, similarity, scoreCard, rankCandidates, chooseEpisodeNumber, SOURCES }
  };
} else {
  globalThis.getStreams = getStreams;
}
