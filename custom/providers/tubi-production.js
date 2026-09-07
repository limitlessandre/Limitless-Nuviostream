"use strict";

// Tubi production provider v1.2.0
// Builds on the validated anonymous-bearer probe flow. Successful matches return
// only clear HLS resources. Results are reduced to the top two unique quality
// levels with up to two distinct manifests per quality (four rows max), preferring
// HLSV6 and H.264 internally when multiple variants share a resolution.
// User-facing rows are simplified to quality + numbered mirror labels and are
// returned highest-quality first. Safe no-match failures collapse to one compact
// No Source Found diagnostic instead of exposing the full probe trace.
// Anime titles use the shared MAL/Jikan -> AniList -> TMDB fallback identity layer;
// non-anime titles keep the existing TMDB/IMDb-only matching path.
// DRM-only titles remain non-playable and return a compact diagnostic row instead.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/tubi-nexus-probe-v5.js";
let cached = null;

function animeHelperSource() {
  return `
const __TUBI_IDENTITY_URL="https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
let __tubiIdentityCache=null;
async function __tubiLoadIdentity(){
  if(__tubiIdentityCache&&typeof __tubiIdentityCache.resolveAnimeIdentity==="function")return __tubiIdentityCache;
  try{
    const r=await fetch(__TUBI_IDENTITY_URL,{skipSizeCheck:true});
    if(!r||!r.ok)return null;
    const s=String(await r.text()||"");
    const m={exports:{}};
    const f=new Function("module","exports","require",s+"\\n;return module.exports;");
    const x=f(m,m.exports,function(name){throw new Error("Unsupported nested require: "+name);})||m.exports;
    if(!x||typeof x.resolveAnimeIdentity!=="function")return null;
    __tubiIdentityCache=x;return x;
  }catch(_){return null;}
}
async function __tubiEnrichAnimeIdentity(info,inputId,type,season,episode){
  if(!info)return info;
  try{
    const helper=await __tubiLoadIdentity();
    if(!helper)return {...info,aliases:[info.title],isAnime:false};
    const identity=await helper.resolveAnimeIdentity(inputId,type,season,episode,TMDB_API_KEY);
    if(!identity||!identity.isAnime)return {...info,aliases:[info.title],isAnime:false};
    const seen=new Set(),aliases=[];
    for(const value of [].concat(identity.aliases||[]).concat([info.title])){
      const text=clean(value),key=norm(text);if(!text||!key||seen.has(key))continue;seen.add(key);aliases.push(text);
    }
    return {...info,aliases:aliases.slice(0,16),isAnime:true,identitySource:identity.identitySource||"anime"};
  }catch(_){return {...info,aliases:[info.title],isAnime:false};}
}
function __tubiAnimeScore(candidate,aliases){
  const a=norm(candidate);if(!a)return 0;let best=0;
  const aw=a.split(" ").filter(Boolean);
  for(const alias of aliases||[]){
    const b=norm(alias);if(!b)continue;
    if(a===b){best=Math.max(best,100);continue;}
    const bw=b.split(" ").filter(Boolean);
    if(bw.length<2)continue;
    const meaningful=bw.filter(w=>w.length>1);
    const hits=meaningful.filter(w=>aw.includes(w)).length;
    if(meaningful.length&&hits===meaningful.length&&aw.length<=bw.length+2)best=Math.max(best,85);
  }
  return best;
}
`;
}

