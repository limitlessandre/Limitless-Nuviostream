"use strict";

// NetMirror Nexus presentation adapter using NAMING_STANDARDS.md.
// Upstream extraction/settings remain pinned to the known-good All-in-One-Nuvio commit.
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
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""} ${row && row.title || ""}`;
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
  const text = [row && row.name, row && row.title, row && row.audio, row && row.audioType, row && row.audioLanguage, row && row.language, row && row.lang]
    .filter(Boolean).join(" ").toLowerCase();
  const dual = hasMultipleAudio(row) || /dual\s*audio|\[dual\]|\bdual\b/.test(text);
  const selectable = hasSelectableSubs(row);
  const dub = /\[dub(?:\+sub)?\]|english\s*dub|\bdubbed\b|\bdub\b/.test(text);
  const hsub = /\[hsub\]|hard[\s-]*subs?|hardsub/.test(text);
  if (dual) return "[DUAL]";
  if (selectable) return dub ? "[DUB+SUB]" : "[SUB]";
  if (dub) return "[DUB]";
  if (hsub) return "[HSUB]";
  return "[UNK]";
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

function rowMeta(row) {
  if (!row || typeof row !== "object") return null;
  if (String(row.quality || "").toUpperCase() === "DIAG" || /\bDIAG\b/i.test(String(row.name || ""))) return { row, diagnostic: true };
  const height = qualityNumber(row);
  if (!row.url && !height) return null;
  return { row, quality: qualityLabel(height), tag: classification(row), service: serviceLabel(row) };
}

function normalizeRows(rows) {
  const metas = rows.map(rowMeta);
  const serviceSets = {};
  metas.forEach(meta => {
    if (!meta || meta.diagnostic) return;
    const key = `${meta.quality}|${meta.tag}`;
    if (!serviceSets[key]) serviceSets[key] = new Set();
    if (meta.service) serviceSets[key].add(meta.service);
  });
  return metas.map((meta, index) => {
    if (!meta) return rows[index];
    if (meta.diagnostic) return meta.row;
    const key = `${meta.quality}|${meta.tag}`;
    const showService = serviceSets[key] && serviceSets[key].size > 1 && meta.service;
    return { ...meta.row, name: `${PROVIDER_NAME} • ${meta.quality} • ${meta.tag}${showService ? ` • ${meta.service}` : ""}` };
  });
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? normalizeRows(rows) : [];
  } catch (_) { return []; }
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
