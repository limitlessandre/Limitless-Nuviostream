"use strict";

const PROVIDER_NAME = "Re:ANIME Diagnostic";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

function diag(label, detail) {
  const clean = String(detail == null ? "" : detail).replace(/\s+/g, " ").trim().slice(0, 260);
  return {
    name: `${PROVIDER_NAME} • ${label}${clean ? ` • ${clean}` : ""}`,
    title: `${label}${clean ? ` • ${clean}` : ""}`,
    url: "https://reanime.to/favicon.ico",
    quality: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4",
    language: "Diagnostic",
    subtitles: []
  };
}

async function probe(url, base) {
  try {
    const response = await fetch(url, {
      headers: { ...HEADERS, ...(base ? { "Referer": `${base}/home` } : {}) },
      skipSizeCheck: true
    });
    const status = response ? response.status : 0;
    let text = "";
    try { text = String(await response.text() || ""); } catch (_) {}
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    return { ok: !!(response && response.ok), status, data, text };
  } catch (error) {
    return { ok: false, status: 0, data: null, text: "", error: String(error && error.message || error) };
  }
}

function resultsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function slugOf(item) {
  return String(item && (item.anime_id || item.animeId || item.slug || item.id) || "").trim();
}

function titleOf(item) {
  const t = item && item.title;
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return [t.english, t.romaji, t.native, t.userPreferred].filter(Boolean).join(" / ");
  return String(item && (item.name || item.english_title || item.romaji_title) || "");
}

function keysOf(item) {
  return item && typeof item === "object" ? Object.keys(item).sort().join(",") : "none";
}

function idSummary(item) {
  if (!item || typeof item !== "object") return "none";
  const pairs = [
    ["anime_id", item.anime_id], ["id", item.id], ["slug", item.slug],
    ["anilist", item.anilist], ["anilist_id", item.anilist_id], ["anilistId", item.anilistId],
    ["mal", item.mal], ["mal_id", item.mal_id], ["tmdb", item.tmdb], ["tmdb_id", item.tmdb_id],
    ["type", item.type], ["format", item.format]
  ].filter(pair => pair[1] !== undefined && pair[1] !== null && String(pair[1]) !== "");
  return pairs.length ? pairs.map(([k, v]) => `${k}=${String(v)}`).join(" ") : "no common ids";
}

function extractAniList(item) {
  if (!item || typeof item !== "object") return null;
  for (const key of ["anilist", "anilist_id", "anilistId"]) {
    const value = Number(item[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const covers = [item.cover_image, item.coverImage, item.image, item.poster].filter(Boolean);
  for (const cover of covers) {
    if (typeof cover === "string") {
      const m = cover.match(/\/bx(\d+)-/i); if (m) return Number(m[1]);
    } else if (cover && typeof cover === "object") {
      for (const value of Object.values(cover)) {
        const m = String(value || "").match(/\/bx(\d+)-/i); if (m) return Number(m[1]);
      }
    }
  }
  return null;
}

function episodeCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.data)) return data.data.length;
  if (data && Array.isArray(data.episodes)) return data.episodes.length;
  return 0;
}

