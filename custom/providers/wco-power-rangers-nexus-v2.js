"use strict";

// Nexus-only wrapper around the validated generic season-title resolver.
// Adds one lightweight fallback: when WCO search returns no result for a derived
// title, try the matching /anime/<slug>/ page directly. Production WCO is untouched.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-power-rangers-nexus.js";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
let cached = null;

function diag(message, season, episode) {
  const clean = String(message || "unknown error").replace(/\s+/g, " ").trim().slice(0, 180);
  return [{
    name: `${PROVIDER_NAME} • DIAG WRAPPER • ${clean}`,
    title: `Power Rangers S${String(Number(season || 1)).padStart(2, "0")}E${String(Number(episode || 1)).padStart(2, "0")}`,
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
}

function patchResolver(source) {
  const marker = '  return all.sort((a,b)=>b.score-a.score).slice(0,8);';
  const replacement = [
    '  if(!all.length){',
    '    const slug=String(title||"").toLowerCase().replace(/&amp;|&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");',
    '    if(slug)return ORIGINS.map(origin=>({href:origin+"/anime/"+slug+"/?season=all",title,score:100,direct:true}));',
    '  }',
    marker
  ].join("\n");
  if (!String(source || "").includes(marker)) return "";
  return String(source).replace(marker, replacement);
}

async function loadProvider() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const raw = String(await res.text() || "");
    const source = patchResolver(raw);
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
  try {
    const provider = await loadProvider();
    if (!provider) return diag("patched resolver failed to load", season, episode);
    return await provider.getStreams(inputId, mediaType, season, episode);
  } catch (err) {
    return diag(String(err && err.message || err), season, episode);
  }
}

module.exports = { getStreams };
