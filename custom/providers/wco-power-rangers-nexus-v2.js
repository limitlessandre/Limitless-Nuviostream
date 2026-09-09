"use strict";

// Nexus-only wrapper around the validated generic season-title resolver.
// Adds lightweight fallbacks for WCO search gaps, numbered TMDB season titles,
// season-aware title matching, title-assisted numeric disambiguation, and
// candidate-level diagnostics for unresolved duplicate episode links.
// Production WCO is untouched.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-power-rangers-nexus.js";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
let cached = null;

function diag(message, season, episode) {
  const clean = String(message || "unknown error").replace(/\s+/g, " ").trim().slice(0, 180);
  return [{
    name: `${PROVIDER_NAME} • DIAG WRAPPER • ${clean}`,
    title: `Power Rangers S${String(Number(season || 1)).padStart(2, "0")}E${String(Number(episode || 1)).padStart(2, "0")}`,
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
}

function patchResolver(source) {
  let out = String(source || "");
  if (!out) return "";

  // TMDB sometimes names continuation seasons like "Mighty Morphin (2)" or
  // "Beast Morphers (2)". The parenthetical number is a source-season hint,
  // not part of the WCO series title. Season 1 also gets a safe source hint of 1.
  const oldSearchTitles = String.raw`function __wcoResolverSearchTitles(showTitle,seasonName){
  const show=String(showTitle||"").trim(),season=String(seasonName||"").trim(),out=[];
  const generic=!season||/^season\s*\d+$/i.test(season);
  if(!generic){
    const ns=normalize(season),nh=normalize(show);
    if(ns&&nh&&(ns.includes(nh)||nh.includes(ns)))out.push({title:season,kind:"season"});
    else{
      const words=season.split(/\s+/).filter(Boolean);
      const compactTitle=words.length>=2&&words.length<=4?(show+" "+words.join("")).trim():"";
      out.push({title:(show+" "+season).trim(),kind:"combined",compactTitle});
      out.push({title:season,kind:"season"});
    }
  }
  out.push({title:show,kind:"show"});
  return out.filter((x,i,a)=>x.title&&a.findIndex(y=>normalize(y.title)===normalize(x.title))===i);
}`;

  const newSearchTitles = String.raw`function __wcoResolverSearchTitles(showTitle,seasonName,inputSeason){
  const show=String(showTitle||"").trim(),rawSeason=String(seasonName||"").trim(),out=[];
  const suffix=rawSeason.match(/\s*\((\d+)\)\s*$/);
  const sourceSeason=suffix?Number(suffix[1]):(Number(inputSeason)===1?1:null);
  const season=rawSeason.replace(/\s*\(\d+\)\s*$/,"").trim();
  const generic=!season||/^season\s*\d+$/i.test(season);
  if(!generic){
    const ns=normalize(season),nh=normalize(show);
    if(ns&&nh&&(ns.includes(nh)||nh.includes(ns)))out.push({title:season,kind:"season",sourceSeason});
    else{
      const words=season.split(/\s+/).filter(Boolean);
      const compactTitle=words.length>=2&&words.length<=4?(show+" "+words.join("")).trim():"";
      out.push({title:(show+" "+season).trim(),kind:"combined",compactTitle,sourceSeason});
      out.push({title:season,kind:"season",sourceSeason});
    }
  }
  out.push({title:show,kind:"show",sourceSeason});
  return out.filter((x,i,a)=>x.title&&a.findIndex(y=>normalize(y.title)===normalize(x.title))===i);
}`;

  if (!out.includes(oldSearchTitles)) return "";
  out = out.replace(oldSearchTitles, newSearchTitles);
  out = out.replace(
    'const __attempts = __wcoResolverSearchTitles(info.title, __seasonName);',
    'const __attempts = __wcoResolverSearchTitles(info.title, __seasonName, __inputSeason);'
  );

  // Score the actual episode title, not WCO's "Season X Episode Y" prefix.
  out = out.replace(
    'function __wcoResolverNameEntries(html,pageUrl,wantedName,forcedVariant){',
    'function __wcoResolverNameEntries(html,pageUrl,wantedName,forcedVariant,wantedSourceSeason){'
  );
  out = out.replace(
    '    const score=scoreTitle(text,wantedName);',
    '    const cleanTitle=text.replace(/^\\s*Season\\s*\\d+\\s*Episode\\s*\\d+(?:\\.\\d+)?\\s*[-:–—]?\\s*/i,"").replace(/^\\s*Episode\\s*\\d+(?:\\.\\d+)?\\s*[-:–—]?\\s*/i,"").trim();\n    const score=Math.max(scoreTitle(text,wantedName),scoreTitle(cleanTitle,wantedName));'
  );
  out = out.replace(
    '    out.push({href,text,variant:forcedVariant||detected,season:explicitSeason(combined),episode:ep?Number(ep[1]):null,score});',
    '    let foundSeason=explicitSeason(combined);\n    if(foundSeason==null){const sm=combined.match(/Season\\s*(\\d+)/i)||combined.match(/season[-_ ]?(\\d+)/i);if(sm)foundSeason=Number(sm[1]);}\n    if(wantedSourceSeason&&foundSeason!=null&&Number(foundSeason)!==Number(wantedSourceSeason))continue;\n    out.push({href,text,cleanTitle,variant:forcedVariant||detected,season:foundSeason,episode:ep?Number(ep[1]):null,score});'
  );
  out = out.replace(
    'async function __wcoResolverExtractByName(series,variant,wantedName,displayTitle,info){',
    'async function __wcoResolverExtractByName(series,variant,wantedName,displayTitle,info,wantedSourceSeason){'
  );
  out = out.replace(
    '__wcoResolverNameEntries(filtered.text,filteredUrl,wantedName,variant)',
    '__wcoResolverNameEntries(filtered.text,filteredUrl,wantedName,variant,wantedSourceSeason)'
  );
  out = out.replace(
    '__wcoResolverNameEntries(series.page.text,series.pageUrl,wantedName,variant)',
    '__wcoResolverNameEntries(series.page.text,series.pageUrl,wantedName,variant,wantedSourceSeason)'
  );

  // Numeric fallback also keeps the cleaned title. If WCO exposes multiple links
  // for the same episode number, TMDB's episode name can safely pick the intended one.
  out = out.replace(
    'function __wcoResolverNumericEntries(html,pageUrl,wantedEpisode,forcedVariant){',
    'function __wcoResolverNumericEntries(html,pageUrl,wantedEpisode,forcedVariant,wantedSourceSeason){'
  );
  out = out.replace(
    '    out.push({href,text,variant:forcedVariant||detected,season:explicitSeason(combined)});',
    '    const cleanTitle=text.replace(/^\\s*Season\\s*\\d+\\s*Episode\\s*\\d+(?:\\.\\d+)?\\s*[-:–—]?\\s*/i,"").replace(/^\\s*Episode\\s*\\d+(?:\\.\\d+)?\\s*[-:–—]?\\s*/i,"").trim();\n    let foundSeason=explicitSeason(combined);\n    if(foundSeason==null){const sm=combined.match(/Season\\s*(\\d+)/i)||combined.match(/season[-_ ]?(\\d+)/i);if(sm)foundSeason=Number(sm[1]);}\n    if(wantedSourceSeason&&foundSeason!=null&&Number(foundSeason)!==Number(wantedSourceSeason))continue;\n    out.push({href,text,cleanTitle,variant:forcedVariant||detected,season:foundSeason});'
  );
  out = out.replace(
    'async function __wcoResolverExtractUniqueNumber(series,variant,wantedEpisode,displayTitle,info){',
    'async function __wcoResolverExtractUniqueNumber(series,variant,wantedEpisode,displayTitle,info,wantedSourceSeason,wantedName){'
  );
  out = out.replace(
    '__wcoResolverNumericEntries(filtered.text,filteredUrl,wantedEpisode,variant)',
    '__wcoResolverNumericEntries(filtered.text,filteredUrl,wantedEpisode,variant,wantedSourceSeason)'
  );
  out = out.replace(
    '__wcoResolverNumericEntries(series.page.text,series.pageUrl,wantedEpisode,variant)',
    '__wcoResolverNumericEntries(series.page.text,series.pageUrl,wantedEpisode,variant,wantedSourceSeason)'
  );
  out = out.replace(
    '  episodes=episodes.filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i);\n  if(episodes.length!==1)return{streams:[],count:episodes.length};',
    '  episodes=episodes.filter((x,i,a)=>a.findIndex(y=>String(y.href||"").replace(/[?#].*$/,"").replace(/\\/$/,"")===String(x.href||"").replace(/[?#].*$/,"").replace(/\\/$/,""))===i);\n  const rawCount=episodes.length;\n  const debugEntries=episodes.slice(0,4).map((x,i)=>{const label=String(x.cleanTitle||x.text||"untitled").replace(/\\s+/g," ").trim().slice(0,48);const href=String(x.href||"").replace(/^https?:\\/\\//,"").slice(0,72);return String(i+1)+":S"+String(x.season==null?"nil":x.season)+" "+label+" @ "+href;}).join(" || ");\n  if(episodes.length>1&&wantedName){\n    const scored=episodes.map(x=>({...x,_nameScore:scoreTitle(x.cleanTitle||x.text,wantedName)})).sort((a,b)=>b._nameScore-a._nameScore);\n    if(scored[0]&&scored[0]._nameScore>=80){\n      const top=scored[0]._nameScore;\n      const tied=scored.filter(x=>x._nameScore===top);\n      const firstNorm=normalize(tied[0].cleanTitle||tied[0].text);\n      if(tied.every(x=>normalize(x.cleanTitle||x.text)===firstNorm))episodes=[tied[0]];\n      else if(tied.length===1)episodes=[tied[0]];\n    }\n  }\n  if(episodes.length!==1)return{streams:[],count:rawCount,debug:debugEntries};'
  );

  out = out.replace(
    '__wcoResolverExtractByName(series,"Dub",__episodeName,__displayTitle,info)',
    '__wcoResolverExtractByName(series,"Dub",__episodeName,__displayTitle,info,__r.attempt.sourceSeason)'
  );
  out = out.replace(
    '__wcoResolverExtractByName(series,"Sub",__episodeName,__displayTitle,info)',
    '__wcoResolverExtractByName(series,"Sub",__episodeName,__displayTitle,info,__r.attempt.sourceSeason)'
  );
  out = out.replace(
    '__wcoResolverExtractUniqueNumber(series,"Dub",wantedEpisode,__displayTitle,info)',
    '__wcoResolverExtractUniqueNumber(series,"Dub",wantedEpisode,__displayTitle,info,__r.attempt.sourceSeason,__episodeName)'
  );
  out = out.replace(
    '__wcoResolverExtractUniqueNumber(series,"Sub",wantedEpisode,__displayTitle,info)',
    '__wcoResolverExtractUniqueNumber(series,"Sub",wantedEpisode,__displayTitle,info,__r.attempt.sourceSeason,__episodeName)'
  );

  // When duplicate numeric candidates remain unresolved, expose their labels and URLs.
  out = out.replace(
    '__wcoResolverDiagPush(__diag, "NUMBER CHECK", `${__r.attempt.kind} ${__r.attempt.title} • dubMatches=${dub.count} subMatches=${sub.count}`, __displayTitle);',
    '__wcoResolverDiagPush(__diag, "NUMBER CHECK", `${__r.attempt.kind} ${__r.attempt.title} • dubMatches=${dub.count} subMatches=${sub.count}`, __displayTitle);\n      if(dub.debug)__wcoResolverDiagPush(__diag,"NUMBER DUB",dub.debug,__displayTitle);\n      if(sub.debug)__wcoResolverDiagPush(__diag,"NUMBER SUB",sub.debug,__displayTitle);'
  );

  // Show the source-season hint in diagnostics so future ambiguity is visible.
  out = out.replace(
    '`season=${__seasonName || "EMPTY"} • episode=${__episodeName || "EMPTY"} • searches=${__attempts.map(x=>x.title).join(" | ")}`',
    '`season=${__seasonName || "EMPTY"} • episode=${__episodeName || "EMPTY"} • hint=${__attempts[0]&&__attempts[0].sourceSeason||"nil"} • searches=${__attempts.map(x=>x.title).join(" | ")}`'
  );

  // Existing direct-slug fallback for titles that WCO's search endpoint fails to return.
  const marker = '  return all.sort((a,b)=>b.score-a.score).slice(0,8);';
  const replacement = [
    '  if(!all.length){',
    '    const slug=String(title||"").toLowerCase().replace(/&amp;|&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");',
    '    if(slug)return ORIGINS.map(origin=>({href:origin+"/anime/"+slug+"/?season=all",title,score:100,direct:true}));',
    '  }',
    marker
  ].join("\n");
  if (!out.includes(marker)) return "";
  out = out.replace(marker, replacement);

  return out;
}

async function loadProvider() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const raw = String(await res.text() || "");
    const source = patchResolver(raw);
    if (!source || !source.includes("module.exports")) return null;

    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    }) || mod.exports;

    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const provider = await loadProvider();
    if (!provider) return diag("patched resolver failed to load", season, episode);
    return await provider.getStreams(inputId, mediaType, season, episode);
  } catch (err) {
    return diag(String(err && err.message || err), season, episode);
  }
}

module.exports = { getStreams };