function serverCount(data) {
  return data && data.success && Array.isArray(data.servers) ? data.servers.length : 0;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const rows = [diag("INPUT", `id=${inputId} type=${mediaType} S${season} E${episode}`)];
  try {
    if (String(mediaType || "tv").toLowerCase() === "movie" || Number(season) !== 0) {
      rows.push(diag("STOP", "deep diagnostic only runs for Season 0"));
      return rows;
    }

    const raw = String(inputId || "").trim();
    let tmdbId = /^\d+$/.test(raw) ? Number(raw) : null;
    if (!tmdbId && /^tt\d+$/i.test(raw)) {
      const found = await probe(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
      const list = found.data && found.data.tv_results;
      tmdbId = Array.isArray(list) && list[0] ? Number(list[0].id) : null;
      rows.push(diag("TMDB FIND", `HTTP ${found.status} results=${Array.isArray(list) ? list.length : 0} id=${tmdbId || "none"}`));
    }
    if (!tmdbId) return rows.concat(diag("FAIL", "no TMDB id"));

    const showP = await probe(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
    const show = showP.data || {};
    const showTitle = show.name || show.original_name || "";
    rows.push(diag("TMDB SHOW", `HTTP ${showP.status} ${showTitle || "none"}`));

    const specialP = await probe(`https://api.themoviedb.org/3/tv/${tmdbId}/season/0/episode/${encodeURIComponent(String(episode))}?api_key=${TMDB_API_KEY}`);
    const special = specialP.data || {};
    const specialTitle = special.name || "";
    rows.push(diag("TMDB SPECIAL", `HTTP ${specialP.status} ${specialTitle || "none"}`));
    if (!specialTitle) return rows;

    let candidate = null;
    let searchBase = null;
    const terms = [...new Set([`${showTitle} ${specialTitle}`.trim(), specialTitle].filter(Boolean))];
    for (const term of terms) {
      for (const base of REANIME_DOMAINS) {
        const p = await probe(`${base}/api/v1/search?q=${encodeURIComponent(term)}&limit=15&offset=0`, base);
        const hits = resultsOf(p.data);
        rows.push(diag("SEARCH", `${base.replace(/^https:\/\//, "")} HTTP ${p.status} hits=${hits.length} q=${term}`));
        if (hits.length) {
          candidate = hits.find(x => /guardian\s*fitz/i.test(`${titleOf(x)} ${slugOf(x)}`)) || hits[0];
          searchBase = base;
          break;
        }
      }
      if (candidate) break;
    }
    if (!candidate) return rows.concat(diag("FAIL", "no Re:ANIME search candidate"));

    const slug = slugOf(candidate);
    rows.push(diag("CANDIDATE", `title=${titleOf(candidate)} slug=${slug || "none"}`));
    rows.push(diag("CAND KEYS", keysOf(candidate)));
    rows.push(diag("CAND IDS", idSummary(candidate)));
    let aniListId = extractAniList(candidate);
    rows.push(diag("CAND ANILIST", aniListId || "none"));
    if (!slug) return rows;

    const detailPaths = [`/api/v1/anime/${encodeURIComponent(slug)}`, `/api/anime/${encodeURIComponent(slug)}`];
    for (const path of detailPaths) {
      const p = await probe(`${searchBase}${path}`, searchBase);
      rows.push(diag("DETAIL", `${path} HTTP ${p.status} keys=${keysOf(p.data)}`));
      if (p.ok && p.data) {
        rows.push(diag("DETAIL IDS", idSummary(p.data)));
        aniListId = aniListId || extractAniList(p.data);
      }
    }
    rows.push(diag("RESOLVED ANILIST", aniListId || "none"));

    for (const ep of [0, 1]) {
      for (const base of REANIME_DOMAINS) {
        const p = await probe(`${base}/api/watch/${encodeURIComponent(slug)}/${ep}`, base);
        const links = p.data && Array.isArray(p.data.episode_links) ? p.data.episode_links.length : 0;
        const watchAni = extractAniList(p.data && p.data.anime);
        rows.push(diag(`WATCH ${ep}`, `${base.replace(/^https:\/\//, "")} HTTP ${p.status} links=${links} anilist=${watchAni || "none"}`));
        if (watchAni) aniListId = aniListId || watchAni;
      }
    }

    for (const base of REANIME_DOMAINS) {
      for (const path of [`/api/episodes/${encodeURIComponent(slug)}`, `/api/v1/episodes/${encodeURIComponent(slug)}`]) {
        const p = await probe(`${base}${path}`, base);
        rows.push(diag("EPISODES", `${base.replace(/^https:\/\//, "")} ${path.split("/").slice(0,4).join("/")} HTTP ${p.status} count=${episodeCount(p.data)}`));
        if (p.ok) break;
      }
    }

    rows.push(diag("FINAL ANILIST", aniListId || "none"));
    if (aniListId) {
      for (const ep of [0, 1]) {
        for (const base of REANIME_DOMAINS) {
          const p = await probe(`${base}/api/flix/${aniListId}/${ep}`, base);
          rows.push(diag(`FLIX ${ep}`, `${base.replace(/^https:\/\//, "")} HTTP ${p.status} success=${!!(p.data && p.data.success)} servers=${serverCount(p.data)}`));
        }
      }
    } else {
      rows.push(diag("FLIX", "skipped because no AniList id could be recovered"));
    }

    return rows;
  } catch (error) {
    rows.push(diag("ERROR", String(error && error.message || error)));
    return rows;
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
