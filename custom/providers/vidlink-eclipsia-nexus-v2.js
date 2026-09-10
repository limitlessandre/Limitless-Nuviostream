"use strict";

// Nexus presentation adapter for Eclipsia v9.9.0 Haylox/Vidlink.
// The upstream provider remains authoritative for extraction/playback; this wrapper
// only normalizes the user-facing stream name to the Nexus quality scheme.
const PROVIDER_NAME = "Vidlink";
const SOURCE_URL = "https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/providers/haylox.js";
let cached = null;

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(SOURCE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return { moduleExports: module.exports, localGetStreams: (typeof getStreams === 'function' ? getStreams : null) }; ");
    const captured = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); });
    const exported = captured && captured.moduleExports && typeof captured.moduleExports.getStreams === "function"
      ? captured.moduleExports
      : (captured && typeof captured.localGetStreams === "function" ? { getStreams: captured.localGetStreams } : mod.exports);
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""} ${row && row.title || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const match = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return match ? Number(match[1]) : 0;
}

function qualityLabel(height) {
  if (height >= 4320) return `2x4K 8K ${height}p`;
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `Enhanced QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 540) return `HD-Low ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height >= 360) return `SD-Low ${height}p`;
  return `SD-Very Low ${height}p`;
}

function audioLabel(row) {
  const text = `${row && row.name || ""} ${row && row.title || ""}`.toLowerCase();
  if (/dual\s*audio|\bdual\b/.test(text)) return "[DUAL]";
  if (/dub\s*\+\s*subs?|dub\+subs?|dubbed[^•]*subs?|english\s*dub[^•]*subs?/.test(text)) return "[DUB+SUB]";
  if (/english\s*dub|\bdubbed\b|\bdub\b/.test(text)) return "[DUB]";
  if (/hard\s*subs?|soft\s*subs?|\bsubbed\b|\bsubs?\b/.test(text)) return "[SUB]";
  return "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = qualityNumber(row);
  const rawQuality = String(row.quality || "").trim();
  let quality = height ? qualityLabel(height) : "";
  if (!quality && /^(auto|unknown)$/i.test(rawQuality) && row.url) quality = "Unknown Auto";
  if (!quality) return row;
  const audio = audioLabel(row);
  return { ...row, name: `${PROVIDER_NAME} • ${quality}${audio ? ` • ${audio}` : ""}` };
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
