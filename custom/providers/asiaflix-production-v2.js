"use strict";

// AsiaFlix presentation wrapper for Nuvio's alphabetical stream-label sorting.
const PROVIDER_NAME = "AsiaFlix";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/asiaflix-nexus.js";
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
  } catch (_) { return null; }
}

function esc(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = heightOf(row);
  const quality = String(row.quality || "").trim();
  let label = height ? tier(height) : "";
  if (!label && /^(auto|unknown)$/i.test(quality) && row.url) label = "Unknown Auto";
  if (!label) return row;

  let rest = String(row.name || "").trim();
  rest = rest.replace(new RegExp(`^${esc(PROVIDER_NAME)}(?:\\s*•)?\\s*`, "i"), "");
  if (height) rest = rest.replace(new RegExp(`\\b${height}p\\b`, "i"), "");
  rest = rest
    .replace(/^(?:2x4K 8K|4K|Enhanced QHD|QHD|FHD|HD(?:-Low)?|SD(?:-Low|-Very Low)?|Unknown(?: Auto)?)\s*(?:•\s*)?/i, "")
    .replace(/\s*•\s*•\s*/g, " • ")
    .replace(/^\s*•\s*|\s*•\s*$/g, "")
    .trim();
  return { ...row, name: `${PROVIDER_NAME} • ${label}${rest ? ` • ${rest}` : ""}` };
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
