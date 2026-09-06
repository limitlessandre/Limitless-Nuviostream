"use strict";

const PROVIDER_NAME = "Nexus API DIAG";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const TEST_TMDB_ID = 15130;
const TEST_IMDB_ID = "tt0218775";
const TEST_TITLE = "Monster Rancher";
const WCO_ORIGINS = [
  "https://www.wcostream.tv",
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net"
];
const REANIME_ORIGINS = [
  "https://reanime.to",
  "https://reanime.cz",
  "https://reanime.net"
];

async function request(url, options) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...(options || {}),
      headers: {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...((options && options.headers) || {})
      },
      skipSizeCheck: true
    });
    const text = String(await res.text() || "");
    return {
      ok: !!res.ok,
      status: Number(res.status || 0),
      url: String(res.url || url),
      text,
      ms: Date.now() - started
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url,
      text: "",
      ms: Date.now() - started,
      error: String(e && e.message || e)
    };
  }
}

function short(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > (max || 120) ? text.slice(0, max || 120) + "…" : text;
}

function isCloudflare(text) {
  const s = String(text || "").toLowerCase();
  return s.includes("just a moment") || s.includes("cf-chl-") || s.includes("challenge-platform") || s.includes("cloudflare ray id") || s.includes("attention required");
}

function row(label, ok, detail, url) {
  const state = ok ? "OK" : "FAIL";
  return {
    name: `${PROVIDER_NAME} • ${state} • ${label}`,
    title: short(detail || "No detail", 220),
    url: url || "https://example.com/",
    quality: "DIAG",
    provider: PROVIDER_NAME,
    type: "mp4",
    language: state,
    subtitles: []
  };
}

async function probeFetch() {
  const r = await request("https://example.com/");
  return row("NUVIO FETCH", r.ok && /Example Domain/i.test(r.text), `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length}`, r.url);
}

async function probeTmdb() {
  const url = `https://api.themoviedb.org/3/tv/${TEST_TMDB_ID}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const r = await request(url, { headers: { "Accept": "application/json" } });
  let data = null;
  try { data = JSON.parse(r.text); } catch (_) {}
  const name = data && (data.name || data.original_name);
  const imdb = data && data.external_ids && data.external_ids.imdb_id;
  const ok = r.ok && !!name;
  return {
    stream: row("TMDB", ok, `HTTP ${r.status} • ${r.ms}ms • name=${name || "?"} • imdb=${imdb || "?"}`, "https://www.themoviedb.org/"),
    imdbId: imdb || TEST_IMDB_ID
  };
}

async function probeMalMapper(imdbId) {
  const url = `https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(imdbId || TEST_IMDB_ID)}&s=1&e=1`;
  const r = await request(url, { headers: { "Accept": "application/json" } });
  let data = null;
  try { data = JSON.parse(r.text); } catch (_) {}
  const malId = data && Number(data.mal_id || 0);
  const malEpisode = data && (data.mal_episode != null ? data.mal_episode : "?");
  const ok = r.ok && !!malId;
  return {
    stream: row("MAL ID MAPPER", ok, `HTTP ${r.status} • ${r.ms}ms • mal_id=${malId || "?"} • mal_episode=${malEpisode}`, "https://myanimelist.net/"),
    malId: malId || null
  };
}

async function probeAniList(malId) {
  if (!malId) return row("ANILIST", false, "Skipped because MAL mapper returned no MAL id", "https://anilist.co/");
  const query = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native} synonyms}}";
  const r = await request("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: Number(malId) } })
  });
  let data = null;
  try { data = JSON.parse(r.text); } catch (_) {}
  const media = data && data.data && data.data.Media;
  const title = media && media.title && (media.title.english || media.title.romaji || media.title.native);
  const ok = r.ok && !!media;
  return row("ANILIST", ok, `HTTP ${r.status} • ${r.ms}ms • id=${media && media.id || "?"} • title=${title || "?"}`, "https://anilist.co/");
}

async function probeReAnime() {
  let last = null;
  for (const base of REANIME_ORIGINS) {
    const r = await request(`${base}/api/v1/search?q=${encodeURIComponent(TEST_TITLE)}&limit=5&offset=0`, {
      headers: { "Accept": "application/json, text/plain, */*", "Referer": `${base}/home` }
    });
    last = r;
    let data = null;
    try { data = JSON.parse(r.text); } catch (_) {}
    const results = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
    if (r.ok && results.length) {
      const first = results[0] || {};
      const id = first.anime_id || first.animeId || first.id || first.slug || "?";
      return row("RE:ANIME API", true, `${base} • HTTP ${r.status} • ${r.ms}ms • results=${results.length} • first=${id}`, base);
    }
  }
  return row("RE:ANIME API", false, `${last ? last.url : REANIME_ORIGINS[0]} • HTTP ${last ? last.status : 0} • ${last ? last.ms : 0}ms • ${last && last.error ? last.error : "no search results / invalid JSON"}`, REANIME_ORIGINS[0]);
}

async function probeFlixCloud() {
  const r = await request("https://flixcloud.cc/");
  const cf = isCloudflare(r.text);
  const ok = r.ok && !cf;
  return row("FLIXCLOUD", ok, `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length} • cloudflare=${cf ? "YES" : "no"}`, r.url || "https://flixcloud.cc/");
}

async function probeWco(base) {
  const url = `${base}/anime/monster-rancher/?season=all&lang=dub`;
  const r = await request(url, { headers: { "Referer": `${base}/` } });
  const cf = isCloudflare(r.text);
  const hasTitle = /Monster\s+Rancher/i.test(r.text);
  const hasEpisode = /Episode\s*1/i.test(r.text) || /monster-rancher-episode-1/i.test(r.text);
  const ok = r.ok && !cf && hasTitle && hasEpisode;
  return row(`WCO ${base.replace(/^https?:\/\/(?:www\.)?/i, "")}`, ok, `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length} • cloudflare=${cf ? "YES" : "no"} • title=${hasTitle ? "yes" : "no"} • ep1=${hasEpisode ? "yes" : "no"}`, r.url || url);
}

async function getStreams(inputId, mediaType, season, episode) {
  const out = [];

  out.push(await probeFetch());

  const tmdb = await probeTmdb();
  out.push(tmdb.stream);

  const mal = await probeMalMapper(tmdb.imdbId);
  out.push(mal.stream);
  out.push(await probeAniList(mal.malId));

  out.push(await probeReAnime());
  out.push(await probeFlixCloud());

  for (const base of WCO_ORIGINS) out.push(await probeWco(base));

  return out;
}

module.exports = { getStreams };
