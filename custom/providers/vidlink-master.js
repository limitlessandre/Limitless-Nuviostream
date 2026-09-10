"use strict";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/0dc4cae83461b97de361af229ca2e569af7e04f8/custom/providers/vidlink-eclipsia-nexus-v3.js";
let cached = null;
async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const r = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!r || !r.ok) return null;
    const src = String(await r.text() || "");
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", src + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}
async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try { return await base.getStreams(inputId, mediaType, season, episode); } catch (_) { return []; }
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
