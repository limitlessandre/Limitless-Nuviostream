"use strict";

const PROVIDER_NAME = "WCO Domain Test";
const V4_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-domain-test-v4.js";
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
  let source = await fetchText(V4_URL);
  if (!source) return null;

  const needle = 'const pUrl=premium.url||canonical,pHints=__pdHints(premium.text,pUrl);\n          const resolved=await __pdResolvePremiumPage(pUrl,premium.text,variant,ep.text||info.title,info);';
  const replacement = [
    'const pUrl=premium.url||canonical,pHints=__pdHints(premium.text,pUrl);',
    '          const pInner=__pdInner(premium.text,pUrl);',
    '          if(pInner&&/embed\\.wcopremium\\.tv/i.test(pInner)){',
    '            const eRes=await req(pInner,{headers:{"Cookie":cookie,"Referer":pUrl}});',
    '            if(!eRes.ok)return{streams:[],stage:"PREMIUM EMBED",detail:variant+": canonical OK; embed HTTP "+(eRes.status||0)+" final="+originOf(eRes.url||pInner)};',
    '            const eUrl=eRes.url||pInner,eHints=__pdHints(eRes.text,eUrl),eInner=__pdInner(eRes.text,eUrl);',
    '            if(eInner&&/embed\\.wcostream/i.test(eInner)){',
    '              const streams=await extractEmbed(eInner,variant,ep.text||info.title,info);',
    '              if(streams&&streams.length)return{streams:streams,stage:"PLAYABLE",detail:variant+": premium embed -> normal WCO embed -> "+originOf(streams[0].url)};',
    '            }',
    '            const media=[];',
    '            const seen=new Set();',
    '            const addMedia=function(raw){',
    '              raw=String(raw||"").replace(/&amp;/g,"&").replace(/\\\\\\//g,"/").trim();',
    '              if(!raw)return;',
    '              const u=absolute(raw,eUrl);',
    '              if(!/^https?:\\/\\//i.test(u)||!/(?:\\.m3u8|\\.mp4)(?:[?#]|$)/i.test(u)||seen.has(u))return;',
    '              seen.add(u);media.push(u);',
    '            };',
    '            const html=String(eRes.text||"");',
    '            for(const re of [/<(?:video|source)\\b[^>]*\\bsrc=["\\x27]([^"\\x27]+)["\\x27]/ig,/\\b(?:src|file)\\s*[:=]\\s*["\\x27]([^"\\x27]+\\.(?:m3u8|mp4)(?:[^"\\x27]*)?)["\\x27]/ig,/(https?:\\/\\/[^\\s<>"\\x27]+\\.(?:m3u8|mp4)(?:[^\\s<>"\\x27]*)?)/ig]){',
    '              let m;while((m=re.exec(html)))addMedia(m[1]);',
    '            }',
    '            if(media.length){',
    '              const out=media.slice(0,6).map(function(u){',
    '                const qm=u.match(/(?:^|[^0-9])(2160|1080|720|480)(?:p)?(?:[^0-9]|$)/i);',
    '                const q=qm?qm[1]+"p":"Auto";',
    '                return{name:PROVIDER_NAME+" • PREMIUM • "+q+" • "+(variant==="Dub"?"English Dub":"Japanese + English Hard Subs"),title:ep.text||info.title,url:u,quality:q,language:variant==="Dub"?"English":"Japanese",provider:PROVIDER_NAME,type:/\\.m3u8(?:[?#]|$)/i.test(u)?"m3u8":"mp4",headers:{"Cookie":cookie,"Referer":eUrl,"Origin":originOf(eUrl)}};',
    '              });',
    '              return{streams:out,stage:"PLAYABLE",detail:variant+": authenticated premium player exposed "+out.length+" direct media source(s)"};',
    '            }',
    '            return{streams:[],stage:"PREMIUM EMBED",detail:variant+": HTTP "+(eRes.status||200)+" final="+originOf(eUrl)+" inner="+(eInner?originOf(eInner):"none")+" markers="+eHints+" media=0"};',
    '          }',
    '          const resolved=await __pdResolvePremiumPage(pUrl,premium.text,variant,ep.text||info.title,info);'
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
    { type: "info", label: "Premium testing follows your authenticated WCO session into embed.wcopremium.tv. It now checks the authenticated VideoJS player page for media URLs already exposed to your account, without bypassing authentication or entitlement checks." },
    { type: "toggle", key: "premiumEnabled", label: "Enable premium session test", description: "Use only with a current authenticated WCO Cookie header from your own account.", defaultValue: false },
    { type: "text", key: "premiumCookie", label: "Premium session cookie", placeholder: "cookie_name=value; other_cookie=value", description: "Paste only the Cookie request-header value. Never paste your username or password. Stored locally by Nuvio for this test provider.", isPassword: true }
  ];
}

module.exports = { getStreams, onSettings };
