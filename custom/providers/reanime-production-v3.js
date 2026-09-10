"use strict";

// Re:ANIME presentation wrapper for Nuvio's alphabetical stream-label sorting.
// Keeps the validated provider untouched and only normalizes user-facing quality/audio labels.
const PROVIDER_NAME = "Re:ANIME";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/reanime-resilient-v2.js";
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

function hasSubtitleTracks(row) {
  const groups = [row && row.subtitles, row && row.subtitleTracks, row && row.captions, row && row.tracks];
  return groups.some(function(value) {
    return Array.isArray(value) && value.some(function(track) {
      if (!track) return false;
      if (typeof track === "string") return !!String(track).trim();
      const kind = String(track.kind || track.type || "").toLowerCase();
      if (kind && !/(sub|caption|text|vtt|srt)/.test(kind)) return false;
      return !!(track.url || track.file || track.src || track.label || track.name || track.language || track.lang);
    });
  });
}

function isJapaneseAudio(row, text) {
  const language = String(row && (row.audioLanguage || row.language || row.lang) || "").trim();
  return /^(?:ja|jpn|japanese)$/i.test(language) || /\bjapanese\s+audio\b/i.test(text || "");
}

function audioLabel(row) {
  const text = [
    row && row.name, row && row.title, row && row.audio, row && row.audioType,
    row && row.audioLanguage, row && row.language, row && row.lang
  ].filter(Boolean).join(" ").toLowerCase();
  const externalSubs = hasSubtitleTracks(row);
  const hardSubs = /\bh\s*sub\b|\bhsub\b|hard\s*subs?/.test(text);
  const softSubs = /soft\s*subs?|softsub/.test(text);
  const hasSubs = externalSubs || hardSubs || softSubs || /\bsubbed\b|\bsubs?\b|\bcaptions?\b/.test(text);
  const hasDub = /dub\s*\+\s*subs?|dub\+subs?|english\s*dub|\bdubbed\b|\bdub\b/.test(text);
  if (/dual\s*audio|\bdual\b/.test(text)) return "[DUAL]";
  if (hasDub && hasSubs) return "[DUB+SUB]";
  if (hasDub) return "[DUB]";
  if (hardSubs) return "[HSUB]";
  if (externalSubs || softSubs || /\bsubbed\b|\bsubs?\b|\bcaptions?\b/.test(text)) return "[SUB]";
  if (isJapaneseAudio(row, text)) return "[HSUB]";
  return "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = qualityNumber(row);
  const rawQuality = String(row.quality || "").trim();
  let label = height ? qualityLabel(height) : "";
  if (!label && /^(auto|unknown)$/i.test(rawQuality) && row.url) label = "Unknown Auto";
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
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
