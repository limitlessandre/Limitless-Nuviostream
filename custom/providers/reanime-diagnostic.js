"use strict";

const PROVIDER_NAME = "Re:ANIME Diagnostic";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const REANIME_DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

function diag(label, detail) {
  const clean = String(detail == null ? "" : detail).replace(/\s+/g, " ").trim().slice(0, 220);
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

async function probeJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...BASE_HEADERS, ...(options.headers || {}) },
      skipSizeCheck: true
    });
    const status = response ? response.status : 0;
    const finalUrl = response && response.url ? response.url : url;
    let text = "";
    try { text = String(await response.text() || ""); } catch (_) {}
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    return { ok: !!(response && response.ok), status, finalUrl, text, data };
  } catch (error) {
    return { ok: false, status: 0, finalUrl: url, text: "", data: null, error: String(error && error.message || error) };
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return [value.english, value.romaji, value.native, value.userPreferred].filter(Boolean).join(" / ");
  }
  return String(value);
}

function slugFromCandidate(candidate) {
  return String(candidate && (candidate.anime_id || candidate.animeId || candidate.slug || candidate.id) || "").trim();
}

function searchResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function candidateLabel(candidate) {
  return titleText(candidate && candidate.title) || candidate && (candidate.name || candidate.english_title || candidate.romaji_title) || slugFromCandidate(candidate) || "unnamed";
}

function significantTokens(value) {
  const stop = new Set(["the", "and", "episode", "special", "season", "part", "cour", "jobless", "reincarnation"]);
  return normalize(value).split(" ").filter(token => token.length >= 4 && !stop.has(token));
}

function candidateScore(candidate, specialName, showTitle) {
  const hay = normalize([
    titleText(candidate && candidate.title),
    candidate && candidate.name,
    candidate && candidate.english_title,
    candidate && candidate.romaji_title,
    candidate && candidate.alternative_title,
    candidate && candidate.anime_id,
    candidate && candidate.slug
  ].filter(Boolean).join(" "));
  if (!hay) return 0;
  const specialTokens = significantTokens(specialName);
  if (!specialTokens.length || !specialTokens.every(token => hay.includes(token))) return 0;
  let score = 80 + specialTokens.length * 5;
  for (const token of significantTokens(showTitle).slice(0, 4)) if (hay.includes(token)) score += 3;
  if (/\bepisode\s*0\b|\bspecial\b|\bova\b/.test(hay)) score += 8;
  return score;
}

async function resolveTmdbId(inputId) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return { id: parseInt(raw, 10), detail: `numeric ${raw}` };
  if (!/^tt\d+$/i.test(raw)) return { id: null, detail: `unsupported id ${raw || "empty"}` };
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  const p = await probeJson(url);
  const list = p.data && p.data.tv_results;
  const id = Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
  return { id, detail: `HTTP ${p.status} results=${Array.isArray(list) ? list.length : 0}${id ? ` tmdb=${id}` : ""}` };
}

