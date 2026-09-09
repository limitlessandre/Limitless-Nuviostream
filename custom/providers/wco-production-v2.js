"use strict";

// Production WCO wrapper with the validated Power Rangers season-title resolver
// used only as a fallback after the normal production provider returns no streams.
// Normal production now passes through the MAL/AniList-assisted anime identity layer;
// the Power Rangers fallback remains separately scoped by its own TMDB gate.

const PROVIDER_NAME = "WCO";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const PRODUCTION_URL = `${BRANCH_RAW}/wco-anime-production.js`;
const RESOLVER_URL = `${BRANCH_RAW}/wco-power-rangers-nexus-v3.js`;

let productionCache = null;
let resolverCache = null;

async function loadModule(url, cacheName) {
  if (cacheName === "production" && productionCache) return productionCache;
  if (cacheName === "resolver" && resolverCache) return resolverCache;
  try {
    const res = await fetch(url, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const source = String(await res.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    if (cacheName === "production") productionCache = exported;
    if (cacheName === "resolver") resolverCache = exported;
    return exported;
  } catch (_) {
    return null;
  }
}

function isRealStream(row) {
  if (!row || !row.url) return false;
  const quality = String(row.quality || "");
  const name = String(row.name || "");
  return !/^DIAG$/i.test(quality) && !/\bDIAG\b/i.test(name);
}

function normalizeFallback(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!isRealStream(row)) continue;
    const name = String(row.name || "").replace(/^WCO Power Rangers Nexus/i, PROVIDER_NAME);
    const key = `${row.url}|${row.quality || ""}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, name, provider: PROVIDER_NAME });
  }
  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  const production = await loadModule(PRODUCTION_URL, "production");
  if (!production) return [];

  let primary = [];
  try {
    primary = await production.getStreams(inputId, mediaType, season, episode);
  } catch (_) {
    primary = [];
  }
  if (Array.isArray(primary) && primary.length) return primary;

  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie" || Number(season) === 0) return Array.isArray(primary) ? primary : [];

  const resolver = await loadModule(RESOLVER_URL, "resolver");
  if (!resolver) return Array.isArray(primary) ? primary : [];
  try {
    return normalizeFallback(await resolver.getStreams(inputId, mediaType, season, episode));
  } catch (_) {
    return Array.isArray(primary) ? primary : [];
  }
}

async function onSettings() {
  const production = await loadModule(PRODUCTION_URL, "production");
  if (!production || typeof production.onSettings !== "function") return [];
  try { return await production.onSettings(); }
  catch (_) { return [];
  }
}

module.exports = { getStreams, onSettings };
