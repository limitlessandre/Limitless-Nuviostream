"use strict";

// Parked 123MoviesIN probe for Limitless-Provider-Lab.
// This loader preserves the final Nexus placeholder implementation from the commit
// where live probing confirmed TMDB-native catalog routes but no distinct player.

const ARCHIVE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/60da16cb74131f74b44402ec8e500e61ff730b94/custom/providers/123moviesin-nexus.js";
let cached = null;

async function loadArchived() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(ARCHIVE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadArchived();
  if (!base) return [];
  try { return await base.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
}

module.exports = { getStreams };
