#!/usr/bin/env node
"use strict";

/*
 * NetMirror Helix Stage 6: read-only multi-audio topology probe.
 * Diagnostic only. Production NetMirror and Helix provider are not imported.
 *
 * Goal: trace Squid Game's default subject and advertised English-dub subject
 * through Net27 + Aoneroom, inventory every media-bearing field, and determine
 * whether English audio exists as a separate resource or hidden manifest.
 */
const fs=require("node:fs"), path=require("node:path");
const NET27="https://net27.cc";
const AONE="https://h5-api.aoneroom.com";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const FIX={name:"Squid Game",tmdb:93405,season:1,episode:1};

function redact(v){return String(v||"")
 .replace(/([?&](?:sign|token|in|h|hash|t|Policy|Signature|Key-Pair-Id)=)[^&#\s]+/gi,"$1<redacted>")
 .replace(/(t_hash_t=)[^;\s]+/gi,"$1<redacted>");}
function sanitize(v){return JSON.parse(JSON.stringify(v,(k,x)=>typeof x==="string"?redact(x):x));}
function walk(v,trail=[],out=[]){
 if(Array.isArray(v)){v.forEach((x,i)=>walk(x,trail.concat(i),out));return out;}
 if(!v||typeof v!=="object")return out;
 for(const [k,x] of Object.entries(v)){const p=trail.concat(k);
  if(typeof x==="string" && (/^https?:\/\//i.test(x)||/url|file|src|stream|audio|video|caption|subtitle|master|playlist|dash|hls|mp4|detailpath|subjectid/i.test(k)))
   out.push({path:p.join("."),key:k,value:redact(x)});
  walk(x,p,out);
 } return out;
}
function kind(u){u=String(u||""); if(/220884/.test(u))return"wrong-220884"; if(/tran-audio/i.test(u))return"tran-audio";
 if(/\.m3u8(?:[?#]|$)/i.test(u))return"hls"; if(/\.mpd(?:[?#]|$)/i.test(u))return"dash";
 if(/\.mp4(?:[?#]|$)/i.test(u))return"mp4"; if(/\.(?:srt|vtt)(?:[?#]|$)/i.test(u))return"subtitle"; return"other";}
async function fetchText(url,headers={}){
 const t=Date.now(); try{const r=await fetch(url,{headers:{Accept:"application/json, text/plain, */*","User-Agent":UA,...headers},signal:AbortSignal.timeout(10000)});
 const body=await r.text(); let json=null; try{json=JSON.parse(body)}catch{}
 return{status:r.status,ms:Date.now()-t,finalUrl:redact(r.url),contentType:r.headers.get("content-type")||"",json:json?sanitize(json):null,body:json?undefined:redact(body.slice(0,12000))};
 }catch(e){return{error:e.message,ms:Date.now()-t};}}
function summarize(label,response){
 const data=response&&response.json; const refs=walk(data); const media=[...new Map(refs.filter(x=>/^https?:\/\//i.test(x.value)).map(x=>[x.value,{...x,kind:kind(x.value)}])).values()];
 return{label,response,inventory:media,counts:media.reduce((a,x)=>(a[x.kind]=(a[x.kind]||0)+1,a),{})};
}
function findDubRows(v){
 const rows=[]; const seen=new Set();
 (function rec(x,p=[]){if(Array.isArray(x)){x.forEach((z,i)=>rec(z,p.concat(i)));return;} if(!x||typeof x!=="object")return;
  const sid=x.subjectId??x.dubSubjectId??x.subject_id; const dp=x.detailPath??x.dubDetailPath??x.detail_path; const lang=x.language??x.lang??x.name??x.title;
  if(sid||dp){const key=String(sid)+"|"+String(dp);if(!seen.has(key)){seen.add(key);rows.push({path:p.join("."),subjectId:sid,detailPath:dp,language:lang});}}
  Object.entries(x).forEach(([k,z])=>rec(z,p.concat(k)));
 })(v); return rows;
}
(async()=>{
 const out={generatedAt:new Date().toISOString(),experiment:"NetMirror Helix Stage 6 - multi-audio topology",coldCookie:true,fixture:FIX,steps:{}};
 const variantUrl=`${NET27}/api/variants-tmdb/tv/${FIX.tmdb}?se=${FIX.season}&ep=${FIX.episode}`;
 const vr=await fetchText(variantUrl,{Referer:NET27+"/"}); out.steps.variants=summarize("variants",vr);
 const vd=vr.json||{}; const variants=Array.isArray(vd.variants)?vd.variants:[];
 const def=variants.find(v=>/^default$/i.test(String(v.language||"")))||null;
 const eng=variants.find(v=>/english\s*dub/i.test(String(v.language||"")))||null;
 out.selection={default:def,englishDub:eng};

 const defaultDetail=(def&&def.detailPath)||vd.defaultDetailPath||"";
 if(defaultDetail){
  const dr=await fetchText(`${AONE}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(defaultDetail)}`,{Origin:"https://net27.cc",Referer:NET27+"/"});
  out.steps.aoneroomDefaultDetail=summarize("aoneroom-default-detail",dr);
  out.steps.aoneroomDubRows=findDubRows(dr.json);
 }

 async function embed(label,v){
  if(!v)return null;
  const p=new URLSearchParams({type:"tv",se:String(FIX.season),ep:String(FIX.episode)});
  if(v.dubSubjectId)p.set("dubSubjectId",String(v.dubSubjectId));
  if(v.detailPath)p.set("detailPath",String(v.detailPath));
  // Also test the parameter names used by the public Nivio implementation.
  if(v.dubSubjectId)p.set("dub",String(v.dubSubjectId));
  if(v.detailPath)p.set("dubdp",String(v.detailPath));
  if(vd.defaultSubjectId)p.set("sid",String(vd.defaultSubjectId));
  if(vd.defaultDetailPath)p.set("dp",String(vd.defaultDetailPath));
  const r=await fetchText(`${NET27}/api/embed-tmdb/${FIX.tmdb}?${p}`,{Referer:NET27+"/"});
  return summarize(label,r);
 }
 out.steps.embedDefault=await embed("embed-default",def||{});
 out.steps.embedEnglish=await embed("embed-english",eng);

 // If Aoneroom supplied a more authoritative detailPath for the English subject,
 // repeat the request with that path rather than trusting variants-tmdb alone.
 const dubRows=out.steps.aoneroomDubRows||[];
 const engSid=eng&&String(eng.dubSubjectId||"");
 const exact=dubRows.find(x=>engSid&&String(x.subjectId||"")===engSid);
 if(eng&&exact&&exact.detailPath){
   out.selection.englishAoneroom=exact;
   out.steps.embedEnglishAoneroom=await embed("embed-english-aoneroom",{...eng,detailPath:exact.detailPath});
 }

 const dest=process.argv[2]||path.resolve(process.cwd(),"netmirror-helix-stage6-audio.json");
 fs.writeFileSync(dest,JSON.stringify(out,null,2));
 console.log("Wrote",dest);
 console.log("Default:",def&&def.language,def&&def.dubSubjectId);
 console.log("English:",eng&&eng.language,eng&&eng.dubSubjectId);
 console.log("Aoneroom dub rows:",dubRows.length);
 for(const k of ["embedDefault","embedEnglish","embedEnglishAoneroom"]){const x=out.steps[k];if(x)console.log(k,x.response&&x.response.status,x.response&&x.response.ms+"ms",JSON.stringify(x.counts));}
})().catch(e=>{console.error(e);process.exitCode=1;});
