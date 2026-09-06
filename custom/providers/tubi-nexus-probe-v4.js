"use strict";

// Tubi Nexus Probe v0.4
// Keeps the current page-state probe, then tests the still-maintained /oz API flow
// after bootstrapping a public Tubi web session. Diagnostic output only.

const PROVIDER_NAME = "Tubi Nexus Probe";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/tubi-nexus-probe.js";
const DIAG_URL = "https://tubitv.com/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
let cached = null;

function clean(v){return String(v==null?"":v).replace(/\s+/g," ").trim();}
function short(v,n){const s=clean(v),m=n||175;return s.length>m?s.slice(0,m)+"…":s;}
function diag(stage,msg,title){return{name:`${PROVIDER_NAME} • DIAG ${stage} • ${short(msg,180)}`,title:title||"Tubi feasibility probe",url:DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};}

async function loadBase(){
  if(cached&&typeof cached.getStreams==="function")return cached;
  try{
    const r=await fetch(BASE_URL,{skipSizeCheck:true});if(!r||!r.ok)return null;
    const src=String(await r.text()||"");if(!src.includes("module.exports"))return null;
    const mod={exports:{}};const fn=new Function("module","exports","require",src+"\n;return module.exports;");
    const out=fn(mod,mod.exports,function(name){throw new Error("Unsupported nested require: "+name);})||mod.exports;
    if(!out||typeof out.getStreams!=="function")return null;cached=out;return out;
  }catch(_){return null;}
}

function parseTitle(rows){
  const row=(rows||[]).find(x=>/DIAG TMDB/i.test(String(x&&x.name||"")));
  const text=String(row&&row.name||"");
  const m=text.match(/\btitle=(.*?)\s*•\s*year=/i);
  return m?clean(m[1]):"";
}
function parseDisplay(rows){return String(rows&&rows[0]&&rows[0].title||"Tubi feasibility probe");}
function hasCandidate(rows){return (rows||[]).some(x=>/DIAG CANDIDATE/i.test(String(x&&x.name||"")));}

function getCookies(res){
  const raw=[];
  try{if(res&&res.headers&&typeof res.headers.getSetCookie==="function")raw.push(...(res.headers.getSetCookie()||[]));}catch(_){}
  try{const one=res&&res.headers&&res.headers.get&&res.headers.get("set-cookie");if(one)raw.push(one);}catch(_){}
  const pairs=[];
  for(const line of raw){
    const text=String(line||"");
    const re=/(?:^|,\s*)([A-Za-z0-9_.-]+)=([^;,]*)/g;let m;
    while((m=re.exec(text))){const pair=m[1]+"="+m[2];if(!pairs.some(x=>x.split("=")[0]===m[1]))pairs.push(pair);}
  }
  return pairs;
}

async function request(url,cookie,referer){
  try{
    const headers={"User-Agent":UA,"Accept":"application/json,text/plain,*/*","Accept-Language":"en-US,en;q=0.9","Referer":referer||"https://tubitv.com/"};
    if(cookie)headers.Cookie=cookie;
    const res=await fetch(url,{headers,skipSizeCheck:true});
    const text=String(await res.text()||"");let data=null;try{data=JSON.parse(text);}catch(_){}
    return{ok:!!res.ok,status:Number(res.status||0),url:String(res.url||url),text,data,res};
  }catch(e){return{ok:false,status:0,url,text:"",data:null,error:String(e&&e.message||e)};}
}
function listResults(data){if(Array.isArray(data))return data;if(data&&Array.isArray(data.results))return data.results;if(data&&Array.isArray(data.items))return data.items;return[];}
function itemTitle(x){return clean(x&&(x.title||x.name));}
function itemId(x){return clean(x&&(x.id||x.content_id||x.video_id));}
function itemType(x){return clean(x&&(x.type||x.content_type||x.kind));}

async function ozProbe(title,display){
  const rows=[];
  const boot=await request("https://tubitv.com/","","https://tubitv.com/");
  const cookies=getCookies(boot.res),cookie=cookies.join("; ");
  rows.push(diag("OZ BOOTSTRAP",`${boot.status||"ERR"} • cookies=${cookies.length} • bytes=${boot.text.length}`,display));

  const q=encodeURIComponent(title);
  const searchUrl=`https://tubitv.com/oz/search/${q}?isKidsMode=false&useLinearHeader=true&isMobile=false`;
  const s=await request(searchUrl,cookie,`https://tubitv.com/search/${q}`),items=listResults(s.data);
  rows.push(diag("OZ SEARCH",`${s.status||"ERR"} • json=${s.data?"yes":"no"} • items=${items.length} • cookie=${cookie?"yes":"no"}${s.data?"":` • ${short(s.text,70)}`}`,display));
  for(const x of items.slice(0,4))rows.push(diag("OZ CANDIDATE",`id=${itemId(x)||"?"} • type=${itemType(x)||"?"} • ${itemTitle(x)||"untitled"}`,display));
  if(!items.length)return rows;

  const first=items.find(x=>itemId(x))||items[0],id=itemId(first);if(!id)return rows;
  const suffix="?video_resources=hlsv6_widevine_nonclearlead&video_resources=hlsv6";
  for(const cid of ["0"+id,id]){
    const u=`https://tubitv.com/oz/videos/${cid}/content${suffix}`;
    const c=await request(u,cookie,searchUrl);
    const d=c.data||{},children=Array.isArray(d.children)?d.children.length:0,resources=Array.isArray(d.video_resources)?d.video_resources.length:0;
    rows.push(diag("OZ CONTENT",`${c.status||"ERR"} • id=${cid} • json=${c.data?"yes":"no"} • children=${children} • resources=${resources}${c.data?"":` • ${short(c.text,55)}`}`,display));
    if(c.ok&&c.data)break;
  }
  return rows;
}

async function getStreams(inputId,mediaType,season,episode){
  const base=await loadBase();if(!base)return[diag("LOAD","v0.3 probe failed to load")];
  let rows=[];try{rows=await base.getStreams(inputId,mediaType,season,episode);}catch(e){rows=[diag("BASE",String(e&&e.message||e))];}
  if(hasCandidate(rows))return rows;
  const title=parseTitle(rows);if(!title)return rows.concat([diag("OZ STOP","could not recover TMDB title from base diagnostics",parseDisplay(rows))]).slice(0,20);
  const extra=await ozProbe(title,parseDisplay(rows));
  return rows.concat(extra).slice(0,20);
}

module.exports={getStreams};
