"use strict";

// Limitless Nexus KissKH production wrapper v1.0.1.
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
  } catch (_) {
    return null;
  }
}

function hasSubtitleTracks(row) {
  const groups = [row && row.subtitles, row && row.subtitleTracks, row && row.captions, row && row.tracks];
  return groups.some(function(value) {
    return Array.isArray(value) && value.some(function(track) {
      if (!track) return false;
      if (typeof track === "string") return !!clean(track);
      return !!clean(track.url || track.file || track.src || track.label || track.name || track.language || track.lang);
    });
  });
}

function hasAudioTag(name) {
  return /\[(?:HSUB|SUB|DUB|DUB\+SUB|DUAL)\]/i.test(clean(name));
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  let name = clean(row.name);
  name = name.replace(/^KissKH Standalone(?=\s*•|$)/i, PROVIDER_NAME);
  if (!name) name = PROVIDER_NAME;

  if (!hasAudioTag(name)) {
    if (hasSubtitleTracks(row)) {
      name += " • [SUB]";
    } else if (/^(?:ja|jpn|japanese)$/i.test(clean(row.language || row.lang || row.audioLanguage))) {
      // KissKH Japanese-language releases are presented as hard-subbed in our
      // stream-card scheme when no separate subtitle tracks are exposed.
      name += " • [HSUB]";
    }
  }

  return { ...row, name, provider: PROVIDER_NAME };
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
