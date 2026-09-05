"use strict";

const PROVIDER_NAME = "WCO Power Rangers DIAG";
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
  19: { title: "Power Rangers Super Samurai", season: 1, fallbacks: [{ title: "Power Rangers Samurai", season: 2 }] },
  20: { title: "Power Rangers Megaforce", season: 1 },
  21: { title: "Power Rangers Super Megaforce", season: 1, fallbacks: [{ title: "Power Rangers Megaforce", season: 2 }] },
  22: { title: "Power Rangers Dino Charge", season: 1 },
  23: { title: "Power Rangers Dino Super Charge", season: 1, fallbacks: [{ title: "Power Rangers Dino Charge", season: 2 }] },
  24: { title: "Power Rangers Ninja Steel", season: 1 },
  25: { title: "Power Rangers Super Ninja Steel", season: 1, fallbacks: [{ title: "Power Rangers Ninja Steel", season: 2 }] },
  26: { title: "Power Rangers Beast Morphers", season: 1 },
  27: { title: "Power Rangers Beast Morphers", season: 2 },
  28: { title: "Power Rangers Dino Fury", season: 1 },
  29: { title: "Power Rangers Dino Fury", season: 2 },
  30: { title: "Power Rangers Cosmic Fury", season: 1 }
};

function mapSourceCode() {
  return "const __PR_DIAG_MAP=" + JSON.stringify(POWER_RANGERS_MAP) + ";\n" +
    "function __prDiagAttempts(s){const x=__PR_DIAG_MAP[Number(s||1)];if(!x)return[];return [{title:x.title,season:x.season,kind:'primary'}].concat((x.fallbacks||[]).map(y=>({title:y.title,season:y.season,kind:'fallback'})));}\n";
}