async function loadPatched() {
  if (cached && typeof cached.getStreams === "function") return cached;
  const r = await fetch(BASE_URL, { skipSizeCheck: true });
  if (!r || !r.ok) return null;
  let src = String(await r.text() || "");

  const providerOld = 'const PROVIDER_NAME = "Tubi Nexus Probe";';
  const providerNew = 'const PROVIDER_NAME = "Tubi";';
  const helperMarker = 'function typeOkay(x,wanted){const t=itemType(x);if(!t)return true;if(wanted==="tv")return /series|show|^s$|tv/.test(t)&&!/^v$|movie|film/.test(t);return /movie|film|^v$/.test(t)&&!/series|show|^s$/.test(t);}';
  const helperBlock = helperMarker + '\nfunction clearStreamsFrom(data,display){\n  const list=Array.isArray(data&&data.video_resources)?data.video_resources:[],seen=new Set(),out=[];\n  for(const r of list){\n    const kind=clean(r&&r.type).toLowerCase(),url=clean(r&&r.manifest&&r.manifest.url);\n    if(!url||(kind!=="hlsv6"&&kind!=="hlsv3")||seen.has(url))continue;\n    seen.add(url);\n    const rawRes=clean(r&&r.resolution),m=rawRes.match(/(\\d{3,4})/),quality=m?m[1]+"p":"Auto";\n    let codec=clean(r&&r.codec).replace(/^VIDEO_CODEC_/i,"");\n    if(/^h264$/i.test(codec))codec="H.264";else if(/^(h265|hevc)$/i.test(codec))codec="H.265";\n    out.push({name:`Tubi • ${quality} • ${kind.toUpperCase()}${codec?` • ${codec}`:""}`,title:display?`${display} • Tubi`:"Tubi",url,quality,language:"English",provider:"Tubi",type:"m3u8",headers:{"User-Agent":UA,"Referer":WEB+"/","Origin":WEB},subtitles:[]});\n  }\n  out.sort((a,b)=>{const aq=parseInt(a.quality)||0,bq=parseInt(b.quality)||0;if(aq!==bq)return bq-aq;const av=a.name.includes("HLSV6")?0:1,bv=b.name.includes("HLSV6")?0:1;if(av!==bv)return av-bv;const ac=a.name.includes("H.264")?0:1,bc=b.name.includes("H.264")?0:1;return ac-bc;});\n  const qualities=[];\n  for(const row of out){const q=String(row.quality||"Auto");if(!qualities.includes(q))qualities.push(q);if(qualities.length>=2)break;}\n  const picked=[],counts={};\n  for(const row of out){const q=String(row.quality||"Auto");if(!qualities.includes(q))continue;counts[q]=(counts[q]||0);if(counts[q]>=2)continue;picked.push(row);counts[q]++;if(picked.length>=4)break;}\n  return picked;\n}';

  const bestOld = 'const best=scored[0];let targetId=best.id;';
  const bestNew = 'const best=scored[0];let targetId=best.id,episodePayload=null;';
  const oldEpisodeBlock = 'const page=await request(cu,{headers:sh}),kids=page.data&&Array.isArray(page.data.children)?page.data.children:[];\n    const ep=kids.find((x,i)=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||(i+1))===wantedE);';
  const newEpisodeBlock = 'const page=await request(cu,{headers:sh}),groups=page.data&&Array.isArray(page.data.children)?page.data.children:[],kids=[];\n    for(const group of groups){const inner=group&&Array.isArray(group.children)?group.children:[];if(inner.length)kids.push(...inner);else if(group&&typeof group==="object"&&itemId(group))kids.push(group);}\n    const ep=kids.find(x=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||0)===wantedE)||(wantedE>0&&kids.length>=wantedE?kids[wantedE-1]:null);';
  const epAssignOld = 'if(!ep||!itemId(ep)){rows.push(diag("VERDICT","bearer auth and title search work, but episode mapping needs adjustment",display));return rows.slice(0,18);}targetId=itemId(ep);';
  const epAssignNew = 'if(!ep||!itemId(ep)){return [diag("NO EPISODE",`Tubi title matched, but S${wantedS}E${wantedE} could not be mapped`,display)];}targetId=itemId(ep);episodePayload=ep;';
  const resourceOld = 'const cr=await request(contentUrl,{headers:sh}),rs=resourceSummary(cr.data);\n  rows.push(diag("API CONTENT",`${cr.status||"ERR"} • json=${cr.data?"yes":"no"} • id=${targetId} • resources=${rs.total}`,display));\n  rows.push(diag("RESOURCES",`clear=${rs.clear} • drm=${rs.drm} • types=${rs.types.join(",")||"none"}${rs.host?` • clearHost=${rs.host}`:""}`,display));\n  rows.push(diag("VERDICT",rs.clear>0?"current Tubi anonymous API exposes at least one clear HLS/DASH resource; controlled playback provider is feasible":(rs.drm>0?"title mapped successfully but only DRM resources were returned for this item":"auth/search/content work, but no playback resource was returned for this item"),display));\n  return rows.slice(0,18);';
  const resourceNew = 'const cr=await request(contentUrl,{headers:sh}),directRs=resourceSummary(cr.data),seasonRs=episodePayload?resourceSummary(episodePayload):{total:0,clear:0,drm:0,types:[],host:""};\n  const seasonStreams=episodePayload?clearStreamsFrom(episodePayload,display):[],directStreams=clearStreamsFrom(cr.data,display),streams=seasonStreams.length?seasonStreams:directStreams;\n  if(streams.length)return streams;\n  const drm=Math.max(seasonRs.drm||0,directRs.drm||0);\n  return [diag(drm>0?"DRM ONLY":"NO STREAM",drm>0?`Tubi matched this title, but only Widevine resources are available (${drm})`:`Tubi matched this title, but returned no clear HLS resource`,display)];';

  const tmdbMarker = 'async function tmdbInfo(inputId,mediaType){';
  const infoOld = 'const rows=[],type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",info=await tmdbInfo(inputId,type);if(!info)return[diag("TMDB",`unable to resolve ${inputId}`)];';
  const infoNew = 'const rows=[],type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv";let info=await tmdbInfo(inputId,type);if(!info)return[diag("TMDB",`unable to resolve ${inputId}`)];info=await __tubiEnrichAnimeIdentity(info,inputId,type,season,episode);';
  const searchOld = 'const sh=apiHeaders(auth),searchUrl=`${SEARCH}/api/v3/search?${qs({search:info.title,include_channels:"true",include_linear:"true",is_kids_mode:"false"})}`;\n  const sr=await request(searchUrl,{headers:sh}),items=orderedSearch(sr.data).filter(x=>itemId(x)&&itemTitle(x)&&typeOkay(x,type));\n  const scored=items.map(x=>({raw:x,id:itemId(x),title:itemTitle(x),kind:itemType(x),year:itemYear(x),score:score(itemTitle(x),info.title)+(itemYear(x)&&info.year&&itemYear(x)===info.year?15:0)})).sort((a,b)=>b.score-a.score);\n  rows.push(diag("API SEARCH",`${sr.status||"ERR"} • json=${sr.data?"yes":"no"} • items=${items.length} • matched=${scored.length}`,display));';
  const searchNew = 'const sh=apiHeaders(auth),searchTerms=info.isAnime?(info.aliases||[info.title]).slice(0,8):[info.title],items=[],seenItems=new Set();let lastStatus="ERR",hadJson=false;\n  for(const term of searchTerms){const searchUrl=`${SEARCH}/api/v3/search?${qs({search:term,include_channels:"true",include_linear:"true",is_kids_mode:"false"})}`;const sr=await request(searchUrl,{headers:sh});lastStatus=sr.status||lastStatus;hadJson=hadJson||!!sr.data;for(const x of orderedSearch(sr.data)){const id=itemId(x);if(!id||!itemTitle(x)||!typeOkay(x,type)||seenItems.has(id))continue;seenItems.add(id);items.push(x);}}\n  const scored=items.map(x=>({raw:x,id:itemId(x),title:itemTitle(x),kind:itemType(x),year:itemYear(x),score:(info.isAnime?__tubiAnimeScore(itemTitle(x),info.aliases||[info.title]):score(itemTitle(x),info.title))+(itemYear(x)&&info.year&&itemYear(x)===info.year?15:0)})).sort((a,b)=>b.score-a.score);\n  rows.push(diag("API SEARCH",`${lastStatus} • json=${hadJson?"yes":"no"} • items=${items.length} • matched=${scored.length}${info.isAnime?` • animeAliases=${searchTerms.length}`:""}`,display));';

  if (!src.includes(providerOld) || !src.includes(helperMarker) || !src.includes(bestOld) || !src.includes(oldEpisodeBlock) || !src.includes(epAssignOld) || !src.includes(resourceOld) || !src.includes(tmdbMarker) || !src.includes(infoOld) || !src.includes(searchOld)) return null;

  src = src
    .replace(providerOld, providerNew)
    .replace(/Tubi feasibility probe/g, "Tubi diagnostic")
    .replace(tmdbMarker, animeHelperSource() + "\n" + tmdbMarker)
    .replace(infoOld, infoNew)
    .replace(searchOld, searchNew)
    .replace(helperMarker, helperBlock)
    .replace(bestOld, bestNew)
    .replace(oldEpisodeBlock, newEpisodeBlock)
    .replace(epAssignOld, epAssignNew)
    .replace(resourceOld, resourceNew);

  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", src + "\n;return module.exports;");
  const out = fn(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
  if (!out || typeof out.getStreams !== "function") return null;
  cached = out;
  return out;
}

function qualityNumber(row) {
  const match = String(row && row.quality || row && row.name || "").match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

function isRealStream(row) {
  return !!(row && row.url && !/^DIAG$/i.test(String(row.quality || "")) && !/\bDIAG\b/i.test(String(row.name || "")));
}

function polishRealStreams(rows) {
  const real = (rows || []).filter(isRealStream).slice();
  real.sort((a, b) => qualityNumber(b) - qualityNumber(a));
  const mirrors = {};
  return real.map(row => {
    const quality = String(row.quality || (qualityNumber(row) ? qualityNumber(row) + "p" : "Auto"));
    mirrors[quality] = (mirrors[quality] || 0) + 1;
    return {
      ...row,
      name: `Tubi • ${quality} • Mirror ${mirrors[quality]}`
    };
  });
}

function compactNoSource(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const noSafeMatch = list.some(row => /no safe Tubi title match was found/i.test(String(row && row.name || "")));
  if (!noSafeMatch) return list;
  const sourceRow = list.find(row => row && row.title && !/feasibility probe|diagnostic/i.test(String(row.title))) || list[0] || {};
  return [{
    name: "Tubi • DIAG NO SOURCE FOUND",
    title: sourceRow.title || "No matching Tubi source was found for this title",
    url: "https://tubitv.com/favicon.ico",
    quality: "DIAG",
    language: "Unavailable",
    provider: "Tubi",
    type: "mp4",
    subtitles: []
  }];
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const base = await loadPatched();
    if (!base) return [{name:"Tubi • DIAG LOAD • playback patch failed to load",title:"Tubi diagnostic",url:"https://tubitv.com/favicon.ico",quality:"DIAG",language:"Debug",provider:"Tubi",type:"mp4"}];
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    if (!Array.isArray(rows)) return [];
    if (rows.some(isRealStream)) return polishRealStreams(rows);
    return compactNoSource(rows);
  } catch (e) {
    return [{name:`Tubi • DIAG ERROR • ${String(e&&e.message||e).slice(0,160)}`,title:"Tubi diagnostic",url:"https://tubitv.com/favicon.ico",quality:"DIAG",language:"Debug",provider:"Tubi",type:"mp4"}];
  }
}

module.exports = { getStreams };
