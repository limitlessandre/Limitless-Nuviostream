"use strict";

// Limitless Nexus adapter for the verified-working NetMirror provider from
// NuvioPlugin/All-in-One-Nuvio. Upstream revision is pinned so Nexus behavior
// cannot change silently. Original upstream manifest credits Dustincos.
const SOURCE_URL = "https://raw.githubusercontent.com/NuvioPlugin/All-in-One-Nuvio/716057b2a0d55a634da88c1d0d2db7352df07c69/providers/netmirror.js";
let cached = null;

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(SOURCE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
