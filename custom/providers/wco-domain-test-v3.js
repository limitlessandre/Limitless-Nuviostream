"use strict";

const PROVIDER_NAME = "WCO Domain Test";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const LEGACY_URL = `${BRANCH_RAW}/wco-domain-test-v2.js`;
const CORE_URL = `${BRANCH_RAW}/wco.js`;
const PREMIUM_ORIGINS = [
  "https://www.wcostream.tv",
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net"
];

let legacyModule = null;
let rawCore = null;
const premiumCache = new Map();

function settings() {
  return (typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS) || {};
}

function premiumEnabled() {
  const s = settings();
  return s.premiumEnabled === true || String(s.premiumEnabled || "").toLowerCase() === "true";
}

function premiumCookie() {
  return String(settings().premiumCookie || "").trim();
}

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].replace(/^www\./i, "") : String(url || "");
}

function clean(value) {
  return String(value || "").replace(/https?:\/\/www\./gi, "").replace(/https?:\/\//gi, "").replace(/\s+/g, " ").trim().slice(0, 190);
}

async function fetchText(url) {
  try {
    const r = await fetch(url, { skipSizeCheck: true });
    if (!r || !r.ok) return "";
    return String(await r.text() || "");
  } catch (_) { return ""; }
}

function evaluate(source) {
  try {
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", String(source || "") + "\n;return module.exports;");
    return factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
  } catch (_) { return null; }
}

async function legacy() {
  if (legacyModule && typeof legacyModule.getStreams === "function") return legacyModule;
  const source = await fetchText(LEGACY_URL);
  if (!source) return null;
  legacyModule = evaluate(source);
  return legacyModule && typeof legacyModule.getStreams === "function" ? legacyModule : null;
}

async function coreSource() {
  if (rawCore) return rawCore;
  rawCore = await fetchText(CORE_URL);
  return rawCore;
}

function premiumAddon() {
  return `
function __pdSlug(value){return normalize(value).replace(/\\s+/g,"-").replace(/^-+|-+$/g,"");}
async function __pdCandidates(info,wantedSeason){
  const normal=await searchWco(info,wantedSeason);
  if(normal&&normal.length)return normal;
  const out=[];
  for(const title of info.titles.slice(0,4)){
    const slug=__pdSlug(title);if(!slug)continue;
    for(const path of ["/anime/"+slug,"/anime/"+slug+"-english-dubbed","/anime/"+slug+"-english-subbed"]){
      const url=ORIGINS[0]+path,page=await req(url,{headers:{"Referer":ORIGINS[0]+"/"}});if(!page.ok)continue;
      const identity=pageIdentityText(page.text);if(!identity)continue;
      const base=Math.max(...info.titles.map(t=>scoreTitle(identity,t))),seasonScore=seasonPreference(identity+" "+url,wantedSeason);
      if(base>=45&&seasonScore>-1000)out.push({href:url,title:identity,variant:classifyVariant(identity+" "+url),score:base+seasonScore});
    }
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,8);
}
function __pdHints(html,url){
  const t=String(html||""),h=[];
  if(/free\\.wcopremium\\.tv/i.test(t)||/free\\.wcopremium\\.tv/i.test(String(url||"")))h.push("free.wcopremium");
  if(/videojs|video-js/i.test(t))h.push("VideoJS");
  if(/jwplayer/i.test(t))h.push("JWPlayer");
  if(/<iframe\\b/i.test(t))h.push("iframe");
  if(/embed\\.wcostream/i.test(t))h.push("embed.wcostream");
  if(/<video\\b/i.test(t))h.push("video");
  if(/<source\\b/i.test(t))h.push("source");
  if(/getvid|video-js-new|video-js-old|getvidlink|getJSON\\s*\\(/i.test(t))h.push("WCO player script");
  if(/expired|renew|upgrade to a premium|active subscription/i.test(t))h.push("entitlement text");
  if(/log[ -]?in|sign[ -]?in/i.test(t))h.push("login text");
  return h.length?h.join(","):"none";
}
function __pdAbs(v,base){return absolute(v,base);}
function __pdInner(html,page){
  const t=String(html||"");
  for(const re of [/<iframe\\b[^>]*(?:src|data-src)=["']([^"']+)["']/i,/<embed\\b[^>]*(?:src|data-src)=["']([^"']+)["']/i,/["']((?:https?:)?\\/\\/embed\\.wcostream[^"'\\\\\\s<]+)["']/i]){
    const m=t.match(re);if(m&&m[1])return __pdAbs(m[1].replace(/\\\\\\//g,"/"),page);
  }
  return "";
}
async function __premiumDiagnostic(inputId,mediaType,season,episode,cookie){
  const wantedS=Number(season||1),wantedE=Number(episode||1),type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv";
  if(type==="movie")return{streams:[],stage:"SKIPPED",detail:"premium episode diagnostic is TV/anime only"};
  let info;try{info=await tmdbInfo(inputId,type);}catch(e){return{streams:[],stage:"METADATA",detail:String(e&&e.message||e)}}
  if(!info)return{streams:[],stage:"METADATA",detail:"TMDB identity unavailable"};
  let candidates;try{candidates=await __pdCandidates(info,wantedS);}catch(e){return{streams:[],stage:"SEARCH",detail:String(e&&e.message||e)}}
  if(!candidates.length)return{streams:[],stage:"SEARCH",detail:"no acceptable title match for "+info.title};
  let best={streams:[],stage:"SERIES",detail:"title matched but no usable series page"};
  for(const candidate of candidates.slice(0,6)){
    let series;try{series=await candidatePage(candidate);}catch(_){continue}if(!series)continue;
    for(const variant of ["Dub","Sub"]){
      const lang=variant==="Sub"?"sub":"dub",filterUrl=audioFilterUrl(series.pageUrl,lang),filtered=await req(filterUrl,{headers:{"Referer":series.pageUrl}});
      let eps=filtered.ok?episodeLinks(filtered.text,filterUrl,wantedS,wantedE,series.season,variant):[];
      if(!eps.length)eps=episodeLinks(series.page.text,series.pageUrl,wantedS,wantedE,series.season,variant);
      if(!eps.length){best={streams:[],stage:"EPISODE",detail:variant+": no matching episode"};continue;}
      for(const ep of eps.slice(0,3)){
        const page=await req(ep.href,{headers:{"Referer":filtered.ok?filterUrl:series.pageUrl}});if(!page.ok){best={streams:[],stage:"EPISODE PAGE",detail:variant+": HTTP "+(page.status||0)};continue;}
        let frame=iframeLink(page.text,ep.href);if(!frame){best={streams:[],stage:"EMBED",detail:variant+": no iframe"};continue;}
        if(!/(?:^https?:\\/\\/)?(?:user\\.|free\\.wcopremium\\.tv|[^/]*wcopremium\\.tv)/i.test(frame)){
          if(/embed\\.wcostream/i.test(frame)){
            const streams=await extractEmbed(frame,variant,ep.text||info.title,info);if(streams&&streams.length)return{streams,stage:"PLAYABLE",detail:variant+": normal embed remained playable"};
          }
          best={streams:[],stage:"EMBED",detail:variant+": non-premium iframe "+originOf(frame)};continue;
        }
        if(!cookie)return{streams:[],stage:"PREMIUM AUTH",detail:variant+": premium frame "+originOf(frame)+" but cookie is missing"};
        const auth=await req(frame,{headers:{"Cookie":cookie,"Referer":ep.href}});
        if(!auth.ok)return{streams:[],stage:"PREMIUM AUTH",detail:variant+": HTTP "+(auth.status||0)+" final="+originOf(auth.url||frame)};
        const hints=__pdHints(auth.text,auth.url||frame),inner=__pdInner(auth.text,auth.url||frame);
        if(inner&&/embed\\.wcostream/i.test(inner)){
          const streams=await extractEmbed(inner,variant,ep.text||info.title,info);if(streams&&streams.length)return{streams,stage:"PLAYABLE",detail:variant+": authenticated inner embed -> "+originOf(streams[0].url)};
          best={streams:[],stage:"PREMIUM PLAYER",detail:variant+": AUTH OK HTTP "+(auth.status||200)+" final="+originOf(auth.url||frame)+" inner="+originOf(inner)+" markers="+hints+"; inner embed did not resolve"};continue;
        }
        return{streams:[],stage:"PREMIUM PLAYER",detail:variant+": AUTH OK HTTP "+(auth.status||200)+" final="+originOf(auth.url||frame)+" inner="+(inner?originOf(inner):"none")+" markers="+hints};
      }
    }
  }
  return best;
}
module.exports.__premiumDiagnostic=__premiumDiagnostic;
`;
}

async function premiumCore(origin) {
  if (premiumCache.has(origin)) return premiumCache.get(origin);
  let source = await coreSource();
  if (!source) return null;
  source = source.replace(/const PROVIDER_NAME\s*=\s*"WCO"\s*;/, 'const PROVIDER_NAME = "WCO Domain Test";');
  source = source.replace(/const ORIGINS\s*=\s*\[[\s\S]*?\];/, `const ORIGINS = [${JSON.stringify(origin)}];`);
  source += premiumAddon();
  const mod = evaluate(source);
  if (!mod || typeof mod.__premiumDiagnostic !== "function") return null;
  premiumCache.set(origin, mod);
  return mod;
}

function diagnostic(origin, stage, detail) {
  return {
    name: `${PROVIDER_NAME} • PREMIUM EPISODE • ${hostOf(origin)} • DIAG ${clean(stage || "UNKNOWN").toUpperCase()} • ${clean(detail || "no detail")}`,
    title: `${hostOf(origin)} premium diagnostic`,
    url: `${origin}/`,
    quality: "144p",
    language: "Diagnostic",
    provider: PROVIDER_NAME,
    type: "mp4",
    headers: { "Referer": `${origin}/` }
  };
}

function labelStreams(streams, origin) {
  return (streams || []).map(s => ({ ...s, provider: PROVIDER_NAME, name: `${PROVIDER_NAME} • PREMIUM EPISODE • ${hostOf(origin)} → ${hostOf(s.url)} • ${s.quality || "Auto"} • ${String(s.name || "").replace(/^WCO\s*•\s*/i, "")}` }));
}

async function runPremiumEpisode(inputId, mediaType, season, episode) {
  const cookie = premiumCookie();
  const out = [];
  for (const origin of PREMIUM_ORIGINS) {
    const core = await premiumCore(origin);
    if (!core) { out.push(diagnostic(origin, "MODULE", "premium diagnostic core failed to load")); continue; }
    try {
      const r = await core.__premiumDiagnostic(inputId, mediaType, season, episode, cookie);
      if (r && r.streams && r.streams.length) out.push(...labelStreams(r.streams, origin));
      else out.push(diagnostic(origin, r && r.stage, r && r.detail));
    } catch (e) {
      out.push(diagnostic(origin, "RUNTIME", String(e && e.message || e)));
    }
  }
  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  if (premiumEnabled() && type !== "movie" && Number(season) !== 0) {
    return await runPremiumEpisode(inputId, mediaType, season, episode);
  }
  const mod = await legacy();
  if (!mod || typeof mod.getStreams !== "function") return [];
  return await mod.getStreams(inputId, mediaType, season, episode);
}

function onSettings() {
  return [
    { type: "header", label: "WCO Premium Diagnostic" },
    { type: "info", label: "Premium normal episodes use a direct authenticated diagnostic against wcostream.tv, wcoflix.tv, and wcoforever.net. Movies, Season 0, and non-premium tests continue using the previously validated Domain Test." },
    { type: "toggle", key: "premiumEnabled", label: "Enable premium session test", description: "Use only with a current authenticated WCO Cookie header from your own account.", defaultValue: false },
    { type: "text", key: "premiumCookie", label: "Premium session cookie", placeholder: "cookie_name=value; other_cookie=value", description: "Paste only the Cookie request-header value. Never paste your username or password. Stored locally by Nuvio for this test provider.", isPassword: true }
  ];
}

module.exports = { getStreams, onSettings };
