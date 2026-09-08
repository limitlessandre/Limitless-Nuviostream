"use strict";

// 1Shows Nexus probe v0.1.2
// Keeps the proven 1Shows catalog check + current encrypted VidZee flow,
// then probes the maintained extension's Vidrock fallback path.

const PROVIDER_NAME = "1Shows Test";
const SITE_BASE = "https://www.1shows.org";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const VIDZEE_API = "https://core.vidzee.wtf";
const VIDZEE_ORIGIN = "https://player.vidzee.wtf";
const VIDROCK_BASE = "https://vidrock.ru";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const VIDZEE_RC4_KEY_HEX = "e4f9b27d8c1a6ef5037db98ac54e21f0b9d6c3a781fe42ad65c0e9b73f148a2d";
const VIDROCK_AES_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
const VIDZEE_SERVERS = ["ipcloud", "v6:Hindi", "dcloud", "tik"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function short(v, n) { const t = clean(v).replace(/\s+/g, " "); const m = Number(n)||205; return t.length > m ? t.slice(0,m-1)+"…" : t; }
function mediaTypeOf(v) { return String(v||"tv").toLowerCase() === "movie" ? "movie" : "tv"; }
function hostOf(url) { try { return new URL(url).hostname; } catch (_) { return "unknown-host"; } }
function inferHeight(text) { const m = clean(text).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i); return m ? Number(m[1]) : 0; }
function tier(h) { h=Number(h||0); if(h>=2160)return `4K ${h}p`; if(h>=1440)return `Enhanced QHD ${h}p`; if(h>=1080)return `FHD ${h}p`; if(h>=720)return `HD ${h}p`; if(h>=480)return `SD ${h}p`; if(h>=360)return `SD-Low ${h}p`; return h ? `SD-Very Low ${h}p` : "Unknown Auto"; }
function diag(label, detail) { return { name:`${PROVIDER_NAME} • DIAG ${label}${detail?` • ${short(detail,205)}`:""}`, title:clean(detail)||`${PROVIDER_NAME} diagnostic`, url:`${SITE_BASE}/favicon.ico`, quality:"DIAG", language:"Unavailable", provider:PROVIDER_NAME, type:"mp4", subtitles:[] }; }

async function fetchJson(url, headers) {
  try {
    const r = await fetch(url,{headers:{"User-Agent":USER_AGENT,"Accept":"application/json,text/plain,*/*",...(headers||{})},redirect:"follow",skipSizeCheck:true});
    if(!r) return {ok:false,status:0,data:null,error:"no response"};
    const status=Number(r.status||0);
    if(!r.ok) return {ok:false,status,data:null,error:`HTTP ${status||"ERR"}`};
    return {ok:true,status,data:await r.json(),error:""};
  } catch(e) { return {ok:false,status:0,data:null,error:clean(e&&e.message?e.message:e)||"request error"}; }
}

async function resolveTmdbId(inputId,type){
  const raw=clean(inputId); if(/^\d+$/.test(raw)) return Number(raw); if(!/^tt\d+$/i.test(raw)) return null;
  const r=await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,{});
  const rows=type==="movie"?r.data&&r.data.movie_results:r.data&&r.data.tv_results;
  return Array.isArray(rows)&&rows[0]&&rows[0].id?Number(rows[0].id):null;
}

