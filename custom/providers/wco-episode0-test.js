"use strict";

const PROVIDER_NAME = "WCO Episode 0 Test";
const WCO_SOURCE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
let cachedWco = null;

async function loadWco() {
  if (cachedWco && typeof cachedWco.getStreams === "function") return cachedWco;
  const res = await fetch(WCO_SOURCE_URL, { skipSizeCheck: true });
  if (!res || !res.ok) return null;
  let source = String(await res.text() || "");
  if (!source || !source.includes("module.exports")) return null;

  // Preserve a legitimate Episode 0 request at BOTH zero-coercion points
  // inside the current WCO TV resolver. Main WCO remains untouched.
  source = source.replace(
    "const wantedE = Number(wantedEpisode || 1);",
    "const wantedE = Number(wantedEpisode == null ? 1 : wantedEpisode);"
  );
  source = source.replace(
    "const wantedEpisode = Number(episode || 1);",
    "const wantedEpisode = Number(episode == null ? 1 : episode);"
  );

  try {
    const mod = { exports: {} };
    const localRequire = function(name) {
      throw new Error(`Unsupported nested require: ${name}`);
    };
    const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
    const exported = factory(mod, mod.exports, localRequire) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedWco = exported;
    return cachedWco;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "").toLowerCase();
  if (type === "movie" || Number(season) !== 0) return [];

  const fallbackSeason = Number(episode || 0);
  if (!Number.isFinite(fallbackSeason) || fallbackSeason < 1) return [];

  const wco = await loadWco();
  if (!wco) return [];

  try {
    const streams = await wco.getStreams(inputId, "tv", fallbackSeason, 0);
    return (streams || []).map(stream => ({
      ...stream,
      name: String(stream.name || "WCO").replace(/^WCO\s*•\s*/i, `${PROVIDER_NAME} • `) + ` • S0E${fallbackSeason}→S${fallbackSeason}E0`,
      provider: PROVIDER_NAME
    }));
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
