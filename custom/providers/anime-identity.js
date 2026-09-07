"use strict";

// Shared Nexus anime identity resolver.
// Anime: MAL/Jikan first, AniList supplements sparse/failed MAL title sets, then
// TMDB/IMDb aliases remain the safety fallback. Non-anime never calls anime DBs.

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

function usableLatinAliases(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const n = normalize(value);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
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

async function tmdbLocalizedAliases(id, type, title, original, year, apiKey) {
  const key = apiKey || DEFAULT_TMDB_KEY;
  const out = [];

  // First ask TMDB for the same exact id in common English locales. This cannot
  // drift to another title because the TMDB id is already fixed.
  for (const language of ["en-US", "en-GB"]) {
    const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${id}?api_key=${key}&language=${language}`);
    if (!data) continue;
    if (type === "movie") out.push(data.title, data.original_title);
    else out.push(data.name, data.original_name);
  }

  // TMDB text search also indexes translated and AKA names. Use it only as an alias
  // recovery step and only accept a result whose id is exactly the already-resolved
  // TMDB id, so no fuzzy cross-title match can enter the identity set.
  for (const term of uniq([title, original]).slice(0, 2)) {
    const yearPart = year
      ? (type === "movie" ? `&primary_release_year=${encodeURIComponent(year)}` : `&first_air_date_year=${encodeURIComponent(year)}`)
      : "";
    const data = await fetchJson(`https://api.themoviedb.org/3/search/${type}?api_key=${key}&language=en-US&query=${encodeURIComponent(term)}${yearPart}`);
    const results = data && Array.isArray(data.results) ? data.results : [];
    const match = results.find(x => Number(x && x.id || 0) === Number(id));
    if (!match) continue;
    if (type === "movie") out.push(match.title, match.original_title);
    else out.push(match.name, match.original_name);
  }

  return uniq(out);
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
  const year = String(data.release_date || data.first_air_date || "").slice(0, 4);

  let fallbackAliases = uniq([title, original].concat(alternatives));
  if (isAnime) {
    const localized = await tmdbLocalizedAliases(id, type, title, original, year, key);
    fallbackAliases = uniq(fallbackAliases.concat(localized));
  }

  return {
    tmdbId: id,
    imdbId: String((data.external_ids && data.external_ids.imdb_id) || data.imdb_id || (/^tt\d+$/i.test(raw) ? raw : "")),
    type,
    title,
    originalTitle: original,
    year,
    originalLanguage,
    isAnime,
    fallbackAliases: fallbackAliases.slice(0, 20)
  };
}

function titleScore(candidate, aliases) {
  const a = normalize(candidate);
  if (!a) return 0;
  let best = 0;
  for (const alias of aliases || []) {
    const b = normalize(alias);
    if (!b) continue;
    if (a === b) {
      best = Math.max(best, 100);
      continue;
    }

    const aw = a.split(" ").filter(Boolean);
    const bw = b.split(" ").filter(Boolean);
    const meaningful = bw.filter(x => x.length > 1);
    const overlap = meaningful.filter(x => aw.includes(x)).length;

    // Anime databases often store a longer canonical/romaji title while TMDB has
    // the shorter franchise title. Treat a full multi-word prefix/phrase match as
    // strong rather than rejecting it solely because the canonical title is longer.
    // Example: "Monster Farm" -> "Monster Farm: Enbanseki no Himitsu".
    if (meaningful.length >= 2 && overlap === meaningful.length && (a.startsWith(b) || a.includes(b))) {
      best = Math.max(best, 90);
      continue;
    }

    const needed = meaningful.length;
    if (needed && overlap === needed && Math.min(aw.length, bw.length) / Math.max(aw.length, bw.length) >= 0.7) {
      best = Math.max(best, 85);
    }
  }
  return best;
}

function jikanAliases(item) {
  return uniq([
    item && item.title_english,
    item && item.title,
    item && item.title_japanese
  ].concat((item && item.titles || []).map(x => x && x.title)).concat((item && item.title_synonyms) || []));
}

async function malPath(meta, season, episode) {
  if (!meta || !meta.fallbackAliases || !meta.fallbackAliases.length) return { malId:null, mappedEpisode:null, aliases:[] };
  let best = null;
  for (const term of meta.fallbackAliases.slice(0, 4)) {
    const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(term)}&limit=10&sfw=false`);
    const results = data && Array.isArray(data.data) ? data.data : [];
    for (const item of results) {
      const aliases = jikanAliases(item);
      const score = Math.max(0, ...aliases.map(x => titleScore(x, meta.fallbackAliases)));
      const itemYear = Number(item && item.year || (item && item.aired && item.aired.from ? String(item.aired.from).slice(0,4) : 0));
      const yearBonus = meta.year && itemYear === Number(meta.year) ? 10 : 0;
      const total = score + yearBonus;
      if (!best || total > best.score) best = { item, aliases, score:total };
    }
    if (best && best.score >= 100) break;
  }
  if (!best || best.score < 85) return { malId:null, mappedEpisode:null, aliases:[] };
  return {
    malId: Number(best.item.mal_id || 0) || null,
    mappedEpisode: meta.type === "movie" ? 1 : Number(episode || 1),
    aliases: best.aliases
  };
}

function anilistAliases(media) {
  const t = media && media.title || {};
  return uniq([t.english, t.romaji, t.userPreferred, t.native].concat(media && media.synonyms || []));
}

async function anilistPath(meta, knownMalId) {
  if (!meta || !meta.fallbackAliases || !meta.fallbackAliases.length) return { anilistId:null, malId:null, aliases:[] };

  // When MAL/Jikan already resolved an exact MAL id, use that id to enrich from
  // AniList instead of re-searching by title. This is both safer and much better at
  // recovering English aliases such as Monster Rancher from Monster Farm.
  if (knownMalId) {
    const byIdQuery = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal seasonYear title{english romaji native userPreferred} synonyms}}";
    const byId = await fetchJson("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Accept":"application/json" },
      body: JSON.stringify({ query:byIdQuery, variables:{ idMal:Number(knownMalId) } })
    });
    const media = byId && byId.data && byId.data.Media;
    if (media) {
      return {
        anilistId: Number(media.id || 0) || null,
        malId: Number(media.idMal || knownMalId) || Number(knownMalId),
        aliases: anilistAliases(media)
      };
    }
  }

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
    const candidateAliases = anilistAliases(media);
    const score = Math.max(0, ...candidateAliases.map(x => titleScore(x, meta.fallbackAliases)));
    const yearBonus = meta.year && Number(media.seasonYear || 0) === Number(meta.year) ? 10 : 0;
    if (!best || score + yearBonus > best.score) best = { media, aliases:candidateAliases, score:score + yearBonus };
    if (best && best.score >= 100) break;
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
    return { ...meta, aliases:meta.fallbackAliases.slice(), animeAliases:[], malId:null, anilistId:null, mappedEpisode:null, identitySource:"tmdb" };
  }

  const mal = await malPath(meta, season, episode);
  let ani = { anilistId:null, malId:null, aliases:[] };
  const usableMalAliases = usableLatinAliases(mal.aliases || []);
  if (!mal.malId || usableMalAliases.length < 2) {
    ani = await anilistPath(meta, mal.malId || null);
  }

  const animeAliases = uniq([].concat(mal.aliases || []).concat(ani.aliases || []));
  const aliases = uniq(animeAliases.concat(meta.fallbackAliases || [])).slice(0, 24);
  return {
    ...meta,
    aliases,
    animeAliases,
    malId: mal.malId || ani.malId || null,
    anilistId: ani.anilistId || null,
    mappedEpisode: mal.mappedEpisode || null,
    identitySource: mal.malId ? (ani.anilistId ? "mal+anilist" : "mal") : ani.anilistId ? "anilist" : "tmdb-fallback"
  };
}

module.exports = { resolveAnimeIdentity };
