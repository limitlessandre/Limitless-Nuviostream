"use strict";

// Limitless Nexus adapter for Eclipsia's Vidlink provider (nyxora.js).
// Upstream revision is pinned. Extraction/headers remain upstream-identical;
// only the visible row/provider label is normalized to Vidlink.
const SOURCE_URL = "https://raw.githubusercontent.com/ItsMe-95fx/eclipsia-nuvio/822674b5d84d75d6159082a0b266a7ceed358874/providers/nyxora.js";
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

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const quality = String(row.quality || row.title || "").trim();
  return {
    ...row,
    name: quality ? "Vidlink • " + quality : "Vidlink",
    provider: "Vidlink"
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
