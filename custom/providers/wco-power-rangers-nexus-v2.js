"use strict";

// Nexus-only wrapper around the validated generic season-title resolver.
// Adds lightweight fallbacks for WCO search gaps and numbered TMDB season titles.
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
  // not part of the WCO series title. Strip it from search text but preserve it
  // so episode matching can stay inside the correct WCO season.
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

  const newSearchTitles = String.raw`function __wcoResolverSearchTitles(showTitle,seasonName){
  const show=String(showTitle||"").trim(),rawSeason=String(seasonName||"").trim(),out=[];
  const suffix=rawSeason.match(/\s*\((\d+)\)\s*$/);
  const sourceSeason=suffix?Number(suffix[1]):null;
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
    'function __wcoResolverNameEntries(html,pageUrl,wantedName,forcedVariant){',
    'function __wcoResolverNameEntries(html,pageUrl,wantedName,forcedVariant,wantedSourceSeason){'
  );
  out = out.replace(
    '    const ep=text.match(/Episode\\s*(\\d+(?:\\.\\d+)?)/i)||href.match(/episode[-_ ]?(\\d+(?:\\.\\d+)?)/i);\n    out.push({href,text,variant:forcedVariant||detected,season:explicitSeason(combined),episode:ep?Number(ep[1]):null,score});',
    '    const foundSeason=explicitSeason(combined);\n    if(wantedSourceSeason&&foundSeason!=null&&Number(foundSeason)!==Number(wantedSourceSeason))continue;\n    const ep=text.match(/Episode\\s*(\\d+(?:\\.\\d+)?)/i)||href.match(/episode[-_ ]?(\\d+(?:\\.\\d+)?)/i);\n    out.push({href,text,variant:forcedVariant||detected,season:foundSeason,episode:ep?Number(ep[1]):null,score});'
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

  out = out.replace(
    'function __wcoResolverNumericEntries(html,pageUrl,wantedEpisode,forcedVariant){',
    'function __wcoResolverNumericEntries(html,pageUrl,wantedEpisode,forcedVariant,wantedSourceSeason){'
  );
  out = out.replace(
    '    const detected=classifyVariant(combined);\n    if(forcedVariant&&detected!=="Original"&&detected!==forcedVariant)continue;\n    out.push({href,text,variant:forcedVariant||detected,season:explicitSeason(combined)});',
    '    const foundSeason=explicitSeason(combined);\n    if(wantedSourceSeason&&foundSeason!=null&&Number(foundSeason)!==Number(wantedSourceSeason))continue;\n    const detected=classifyVariant(combined);\n    if(forcedVariant&&detected!=="Original"&&detected!==forcedVariant)continue;\n    out.push({href,text,variant:forcedVariant||detected,season:foundSeason});'
  );
  out = out.replace(
    'async function __wcoResolverExtractUniqueNumber(series,variant,wantedEpisode,displayTitle,info){',
    'async function __wcoResolverExtractUniqueNumber(series,variant,wantedEpisode,displayTitle,info,wantedSourceSeason){'
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
    '__wcoResolverExtractByName(series,"Dub",__episodeName,__displayTitle,info)',
    '__wcoResolverExtractByName(series,"Dub",__episodeName,__displayTitle,info,__r.attempt.sourceSeason)'
  );
  out = out.replace(
    '__wcoResolverExtractByName(series,"Sub",__episodeName,__displayTitle,info)',
    '__wcoResolverExtractByName(series,"Sub",__episodeName,__displayTitle,info,__r.attempt.sourceSeason)'
  );
  out = out.replace(
    '__wcoResolverExtractUniqueNumber(series,"Dub",wantedEpisode,__displayTitle,info)',
    '__wcoResolverExtractUniqueNumber(series,"Dub",wantedEpisode,__displayTitle,info,__r.attempt.sourceSeason)'
  );
  out = out.replace(
    '__wcoResolverExtractUniqueNumber(series,"Sub",wantedEpisode,__displayTitle,info)',
    '__wcoResolverExtractUniqueNumber(series,"Sub",wantedEpisode,__displayTitle,info,__r.attempt.sourceSeason)'
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