async function searchDomain(base, path) {
  const p = await probeJson(`${base}${path}`, { headers: { "Referer": `${base}/home` } });
  return { ...p, base, results: searchResults(p.data) };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const rows = [];
  try {
    const type = String(mediaType || "tv").toLowerCase();
    rows.push(diag("INPUT", `id=${inputId} type=${type} S${season} E${episode}`));
    if (type === "movie" || Number(season) !== 0) {
      rows.push(diag("STOP", "diagnostic only runs for Season 0 TV/anime requests"));
      return rows;
    }

    const resolved = await resolveTmdbId(inputId);
    rows.push(diag("TMDB ID", resolved.detail));
    if (!resolved.id) return rows;

    const showProbe = await probeJson(`https://api.themoviedb.org/3/tv/${resolved.id}?api_key=${TMDB_API_KEY}`);
    const show = showProbe.data || {};
    const showTitle = show.name || show.original_name || "";
    const originalTitle = show.original_name || show.name || "";
    rows.push(diag("TMDB SHOW", `HTTP ${showProbe.status} ${showTitle || "no title"}`));

    const specialProbe = await probeJson(`https://api.themoviedb.org/3/tv/${resolved.id}/season/0/episode/${encodeURIComponent(String(episode))}?api_key=${TMDB_API_KEY}`);
    const special = specialProbe.data || {};
    rows.push(diag("TMDB SPECIAL", `HTTP ${specialProbe.status} name=${special.name || "none"}`));
    if (!special.name) return rows;

    const terms = [...new Set([
      `${showTitle} ${special.name}`.trim(),
      special.name,
      `${originalTitle} ${special.name}`.trim()
    ].filter(Boolean))];

    const allCandidates = new Map();
    for (let ti = 0; ti < terms.length; ti++) {
      const term = terms[ti];
      let foundAny = false;
      for (const base of REANIME_DOMAINS) {
        for (const endpoint of ["/api/v1/search", "/api/search"]) {
          const path = `${endpoint}?q=${encodeURIComponent(term)}&limit=15&offset=0`;
          const result = await searchDomain(base, path);
          rows.push(diag(`SEARCH ${ti + 1}`, `${base.replace(/^https:\/\//, "")} ${endpoint} HTTP ${result.status} hits=${result.results.length} q=${term}`));
          if (result.results.length) {
            foundAny = true;
            result.results.slice(0, 5).forEach(candidate => {
              const slug = slugFromCandidate(candidate);
              const key = slug || candidateLabel(candidate);
              if (!allCandidates.has(key)) allCandidates.set(key, candidate);
            });
            break;
          }
        }
        if (foundAny) break;
      }
    }

    const candidates = [...allCandidates.values()].map(candidate => ({
      candidate,
      slug: slugFromCandidate(candidate),
      label: candidateLabel(candidate),
      score: candidateScore(candidate, special.name, showTitle)
    })).sort((a, b) => b.score - a.score);

    rows.push(diag("CANDIDATES", `unique=${candidates.length} scored=${candidates.filter(x => x.score > 0).length}`));
    candidates.slice(0, 5).forEach((item, index) => {
      rows.push(diag(`CAND ${index + 1}`, `score=${item.score} slug=${item.slug || "none"} title=${item.label}`));
    });

    const ranked = candidates.filter(x => x.score > 0).slice(0, 5);
    if (!ranked.length) {
      rows.push(diag("FAIL", "search returned no candidate that passed special-title scoring"));
      return rows;
    }

    for (let i = 0; i < ranked.length; i++) {
      const item = ranked[i];
      if (!item.slug) {
        rows.push(diag(`WATCH ${i + 1}`, "candidate has no usable slug"));
        continue;
      }
      let watchFound = false;
      for (const base of REANIME_DOMAINS) {
        const watch = await probeJson(`${base}/api/watch/${encodeURIComponent(item.slug)}/1`, { headers: { "Referer": `${base}/home` } });
        const links = watch.data && Array.isArray(watch.data.episode_links) ? watch.data.episode_links : [];
        const anime = watch.data && watch.data.anime;
        const aid = anime && (anime.anilist || anime.anilist_id || anime.anilistId);
        rows.push(diag(`WATCH ${i + 1}`, `${base.replace(/^https:\/\//, "")} HTTP ${watch.status} links=${links.length} anilist=${aid || "none"} slug=${item.slug}`));
        if (watch.ok && watch.data) {
          watchFound = true;
          if (links.length) {
            const types = [...new Set(links.map(x => String(x && x.dataType || "?")).filter(Boolean))].join(",");
            const servers = [...new Set(links.map(x => String(x && x.serverName || "?")).filter(Boolean))].join(",");
            rows.push(diag("SUCCESS", `episode_links=${links.length} types=${types || "none"} servers=${servers || "none"}`));
            return rows;
          }
          rows.push(diag("NO LINKS", `watch page exists but episode_links is empty for ${item.slug}`));
          break;
        }
      }
      if (!watchFound) rows.push(diag(`WATCH ${i + 1}`, `no domain returned a watch payload for ${item.slug}`));
    }

    rows.push(diag("FAIL", "ranked candidates existed, but no playable episode_links were found"));
    return rows;
  } catch (error) {
    rows.push(diag("ERROR", String(error && error.message || error)));
    return rows;
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
