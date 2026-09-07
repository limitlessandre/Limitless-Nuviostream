"use strict";

// Parked 123MoviesFree probe for Limitless-Provider-Lab.
// This loader preserves the final Nexus v0.1.1 probe that tested the ww# family
// directly and confirmed that Nuvio could not fetch the current Cloudflare frontend.

const ARCHIVE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/9732169eb85c795a3563998dd04fcdb234a5a36a/custom/providers/123moviesfree-placeholder.js";
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
