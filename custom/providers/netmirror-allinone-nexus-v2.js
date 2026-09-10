"use strict";

// Limitless Nexus presentation adapter for the verified-working NetMirror provider
// from NuvioPlugin/All-in-One-Nuvio. Extraction/settings stay upstream-identical;
// only the visible stream name is normalized to the Nexus quality-label scheme.
const PROVIDER_NAME = "NetMirror";
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

function serviceLabel(row) {
  const text = `${row && row.name || ""} ${row && row.provider || ""}`;
  const known = [
    [/\bnetflix\b/i, "Netflix"],
    [/\b(?:amazon\s*)?prime(?:\s*video)?\b/i, "Prime Video"],
    [/\bdisney\s*\+|\bdisneyplus\b/i, "Disney+"],
    [/\bjio\s*hotstar\b|\bjiohotstar\b/i, "JioHotstar"],
    [/\bhotstar\b/i, "Hotstar"],
    [/\bhulu\b/i, "Hulu"],
    [/\b(?:hbo\s*)?max\b/i, "Max"]
  ];
  for (const pair of known) if (pair[0].test(text)) return pair[1];
  const paren = String(row && row.name || "").match(/\(([^)]+)\)/);
  if (paren) {
    const value = paren[1].trim();
    if (value && !/^(?:\d{3,4}p|auto|unknown)$/i.test(value)) return value;
  }
  return "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = qualityNumber(row);
  const rawQuality = String(row.quality || "").trim();
  let quality = height ? qualityLabel(height) : "";
  if (!quality && /^(auto|unknown)$/i.test(rawQuality) && row.url) quality = "Unknown Auto";
  if (!quality) return row;

  const service = serviceLabel(row);
  const audio = audioLabel(row);
  const details = [];
  if (audio) details.push(audio);
  if (service) details.push(service);
  return { ...row, name: `${PROVIDER_NAME} • ${quality}${details.length ? ` • ${details.join(" • ")}` : ""}` };
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

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
