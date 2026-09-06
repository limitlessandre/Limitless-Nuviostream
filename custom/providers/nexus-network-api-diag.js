"use strict";

const PROVIDER_NAME = "Nexus API DIAG";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const TEST_TMDB_ID = 15130;
const TEST_IMDB_ID = "tt0218775";
const TEST_MAL_ID = 1469;
const TEST_TITLE = "Monster Rancher";

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
    return { ok: !!res.ok, status: Number(res.status || 0), url: String(res.url || url), text, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, url, text: "", ms: Date.now() - started, error: String(e && e.message || e) };
  }
}

function short(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > (max || 180) ? text.slice(0, max || 180) + "…" : text;
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
  return row("NUVIO FETCH", r.ok && /Example Domain/i.test(r.text), `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length}${r.error ? ` • ${r.error}` : ""}`, r.url);
}

async function probeTmdb() {
  const url = `https://api.themoviedb.org/3/tv/${TEST_TMDB_ID}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const r = await request(url, { headers: { "Accept": "application/json" } });
  let data = null; try { data = JSON.parse(r.text); } catch (_) {}
  const name = data && (data.name || data.original_name);
  const imdb = data && data.external_ids && data.external_ids.imdb_id;
  return row("TMDB", r.ok && !!name, `HTTP ${r.status} • ${r.ms}ms • name=${name || "?"} • imdb=${imdb || "?"}${r.error ? ` • ${r.error}` : ""}`, "https://www.themoviedb.org/");
}

async function probeMalMapper() {
  const url = `https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(TEST_IMDB_ID)}&s=1&e=1`;
  const r = await request(url, { headers: { "Accept": "application/json" } });
  let data = null; try { data = JSON.parse(r.text); } catch (_) {}
  const malId = data && Number(data.mal_id || 0);
  const malEpisode = data && (data.mal_episode != null ? data.mal_episode : "?");
  return row("MAL ID MAPPER", r.ok && !!malId, `HTTP ${r.status} • ${r.ms}ms • mal_id=${malId || "?"} • mal_episode=${malEpisode}${r.error ? ` • ${r.error}` : ""}`, "https://myanimelist.net/");
}

async function probeAniList() {
  const query = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native} synonyms}}";
  const r = await request("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: TEST_MAL_ID } })
  });
  let data = null; try { data = JSON.parse(r.text); } catch (_) {}
  const media = data && data.data && data.data.Media;
  const title = media && media.title && (media.title.english || media.title.romaji || media.title.native);
  return row("ANILIST", r.ok && !!media, `HTTP ${r.status} • ${r.ms}ms • id=${media && media.id || "?"} • title=${title || "?"}${r.error ? ` • ${r.error}` : ""}`, "https://anilist.co/");
}

async function probeReAnime() {
  const base = "https://reanime.to";
  const r = await request(`${base}/api/v1/search?q=${encodeURIComponent(TEST_TITLE)}&limit=5&offset=0`, { headers: { "Accept": "application/json, text/plain, */*", "Referer": `${base}/home` } });
  let data = null; try { data = JSON.parse(r.text); } catch (_) {}
  const results = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
  const first = results[0] || {};
  const id = first.anime_id || first.animeId || first.id || first.slug || "?";
  return row("RE:ANIME API", r.ok && results.length > 0, `HTTP ${r.status} • ${r.ms}ms • results=${results.length} • first=${id}${r.error ? ` • ${r.error}` : ""}`, base);
}

async function probeFlixCloud() {
  const r = await request("https://flixcloud.cc/");
  const cf = isCloudflare(r.text);
  return row("FLIXCLOUD", r.ok && !cf, `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length} • cloudflare=${cf ? "YES" : "no"}${r.error ? ` • ${r.error}` : ""}`, r.url || "https://flixcloud.cc/");
}

async function probeWco() {
  const base = "https://www.wcostream.tv";
  const url = `${base}/anime/monster-rancher/?season=all&lang=dub`;
  const r = await request(url, { headers: { "Referer": `${base}/` } });
  const cf = isCloudflare(r.text);
  const hasTitle = /Monster\s+Rancher/i.test(r.text);
  const hasEpisode = /Episode\s*1/i.test(r.text) || /monster-rancher-episode-1/i.test(r.text);
  return row("WCO wcostream.tv", r.ok && !cf && hasTitle && hasEpisode, `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length} • cloudflare=${cf ? "YES" : "no"} • title=${hasTitle ? "yes" : "no"} • ep1=${hasEpisode ? "yes" : "no"}${r.error ? ` • ${r.error}` : ""}`, r.url || url);
}

async function getStreams(inputId, mediaType, season, episode) {
  const n = Number(episode || 1);
  if (n === 1) return [await probeFetch()];
  if (n === 2) return [await probeTmdb()];
  if (n === 3) return [await probeMalMapper()];
  if (n === 4) return [await probeAniList()];
  if (n === 5) return [await probeReAnime()];
  if (n === 6) return [await probeFlixCloud()];
  if (n === 7) return [await probeWco()];
  return [row("SELECT EPISODE 1-7", false, "E1 Nuvio fetch • E2 TMDB • E3 MAL mapper • E4 AniList • E5 Re:ANIME • E6 FlixCloud • E7 WCO", "https://example.com/")];
}

module.exports = { getStreams };
