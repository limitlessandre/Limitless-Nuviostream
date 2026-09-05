"use strict";

// Nexus-only Power Rangers compatibility provider.
// It dynamically loads the current production WCO provider and patches only
// the core TV-series lookup so TMDB's single 30-season Power Rangers entry
// maps to WCO's era-specific series pages.

const BASE_PROVIDER_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production.js";
const POWER_RANGERS_IDS = new Set(["2328", "tt0106064"]);
let cachedProvider = null;

function powerRangersPatchSource() {
  return String.raw`
function augmentPowerRangersCore(source) {
  const mapCode = String.raw\`
const __WCO_POWER_RANGERS_MAP = {
  1:  { title: "Mighty Morphin Power Rangers", season: 1 },
  2:  { title: "Mighty Morphin Power Rangers", season: 2 },
  3:  { title: "Mighty Morphin Power Rangers", season: 3 },
  4:  { title: "Power Rangers Zeo", season: 1 },
  5:  { title: "Power Rangers Turbo", season: 1 },
  6:  { title: "Power Rangers in Space", season: 1 },
  7:  { title: "Power Rangers Lost Galaxy", season: 1 },
  8:  { title: "Power Rangers Lightspeed Rescue", season: 1 },
  9:  { title: "Power Rangers Time Force", season: 1 },
  10: { title: "Power Rangers Wild Force", season: 1 },
  11: { title: "Power Rangers Ninja Storm", season: 1 },
  12: { title: "Power Rangers Dino Thunder", season: 1 },
  13: { title: "Power Rangers S.P.D.", season: 1 },
  14: { title: "Power Rangers Mystic Force", season: 1 },
  15: { title: "Power Rangers Operation Overdrive", season: 1 },
  16: { title: "Power Rangers Jungle Fury", season: 1 },
  17: { title: "Power Rangers RPM", season: 1 },
  18: { title: "Power Rangers Samurai", season: 1 },
  19: { title: "Power Rangers Super Samurai", season: 1 },
  20: { title: "Power Rangers Megaforce", season: 1 },
  21: { title: "Power Rangers Super Megaforce", season: 1 },
  22: { title: "Power Rangers Dino Charge", season: 1 },
  23: { title: "Power Rangers Dino Super Charge", season: 1 },
  24: { title: "Power Rangers Ninja Steel", season: 1 },
  25: { title: "Power Rangers Super Ninja Steel", season: 1 },
  26: { title: "Power Rangers Beast Morphers", season: 1 },
  27: { title: "Power Rangers Beast Morphers", season: 2 },
  28: { title: "Power Rangers Dino Fury", season: 1 },
  29: { title: "Power Rangers Dino Fury", season: 2 },
  30: { title: "Power Rangers Cosmic Fury", season: 1 }
};
function __wcoPowerRangersTarget(season) {
  return __WCO_POWER_RANGERS_MAP[Number(season || 1)] || null;
}
\`;

  source = source.replace('const PROVIDER_NAME = "WCO";', 'const PROVIDER_NAME = "WCO Power Rangers Nexus";');
  source = source.replace('"use strict";', '"use strict";\\n' + mapCode);

  const marker = 'async function tvStreams(info, season, episode) {\\n  const wantedSeason = Number(season || 1);';
  const replacement = [
    'async function tvStreams(info, season, episode) {',
    '  const __prTarget = __wcoPowerRangersTarget(season);',
    '  if (__prTarget) {',
    '    info = { ...info, title: __prTarget.title, titles: uniq([__prTarget.title]) };',
    '    season = __prTarget.season;',
    '  }',
    '  const wantedSeason = Number(season || 1);'
  ].join('\\n');

  if (!source.includes(marker)) throw new Error('WCO Power Rangers patch marker not found');
  return source.replace(marker, replacement);
}
`;
}

function augmentProductionSource(source) {
  const addon = powerRangersPatchSource();
  source = source.replace('"use strict";', '"use strict";\n' + addon);

  const marker = 'if (key === "core") source = augmentCoreMirrors(source);';
  const replacement = 'if (key === "core") source = augmentPowerRangersCore(augmentCoreMirrors(source));';
  if (!source.includes(marker)) throw new Error("WCO production core hook not found");
  return source.replace(marker, replacement);
}

async function loadProvider() {
  if (cachedProvider && typeof cachedProvider.getStreams === "function") return cachedProvider;

  const res = await fetch(BASE_PROVIDER_URL, { skipSizeCheck: true });
  if (!res || !res.ok) return null;
  let source = String(await res.text() || "");
  if (!source || !source.includes("module.exports")) return null;

  source = augmentProductionSource(source);
  const mod = { exports: {} };
  const localRequire = function(name) { throw new Error(`Unsupported require: ${name}`); };
  const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
  const exported = factory(mod, mod.exports, localRequire) || mod.exports;
  if (!exported || typeof exported.getStreams !== "function") return null;
  cachedProvider = exported;
  return cachedProvider;
}

async function getStreams(inputId, mediaType, season, episode) {
  const rawId = String(inputId || "").trim().toLowerCase();
  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie" || !POWER_RANGERS_IDS.has(rawId)) return [];

  const mappedSeason = Number(season || 1);
  if (!Number.isFinite(mappedSeason) || mappedSeason < 1 || mappedSeason > 30) return [];

  try {
    const provider = await loadProvider();
    if (!provider) return [];
    return await provider.getStreams(inputId, mediaType, season, episode);
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
