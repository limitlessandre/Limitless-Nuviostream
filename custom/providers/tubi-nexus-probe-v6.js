"use strict";

// Tubi Nexus Probe v0.6
// Loads the validated v0.5 anonymous-bearer probe and fixes Tubi's current
// season payload shape: page.children contains season/group objects whose
// own children array contains the actual episode objects and content ids.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/tubi-nexus-probe-v5.js";
let cached = null;

async function loadPatched(){
  if(cached && typeof cached.getStreams === "function") return cached;
  const r = await fetch(BASE_URL,{skipSizeCheck:true});
  if(!r || !r.ok) return null;
  let src = String(await r.text() || "");

  const oldBlock = 'const page=await request(cu,{headers:sh}),kids=page.data&&Array.isArray(page.data.children)?page.data.children:[];\n    const ep=kids.find((x,i)=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||(i+1))===wantedE);';
  const newBlock = 'const page=await request(cu,{headers:sh}),groups=page.data&&Array.isArray(page.data.children)?page.data.children:[],kids=[];\n    for(const group of groups){const inner=group&&Array.isArray(group.children)?group.children:[];if(inner.length)kids.push(...inner);else if(group&&typeof group==="object"&&itemId(group))kids.push(group);}\n    const ep=kids.find(x=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||0)===wantedE)||(wantedE>0&&kids.length>=wantedE?kids[wantedE-1]:null);';

  if(!src.includes(oldBlock)) return null;
  src = src.replace(oldBlock,newBlock);

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
    if(!base) return [{name:"Tubi Nexus Probe • DIAG LOAD • v0.6 nested-episode patch failed to load",title:"Tubi feasibility probe",url:"https://tubitv.com/favicon.ico",quality:"DIAG",language:"Debug",provider:"Tubi Nexus Probe",type:"mp4"}];
    return await base.getStreams(inputId,mediaType,season,episode);
  }catch(e){
    return [{name:`Tubi Nexus Probe • DIAG ERROR • ${String(e&&e.message||e).slice(0,160)}`,title:"Tubi feasibility probe",url:"https://tubitv.com/favicon.ico",quality:"DIAG",language:"Debug",provider:"Tubi Nexus Probe",type:"mp4"}];
  }
}

module.exports={getStreams};
