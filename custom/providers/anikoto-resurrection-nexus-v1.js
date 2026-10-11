"use strict";

// AniKoto Resurrection Test v0.1.0
// Nexus-only direct-path canary. No localhost relay.
// Reuses the last proven AniKoto resolver, but refuses known-dead image-wrapped
// s=tcdn lanes and unsigned current MegaPlay CDN URLs. This leaves direct HLS,
// Mewcdn/HOST_MAP paths, and any already-valid signed streams for Nuvio testing.

const PROVIDER_NAME = "AniKoto Resurrection Test";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-nexus-v6.js?rev=208";
let cached = null;

function validHttps(value) {
  try {
    const u = new URL(String(value || "").trim());
    return u.protocol === "https:" ? u : null;
  } catch (_) { return null; }
}

function isTcdn(value) {
  try {
    const u = new URL(String(value || ""));
    return String(u.searchParams.get("s") || "").toLowerCase() === "tcdn";
  } catch (_) {
    return /[?&]s=tcdn(?:[&#]|$)/i.test(String(value || ""));
  }
}

function isUnsignedKeyedMedia(value) {
  try {
    const u = new URL(String(value || ""));
    const keyed = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i.test(u.pathname);
    return keyed && !u.searchParams.get("token");
  } catch (_) { return false; }
}

function normalizeLanguage(value) {
  const v = String(value || "").toLowerCase();
  if (v === "eng") return "en";
  if (v === "jpn") return "ja";
  return value;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object" || !validHttps(row.url)) return null;
  const meta = row.anikotoSource || {};
  if (isTcdn(meta.embed) || isTcdn(row.url) || isUnsignedKeyedMedia(row.url)) return null;

  const subtitles = Array.isArray(row.subtitles)
    ? row.subtitles.filter(x => x && validHttps(x.url)).map(x => ({ ...x, language: normalizeLanguage(x.language) }))
    : [];

  let tag = "[UNK]";
  if (meta.mode === "dub") tag = subtitles.length ? "[DUB+SUB]" : "[DUB]";
  else if (subtitles.length) tag = "[SUB]";
  else if (/h-?sub/i.test(String(meta.sourceType || ""))) tag = "[HSUB]";

  const rawParts = String(row.name || "").split(" • ").map(x => x.trim()).filter(Boolean);
  const server = String(meta.server || rawParts[rawParts.length - 1] || "").trim();
  const usefulServer = server && !/^(anikototv|auto|softsub|dub|dubs\+subs?)$/i.test(server) ? server : "";

  return {
    ...row,
    provider: PROVIDER_NAME,
    name: PROVIDER_NAME + " • Unknown Auto • " + tag + (usefulServer ? " • " + usefulServer : ""),
    quality: "Auto",
    subtitles
  };
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
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

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow).filter(Boolean).slice(0, 6) : [];
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
