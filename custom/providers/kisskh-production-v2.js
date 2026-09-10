"use strict";

// Limitless Nexus KissKH production wrapper using NAMING_STANDARDS.md.
// The tested standalone resolver is pinned to an immutable Limitless commit.
// No runtime dependency on Eclipsia/Codeberg.
const PROVIDER_NAME = "KissKH";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/8e48328bf8b5367cead3a31ee0498cde013376d3/custom/providers/kisskh-standalone-nexus-v1.js";
const FALLBACK = "https://kisskh.ovh/favicon.ico";
let cached = null;

function clean(v) { return String(v == null ? "" : v).trim(); }

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
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

function isJapanese(row) {
  return /^(?:ja|jpn|japanese)$/i.test(clean(row && (row.audioLanguage || row.language || row.lang)));
}

function classification(row) {
  const text = [row && row.name, row && row.title, row && row.audio, row && row.audioType, row && row.audioLanguage, row && row.language, row && row.lang]
    .filter(Boolean).join(" ").toLowerCase();
  const dual = hasMultipleAudio(row) || /dual\s*audio|\[dual\]|\bdual\b/.test(text);
  const selectable = hasSelectableSubs(row);
  const dub = /\[dub(?:\+sub)?\]|english\s*dub|\bdubbed\b|\bdub\b/.test(text);
  const explicitHsub = /\[hsub\]|hard[\s-]*subs?|hardsub/.test(text);
  if (dual) return "[DUAL]";
  if (selectable) return dub ? "[DUB+SUB]" : "[SUB]";
  if (dub) return "[DUB]";
  if (explicitHsub) return "[HSUB]";
  // Provider-specific verified rule recorded in NAMING_STANDARDS.md:
  // current first-party Japanese KissKH streams were manually verified hard-subbed.
  if (isJapanese(row)) return "[HSUB]";
  return "[UNK]";
}

function sourceDisambiguator(row) {
  const text = clean(row && row.name);
  if (/\bThirdParty\b/i.test(text)) return "ThirdParty";
  if (/\bFallback\b/i.test(text)) return "Fallback";
  const m = text.match(/\bmirror\s*(\d+)\b/i);
  return m ? `Mirror ${m[1]}` : "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  if (String(row.quality || "").toUpperCase() === "DIAG" || /\bDIAG\b/i.test(String(row.name || ""))) return { ...row, provider: PROVIDER_NAME };
  const height = qualityNumber(row);
  if (!row.url && !height) return row;
  const extra = sourceDisambiguator(row);
  return {
    ...row,
    name: `${PROVIDER_NAME} • ${qualityLabel(height)} • ${classification(row)}${extra ? ` • ${extra}` : ""}`,
    provider: PROVIDER_NAME
  };
}

function noSource(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  const detail = type === "movie"
    ? `No exact playable KissKH source found for ${clean(inputId) || "requested movie"}`
    : `No exact playable KissKH source found for ${clean(inputId) || "requested title"} • S${Number(season || 1)}E${Number(episode || 1)}`;
  return {
    name: `${PROVIDER_NAME} • DIAG NO SOURCE FOUND`,
    title: detail,
    url: FALLBACK,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  const base = await loadBase();
  if (!base) return [noSource(inputId, mediaType, season, episode)];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    const normalized = Array.isArray(rows) ? rows.filter(Boolean).map(normalizeRow) : [];
    return normalized.length ? normalized : [noSource(inputId, mediaType, season, episode)];
  } catch (_) {
    return [noSource(inputId, mediaType, season, episode)];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
