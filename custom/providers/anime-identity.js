"use strict";

// Shared Nexus anime identity resolver.
// Anime: MAL/Jikan + AniList aliases first, TMDB/IMDb aliases as fallback.
// Non-anime: TMDB/IMDb only, with no anime-database requests.

const DEFAULT_TMDB_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalize(value) {
  return String(value || "").toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, options) {
  try {
    const response = await fetch(url, {
      ...(options || {}),
      headers: {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        ...((options && options.headers) || {})
      },
      skipSizeCheck: true
    });
    if (!response || !response.ok) return null;
    return JSON.parse(String(await response.text() || "{}"));
  } catch (_) {
    return null;
  }
}

async function resolveTmdb(inputId, mediaType, apiKey) {
  const key = apiKey || DEFAULT_TMDB_KEY;
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  const raw = String(inputId || "").trim();
  let id = /^\d+$/.test(raw) ? Number(raw) : null;
  if (!id && /^tt\d+$/i.test(raw)) {
    const found = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${key}&external_source=imdb_id`);
    const list = type === "movie" ? found && found.movie_results : found && found.tv_results;
    id = Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
  }
  if (!id) return null;

  const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${id}?api_key=${key}&append_to_response=alternative_titles,external_ids`);
  if (!data) return null;

  const title = type === "movie" ? (data.title || data.original_title || "") : (data.name || data.original_name || "");
  const original = type === "movie" ? (data.original_title || title) : (data.original_name || title);
  const alternatives = type === "movie"
    ? ((data.alternative_titles && data.alternative_titles.titles) || []).map(x => x && x.title)
    : ((data.alternative_titles && data.alternative_titles.results) || []).map(x => x && x.title);
  const genres = (data.genres || []).map(x => Number(x && x.id || 0)).filter(Boolean);
  const countries = uniq([].concat(data.origin_country || []).concat((data.production_countries || []).map(x => x && x.iso_3166_1)));
  const originalLanguage = String(data.original_language || "").toLowerCase();
  const explicitAnimeType = String(mediaType || "").toLowerCase() === "anime";
  const isAnime = explicitAnimeType || (genres.includes(16) && (originalLanguage === "ja" || countries.includes("JP")));

  return {
    tmdbId: id,
    imdbId: String((data.external_ids && data.external_ids.imdb_id) || data.imdb_id || (/^tt\d+$/i.test(raw) ? raw : "")),
    type,
    title,
    originalTitle: original,
    year: String(data.release_date || data.first_air_date || "").slice(0, 4),
    originalLanguage,
    isAnime,
    fallbackAliases: uniq([title, original].concat(alternatives)).slice(0, 16)
  };
}

async function malPath(meta, season, episode) {
  if (!meta || !meta.imdbId) return { malId:null, mappedEpisode:null, aliases:[] };
  const s = meta.type === "movie" ? 1 : Number(season || 1);
  const e = meta.type === "movie" ? 1 : Number(episode || 1);
  const mapped = await fetchJson(`https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(meta.imdbId)}&s=${encodeURIComponent(String(s))}&e=${encodeURIComponent(String(e))}`);
  const malId = mapped && Number(mapped.mal_id || 0) || null;
  const mappedEpisode = mapped && Number(mapped.mal_episode || 0) || null;
  if (!malId) return { malId:null, mappedEpisode:null, aliases:[] };

  const jikan = await fetchJson(`https://api.jikan.moe/v4/anime/${malId}`);
  const data = jikan && jikan.data;
  const aliases = data ? uniq([
    data.title_english,
    data.title,
    data.title_japanese
  ].concat((data.titles || []).map(x => x && x.title)).concat(data.title_synonyms || [])) : [];
  return { malId, mappedEpisode, aliases };
}

function titleScore(candidate, aliases) {
  const a = normalize(candidate);
  if (!a) return 0;
  let best = 0;
  for (const alias of aliases || []) {
    const b = normalize(alias);
    if (!b) continue;
    if (a === b) best = Math.max(best, 100);
    else if (a.includes(b) || b.includes(a)) {
      const aw = a.split(" ").filter(Boolean), bw = b.split(" ").filter(Boolean);
      const overlap = bw.filter(x => x.length > 1 && aw.includes(x)).length;
      const needed = bw.filter(x => x.length > 1).length;
      if (needed && overlap === needed) best = Math.max(best, 85);
    }
  }
  return best;
}

async function anilistPath(meta) {
  if (!meta || !meta.fallbackAliases || !meta.fallbackAliases.length) return { anilistId:null, malId:null, aliases:[] };
  const query = "query($search:String){Media(search:$search,type:ANIME){id idMal seasonYear title{english romaji native userPreferred} synonyms}}";
  let best = null;

  for (const term of meta.fallbackAliases.slice(0, 4)) {
    const data = await fetchJson("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Accept":"application/json" },
      body: JSON.stringify({ query, variables:{ search:term } })
    });
    const media = data && data.data && data.data.Media;
    if (!media) continue;
    const t = media.title || {};
    const candidateAliases = uniq([t.english, t.romaji, t.userPreferred, t.native].concat(media.synonyms || []));
    const score = Math.max(...candidateAliases.map(x => titleScore(x, meta.fallbackAliases)));
    const yearBonus = meta.year && Number(media.seasonYear || 0) === Number(meta.year) ? 10 : 0;
    if (!best || score + yearBonus > best.score) best = { media, aliases:candidateAliases, score:score + yearBonus };
    if (best && best.score >= 110) break;
  }

  if (!best || best.score < 85) return { anilistId:null, malId:null, aliases:[] };
  return {
    anilistId: Number(best.media.id || 0) || null,
    malId: Number(best.media.idMal || 0) || null,
    aliases: best.aliases
  };
}

async function resolveAnimeIdentity(inputId, mediaType, season, episode, tmdbApiKey) {
  const meta = await resolveTmdb(inputId, mediaType, tmdbApiKey);
  if (!meta) return null;

  if (!meta.isAnime) {
    return {
      ...meta,
      aliases: meta.fallbackAliases.slice(),
      animeAliases: [],
      malId: null,
      anilistId: null,
      mappedEpisode: null,
      identitySource: "tmdb"
    };
  }

  // MAL and AniList are independent enrichment paths. Either may fail without
  // blocking the TMDB/IMDb fallback.
  const mal = await malPath(meta, season, episode);
  const ani = await anilistPath(meta);

  const animeAliases = uniq([].concat(mal.aliases || []).concat(ani.aliases || []));
  const aliases = uniq(animeAliases.concat(meta.fallbackAliases || [])).slice(0, 24);
  return {
    ...meta,
    aliases,
    animeAliases,
    malId: mal.malId || ani.malId || null,
    anilistId: ani.anilistId || null,
    mappedEpisode: mal.mappedEpisode || null,
    identitySource: animeAliases.length ? "anime-db" : "tmdb-fallback"
  };
}

module.exports = { resolveAnimeIdentity };
