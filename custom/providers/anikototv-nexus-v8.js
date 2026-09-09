"use strict";

// AnikotoTV Nexus v2.0.7 relay-v2 playback test.
// Discovery/extraction remains v2.0.5. The final handoff uses the local relay's
// /play endpoint so Nuvio Desktop can receive subtitles as an HLS media group.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-nexus-v6.js";
const RELAY = "http://127.0.0.1:8787";
let cached = null;

function cleanSubtitle(row) {
  if (!row || typeof row !== "object") return null;
  const url = String(row.url || "").trim();
  if (!/^https:\/\//i.test(url)) return null;
  const language = String(row.language || "eng").trim() || "eng";
  const name = String(row.name || row.id || (language === "eng" ? "English" : language)).trim();
  return { ...row, url, language, name };
}

function relayStreamUrl(mediaUrl, subtitles) {
  const media = String(mediaUrl || "").trim();
  if (!/^https:\/\//i.test(media)) return media;
  let url = RELAY + "/play?url=" + encodeURIComponent(media);
  const preferred = (subtitles || []).find((sub) => /^(?:en|eng|english)$/i.test(sub.language || "")) || (subtitles || [])[0];
  if (preferred && preferred.url) {
    url += "&sub=" + encodeURIComponent(preferred.url);
    url += "&lang=" + encodeURIComponent(preferred.language || "eng");
    url += "&name=" + encodeURIComponent(preferred.name || "English");
  }
  return url;
}

function relaySubtitle(row) {
  const sub = cleanSubtitle(row);
  if (!sub) return null;
  return {
    ...sub,
    url: RELAY + "/stream?url=" + encodeURIComponent(sub.url),
    headers: {}
  };
}

function relayRow(row) {
  if (!row || typeof row !== "object" || !row.url) return row;
  const rawSubs = Array.isArray(row.subtitles) ? row.subtitles.map(cleanSubtitle).filter(Boolean) : [];
  const relayedSubs = rawSubs.map(relaySubtitle).filter(Boolean);
  const count = rawSubs.length;
  const serverName = String(row.name || "AnikotoTV");
  return {
    ...row,
    name: serverName + " • Relay2" + (count ? " • SUBS:" + count : ""),
    url: relayStreamUrl(row.url, rawSubs),
    type: "m3u8",
    headers: {},
    subtitles: relayedSubs
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
