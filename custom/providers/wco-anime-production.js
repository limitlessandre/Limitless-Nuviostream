"use strict";

// WCO production adapter. Anime titles use the shared MAL/AniList-first identity
// resolver, then fall back to WCO core's existing TMDB aliases when anime metadata
// is unavailable. Non-anime titles never call the anime databases.

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

function patchProduction(source) {
  let out = String(source || "");
  const marker = 'if (key === "core") source = augmentCoreMirrors(source);';
  if (!out.includes(marker)) return "";
  out = out.replace('"use strict";', '"use strict";\n\n' + augmentAnimeIdentity.toString() + '\n' + coreAnimeAddonSource.toString() + '\n');
  out = out.replace(marker, 'if (key === "core") source = augmentCoreMirrors(augmentAnimeIdentity(source));');
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
