"use strict";

const PROVIDER_NAME = "WCO";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const MODULE_URLS = {
  core: `${BRANCH_RAW}/wco.js`,
  special: `${BRANCH_RAW}/wco-special-test-v2.js`,
  episode0: `${BRANCH_RAW}/wco-episode0-test.js`
};

const cache = Object.create(null);

async function loadModule(key) {
  if (cache[key] && typeof cache[key].getStreams === "function") return cache[key];
  const url = MODULE_URLS[key];
  if (!url) return null;
  try {
    const res = await fetch(url, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const source = String(await res.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const localRequire = function(name) {
      throw new Error(`Unsupported nested require: ${name}`);
    };
    const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
    const exported = factory(mod, mod.exports, localRequire) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cache[key] = exported;
    return exported;
  } catch (_) {
    return null;
  }
}

function isDebug(stream) {
  const name = String(stream && stream.name || "");
  const quality = String(stream && stream.quality || "");
  return !stream || !stream.url || /\bDIAG\b/i.test(name) || /^Debug$/i.test(quality);
}

function productionLabel(stream) {
  const name = String(stream && stream.name || "").toLowerCase();
  if (name.includes("dual audio")) return "Dual Audio + Subs";
  if (name.includes("multi audio")) return "Multi Audio + Subs";
  if (name.includes("japanese + english hard subs")) return "Japanese + English Hard Subs";
  if (name.includes("english dub")) return "English Dub";
  if (name.includes("english (original)")) return "English (Original)";
  if (name.includes("japanese (original)")) return "Japanese (Original)";
  const lang = String(stream && stream.language || "").trim();
  return lang || "Original";
}

function cleanStreams(streams) {
  const out = [];
  const seen = new Set();
  for (const stream of streams || []) {
    if (isDebug(stream)) continue;
    const quality = String(stream.quality || "Auto");
    const label = productionLabel(stream);
    const key = `${quality}|${label}|${stream.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...stream,
      name: `${PROVIDER_NAME} • ${quality} • ${label}`,
      provider: PROVIDER_NAME
    });
  }
  return out;
}

async function run(key, inputId, mediaType, season, episode) {
  const mod = await loadModule(key);
  if (!mod) return [];
  try {
    return cleanStreams(await mod.getStreams(inputId, mediaType, season, episode));
  } catch (_) {
    return [];
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();

  if (type === "movie") {
    return await run("special", inputId, "movie", season, episode);
  }

  if (Number(season) === 0) {
    const titleMatched = await run("special", inputId, type, season, episode);
    if (titleMatched.length) return titleMatched;
    return await run("episode0", inputId, type, season, episode);
  }

  return await run("core", inputId, type, season, episode);
}

module.exports = { getStreams };
