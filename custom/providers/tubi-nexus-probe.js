"use strict";

// Nexus-only Tubi feasibility probe. Diagnostic output only.
// It checks title lookup, series/episode mapping, and whether the legacy public
// content endpoint still exposes a playback-shaped field. It does not return media.

const PROVIDER_NAME = "Tubi Nexus Probe";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DIAG_URL = "https://tubitv.com/favicon.ico";
const TUBI_BASES = ["https://tubitv.com/oz", "https://www.tubitv.com/oz"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function clean(v){return String(v==null?"":v).replace(/\s+/g," ").trim();}
function short(v,n){const s=clean(v),m=n||170;return s.length>m?s.slice(0,m)+"…":s;}
function diag(stage,msg,title){return{name:`${PROVIDER_NAME} • DIAG ${stage} • ${short(msg,175)}`,title:title||"Tubi feasibility probe",url:DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};}

async function req(url){
  try{
    const res=await fetch(url,{headers:{"User-Agent":UA,"Accept":"application/json,text/plain,*/*","Accept-Language":"en-US,en;q=0.9","Referer":"https://tubitv.com/"},skipSizeCheck:true});
    const text=String(await res.text()||"");
    return{ok:!!res.ok,status:Number(res.status||0),url:String(res.url||url),text};
  }catch(e){return{ok:false,status:0,url,text:"",error:String(e&&e.message||e)};}
}
function json(text){try{return JSON.parse(String(text||""));}catch(_){return null;}}
async function jreq(url){const r=await req(url);return{...r,data:r.ok?json(r.text):null};}

async function tmdbInfo(inputId,mediaType){
  const type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv";
  const raw=String(inputId||"").trim();let id=/^\d+$/.test(raw)?Number(raw):null;
  if(!id&&/^tt\d+$/i.test(raw)){
    const f=await jreq(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const list=type==="movie"?f.data&&f.data.movie_results:f.data&&f.data.tv_results;
    id=Array.isArray(list)&&list[0]&&list[0].id?Number(list[0].id):null;
  }
  if(!id)return null;
  const r=await jreq(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`),d=r.data;
  if(!d)return null;
  return{id,type,title:clean(type==="movie"?(d.title||d.original_title):(d.name||d.original_name)),originalTitle:clean(type==="movie"?d.original_title:d.original_name),year:clean(type==="movie"?d.release_date:d.first_air_date).slice(0,4),imdb:clean(d.imdb_id||(d.external_ids&&d.external_ids.imdb_id))};
}

function norm(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function score(a,b){a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 100;if(a.startsWith(b)||b.startsWith(a))return 90;if(a.includes(b)||b.includes(a))return 80;const aw=a.split(" "),bw=b.split(" ");let x=0;for(const w of bw)if(w.length>1&&aw.includes(w))x++;return Math.round(x/Math.max(1,bw.length)*70);}
function results(data){if(Array.isArray(data))return data;if(!data||typeof data!=="object")return[];for(const k of["results","items","list"]){if(Array.isArray(data[k]))return data[k];}if(data.contents&&typeof data.contents==="object")return Array.isArray(data.contents)?data.contents:Object.values(data.contents);return[];}

async function searchTubi(info){
  const queries=[info.title];if(info.originalTitle&&norm(info.originalTitle)!==norm(info.title))queries.push(info.originalTitle);
  const attempts=[],found=[];
  for(const base of TUBI_BASES)for(const q of queries){
    const url=`${base}/search/${encodeURIComponent(q)}`,r=await jreq(url);
    attempts.push({url,status:r.status,json:!!r.data,prefix:short(r.text,80)});
    for(const item of results(r.data)){
      const title=clean(item&&(item.title||item.name)),id=item&&(item.id||item.content_id||item.video_id);if(!title||!id)continue;
      const year=clean(item.year||item.release_year||item.release_date).slice(0,4);let s=score(title,info.title);if(info.year&&year===info.year)s+=15;
      const row={id:String(id),title,type:clean(item.type||item.content_type||item.kind),year,score:s,base};
      const old=found.find(x=>x.id===row.id);if(!old)found.push(row);else if(row.score>old.score)Object.assign(old,row);
    }
  }
  return{attempts,found:found.sort((a,b)=>b.score-a.score)};
}

function kids(d){return d&&Array.isArray(d.children)?d.children:[];}
function findEpisode(d,season,episode){const s=Number(season||1),e=Number(episode||1),ss=kids(d);for(let i=0;i<ss.length;i++){const sn=ss[i]||{},sno=Number(sn.season_number||sn.season||sn.number||(i+1));if(sno!==s)continue;const es=kids(sn);for(let j=0;j<es.length;j++){const ep=es[j]||{},eno=Number(ep.episode_number||ep.episode||ep.number||(j+1));if(eno===e&&(ep.id||ep.video_id))return{node:ep,sno,eno};}}return null;}
async function content(id,base,zero){const u=`${base}/videos/${zero?"0":""}${id}/content`,r=await jreq(u);return{...r,requestUrl:u};}

function playbackShape(d){
  if(!d||typeof d!=="object")return{present:false,key:"",kind:"",host:"",keys:[]};
  const fields=["url","video_url","stream_url","hls_url","manifest_url","playback_url"];
  for(const k of fields){const v=d[k];if(typeof v==="string"&&/^https?:\/\//i.test(v)){let host="";try{host=new URL(v).host;}catch(_){}const kind=/\.m3u8(?:[?#]|$)/i.test(v)?"hls":(/\.mpd(?:[?#]|$)/i.test(v)?"dash":"url");return{present:true,key:k,kind,host,keys:Object.keys(d).slice(0,20)};}}
  return{present:false,key:"",kind:"",host:"",keys:Object.keys(d).slice(0,20)};
}

async function getStreams(inputId,mediaType,season,episode){
  const rows=[],type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",info=await tmdbInfo(inputId,type);
  if(!info)return[diag("TMDB",`unable to resolve ${inputId}`)];
  const display=type==="movie"?`${info.title}${info.year?` (${info.year})`:""}`:`${info.title} S${String(Number(season||1)).padStart(2,"0")}E${String(Number(episode||1)).padStart(2,"0")}`;
  rows.push(diag("TMDB",`title=${info.title} • year=${info.year||"?"} • imdb=${info.imdb||"?"} • type=${type}`,display));
  const s=await searchTubi(info);
  for(const a of s.attempts.slice(0,4))rows.push(diag("SEARCH HTTP",`${a.status||"ERR"} • json=${a.json?"yes":"no"} • ${a.url.replace(/^https?:\/\//,"")}${a.json?"":` • ${a.prefix}`}`,display));
  if(!s.found.length){rows.push(diag("SEARCH RESULT","no parseable Tubi search result found",display));return rows;}
  for(const c of s.found.slice(0,4))rows.push(diag("CANDIDATE",`score=${c.score} • id=${c.id} • type=${c.type||"?"} • year=${c.year||"?"} • ${c.title}`,display));
  const best=s.found[0];if(best.score<70){rows.push(diag("STOP",`best title score ${best.score} is too weak`,display));return rows;}
  let targetId=best.id,base=best.base||TUBI_BASES[0];
  if(type==="tv"){
    let show=await content(best.id,base,true);if(!show.data)show=await content(best.id,base,false);
    rows.push(diag("SHOW CONTENT",`${show.status||"ERR"} • json=${show.data?"yes":"no"} • children=${kids(show.data).length} • ${show.requestUrl.replace(/^https?:\/\//,"")}`,display));
    if(!show.data)return rows;
    const m=findEpisode(show.data,season,episode);if(!m){rows.push(diag("EPISODE MAP",`no S${season||1}E${episode||1} match`,display));return rows;}
    targetId=String(m.node.id||m.node.video_id);rows.push(diag("EPISODE MAP",`S${m.sno}E${m.eno} → Tubi id=${targetId} • ${clean(m.node.title||m.node.name||"untitled")}`,display));
  }
  let v=await content(targetId,base,false);if(!v.data)v=await content(targetId,base,true);
  rows.push(diag("VIDEO CONTENT",`${v.status||"ERR"} • json=${v.data?"yes":"no"} • ${v.requestUrl.replace(/^https?:\/\//,"")}`,display));
  if(!v.data)return rows;
  const p=playbackShape(v.data);
  rows.push(diag("PLAYBACK SHAPE",`directField=${p.present?"yes":"no"}${p.present?` • key=${p.key} • kind=${p.kind} • host=${p.host}`:""} • keys=${p.keys.join(",")||"none"}`,display));
  rows.push(diag("VERDICT",p.present?"legacy-style playback field is still present; next step is a controlled playback test":"no obvious legacy-style playback field; current API needs deeper inspection",display));
  return rows.slice(0,16);
}

module.exports={getStreams};
