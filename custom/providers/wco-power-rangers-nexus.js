"use strict";

// Nexus-only Power Rangers compatibility provider.
// Loads the proven WCO core directly and patches only Power Rangers mapping.
// Production WCO remains untouched.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
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

function mapSourceCode() {
  return "const __WCO_POWER_RANGERS_MAP = " + JSON.stringify(POWER_RANGERS_MAP) + ";\n" +
    "function __wcoPowerRangersAttempts(season){const x=__WCO_POWER_RANGERS_MAP[Number(season||1)];if(!x)return[];return [{title:x.title,season:x.season,kind:'primary'}].concat((Array.isArray(x.fallbacks)?x.fallbacks:[]).map(y=>({title:y.title,season:y.season,kind:'fallback'})));}\n";
}

function patchCore(source) {
  source = String(source || "");
  if (!source) return "";

  source = source.replace('const PROVIDER_NAME = "WCO";', 'const PROVIDER_NAME = "WCO Power Rangers Nexus";');
  source = source.replace('"use strict";', '"use strict";\n' + mapSourceCode());

  const helperMarker = "async function tvStreams(info, season, episode) {";
  const helperCode = `
const __WCO_PR_DIAG_URL="https://www.wcostream.tv/favicon.ico";
function __wcoPrDiagRow(stage,message,displayTitle){
  const clean=String(message||"").replace(/\\s+/g," ").trim().slice(0,190);
  const label="DIAG "+stage+" • "+clean;
  return{name:PROVIDER_NAME+" • "+label,title:displayTitle||label,url:__WCO_PR_DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};
}
function __wcoPrDiagPush(rows,stage,message,displayTitle){
  if(!rows||rows.length>=12)return;
  const row=__wcoPrDiagRow(stage,message,displayTitle);
  if(!rows.some(x=>x&&x.name===row.name))rows.push(row);
}
function __wcoPrSeriesInfo(series,wantedTitle){
  if(!series||!series.page)return{identity:"NO PAGE",score:0};
  const identity=(pageIdentityText(series.page.text)+" "+String(series.pageUrl||"")).replace(/\\s+/g," ").trim();
  return{identity,score:scoreTitle(identity,wantedTitle)};
}
function __wcoPrSeriesMatches(series,wantedTitle){return __wcoPrSeriesInfo(series,wantedTitle).score>=80;}

function __wcoPrNameEpisodes(html,pageUrl,wantedSeason,wantedName,pageSeason,forcedVariant){
  const out=[];
  const wantedS=Number(wantedSeason||1);
  const re=/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
  let m;
  while((m=re.exec(String(html||"")))&&out.length<700){
    const text=stripTags(m[2]);
    const href=absolute(m[1],pageUrl);
    if(!href||!text||/\\/anime\\//i.test(href))continue;
    const combined=text+" "+href;
    if(!/episode/i.test(combined))continue;
    const score=scoreTitle(text,wantedName);
    if(score<80)continue;
    const foundSeason=explicitSeason(combined);
    if(foundSeason!=null&&foundSeason!==wantedS)continue;
    if(foundSeason==null&&wantedS!==1&&Number(pageSeason||0)!==wantedS)continue;
    const detected=classifyVariant(combined);
    if(forcedVariant&&detected!=="Original"&&detected!==forcedVariant)continue;
    out.push({href,text,variant:forcedVariant||detected,season:foundSeason,score});
  }
  return out.sort((a,b)=>b.score-a.score).filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i);
}

async function __wcoPrExtractByName(series,variant,wantedSeason,wantedName,displayTitle,info){
  if(!wantedName)return[];
  const lang=variant==="Sub"?"sub":"dub";
  const filteredUrl=audioFilterUrl(series.pageUrl,lang);
  let filtered=await req(filteredUrl,{headers:{"Referer":series.pageUrl}});
  let episodes=filtered.ok?__wcoPrNameEpisodes(filtered.text,filteredUrl,wantedSeason,wantedName,series.season,variant):[];
  if(!episodes.length)episodes=__wcoPrNameEpisodes(series.page.text,series.pageUrl,wantedSeason,wantedName,series.season,variant);
  for(const entry of episodes.slice(0,3)){
    const epPage=await req(entry.href,{headers:{"Referer":filtered.ok?filteredUrl:series.pageUrl}});
    if(!epPage.ok)continue;
    const frame=iframeLink(epPage.text,entry.href);
    if(!frame||/user\\.wcostream\\.tv\\/check-login/i.test(frame))continue;
    const streams=await extractEmbed(frame,variant,displayTitle,info);
    if(streams.length)return streams;
  }
  return[];
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
    '  const __attempts = __wcoPowerRangersAttempts(__inputSeason);',
    '  const __displayTitle = `${info.title} S${String(__inputSeason).padStart(2, "0")}E${String(wantedEpisode).padStart(2, "0")}`;',
    '  const __diag = [];',
    '  if (!__attempts.length) return [__wcoPrDiagRow("MAP", `no mapping for source season ${__inputSeason}`, __displayTitle)];',
    '  let __episodeName = "";',
    '  try {',
    '    const __ep = await jsonReq(`https://api.themoviedb.org/3/tv/${info.id}/season/${__inputSeason}/episode/${wantedEpisode}?api_key=${TMDB_API_KEY}`);',
    '    __episodeName = String(__ep && __ep.name || "").trim();',
    '  } catch (_) {}',
    '  __wcoPrDiagPush(__diag, "TMDB", `S${__inputSeason}E${wantedEpisode} name=${__episodeName || "EMPTY"}`, __displayTitle);',
    '',
    '  const __resolvedAttempts = [];',
    '  for (const __attempt of __attempts) {',
    '    const wantedSeason = Number(__attempt.season || 1);',
    '    const __mappedInfo = { ...info, title: __attempt.title, titles: uniq([__attempt.title]) };',
    '    const candidates = await searchWco(__mappedInfo, wantedSeason);',
    '    const __first = candidates[0] ? `${candidates[0].title || "untitled"} @ ${String(candidates[0].href || "").replace(/^https?:\\/\\//, "").slice(0,70)}` : "none";',
    '    __wcoPrDiagPush(__diag, `SEARCH ${String(__attempt.kind || "try").toUpperCase()}`, `${__attempt.title} S${wantedSeason} • candidates=${candidates.length} • first=${__first}`, __displayTitle);',
    '    __resolvedAttempts.push({ attempt: __attempt, wantedSeason, info: __mappedInfo, candidates });',
    '  }',
    '',
    '  let __nameAcceptedPages = 0;',
    '  let __nameRejectedPages = 0;',
    '  if (__episodeName) {',
    '    for (const __resolved of __resolvedAttempts) {',
    '      for (const candidate of __resolved.candidates.slice(0, 6)) {',
    '        const series = await candidatePage(candidate);',
    '        if (!series) { __wcoPrDiagPush(__diag, "PAGE", `${__resolved.attempt.kind} candidate page failed: ${candidate.title || candidate.href}`, __displayTitle); continue; }',
    '        const __seriesInfo = __wcoPrSeriesInfo(series, __resolved.attempt.title);',
    '        if (__seriesInfo.score < 80) {',
    '          __nameRejectedPages += 1;',
    '          __wcoPrDiagPush(__diag, "PAGE REJECT", `${__resolved.attempt.kind} want=${__resolved.attempt.title} score=${__seriesInfo.score} sourceSeason=${series.season == null ? "nil" : series.season} id=${__seriesInfo.identity.slice(0,95)}`, __displayTitle);',
    '          continue;',
    '        }',
    '        if (series.season != null && series.season !== __resolved.wantedSeason) {',
    '          __nameRejectedPages += 1;',
    '          __wcoPrDiagPush(__diag, "SEASON REJECT", `${__resolved.attempt.kind} want S${__resolved.wantedSeason} page S${series.season} • ${__resolved.attempt.title}`, __displayTitle);',
    '          continue;',
    '        }',
    '        __nameAcceptedPages += 1;',
    '        __wcoPrDiagPush(__diag, "PAGE ACCEPT", `${__resolved.attempt.kind} ${__resolved.attempt.title} S${__resolved.wantedSeason} score=${__seriesInfo.score} sourceSeason=${series.season == null ? "nil" : series.season}`, __displayTitle);',
    '        const dub = await __wcoPrExtractByName(series, "Dub", __resolved.wantedSeason, __episodeName, __displayTitle, __resolved.info);',
    '        const sub = await __wcoPrExtractByName(series, "Sub", __resolved.wantedSeason, __episodeName, __displayTitle, __resolved.info);',
    '        const combined = dub.concat(sub);',
    '        if (combined.length) return finalize(combined, __resolved.info);',
    '      }',
    '    }',
    '  }',
    '  __wcoPrDiagPush(__diag, "NAME RESULT", `episode=${__episodeName || "EMPTY"} acceptedPages=${__nameAcceptedPages} rejectedPages=${__nameRejectedPages} playable=0`, __displayTitle);',
    '',
    '  let __numberAcceptedPages = 0;',
    '  for (const __resolved of __resolvedAttempts) {',
    '    for (const candidate of __resolved.candidates.slice(0, 6)) {',
    '      const series = await candidatePage(candidate);',
    '      if (!series) continue;',
    '      const __seriesInfo = __wcoPrSeriesInfo(series, __resolved.attempt.title);',
    '      if (__seriesInfo.score < 80) continue;',
    '      if (series.season != null && series.season !== __resolved.wantedSeason) continue;',
    '      __numberAcceptedPages += 1;',
    '      const dub = await extractVariantFromSeries(series, "Dub", __resolved.wantedSeason, wantedEpisode, __displayTitle, __resolved.info);',
    '      const sub = await extractVariantFromSeries(series, "Sub", __resolved.wantedSeason, wantedEpisode, __displayTitle, __resolved.info);',
    '      const combined = dub.concat(sub);',
    '      if (combined.length) return finalize(combined, __resolved.info);',
    '    }',
    '  }',
    '  __wcoPrDiagPush(__diag, "NUMBER RESULT", `wanted episode=${wantedEpisode} acceptedPages=${__numberAcceptedPages} playable=0`, __displayTitle);',
    '  __wcoPrDiagPush(__diag, "STOP", "all Power Rangers mapping attempts exhausted with no playable stream", __displayTitle);',
    '  return __diag.length ? __diag : [__wcoPrDiagRow("STOP", "no diagnostic state captured", __displayTitle)];',
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

  const s = Number(season || 1);
  if (!POWER_RANGERS_MAP[s]) return [];

  try {
    const core = await loadCore();
    if (!core) return outerDiag("CORE", "patched WCO core failed to load", season, episode);
    const streams = await core.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(streams) && streams.length ? streams : outerDiag("EMPTY", "core returned no streams and no inline diagnostic rows", season, episode);
  } catch (e) {
    return outerDiag("RUNTIME", String(e && e.message || e), season, episode);
  }
}

module.exports = { getStreams };