function hexToBytes(hex){ const out=[]; const t=clean(hex).replace(/[^0-9a-f]/gi,""); for(let i=0;i+1<t.length;i+=2) out.push(parseInt(t.slice(i,i+2),16)); return out; }
function base64ToBytes(value){ const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; const text=clean(value).replace(/-/g,"+").replace(/_/g,"/").replace(/[^A-Za-z0-9+/=]/g,""); const out=[]; let buffer=0,bits=0; for(let i=0;i<text.length;i++){const ch=text[i]; if(ch==="=")break; const idx=chars.indexOf(ch); if(idx<0)continue; buffer=(buffer<<6)|idx; bits+=6; if(bits>=8){bits-=8; out.push((buffer>>bits)&255);}} return out; }
function utf8Decode(bytes){ let escaped=""; for(const b of bytes) escaped+="%"+Number(b&255).toString(16).padStart(2,"0"); try{return decodeURIComponent(escaped);}catch(_){return String.fromCharCode(...bytes);} }
function rc4Drop2048(keyBytes,dataBytes){ const s=Array.from({length:256},(_,i)=>i); let j=0; for(let i=0;i<256;i++){j=(j+s[i]+keyBytes[i%keyBytes.length])&255; const t=s[i];s[i]=s[j];s[j]=t;} let i=0;j=0; for(let d=0;d<2048;d++){i=(i+1)&255;j=(j+s[i])&255;const t=s[i];s[i]=s[j];s[j]=t;} const out=new Array(dataBytes.length); for(let k=0;k<dataBytes.length;k++){i=(i+1)&255;j=(j+s[i])&255;const t=s[i];s[i]=s[j];s[j]=t;const sb=s[(s[i]+s[j])&255];out[k]=(dataBytes[k]^sb)&255;} return out; }
function decryptVidzee(blob){ try{const plain=utf8Decode(rc4Drop2048(hexToBytes(VIDZEE_RC4_KEY_HEX),base64ToBytes(blob))); const p=JSON.parse(plain); return p&&typeof p==="object"?p:null;}catch(_){return null;} }

async function decryptVidrock(blob){
  try {
    if(typeof crypto==="undefined" || !crypto.subtle || typeof crypto.subtle.importKey!=="function") return {ok:false,error:"crypto.subtle unavailable"};
    const data=base64ToBytes(blob); if(data.length<29) return {ok:false,error:"ciphertext too short"};
    const iv=new Uint8Array(data.slice(0,12)); const ct=new Uint8Array(data.slice(12)); const keyBytes=new Uint8Array(hexToBytes(VIDROCK_AES_KEY_HEX));
    const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt"]);
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv,tagLength:128},key,ct);
    return {ok:true,url:new TextDecoder().decode(new Uint8Array(plain))};
  } catch(e) { return {ok:false,error:clean(e&&e.message?e.message:e)||"decrypt failed"}; }
}

async function catalogProbe(tmdbId,type,season,episode){
  if(type==="movie"){const r=await fetchJson(`${SITE_BASE}/api/movie/${tmdbId}`,{"Referer":`${SITE_BASE}/`}); return {result:r,episodes:[],selected:null};}
  const r=await fetchJson(`${SITE_BASE}/api/tv/${tmdbId}/season/${season}`,{"Referer":`${SITE_BASE}/`});
  const eps=r.ok&&r.data&&Array.isArray(r.data.episodes)?r.data.episodes:[]; const selected=eps.find(ep=>Number(ep&&ep.episode_number)===Number(episode))||null; return {result:r,episodes:eps,selected};
}
function pathFor(tmdbId,type,s,e){ return type==="tv"?`tv/${tmdbId}/${s}/${e}`:`movie/${tmdbId}`; }

