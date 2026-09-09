"use strict";

// Tubi production wrapper v1.2.4
// Keeps the validated Tubi production behavior, but adds a Power Rangers-only
// season-title bridge for TMDB TV id 2328. Tubi catalogs Power Rangers seasons as
// separate franchise cards, while TMDB presents the franchise under one series.
// All non-Power-Rangers matching remains unchanged.

const PROVIDER_NAME = "Tubi";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/tubi-production.js";
let cached = null;

function patchPowerRangers(source) {
  const startMarker = "  const searchNew = 'const sh=apiHeaders(auth),searchTerms=";
  const endMarker = "';\n\n  if (!src.includes(providerOld)";
  const start = source.indexOf(startMarker);
  const end = start >= 0 ? source.indexOf(endMarker, start) : -1;
  if (start < 0 || end < 0) return null;

  const replacement =
    "  const searchNew = 'const sh=apiHeaders(auth),prMap={1:[\"Mighty Morphin Power Rangers\"],2:[\"Mighty Morphin Power Rangers\"],3:[\"Mighty Morphin Power Rangers\"],4:[\"Power Rangers Zeo\"],5:[\"Power Rangers Turbo\"],6:[\"Power Rangers in Space\"],7:[\"Power Rangers Lost Galaxy\"],8:[\"Power Rangers Lightspeed Rescue\"],9:[\"Power Rangers Time Force\"],10:[\"Power Rangers Wild Force\"],11:[\"Power Rangers Ninja Storm\"],12:[\"Power Rangers Dino Thunder\"],13:[\"Power Rangers S.P.D.\",\"Power Rangers SPD\"],14:[\"Power Rangers Mystic Force\"],15:[\"Power Rangers Operation Overdrive\"],16:[\"Power Rangers Jungle Fury\"],17:[\"Power Rangers RPM\"],18:[\"Power Rangers Samurai\"],19:[\"Power Rangers Super Samurai\"],20:[\"Power Rangers Megaforce\"],21:[\"Power Rangers Super Megaforce\"],22:[\"Power Rangers Dino Charge\"],23:[\"Power Rangers Dino Super Charge\"],24:[\"Power Rangers Ninja Steel\"],25:[\"Power Rangers Super Ninja Steel\"],26:[\"Power Rangers Beast Morphers\"],27:[\"Power Rangers Beast Morphers\"],28:[\"Power Rangers Dino Fury\"],29:[\"Power Rangers Dino Fury\"],30:[\"Power Rangers Cosmic Fury\"]},prTerms=(!info.isAnime&&type===\"tv\"&&Number(info.id)===2328)?(prMap[Number(season||1)]||[]):[],searchTerms=info.isAnime?(info.aliases||[info.title]).slice(0,8):(prTerms.length?prTerms:[info.title]),items=[],seenItems=new Set();let lastStatus=\"ERR\",hadJson=false;\\n  for(const term of searchTerms){const searchUrl=`${SEARCH}/api/v3/search?${qs({search:term,include_channels:\"true\",include_linear:\"true\",is_kids_mode:\"false\"})}`;const sr=await request(searchUrl,{headers:sh});lastStatus=sr.status||lastStatus;hadJson=hadJson||!!sr.data;for(const x of orderedSearch(sr.data)){const id=itemId(x);if(!id||!itemTitle(x)||!typeOkay(x,type)||seenItems.has(id))continue;seenItems.add(id);items.push(x);}}\\n  const scored=items.map(x=>{const baseScore=info.isAnime?__tubiAnimeScore(itemTitle(x),info.aliases||[info.title]):(prTerms.length?Math.max(...prTerms.map(term=>score(itemTitle(x),term))):score(itemTitle(x),info.title));const yearBonus=!prTerms.length&&itemYear(x)&&info.year&&itemYear(x)===info.year?15:0;return {raw:x,id:itemId(x),title:itemTitle(x),kind:itemType(x),year:itemYear(x),score:baseScore+yearBonus};}).sort((a,b)=>b.score-a.score);\\n  rows.push(diag(\"API SEARCH\",`${lastStatus} • json=${hadJson?\"yes\":\"no\"} • items=${items.length} • matched=${scored.length}${info.isAnime?` • animeAliases=${searchTerms.length}`:(prTerms.length?` • powerRangers=S${Number(season||1)}`:\"\")}`,display));'";

  return source.slice(0, start) + replacement + source.slice(end + 2);
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const raw = String(await response.text() || "");
    const source = patchPowerRangers(raw);
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}

function esc(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function heightOf(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const match = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return match ? Number(match[1]) : 0;
}

function tier(height) {
  if (height >= 4320) return `2x4K 8K ${height}p`;
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `Enhanced QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 540) return `HD-Low ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height >= 360) return `SD-Low ${height}p`;
  return `SD-Very Low ${height}p`;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const height = heightOf(row);
  const quality = String(row.quality || "").trim();
  let label = height ? tier(height) : "";
  if (!label && /^(auto|unknown)$/i.test(quality) && row.url) label = "Unknown Auto";
  if (!label) return row;

  let rest = String(row.name || "").trim();
  rest = rest.replace(new RegExp(`^${esc(PROVIDER_NAME)}(?:\\s*•)?\\s*`, "i"), "");
  if (height) rest = rest.replace(new RegExp(`\\b${height}p\\b`, "i"), "");
  rest = rest
    .replace(/^(?:2x4K 8K|4K|Enhanced QHD|QHD|FHD|HD(?:-Low)?|SD(?:-Low|-Very Low)?|Unknown(?: Auto)?)\s*(?:•\s*)?/i, "")
    .replace(/\s*•\s*•\s*/g, " • ")
    .replace(/^\s*•\s*|\s*•\s*$/g, "")
    .trim();
  return { ...row, name: `${PROVIDER_NAME} • ${label}${rest ? ` • ${rest}` : ""}` };
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
  } catch (_) { return []; }
}

module.exports = { getStreams };
