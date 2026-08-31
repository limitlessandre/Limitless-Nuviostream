"use strict";

const PROVIDER_NAME = "WCO Domain Test";
const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
const DOMAINS = [
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net",
  "https://www.wco.tv",
  "https://www.wcoanimedub.tv",
  "https://www.wcoanimesub.tv"
];

let rawCore = null;
const coreCache = new Map();

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].replace(/^www\./i, "") : String(url || "");
}

function qualityRank(value) {
  const m = String(value || "").match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

function audioBranch(stream) {
  const text = String(stream && stream.name || "").toLowerCase();
  if (text.includes("english dub") || text.includes("dual audio")) return "Dub";
  if (text.includes("japanese") || text.includes("hard sub") || text.includes("sub")) return "Sub";
  return "Other";
}

async function sourceText() {
  if (rawCore) return rawCore;
  try {
    const res = await fetch(CORE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return "";
    rawCore = String(await res.text() || "");
    return rawCore;
  } catch (_) {
    return "";
  }
}

function patchForOrigin(source, origin) {
  let patched = String(source || "");
  patched = patched.replace(/const PROVIDER_NAME\s*=\s*"WCO"\s*;/, 'const PROVIDER_NAME = "WCO Domain Test";');
  patched = patched.replace(/const ORIGINS\s*=\s*\[[\s\S]*?\];/, `const ORIGINS = [${JSON.stringify(origin)}];`);
  return patched;
}

async function coreFor(origin) {
  if (coreCache.has(origin)) return coreCache.get(origin);
  const raw = await sourceText();
  if (!raw) return null;
  const patched = patchForOrigin(raw, origin);
  try {
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    coreCache.set(origin, exported);
    return exported;
  } catch (_) {
    return null;
  }
}

function pickBest(streams, origin) {
  const best = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const branch = audioBranch(stream);
    if (branch === "Other") continue;
    const prev = best.get(branch);
    if (!prev || qualityRank(stream.quality) > qualityRank(prev.quality)) best.set(branch, stream);
  }

  const out = [];
  for (const [branch, stream] of best.entries()) {
    const clean = { ...stream };
    clean.provider = PROVIDER_NAME;
    clean.name = `${PROVIDER_NAME} • ${hostOf(origin)} • ${clean.quality || "Auto"} • ${branch === "Dub" ? "English Dub" : "Japanese + English Hard Subs"}`;
    out.push(clean);
  }
  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie" || Number(season) === 0) return [];

  const out = [];
  for (const origin of DOMAINS) {
    const core = await coreFor(origin);
    if (!core) continue;
    try {
      const streams = await core.getStreams(inputId, mediaType, season, episode);
      out.push(...pickBest(streams, origin));
    } catch (_) {}
  }
  return out;
}

module.exports = { getStreams };
