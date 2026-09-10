"use strict";

// AniKoto Android direct transport test.
// Reuses the validated Nexus v6 resolver but intentionally skips the localhost relay.
// Nuvio maps row.headers into playback request headers and provider subtitles into
// Android external subtitle tracks, so this wrapper preserves both verbatim/safely.

const PROVIDER_NAME = "AnikotoTV Android";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-nexus-v6.js?rev=208";
let cached = null;

function validHttps(value) {
  try {
    const u = new URL(String(value || "").trim());
    return u.protocol === "https:" ? u.href : "";
  } catch (_) {
    return "";
  }
}

function cleanHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    const name = String(key || "").trim();
    const text = String(value == null ? "" : value).trim();
    if (!name || !text || /^range$/i.test(name)) continue;
    out[name] = text;
  }
  return out;
}

function cleanSubtitle(row) {
  if (!row || typeof row !== "object") return null;
  const url = validHttps(row.url);
  if (!url) return null;
  const language = String(row.language || "und").trim() || "und";
  const name = String(row.name || row.id || language).trim() || language;
  return {
    ...row,
    url,
    language,
    name,
    headers: cleanHeaders(row.headers)
  };
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return null;
  const url = validHttps(row.url);
  if (!url) return null;
  const subtitles = Array.isArray(row.subtitles)
    ? row.subtitles.map(cleanSubtitle).filter(Boolean)
    : [];
  const rawName = String(row.name || "AnikotoTV").trim();
  const directName = rawName.replace(/^AnikotoTV\b/i, PROVIDER_NAME) + " • Direct";
  return {
    ...row,
    name: directName,
    provider: PROVIDER_NAME,
    url,
    headers: cleanHeaders(row.headers),
    subtitles,
    type: row.type || (/\.mp4(?:[?#]|$)/i.test(url) ? "mp4" : "m3u8")
  };
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source || !source.includes("module.exports")) return null;
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

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