async function vidzeeProbe(tmdbId,type,s,e,server){
  const path=pathFor(tmdbId,type,s,e); const r=await fetchJson(`${VIDZEE_API}/streams/${path}?s=${encodeURIComponent(server)}&e=1`,{"Referer":`${VIDZEE_ORIGIN}/`,`Origin`:VIDZEE_ORIGIN});
  if(!r.ok)return {server,ok:false,error:r.error||`HTTP ${r.status||"ERR"}`}; const blob=clean(r.data&&r.data.c); if(!blob)return {server,ok:false,error:"no-c"};
  const d=decryptVidzee(blob); const url=clean(d&&d.url); if(!/^https?:\/\//i.test(url))return {server,ok:false,error:d?"decoded-no-url":"decrypt-failed"};
  return {server,ok:true,url,language:clean(d&&d.language)||(server.toLowerCase().includes("hindi")?"Hindi":"Auto")};
}

async function vidrockProbe(tmdbId,type,s,e){
  const path=pathFor(tmdbId,type,s,e); const r=await fetchJson(`${VIDROCK_BASE}/api/${path}`,{"Referer":`${VIDROCK_BASE}/`,`Origin`:VIDROCK_BASE});
  if(!r.ok)return {ok:false,error:r.error||`HTTP ${r.status||"ERR"}`,entries:[],streams:[]};
  const map=r.data&&typeof r.data==="object"&&!Array.isArray(r.data)?r.data:{}; const entries=Object.entries(map).filter(([,v])=>v&&clean(v.url));
  const streams=[]; const errors=[];
  for(const [name,v] of entries.slice(0,6)){
    const dec=await decryptVidrock(clean(v.url));
    if(dec.ok && /^https?:\/\//i.test(clean(dec.url))) streams.push({server:name,url:clean(dec.url),language:clean(v.language)||"Auto"});
    else errors.push(`${name}=${dec.error||"no-url"}`);
  }
  return {ok:true,error:"",entries,streams,errors};
}

function streamRow(tmdbId,type,s,e,server,url,language,referer,origin){ const h=inferHeight(url); return {name:`${PROVIDER_NAME} • ${tier(h)} • ${server}`,title:`TMDB ${tmdbId}${type==="tv"?` • S${s}E${e}`:" • Movie"}`,url,quality:h?`${h}p`:"Auto",language:language||"Auto",headers:{"User-Agent":USER_AGENT,"Referer":referer,"Origin":origin},provider:PROVIDER_NAME,type:/\.mp4(?:$|[?#])/i.test(url)?"mp4":"m3u8",subtitles:[]}; }

async function getStreams(inputId,mediaType="tv",season=1,episode=1){
  const type=mediaTypeOf(mediaType),s=Number(season||1),e=Number(episode||1); const tmdbId=await resolveTmdbId(inputId,type); if(!tmdbId)return [diag("TMDB FAILED",`input=${inputId} • type=${type}`)];
  const [catalog,vidzee,vidrock]=await Promise.all([catalogProbe(tmdbId,type,s,e),Promise.all(VIDZEE_SERVERS.map(x=>vidzeeProbe(tmdbId,type,s,e,x))),vidrockProbe(tmdbId,type,s,e)]);
  const rows=[]; const c=catalog.result;
  if(c&&c.ok){ if(type==="tv") rows.push(diag("CATALOG OK",`TMDB ${tmdbId} • S${s} • episodes=${catalog.episodes.length}${catalog.selected?` • E${e}=${clean(catalog.selected.name)||"found"}`:` • E${e}=missing`}`)); else rows.push(diag("CATALOG OK",`TMDB ${tmdbId} • movie • HTTP ${c.status}`)); }
  else rows.push(diag("CATALOG FAIL",`TMDB ${tmdbId} • ${c?c.error:"no response"}`));

  const seen=new Set(); const failures=[]; let vidzeeOK=0;
  for(const p of vidzee){ if(!p.ok){failures.push(`${p.server}=${p.error}`);continue;} vidzeeOK++; if(!seen.has(p.url)){seen.add(p.url);rows.unshift(streamRow(tmdbId,type,s,e,`VidZee ${p.server}`,p.url,p.language,`${VIDZEE_ORIGIN}/`,VIDZEE_ORIGIN));} }
  rows.push(diag("VIDZEE",`servers=${vidzeeOK}/${VIDZEE_SERVERS.length}${failures.length?` • ${failures.join(" • ")}`:""}`));

  if(!vidrock.ok) rows.push(diag("VIDROCK FAIL",vidrock.error));
  else {
    rows.push(diag("VIDROCK API",`HTTP 200 • entries=${vidrock.entries.length} • decrypted=${vidrock.streams.length}${vidrock.errors&&vidrock.errors.length?` • ${vidrock.errors.slice(0,4).join(" | ")}`:""}`));
    for(const p of vidrock.streams){ if(seen.has(p.url))continue; seen.add(p.url); rows.unshift(streamRow(tmdbId,type,s,e,`Vidrock ${p.server}`,p.url,p.language,`${VIDROCK_BASE}/`,VIDROCK_BASE)); }
    if(vidrock.entries.length && !vidrock.streams.length && (typeof crypto==="undefined" || !crypto.subtle)) rows.push(diag("VIDROCK CRYPTO",`API has ${vidrock.entries.length} encrypted source(s), but this Nuvio runtime has no crypto.subtle AES-GCM`));
  }
  rows.push(diag("REQUEST",`TMDB ${tmdbId} • ${type}${type==="tv"?` • S${s}E${e}`:""} • playable=${seen.size}`));
  if(!seen.size) rows.push(diag("NO STREAM",`Catalog matched, but VidZee/Vidrock returned no playable source`));
  return rows;
}

if(typeof module!=="undefined"&&module.exports)module.exports={getStreams}; else globalThis.getStreams=getStreams;
