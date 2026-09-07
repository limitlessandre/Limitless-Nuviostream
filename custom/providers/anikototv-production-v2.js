"use strict";

// AnikotoTV presentation wrapper for Nuvio's alphabetical stream-label sorting.
// Keeps the existing extractor untouched and standardizes only user-facing labels.
const PROVIDER_NAME = "AnikotoTV";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv.js";
let cached = null;

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
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

function heightOf(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const match = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return match ? Number(match[1]) : 0;
}

function tier(height) {
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
  if (/dub\s*\+\s*subs?|dub\+subs?|dub\+sub|dubbed[^•]*subs?/.test(text)) return "[DUB+SUB]";
  if (/softsub|soft\s*subs?|\bsubbed\b|\(sub\)|\bsub\b/.test(text)) return "[SUB]";
  if (/\bdubbed\b|\(dub\)|\bdub\b/.test(text)) return "[DUB]";
  return "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = heightOf(row);
  const quality = String(row.quality || "").trim();
  let label = height ? tier(height) : "";
  if (!label && /^(auto|unknown)$/i.test(quality) && row.url) label = "Unknown Auto";
  if (!label) return row;

  const audio = audioLabel(row);
  return {
    ...row,
    name: `${PROVIDER_NAME} • ${label}${audio ? ` • ${audio}` : ""}`
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
  } catch (_) { return []; }
}

module.exports = { getStreams };
