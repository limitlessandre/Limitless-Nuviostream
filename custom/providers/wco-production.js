"use strict";

const MASTER_BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Master-Nexus/custom/providers/wco-production-base.js";
let cachedModule = null;

async function loadMasterWco() {
  if (cachedModule && typeof cachedModule.getStreams === "function") return cachedModule;
  try {
    const response = await fetch(MASTER_BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    let source = String(await response.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    source = source.replace(
      /refs\/heads\/Limitless-nexus\/custom\/providers/g,
      "refs/heads/Limitless-Master-Nexus/custom/providers"
    );
    const mod = { exports: {} };
    const localRequire = function(name) { throw new Error(`Unsupported nested require: ${name}`); };
    const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
    const exported = factory(mod, mod.exports, localRequire) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedModule = exported;
    return cachedModule;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const mod = await loadMasterWco();
  if (!mod) return [];
  try {
    return await mod.getStreams(inputId, mediaType, season, episode);
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
