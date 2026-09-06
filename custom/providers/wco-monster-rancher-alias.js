"use strict";

// Narrow WCO alias fallback for titles where TMDB's preferred name differs from
// WCO's catalog name. This helper is intentionally identity-gated so it cannot
// weaken normal production matching for unrelated shows.

const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
const MONSTER_RANCHER_IDS = new Set(["15130", "tt0218775"]);
let cached = null;

function supported(inputId, mediaType) {
  return String(mediaType || "tv").toLowerCase() !== "movie" && MONSTER_RANCHER_IDS.has(String(inputId || "").trim().toLowerCase());
}

async function loadPatchedCore() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(CORE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    let source = String(await res.text() || "");
    const marker = 'titles: uniq([title, original].concat(alt)).slice(0, 6),';
    if (!source.includes(marker)) return null;
    source = source.replace(marker, 'titles: uniq([title, original].concat(id === 15130 ? ["Monster Rancher"] : []).concat(alt)).slice(0, 8),');
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType, season, episode) {
  if (!supported(inputId, mediaType)) return [];
  const core = await loadPatchedCore();
  if (!core) return [];
  try { return await core.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
}

module.exports = { getStreams };
