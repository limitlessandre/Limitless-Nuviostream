"use strict";

// WCO production adapter that enriches the normal WCO core with anime-native
// MAL/AniList titles before the existing production mirror/premium augmentation runs.
// Non-anime titles remain unchanged when the MAL resolver has no mapping.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production.js";
let cached = null;

function animeIdentityPatchSource() {
  return `
async function __wcoAnimeIdentity(info,inputId,type,season,episode){
  try{
    if(!info)return info;
    const raw=String(inputId||"").trim();
    const imdb=String(info.imdbId||(/^tt\\d+$/i.test(raw)?raw:"")).trim();
    if(!imdb)return info;
    const s=type==="movie"?1:Number(season||1);
    const e=type==="movie"?1:Number(episode||1);
    const mapped=await jsonReq("https://id-mapping-api-malid.hf.space/api/resolve?id="+encodeURIComponent(imdb)+"&s="+encodeURIComponent(String(s))+"&e="+encodeURIComponent(String(e)));
    const malId=mapped&&Number(mapped.mal_id||0);
    if(!malId)return info;
    const query="query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native userPreferred} synonyms}}";
    const ani=await jsonReq("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query,variables:{idMal:malId}})});
    const media=ani&&ani.data&&ani.data.Media;
    if(!media)return info;
    const t=media.title||{};
    const aliases=uniq([t.english,t.romaji,t.userPreferred].concat(Array.isArray(media.synonyms)?media.synonyms:[]).concat([t.native]).concat(info.titles||[])).slice(0,12);
    if(!aliases.length)return info;
    return {...info,title:t.english||t.romaji||t.userPreferred||info.title,titles:aliases,isAnime:true,malId:malId,anilistId:Number(media.id||0)||null};
  }catch(_){return info;}
}
`;
}

function augmentAnimeIdentity(source) {
  let out = String(source || "");
  const tmdbMarker = "async function tmdbInfo(inputId, mediaType) {";
  const getStreamsMarker = "const info = await tmdbInfo(inputId, type);";
  if (!out.includes(tmdbMarker) || !out.includes(getStreamsMarker)) return out;

  out = out.replace(tmdbMarker, animeIdentityPatchSource() + "\n" + tmdbMarker);
  out = out.replace("append_to_response=alternative_titles`", "append_to_response=alternative_titles,external_ids`");
  out = out.replace(
    'year: String(data.release_date || data.first_air_date || "").slice(0, 4)',
    'year: String(data.release_date || data.first_air_date || "").slice(0, 4),\n    imdbId: (/^tt\\d+$/i.test(raw) ? raw : String((data.external_ids && data.external_ids.imdb_id) || data.imdb_id || ""))'
  );
  out = out.replace(
    "const info = await tmdbInfo(inputId, type);\n    if (!info) return [];",
    "let info = await tmdbInfo(inputId, type);\n    if (!info) return [];\n    info = await __wcoAnimeIdentity(info, inputId, type, season, episode);"
  );
  return out;
}

function patchProduction(source) {
  let out = String(source || "");
  const marker = 'if (key === "core") source = augmentCoreMirrors(source);';
  if (!out.includes(marker)) return "";
  out = out.replace('"use strict";', '"use strict";\n\n' + augmentAnimeIdentity.toString() + '\n' + animeIdentityPatchSource.toString() + '\n');
  out = out.replace(marker, 'if (key === "core") source = augmentCoreMirrors(augmentAnimeIdentity(source));');
  return out;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const patched = patchProduction(String(await res.text() || ""));
    if (!patched || !patched.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
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
