"use strict";

// AnikotoTV Nexus v2.0.6 local-relay playback test.
// Discovery/extraction remains v2.0.5; only the final media handoff changes.
// Raw AniKoto HLS and subtitle URLs are routed through the local relay on 127.0.0.1:8787.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-nexus-v6.js";
const RELAY = "http://127.0.0.1:8787";
let cached = null;

function relayUrl(value) {
  const url = String(value || "").trim();
  if (!/^https:\/\//i.test(url)) return url;
  return RELAY + "/stream?url=" + encodeURIComponent(url);
}

function relaySubtitle(row) {
  if (!row || typeof row !== "object") return row;
  const url = relayUrl(row.url);
  return { ...row, url:url };
}

function relayRow(row) {
  if (!row || typeof row !== "object" || !row.url) return row;
  const serverName = String(row.name || "AnikotoTV");
  return {
    ...row,
    name: serverName + " • Relay",
    url: relayUrl(row.url),
    headers: {},
    subtitles: Array.isArray(row.subtitles) ? row.subtitles.map(relaySubtitle) : row.subtitles
  };
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck:true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source) return null;
    const mod = { exports:{} };
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
    return Array.isArray(rows) ? rows.map(relayRow) : [];
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
