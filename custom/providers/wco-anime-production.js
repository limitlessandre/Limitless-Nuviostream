"use strict";

// WCO production adapter. Anime titles use the shared MAL/AniList-first identity
// resolver, then fall back to WCO core's existing TMDB aliases when anime metadata
// is unavailable. Non-anime titles never call the anime databases.
//
// Anime episode ownership is alias-aware: WCO sometimes uses a dubbed/English slug
// for the series page and a romaji/native-derived slug for the subbed episode URL.
// We only allow that alternate ownership path for anime and only when a strong
// multi-token alias match is present, preserving sidebar/recent-release protection.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production.js";
let cached = null;

function coreAnimeAddonSource() {
  return `
const __WCO_IDENTITY_URL="https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
let __wcoIdentityCache=null;
async function __wcoLoadIdentity(){
  if(__wcoIdentityCache&&typeof __wcoIdentityCache.resolveAnimeIdentity==="function")return __wcoIdentityCache;
  try{
    const r=await fetch(__WCO_IDENTITY_URL,{skipSizeCheck:true});
    if(!r||!r.ok)return null;
    const s=String(await r.text()||"");
    const m={exports:{}};
    const f=new Function("module","exports","require",s+"\\n;return module.exports;");
    const x=f(m,m.exports,function(name){throw new Error("Unsupported nested require: "+name);})||m.exports;
    if(!x||typeof x.resolveAnimeIdentity!=="function")return null;
    __wcoIdentityCache=x;return x;
  }catch(_){return null;}
}
async function __wcoEnrichAnimeIdentity(info,inputId,type,season,episode){
  try{
    if(!info)return info;
    const helper=await __wcoLoadIdentity();
    if(!helper)return info;
    const identity=await helper.resolveAnimeIdentity(inputId,type,season,episode,TMDB_API_KEY);
    if(!identity||!identity.isAnime)return info;
    const aliases=uniq([].concat(identity.aliases||[]).concat(info.titles||[])).slice(0,24);
    if(!aliases.length)return info;
    return {...info,title:identity.title||info.title,titles:aliases,isAnime:true,malId:identity.malId||null,anilistId:identity.anilistId||null};
  }catch(_){return info;}
}
`;
}

function augmentAnimeIdentity(source) {
  let out = String(source || "");
  const tmdbMarker = "async function tmdbInfo(inputId, mediaType) {";
  const getStreamsMarker = "const info = await tmdbInfo(inputId, type);\n    if (!info) return [];";
  if (!out.includes(tmdbMarker) || !out.includes(getStreamsMarker)) return out;
  out = out.replace(tmdbMarker, coreAnimeAddonSource() + "\n" + tmdbMarker);
  out = out.replace(
    getStreamsMarker,
    "let info = await tmdbInfo(inputId, type);\n    if (!info) return [];\n    info = await __wcoEnrichAnimeIdentity(info, inputId, type, season, episode);"
  );
  return out;
}

function augmentAnimeEpisodeOwnership(source) {
  let out = String(source || "");
  const oldOwnership = `function episodeBelongsToSeries(href, pageUrl) {
  const series = seriesSlugParts(pageUrl);
  if (!series.slug) return true;
  const path = String(href || "").replace(/^https?:\\/\\/[^/]+/i, "").toLowerCase();
  if (path.includes(\`/\${series.slug}-episode-\`) || path.includes(\`/\${series.slug}-season-\`)) return true;
  if (!series.tokens.length) return true;
  const actual = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
  let hits = 0;
  for (const token of series.tokens) if (actual.has(token)) hits += 1;
  if (series.tokens.length === 1) return false;
  return hits >= Math.max(2, Math.ceil(series.tokens.length * 0.6));
}`;
  const newOwnership = `function episodeBelongsToSeries(href, pageUrl, allowedTitles) {
  const series = seriesSlugParts(pageUrl);
  if (!series.slug) return true;
  const path = String(href || "").replace(/^https?:\\/\\/[^/]+/i, "").toLowerCase();
  if (path.includes(\`/\${series.slug}-episode-\`) || path.includes(\`/\${series.slug}-season-\`)) return true;
  if (!series.tokens.length) return true;
  const actual = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
  let hits = 0;
  for (const token of series.tokens) if (actual.has(token)) hits += 1;
  if (series.tokens.length > 1 && hits >= Math.max(2, Math.ceil(series.tokens.length * 0.6))) return true;

  // Anime-only alternate slug allowance. WCO can use a dubbed/English slug for
  // the series page while subbed episode URLs use a romaji-derived slug. Require
  // at least two meaningful alias tokens and strong coverage, so unrelated Recent
  // Releases/sidebar links cannot qualify from a single generic word.
  for (const title of Array.isArray(allowedTitles) ? allowedTitles : []) {
    const tokens = normalize(title).split(" ").filter(token => token.length >= 3 && !/^\\d+$/.test(token));
    if (tokens.length < 2) continue;
    const unique = [...new Set(tokens)];
    let aliasHits = 0;
    for (const token of unique) if (actual.has(token)) aliasHits += 1;
    if (aliasHits >= Math.max(2, Math.ceil(unique.length * 0.7))) return true;
  }
  return false;
}`;
  if (!out.includes(oldOwnership)) return out;
  out = out.replace(oldOwnership, newOwnership);
  out = out.replace(
    "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant) {",
    "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant, allowedTitles) {"
  );
  out = out.replace(
    "if (!episodeBelongsToSeries(href, pageUrl)) continue;",
    "if (!episodeBelongsToSeries(href, pageUrl, allowedTitles)) continue;"
  );
  out = out.replace(
    "episodeLinks(filtered.text, filteredUrl, wantedSeason, wantedEpisode, series.season, variant)",
    "episodeLinks(filtered.text, filteredUrl, wantedSeason, wantedEpisode, series.season, variant, info.isAnime ? info.titles : [])"
  );
  out = out.replace(
    "episodeLinks(series.page.text, series.pageUrl, wantedSeason, wantedEpisode, series.season, variant)",
    "episodeLinks(series.page.text, series.pageUrl, wantedSeason, wantedEpisode, series.season, variant, info.isAnime ? info.titles : [])"
  );
  out = out.replace(
    "if (!episodeBelongsToSeries(epPage.url || entry.href, series.pageUrl)) continue;",
    "if (!episodeBelongsToSeries(epPage.url || entry.href, series.pageUrl, info.isAnime ? info.titles : [])) continue;"
  );
  return out;
}

function patchProduction(source) {
  let out = String(source || "");
  const marker = 'if (key === "core") source = augmentCoreMirrors(source);';
  if (!out.includes(marker)) return "";
  out = out.replace('"use strict";', '"use strict";\n\n' + augmentAnimeIdentity.toString() + '\n' + coreAnimeAddonSource.toString() + '\n' + augmentAnimeEpisodeOwnership.toString() + '\n');
  out = out.replace(marker, 'if (key === "core") source = augmentCoreMirrors(augmentAnimeEpisodeOwnership(augmentAnimeIdentity(source)));');
  return out;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck:true });
    if (!res || !res.ok) return null;
    const patched = patchProduction(String(await res.text() || ""));
    if (!patched || !patched.includes("module.exports")) return null;
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try { return await base.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

module.exports = { getStreams, onSettings };
