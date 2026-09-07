"use strict";

// WCO presentation wrapper for Nuvio's alphabetical stream-label sorting.
// Keeps the validated WCO extraction/safety chain untouched and only normalizes labels.
const PROVIDER_NAME = "WCO";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production-v3.js";
let cached = null;

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""}`;
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

function audioLabel(row, isAnime) {
  const text = `${row && row.name || ""} ${row && row.title || ""}`.toLowerCase();
  if (/dual\s*audio|\bdual\b/.test(text)) return "[DUAL]";
  if (/dub\s*\+\s*subs?|dub\+subs?|dubbed[^•]*subs?|english\s*dub[^•]*subs?/.test(text)) return "[DUB+SUB]";
  if (/english\s*dub|\bdubbed\b|\bdub\b/.test(text)) return isAnime ? "[DUB]" : "";
  if (/hard\s*subs?|soft\s*subs?|japanese[^•]*subs?|\bsubbed\b|\bsubs?\b/.test(text)) return "[SUB]";
  return "";
}

function mirrorLabel(row) {
  const text = String(row && row.name || "");
  const match = text.match(/\bmirror\s*(\d+)\b/i);
  return match ? `Mirror ${match[1]}` : "";
}

function normalizeRow(row, isAnime) {
  if (!row || typeof row !== "object") return row;
  const height = qualityNumber(row);
  const rawQuality = String(row.quality || "").trim();
  let label = height ? qualityLabel(height) : "";
  if (!label && /^(auto|unknown)$/i.test(rawQuality) && row.url) label = "Unknown Auto";
  if (!label) return row;

  const audio = audioLabel(row, isAnime);
  const mirror = mirrorLabel(row);
  return {
    ...row,
    name: `${PROVIDER_NAME} • ${label}${audio ? ` • ${audio}` : ""}${mirror ? ` • ${mirror}` : ""}`
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    const isAnime = String(mediaType || "").toLowerCase() === "anime";
    return Array.isArray(rows) ? rows.map(row => normalizeRow(row, isAnime)) : [];
  } catch (_) {
    return [];
  }
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

module.exports = { getStreams, onSettings };
