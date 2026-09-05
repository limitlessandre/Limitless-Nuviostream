"use strict";

// Nexus-only Power Rangers compatibility provider.
// This follows the same pattern as the earlier WCO test providers: load the
// proven core directly, patch only the behavior under test, then execute it.
// The production WCO provider remains untouched.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
let cachedCore = null;

const POWER_RANGERS_MAP = {
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

function mapSourceCode() {
  return "const __WCO_POWER_RANGERS_MAP = " + JSON.stringify(POWER_RANGERS_MAP) + ";\n" +
    "function __wcoPowerRangersTarget(season){return __WCO_POWER_RANGERS_MAP[Number(season||1)]||null;}\n";
}

function patchCore(source) {
  source = String(source || "");
  if (!source) return "";

  source = source.replace('const PROVIDER_NAME = "WCO";', 'const PROVIDER_NAME = "WCO Power Rangers Nexus";');
  source = source.replace('"use strict";', '"use strict";\n' + mapSourceCode());

  const tvMarker = 'async function tvStreams(info, season, episode) {\n  const wantedSeason = Number(season || 1);';
  const tvReplacement = [
    'async function tvStreams(info, season, episode) {',
    '  const __inputSeason = Number(season || 1);',
    '  const __prTarget = __wcoPowerRangersTarget(__inputSeason);',
    '  if (!__prTarget) return [];',
    '  info = { ...info, title: __prTarget.title, titles: uniq([__prTarget.title]) };',
    '  season = __prTarget.season;',
    '  const wantedSeason = Number(season || 1);'
  ].join('\n');
  if (!source.includes(tvMarker)) return "";
  source = source.replace(tvMarker, tvReplacement);

  const idMarker = '    const info = await tmdbInfo(inputId, type);\n    if (!info) return [];\n    return type === "movie" ? await movieStreams(info) : await tvStreams(info, season, episode);';
  const idReplacement = [
    '    const info = await tmdbInfo(inputId, type);',
    '    if (!info) return [];',
    '    if (type === "movie" || Number(info.id) !== 2328) return [];',
    '    return await tvStreams(info, season, episode);'
  ].join('\n');
  if (!source.includes(idMarker)) return "";
  source = source.replace(idMarker, idReplacement);

  return source;
}

async function loadCore() {
  if (cachedCore && typeof cachedCore.getStreams === "function") return cachedCore;
  try {
    const res = await fetch(CORE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const raw = String(await res.text() || "");
    const source = patchCore(raw);
    if (!source || !source.includes("module.exports")) return null;

    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    }) || mod.exports;

    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedCore = exported;
    return cachedCore;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie") return [];

  const s = Number(season || 1);
  if (!POWER_RANGERS_MAP[s]) return [];

  try {
    const core = await loadCore();
    if (!core) return [];
    return await core.getStreams(inputId, mediaType, season, episode);
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
