"use strict";

// Tubi Nexus Probe v0.7
// Extends the validated anonymous-bearer probe with Tubi's episode resolution
// behavior used by the maintained Kodi implementation: episode playback data
// is published on the parent season payload, not necessarily by fetching the
// episode id directly. Diagnostic output only. No media is returned.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/tubi-nexus-probe-v5.js";
let cached = null;

async function loadPatched(){
  if(cached && typeof cached.getStreams === "function") return cached;
  const r = await fetch(BASE_URL,{skipSizeCheck:true});
  if(!r || !r.ok) return null;
  let src = String(await r.text() || "");

  const oldEpisodeBlock = 'const page=await request(cu,{headers:sh}),kids=page.data&&Array.isArray(page.data.children)?page.data.children:[];\n    const ep=kids.find((x,i)=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||(i+1))===wantedE);';
  const newEpisodeBlock = 'const page=await request(cu,{headers:sh}),groups=page.data&&Array.isArray(page.data.children)?page.data.children:[],kids=[];\n    for(const group of groups){const inner=group&&Array.isArray(group.children)?group.children:[];if(inner.length)kids.push(...inner);else if(group&&typeof group==="object"&&itemId(group))kids.push(group);}\n    const ep=kids.find(x=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||0)===wantedE)||(wantedE>0&&kids.length>=wantedE?kids[wantedE-1]:null);';
  const bestOld = 'const best=scored[0];let targetId=best.id;';
  const bestNew = 'const best=scored[0];let targetId=best.id,episodePayload=null;';
  const epAssignOld = 'if(!ep||!itemId(ep)){rows.push(diag("VERDICT","bearer auth and title search work, but episode mapping needs adjustment",display));return rows.slice(0,18);}targetId=itemId(ep);';
  const epAssignNew = 'if(!ep||!itemId(ep)){rows.push(diag("VERDICT","bearer auth and title search work, but episode mapping needs adjustment",display));return rows.slice(0,18);}targetId=itemId(ep);episodePayload=ep;';
  const resourceOld = 'const cr=await request(contentUrl,{headers:sh}),rs=resourceSummary(cr.data);\n  rows.push(diag("API CONTENT",`${cr.status||"ERR"} • json=${cr.data?"yes":"no"} • id=${targetId} • resources=${rs.total}`,display));\n  rows.push(diag("RESOURCES",`clear=${rs.clear} • drm=${rs.drm} • types=${rs.types.join(",")||"none"}${rs.host?` • clearHost=${rs.host}`:""}`,display));\n  rows.push(diag("VERDICT",rs.clear>0?"current Tubi anonymous API exposes at least one clear HLS/DASH resource; controlled playback provider is feasible":(rs.drm>0?"title mapped successfully but only DRM resources were returned for this item":"auth/search/content work, but no playback resource was returned for this item"),display));';
  const resourceNew = 'const cr=await request(contentUrl,{headers:sh}),directRs=resourceSummary(cr.data),seasonRs=episodePayload?resourceSummary(episodePayload):{total:0,clear:0,drm:0,types:[],host:""},rs=seasonRs.clear>0?seasonRs:directRs;\n  rows.push(diag("API CONTENT",`${cr.status||"ERR"} • json=${cr.data?"yes":"no"} • id=${targetId} • directResources=${directRs.total}`,display));\n  if(episodePayload)rows.push(diag("SEASON RESOURCES",`clear=${seasonRs.clear} • drm=${seasonRs.drm} • types=${seasonRs.types.join(",")||"none"}${seasonRs.host?` • clearHost=${seasonRs.host}`:""}`,display));\n  rows.push(diag("DIRECT RESOURCES",`clear=${directRs.clear} • drm=${directRs.drm} • types=${directRs.types.join(",")||"none"}${directRs.host?` • clearHost=${directRs.host}`:""}`,display));\n  rows.push(diag("RESOURCES",`selected=${seasonRs.clear>0?"season":"direct"} • clear=${rs.clear} • drm=${rs.drm} • types=${rs.types.join(",")||"none"}${rs.host?` • clearHost=${rs.host}`:""}`,display));\n  rows.push(diag("VERDICT",rs.clear>0?"current Tubi anonymous API exposes at least one clear HLS resource; controlled playback provider is feasible":(rs.drm>0?"title and episode map successfully but only DRM resources were found in both season/direct payloads":"auth/search/content work, but no playback resource was returned for this item"),display));';

  if(!src.includes(oldEpisodeBlock) || !src.includes(bestOld) || !src.includes(epAssignOld) || !src.includes(resourceOld)) return null;
  src = src.replace(bestOld,bestNew).replace(oldEpisodeBlock,newEpisodeBlock).replace(epAssignOld,epAssignNew).replace(resourceOld,resourceNew);

  const mod={exports:{}};
  const fn=new Function("module","exports","require",src+"\n;return module.exports;");
  const out=fn(mod,mod.exports,function(name){throw new Error("Unsupported nested require: "+name);})||mod.exports;
  if(!out || typeof out.getStreams !== "function") return null;
  cached=out;
  return out;
}

async function getStreams(inputId,mediaType,season,episode){
  try{
    const base=await loadPatched();
    if(!base) return [{name:"Tubi Nexus Probe • DIAG LOAD • v0.7 season-resource patch failed to load",title:"Tubi feasibility probe",url:"https://tubitv.com/favicon.ico",quality:"DIAG",language:"Debug",provider:"Tubi Nexus Probe",type:"mp4"}];
    return await base.getStreams(inputId,mediaType,season,episode);
  }catch(e){
    return [{name:`Tubi Nexus Probe • DIAG ERROR • ${String(e&&e.message||e).slice(0,160)}`,title:"Tubi feasibility probe",url:"https://tubitv.com/favicon.ico",quality:"DIAG",language:"Debug",provider:"Tubi Nexus Probe",type:"mp4"}];
  }
}

module.exports={getStreams};
