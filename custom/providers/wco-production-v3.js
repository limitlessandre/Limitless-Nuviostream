"use strict";

// Production WCO safety wrapper.
// Runs the existing production provider unchanged, then suppresses Japanese/Hard-Subs
// rows for titles whose TMDB original language is English. Also provides a narrowly
// identity-gated alias fallback for Monster Rancher / Monster Farm after the normal
// production path returns no streams.

const PROVIDER_NAME = "WCO";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production-v2.js";
const MONSTER_ALIAS_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-monster-rancher-alias.js";
let cached = null;
let monsterAliasCached = null;

async function loadModule(url, cacheName) {
  if (cacheName === "base" && cached && typeof cached.getStreams === "function") return cached;
  if (cacheName === "monster" && monsterAliasCached && typeof monsterAliasCached.getStreams === "function") return monsterAliasCached;
  try {
    const res = await fetch(url, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const source = String(await res.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    if (cacheName === "base") cached = exported;
    if (cacheName === "monster") monsterAliasCached = exported;
    return exported;
  } catch (_) { return null; }
}

async function loadBase() {
  return await loadModule(BASE_URL, "base");
}

async function loadMonsterAlias() {
  return await loadModule(MONSTER_ALIAS_URL, "monster");
}

function isMonsterRancherIdentity(inputId, mediaType) {
  if (String(mediaType || "tv").toLowerCase() === "movie") return false;
  const raw = String(inputId || "").trim().toLowerCase();
  return raw === "15130" || raw === "tt0218775";
}

async function tmdbOriginalLanguage(inputId, mediaType) {
  try {
    const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
    const raw = String(inputId || "").trim();
    let id = /^\d+$/.test(raw) ? Number(raw) : null;
    if (!id && /^tt\d+$/i.test(raw)) {
      const f = await fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, { skipSizeCheck: true });
      if (!f || !f.ok) return "";
      const data = JSON.parse(String(await f.text() || "{}"));
      const list = type === "movie" ? data.movie_results : data.tv_results;
      id = Array.isArray(list) && list[0] && list[0].id ? Number(list[0].id) : null;
    }
    if (!id) return "";
    const r = await fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}`, { skipSizeCheck: true });
    if (!r || !r.ok) return "";
    const data = JSON.parse(String(await r.text() || "{}"));
    return String(data.original_language || "").toLowerCase();
  } catch (_) { return ""; }
}

function isJapaneseRow(row) {
  const language = String(row && row.language || "").toLowerCase();
  const name = String(row && row.name || "").toLowerCase();
  return language === "japanese" || name.includes("japanese + english hard subs") || name.includes("japanese hard subs");
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  let rows = [];
  try { rows = await base.getStreams(inputId, mediaType, season, episode); }
  catch (_) { rows = []; }

  if ((!Array.isArray(rows) || !rows.length) && isMonsterRancherIdentity(inputId, mediaType)) {
    const alias = await loadMonsterAlias();
    if (alias) {
      try { rows = await alias.getStreams(inputId, mediaType, season, episode); }
      catch (_) { rows = []; }
    }
  }

  if (!Array.isArray(rows) || !rows.length) return [];

  const originalLanguage = await tmdbOriginalLanguage(inputId, mediaType);
  if (originalLanguage !== "en") return rows;
  return rows.filter(row => !isJapaneseRow(row));
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

module.exports = { getStreams, onSettings };
