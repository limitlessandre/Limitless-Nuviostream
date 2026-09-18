"use strict";

// Master pin for the user-confirmed Nexus Re:ANIME season-aware build.
// Frozen to the exact validated Nexus commit so later development-branch edits
// cannot change the promoted top-level provider entry.
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/e076be0a4c4f9df8753338f192672bd7196ec97b/custom/providers/reanime-production-v5.js";
let cached = null;

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try { return await base.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