function patchCore(source) {
  source = String(source || "");
  if (!source) return "";
  source = source.replace('const PROVIDER_NAME = "WCO";', 'const PROVIDER_NAME = "WCO Power Rangers DIAG";');
  source = source.replace('"use strict";', '"use strict";\n' + mapSourceCode());

  const start = source.indexOf("async function getStreams(inputId, mediaType, season, episode) {");
  const end = source.indexOf("module.exports = { getStreams };", start);
  if (start < 0 || end < 0) return "";

  const replacement = String.raw`
const __PR_DIAG_URL = "https://www.wcostream.tv/favicon.ico";
function __prDiagRow(stage,message){
  const clean=String(message||"").replace(/\s+/g," ").trim().slice(0,210);
  const label=stage+" • "+clean;
  return {name:PROVIDER_NAME+" • "+label,title:label,url:__PR_DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};
}
function __prDiagSlug(v){return String(v||"").toLowerCase().replace(/&amp;|&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");}
function __prDiagEpisodeName(text){
  return stripTags(text).replace(/^\s*season\s*\d+\s*episode\s*\d+(?:\.\d+)?\s*[-:–]?\s*/i,"").replace(/^\s*episode\s*\d+(?:\.\d+)?\s*[-:–]?\s*/i,"").trim();
}
function __prDiagEpisodeMatches(html,pageUrl,wantedSeason,wantedEpisode,wantedName){
  const out=[];const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(String(html||"")))&&out.length<700){
    const text=stripTags(m[2]),href=absolute(m[1],pageUrl);if(!href||!text||/\/anime\//i.test(href))continue;
    const combined=text+" "+href,foundSeason=explicitSeason(combined);
    const ep=text.match(/Episode\s*(\d+(?:\.\d+)?)/i)||href.match(/episode[-_ ]?(\d+(?:\.\d+)?)/i);
    const numberMatch=!!ep&&Number(ep[1])===Number(wantedEpisode||1)&&(foundSeason==null||foundSeason===Number(wantedSeason||1));
    const cleaned=__prDiagEpisodeName(text);
    const rawNameScore=wantedName?scoreTitle(text,wantedName):0;
    const cleanNameScore=wantedName?scoreTitle(cleaned,wantedName):0;
    if(numberMatch||rawNameScore>=45||cleanNameScore>=45)out.push({text,href,foundSeason,numberMatch,rawNameScore,cleanNameScore,cleaned});
  }
  return out.sort((a,b)=>(b.numberMatch-a.numberMatch)||(b.cleanNameScore-a.cleanNameScore)||(b.rawNameScore-a.rawNameScore));
}
async function getStreams(inputId, mediaType, season, episode) {
  const rows=[];
  try{
    const type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv";
    const inputSeason=Number(season||1),wantedEpisode=Number(episode||1);
    const info=await tmdbInfo(inputId,type);
    if(!info)return [__prDiagRow("01 INPUT","TMDB metadata failed")];
    rows.push(__prDiagRow("01 INPUT","id="+info.id+" title="+info.title+" S"+inputSeason+"E"+wantedEpisode));
    if(type==="movie"||Number(info.id)!==2328){rows.push(__prDiagRow("02 STOP","resolved TMDB id is not Power Rangers 2328"));return rows;}

    let epName="";
    try{const ep=await jsonReq("https://api.themoviedb.org/3/tv/"+info.id+"/season/"+inputSeason+"/episode/"+wantedEpisode+"?api_key="+TMDB_API_KEY);epName=String(ep&&ep.name||"").trim();}catch(_){}
    rows.push(__prDiagRow("02 TMDB EP","name="+(epName||"EMPTY")));

    const attempts=__prDiagAttempts(inputSeason);
    if(!attempts.length){rows.push(__prDiagRow("03 MAP","no mapping for season "+inputSeason));return rows;}

    for(const attempt of attempts){
      rows.push(__prDiagRow("03 MAP",attempt.kind+" => "+attempt.title+" S"+attempt.season));

      const directUrl=ORIGINS[0]+"/anime/"+__prDiagSlug(attempt.title);
      const direct=await req(directUrl,{headers:{"Referer":ORIGINS[0]+"/"}});
      const directIdentity=direct.ok?pageIdentityText(direct.text):"";
      const directScore=direct.ok?scoreTitle(directIdentity+" "+direct.url,attempt.title):0;
      rows.push(__prDiagRow("04 DIRECT",attempt.kind+" HTTP "+direct.status+" final="+String(direct.url||directUrl).replace(/^https?:\/\/[^/]+/,"")+" identity="+(directIdentity||"none")+" score="+directScore));

      const mappedInfo={...info,title:attempt.title,titles:uniq([attempt.title])};
      const candidates=await searchWco(mappedInfo,attempt.season);
      rows.push(__prDiagRow("05 SEARCH",attempt.kind+" candidates="+candidates.length+(candidates[0]?" top="+candidates[0].title+" score="+candidates[0].score:"")));
      if(!candidates.length)continue;

      const candidate=candidates[0];
      const series=await candidatePage(candidate);
      if(!series){rows.push(__prDiagRow("06 PAGE",attempt.kind+" top candidate page failed"));continue;}
      const identity=pageIdentityText(series.page.text);
      const identityScore=scoreTitle(identity+" "+series.pageUrl,attempt.title);
      rows.push(__prDiagRow("06 PAGE",attempt.kind+" identity="+(identity||"none")+" pageSeason="+(series.season==null?"none":series.season)+" identityScore="+identityScore+" url="+series.pageUrl.replace(/^https?:\/\/[^/]+/,"")));

      const dubUrl=audioFilterUrl(series.pageUrl,"dub");
      const dub=await req(dubUrl,{headers:{"Referer":series.pageUrl}});
      rows.push(__prDiagRow("07 LIST",attempt.kind+" dub HTTP "+dub.status+" bytes="+dub.text.length));
      if(!dub.ok)continue;

      const exact=episodeLinks(dub.text,dubUrl,attempt.season,wantedEpisode,series.season,"Dub");
      rows.push(__prDiagRow("08 NUMBER",attempt.kind+" exactCount="+exact.length+(exact[0]?" first="+exact[0].text:"")));

      const matches=__prDiagEpisodeMatches(dub.text,dubUrl,attempt.season,wantedEpisode,epName);
      if(matches.length){
        const x=matches[0];
        rows.push(__prDiagRow("09 NAME",attempt.kind+" first="+x.text+" | cleaned="+x.cleaned+" | season="+(x.foundSeason==null?"none":x.foundSeason)+" num="+(x.numberMatch?"yes":"no")+" rawScore="+x.rawNameScore+" cleanScore="+x.cleanNameScore));
      }else rows.push(__prDiagRow("09 NAME",attempt.kind+" no numeric/name candidates"));
    }

    rows.push(__prDiagRow("10 DONE","diagnostic only, no playback attempted"));
    return rows.slice(0,20);
  }catch(e){
    rows.push(__prDiagRow("99 ERROR",String(e&&e.message||e)));
    return rows;
  }
}

`;

  return source.slice(0, start) + replacement + source.slice(end);
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
    const exported = factory(mod, mod.exports, function(name){throw new Error("Unsupported nested require: "+name);}) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedCore = exported;
    return cachedCore;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const core = await loadCore();
    if (!core) return [{name:PROVIDER_NAME+" • 00 LOAD • core patch failed",title:"core patch failed",url:"https://www.wcostream.tv/favicon.ico",quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"}];
    return await core.getStreams(inputId, mediaType, season, episode);
  } catch (e) {
    return [{name:PROVIDER_NAME+" • 99 WRAPPER • "+String(e&&e.message||e).slice(0,120),title:"wrapper error",url:"https://www.wcostream.tv/favicon.ico",quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"}];
  }
}

module.exports = { getStreams };
