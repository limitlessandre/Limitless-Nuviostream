"use strict";

const PROVIDER_NAME = "WCO Domain Test";
const V5_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-domain-test-v5.js";
let modCache = null;

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

async function patchedModule() {
  if (modCache && typeof modCache.getStreams === "function") return modCache;
  let source = await fetchText(V5_URL);
  if (!source) return null;

  const needle = '    \'            return{streams:[],stage:"PREMIUM EMBED",detail:variant+": HTTP "+(eRes.status||200)+" final="+originOf(eUrl)+" inner="+(eInner?originOf(eInner):"none")+" markers="+eHints};\',';
  const replacement = [
    '    \'            const media=[];\',',
    '    \'            const seen=new Set();\',',
    '    \'            const html=String(eRes.text||"");\',',
    '    \'            for(const prefix of ["https://","http://"]){\',',
    '    \'              let at=0;\',',
    '    \'              while((at=html.indexOf(prefix,at))>=0){\',',
    '    \'                let end=at+prefix.length;\',',
    '    \'                while(end<html.length){const cc=html.charCodeAt(end);if(cc===34||cc===39||cc===32||cc===10||cc===13||cc===9||cc===60||cc===62||cc===92)break;end++;}\',',
    '    \'                let u=html.slice(at,end).replace(/&amp;/g,"&");\',',
    '    \'                if((u.indexOf(".m3u8")>=0||u.indexOf(".mp4")>=0)&&!seen.has(u)){seen.add(u);media.push(u);}\',',
    '    \'                at=Math.max(end,at+prefix.length);\',',
    '    \'              }\',',
    '    \'            }\',',
    '    \'            if(media.length){\',',
    '    \'              const out=media.slice(0,6).map(function(u){return{name:PROVIDER_NAME+" • PREMIUM • Auto • "+(variant==="Dub"?"English Dub":"Japanese + English Hard Subs"),title:ep.text||info.title,url:u,quality:"Auto",language:variant==="Dub"?"English":"Japanese",provider:PROVIDER_NAME,type:u.indexOf(".m3u8")>=0?"m3u8":"mp4",headers:{"Cookie":cookie,"Referer":eUrl,"Origin":originOf(eUrl)}};});\',',
    '    \'              return{streams:out,stage:"PLAYABLE",detail:variant+": authenticated premium player exposed "+out.length+" direct media source(s)"};\',',
    '    \'            }\',',
    '    \'            return{streams:[],stage:"PREMIUM EMBED",detail:variant+": HTTP "+(eRes.status||200)+" final="+originOf(eUrl)+" inner="+(eInner?originOf(eInner):"none")+" markers="+eHints+" media=0"};\','
  ].join("\n");

  if (!source.includes(needle)) return null;
  source = source.replace(needle, replacement);
  modCache = evaluate(source);
  return modCache && typeof modCache.getStreams === "function" ? modCache : null;
}

async function getStreams(inputId, mediaType, season, episode) {
  const mod = await patchedModule();
  if (!mod) return [{
    name: PROVIDER_NAME + " • DIAG MODULE • premium media diagnostic wrapper failed to load",
    title: "WCO premium diagnostic",
    url: "https://www.wcostream.tv/",
    quality: "144p",
    language: "Diagnostic",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
  return await mod.getStreams(inputId, mediaType, season, episode);
}

function onSettings() {
  return [
    { type: "header", label: "WCO Premium Diagnostic" },
    { type: "info", label: "Premium testing follows your authenticated WCO session into embed.wcopremium.tv and scans the already-authorized player HTML for direct MP4/HLS media URLs. Production WCO is unchanged." },
    { type: "toggle", key: "premiumEnabled", label: "Enable premium session test", description: "Use only with a current authenticated WCO Cookie header from your own account.", defaultValue: false },
    { type: "text", key: "premiumCookie", label: "Premium session cookie", placeholder: "cookie_name=value; other_cookie=value", description: "Paste only the Cookie request-header value. Never paste your username or password. Stored locally by Nuvio for this test provider.", isPassword: true }
  ];
}

module.exports = { getStreams, onSettings };
