"use strict";

// Temporary Nexus failure-only identity diagnostic wrapper for Tubi.
// Successful playback rows are returned untouched. When Tubi has no real stream,
// expose the shared anime identity result first so alias failures are observable.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/tubi-production.js";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DIAG_URL = "https://tubitv.com/favicon.ico";
let baseCache = null;
let identityCache = null;

async function loadModule(url) {
  try {
    const r = await fetch(url, { skipSizeCheck:true });
    if (!r || !r.ok) return null;
    const src = String(await r.text() || "");
    if (!src || !src.includes("module.exports")) return null;
    const mod = { exports:{} };
    const fn = new Function("module", "exports", "require", src + "\n;return module.exports;");
    return fn(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
  } catch (_) { return null; }
}

async function loadBase() {
  if (baseCache && typeof baseCache.getStreams === "function") return baseCache;
  baseCache = await loadModule(BASE_URL);
  return baseCache;
}

async function loadIdentity() {
  if (identityCache && typeof identityCache.resolveAnimeIdentity === "function") return identityCache;
  identityCache = await loadModule(IDENTITY_URL);
  return identityCache;
}

function isReal(row) {
  return !!(row && row.url && !/^DIAG$/i.test(String(row.quality || "")) && !/\bDIAG\b/i.test(String(row.name || "")));
}

function diag(message) {
  return {
    name: `Tubi • DIAG IDENTITY • ${String(message || "").slice(0, 220)}`,
    title: "Tubi identity diagnostic",
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: "Tubi",
    type: "mp4"
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base || typeof base.getStreams !== "function") return [diag("base provider failed to load")];
  let rows = [];
  try { rows = await base.getStreams(inputId, mediaType, season, episode); }
  catch (e) { rows = [diag("base error=" + String(e && e.message || e))]; }
  if (Array.isArray(rows) && rows.some(isReal)) return rows;

  const helper = await loadIdentity();
  if (!helper || typeof helper.resolveAnimeIdentity !== "function") return [diag("identity helper failed to load")].concat(Array.isArray(rows) ? rows.slice(0,10) : []);
  try {
    const id = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    if (!id) return [diag("identity=null")].concat(Array.isArray(rows) ? rows.slice(0,10) : []);
    const aliases = Array.isArray(id.aliases) ? id.aliases.slice(0,8) : [];
    const animeAliases = Array.isArray(id.animeAliases) ? id.animeAliases.slice(0,8) : [];
    const msg = `source=${id.identitySource || "?"} • mal=${id.malId || "-"} • ani=${id.anilistId || "-"} • aliases=${aliases.length}[${aliases.join(" | ")}] • anime=${animeAliases.length}[${animeAliases.join(" | ")}]`;
    return [diag(msg)].concat(Array.isArray(rows) ? rows.slice(0,10) : []);
  } catch (e) {
    return [diag("identity error=" + String(e && e.message || e))].concat(Array.isArray(rows) ? rows.slice(0,10) : []);
  }
}

module.exports = { getStreams };
