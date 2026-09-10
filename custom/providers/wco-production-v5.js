"use strict";

// WCO Nexus presentation wrapper using NAMING_STANDARDS.md.
// Extraction/safety stays in wco-production-v3; this file only normalizes
// quality, evidence-based audio/subtitle tags, and explicit mirror labels.
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
  } catch (_) { return null; }
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const m = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return m ? Number(m[1]) : 0;
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
  if (height > 0) return `SD-Very Low ${height}p`;
  return "Unknown Auto";
}

function subtitleTrack(track) {
  if (!track) return false;
  if (typeof track === "string") return !!track.trim();
  const kind = String(track.kind || track.type || "").toLowerCase();
  if (kind && !/(sub|caption|text|vtt|srt)/.test(kind)) return false;
  return !!(track.url || track.file || track.src || track.uri);
}

function hasSelectableSubs(row) {
  return [row && row.subtitles, row && row.subtitleTracks, row && row.captions, row && row.tracks]
    .some(group => Array.isArray(group) && group.some(subtitleTrack));
}

function hasMultipleAudio(row) {
  if ([row && row.audioTracks, row && row.audios].some(group => Array.isArray(group) && group.filter(Boolean).length > 1)) return true;
  const tracks = Array.isArray(row && row.tracks) ? row.tracks : [];
  return tracks.filter(track => track && typeof track === "object" && /audio/i.test(String(track.kind || track.type || ""))).length > 1;
}

function classification(row) {
  const text = [row && row.name, row && row.audio, row && row.audioType, row && row.audioLanguage, row && row.language, row && row.lang]
    .filter(Boolean).join(" ").toLowerCase();
  const dual = hasMultipleAudio(row) || /dual\s*audio|\[dual\]|\bdual\b/.test(text);
  const selectable = hasSelectableSubs(row);
  const dub = /\[dub(?:\+sub)?\]|english\s*dub|\bdubbed\b|\bdub\b/.test(text);
  // WCO explicitly exposes labels such as "Japanese + English Hard Subs".
  const hsub = /\[hsub\]|hard[\s-]*subs?|hardsub/.test(text);
  if (dual) return "[DUAL]";
  if (selectable) return dub ? "[DUB+SUB]" : "[SUB]";
  if (dub) return "[DUB]";
  if (hsub) return "[HSUB]";
  return "[UNK]";
}

function mirrorLabel(row) {
  const text = String(row && row.name || "");
  const m = text.match(/\bmirror\s*(\d+)\b/i);
  return m ? `Mirror ${m[1]}` : "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  if (String(row.quality || "").toUpperCase() === "DIAG" || /\bDIAG\b/i.test(String(row.name || ""))) return row;
  const height = qualityNumber(row);
  if (!row.url && !height) return row;
  const mirror = mirrorLabel(row);
  return { ...row, name: `${PROVIDER_NAME} • ${qualityLabel(height)} • ${classification(row)}${mirror ? ` • ${mirror}` : ""}` };
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
  } catch (_) { return []; }
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
