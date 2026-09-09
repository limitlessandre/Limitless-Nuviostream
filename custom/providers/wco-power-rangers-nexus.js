"use strict";

// Nexus-only testbed for a lightweight generic WCO season-title resolver.
// The resolver itself is generic, but this provider remains scoped to TMDB 2328
// while we validate it against Power Rangers. Production WCO remains untouched.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
let cachedCore = null;

function outerDiag(stage, message, season, episode) {
  const clean = String(message || "").replace(/\s+/g, " ").trim().slice(0, 190);
  const label = `DIAG ${stage} • ${clean}`;
  return [{
    name: `${PROVIDER_NAME} • ${label}`,
    title: `Power Rangers S${String(Number(season || 1)).padStart(2, "0")}E${String(Number(episode || 1)).padStart(2, "0")}`,
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
}

function patchCore(source) {
  source = String(source || "");
  if (!source) return "";

  source = source.replace('const PROVIDER_NAME = "WCO";', 'const PROVIDER_NAME = "WCO Power Rangers Nexus";');

  const helperMarker = "async function tvStreams(info, season, episode) {";
  const helperCode = String.raw`
const __WCO_RESOLVER_DIAG_URL="https://www.wcostream.tv/favicon.ico";
function __wcoResolverDiagRow(stage,message,displayTitle){
  const clean=String(message||"").replace(/\s+/g," ").trim().slice(0,190);
  const label="DIAG "+stage+" • "+clean;
  return{name:PROVIDER_NAME+" • "+label,title:displayTitle||label,url:__WCO_RESOLVER_DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};
}
function __wcoResolverDiagPush(rows,stage,message,displayTitle){
  if(!rows||rows.length>=14)return;
  const row=__wcoResolverDiagRow(stage,message,displayTitle);
  if(!rows.some(x=>x&&x.name===row.name))rows.push(row);
}
function __wcoResolverSearchTitles(showTitle,seasonName){
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
}
async function __wcoResolverSearch(title){
  const all=[];
  for(const origin of ORIGINS){
    const page=await req(origin+"/search",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Origin":origin,"Referer":origin+"/"},body:"catara="+encodeURIComponent(title)+"&konuara=series"});
    if(!page.ok)continue;
    for(const item of searchLinks(page.text,origin)){
      const score=scoreTitle(item.title,title);
      if(score<45)continue;
      const found=all.find(x=>x.href===item.href);
      if(found){if(score>found.score)found.score=score;continue;}
      all.push({...item,score});
    }
    if(all.some(x=>x.score>=95))break;
  }
  return all.sort((a,b)=>b.score-a.score).slice(0,8);
}
function __wcoResolverPageInfo(series,wantedTitle){
  if(!series||!series.page)return{identity:"NO PAGE",score:0};
  const identity=(pageIdentityText(series.page.text)+" "+String(series.pageUrl||"")).replace(/\s+/g," ").trim();
  return{identity,score:scoreTitle(identity,wantedTitle)};
}
function __wcoResolverNameEntries(html,pageUrl,wantedName,forcedVariant){
  const out=[];
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(String(html||"")))&&out.length<700){
    const text=stripTags(m[2]);
    const href=absolute(m[1],pageUrl);
    if(!href||!text||/\/anime\//i.test(href))continue;
    const combined=text+" "+href;
    if(!/episode/i.test(combined))continue;
    const score=scoreTitle(text,wantedName);
    if(score<80)continue;
    const detected=classifyVariant(combined);
    if(forcedVariant&&detected!=="Original"&&detected!==forcedVariant)continue;
    const ep=text.match(/Episode\s*(\d+(?:\.\d+)?)/i)||href.match(/episode[-_ ]?(\d+(?:\.\d+)?)/i);
    out.push({href,text,variant:forcedVariant||detected,season:explicitSeason(combined),episode:ep?Number(ep[1]):null,score});
  }
  return out.sort((a,b)=>b.score-a.score).filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i);
}
async function __wcoResolverExtractByName(series,variant,wantedName,displayTitle,info){
  if(!wantedName)return{streams:[],count:0,best:null};
  const lang=variant==="Sub"?"sub":"dub";
  const filteredUrl=audioFilterUrl(series.pageUrl,lang);
  const filtered=await req(filteredUrl,{headers:{"Referer":series.pageUrl}});
  let episodes=filtered.ok?__wcoResolverNameEntries(filtered.text,filteredUrl,wantedName,variant):[];
  if(!episodes.length)episodes=__wcoResolverNameEntries(series.page.text,series.pageUrl,wantedName,variant);
  const best=episodes[0]||null;
  for(const entry of episodes.slice(0,3)){
    const epPage=await req(entry.href,{headers:{"Referer":filtered.ok?filteredUrl:series.pageUrl}});
    if(!epPage.ok)continue;
    const frame=iframeLink(epPage.text,entry.href);
    if(!frame||/user\.wcostream\.tv\/check-login/i.test(frame))continue;
    const streams=await extractEmbed(frame,variant,displayTitle,info);
    if(streams.length)return{streams,count:episodes.length,best:entry};
  }
  return{streams:[],count:episodes.length,best};
}
function __wcoResolverNumericEntries(html,pageUrl,wantedEpisode,forcedVariant){
  const out=[];
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(String(html||"")))&&out.length<700){
    const text=stripTags(m[2]);
    const href=absolute(m[1],pageUrl);
    if(!href||!text||/\/anime\//i.test(href))continue;
    const combined=text+" "+href;
    const ep=text.match(/Episode\s*(\d+(?:\.\d+)?)/i)||href.match(/episode[-_ ]?(\d+(?:\.\d+)?)/i);
    if(!ep||Number(ep[1])!==Number(wantedEpisode||1))continue;
    const detected=classifyVariant(combined);
    if(forcedVariant&&detected!=="Original"&&detected!==forcedVariant)continue;
    out.push({href,text,variant:forcedVariant||detected,season:explicitSeason(combined)});
  }
  return out.filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i);
}
async function __wcoResolverExtractUniqueNumber(series,variant,wantedEpisode,displayTitle,info){
  const lang=variant==="Sub"?"sub":"dub";
  const filteredUrl=audioFilterUrl(series.pageUrl,lang);
  const filtered=await req(filteredUrl,{headers:{"Referer":series.pageUrl}});
  let episodes=filtered.ok?__wcoResolverNumericEntries(filtered.text,filteredUrl,wantedEpisode,variant):[];
  if(!episodes.length)episodes=__wcoResolverNumericEntries(series.page.text,series.pageUrl,wantedEpisode,variant);
  episodes=episodes.filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i);
  if(episodes.length!==1)return{streams:[],count:episodes.length};
  const entry=episodes[0];
  const epPage=await req(entry.href,{headers:{"Referer":filtered.ok?filteredUrl:series.pageUrl}});
  if(!epPage.ok)return{streams:[],count:1};
  const frame=iframeLink(epPage.text,entry.href);
  if(!frame||/user\.wcostream\.tv\/check-login/i.test(frame))return{streams:[],count:1};
  return{streams:await extractEmbed(frame,variant,displayTitle,info),count:1};
}
`;
  if (!source.includes(helperMarker)) return "";
  source = source.replace(helperMarker, helperCode + "\n" + helperMarker);

  const tvStart = source.indexOf("async function tvStreams(info, season, episode) {");
  const tvEnd = source.indexOf("async function movieStreams(info)", tvStart);
  if (tvStart < 0 || tvEnd < 0) return "";

  const tvReplacement = [
    'async function tvStreams(info, season, episode) {',
    '  const __inputSeason = Number(season || 1);',
    '  const wantedEpisode = Number(episode || 1);',
    '  const __displayTitle = `${info.title} S${String(__inputSeason).padStart(2, "0")}E${String(wantedEpisode).padStart(2, "0")}`;',
    '  const __diag = [];',
    '  let __seasonData = null;',
    '  try { __seasonData = await jsonReq(`https://api.themoviedb.org/3/tv/${info.id}/season/${__inputSeason}?api_key=${TMDB_API_KEY}`); } catch (_) {}',
    '  const __seasonName = String(__seasonData && __seasonData.name || "").trim();',
    '  let __episodeName = "";',
    '  if (__seasonData && Array.isArray(__seasonData.episodes)) {',
    '    const __ep = __seasonData.episodes.find(x => Number(x && x.episode_number) === wantedEpisode);',
    '    __episodeName = String(__ep && __ep.name || "").trim();',
    '  }',
    '  if (!__episodeName) {',
    '    try {',
    '      const __ep = await jsonReq(`https://api.themoviedb.org/3/tv/${info.id}/season/${__inputSeason}/episode/${wantedEpisode}?api_key=${TMDB_API_KEY}`);',
    '      __episodeName = String(__ep && __ep.name || "").trim();',
    '    } catch (_) {}',
    '  }',
    '  const __attempts = __wcoResolverSearchTitles(info.title, __seasonName);',
    '  __wcoResolverDiagPush(__diag, "TMDB", `season=${__seasonName || "EMPTY"} • episode=${__episodeName || "EMPTY"} • searches=${__attempts.map(x=>x.title).join(" | ")}`, __displayTitle);',
    '',
    '  const __resolved = [];',
    '  for (const __attempt of __attempts) {',
    '    let candidates = await __wcoResolverSearch(__attempt.title);',
    '    let __matchTitle = __attempt.title;',
    '    if (__attempt.compactTitle && (!candidates.length || Number(candidates[0] && candidates[0].score || 0) < 70)) {',
    '      const __compactCandidates = await __wcoResolverSearch(__attempt.compactTitle);',
    '      const __compactFirst = __compactCandidates[0] ? `${__compactCandidates[0].title || "untitled"} @ ${String(__compactCandidates[0].href || "").replace(/^https?:\\/\\//, "").slice(0,65)}` : "none";',
    '      __wcoResolverDiagPush(__diag, "SEARCH COMPACT", `${__attempt.compactTitle} • candidates=${__compactCandidates.length} • first=${__compactFirst}`, __displayTitle);',
    '      if (__compactCandidates.length && (!candidates.length || Number(__compactCandidates[0].score || 0) > Number(candidates[0] && candidates[0].score || 0))) {',
    '        candidates = __compactCandidates;',
    '        __matchTitle = __attempt.compactTitle;',
    '      }',
    '    }',
    '    const __first = candidates[0] ? `${candidates[0].title || "untitled"} @ ${String(candidates[0].href || "").replace(/^https?:\\/\\//, "").slice(0,65)}` : "none";',
    '    __wcoResolverDiagPush(__diag, `SEARCH ${__attempt.kind.toUpperCase()}`, `${__matchTitle} • candidates=${candidates.length} • first=${__first}`, __displayTitle);',
    '    __resolved.push({attempt:__attempt,candidates,matchTitle:__matchTitle});',
    '  }',
    '',
    '  let __accepted = 0, __parentAccepted = 0, __rejected = 0;',
    '  if (__episodeName) {',
    '    for (const __r of __resolved) {',
    '      const __threshold = __r.attempt.kind === "show" ? 80 : 70;',
    '      for (const candidate of __r.candidates.slice(0,6)) {',
    '        const series = await candidatePage(candidate);',
    '        if (!series) continue;',
    '        const __wantedTitle = __r.matchTitle || __r.attempt.title;',
    '        const __page = __wcoResolverPageInfo(series,__wantedTitle);',
    '        const __showPage = __wcoResolverPageInfo(series,info.title);',
    '        const __directPage = __page.score >= __threshold;',
    '        const __parentPage = !__directPage && __r.attempt.kind !== "show" && __showPage.score >= 80;',
    '        if (!__directPage && !__parentPage) {',
    '          __rejected += 1;',
    '          __wcoResolverDiagPush(__diag, "PAGE REJECT", `${__r.attempt.kind} want=${__wantedTitle} score=${__page.score} showScore=${__showPage.score} id=${__page.identity.slice(0,78)}`, __displayTitle);',
    '          continue;',
    '        }',
    '        if (__parentPage) {',
    '          __parentAccepted += 1;',
    '          __wcoResolverDiagPush(__diag, "PAGE PARENT", `${__r.attempt.kind} want=${__wantedTitle} pageScore=${__page.score} showScore=${__showPage.score} • checking episode name`, __displayTitle);',
    '        } else {',
    '          __accepted += 1;',
    '        }',
    '        const dub = await __wcoResolverExtractByName(series,"Dub",__episodeName,__displayTitle,info);',
    '        const sub = await __wcoResolverExtractByName(series,"Sub",__episodeName,__displayTitle,info);',
    '        const __best = dub.best || sub.best;',
    '        if (__best) __wcoResolverDiagPush(__diag, "NAME MATCH", `${__r.attempt.kind} score=${__best.score} sourceSeason=${__best.season == null ? "nil" : __best.season} sourceEpisode=${__best.episode == null ? "nil" : __best.episode} • ${__best.text.slice(0,80)}`, __displayTitle);',
    '        const combined = dub.streams.concat(sub.streams);',
    '        if (combined.length) return finalize(combined,info);',
    '      }',
    '    }',
    '  }',
    '  __wcoResolverDiagPush(__diag, "NAME RESULT", `episode=${__episodeName || "EMPTY"} • directPages=${__accepted} • parentPages=${__parentAccepted} • rejectedPages=${__rejected} • playable=0`, __displayTitle);',
    '',
    '  let __numericPages = 0;',
    '  for (const __r of __resolved) {',
    '    if (__r.attempt.kind === "show") continue;',
    '    for (const candidate of __r.candidates.slice(0,6)) {',
    '      const series = await candidatePage(candidate);',
    '      if (!series) continue;',
    '      const __wantedTitle = __r.matchTitle || __r.attempt.title;',
    '      const __page = __wcoResolverPageInfo(series,__wantedTitle);',
    '      if (__page.score < 70) continue;',
    '      const dub = await __wcoResolverExtractUniqueNumber(series,"Dub",wantedEpisode,__displayTitle,info);',
    '      const sub = await __wcoResolverExtractUniqueNumber(series,"Sub",wantedEpisode,__displayTitle,info);',
    '      __numericPages += 1;',
    '      __wcoResolverDiagPush(__diag, "NUMBER CHECK", `${__r.attempt.kind} ${__wantedTitle} • dubMatches=${dub.count} subMatches=${sub.count}`, __displayTitle);',
    '      const combined = dub.streams.concat(sub.streams);',
    '      if (combined.length) return finalize(combined,info);',
    '    }',
    '  }',
    '  __wcoResolverDiagPush(__diag, "NUMBER RESULT", `episode=${wantedEpisode} • checkedPages=${__numericPages} • only unique numeric matches are allowed on strong season-title pages`, __displayTitle);',
    '  __wcoResolverDiagPush(__diag, "STOP", "season-title resolver exhausted all safe attempts", __displayTitle);',
    '  return __diag.length ? __diag : [__wcoResolverDiagRow("STOP","no diagnostic state captured",__displayTitle)];',
    '}',
    ''
  ].join('\n');

  source = source.slice(0, tvStart) + tvReplacement + source.slice(tvEnd);

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
  const s = Number(season || 1), e = Number(episode || 1);
  if (!Number.isFinite(s) || s < 1 || !Number.isFinite(e) || e < 1) return [];

  try {
    const core = await loadCore();
    if (!core) return outerDiag("CORE", "patched WCO core failed to load", s, e);
    return await core.getStreams(inputId, mediaType, season, episode);
  } catch (err) {
    return outerDiag("RUNTIME", String(err && err.message || err || "unknown error"), s, e);
  }
}

module.exports = { getStreams };
