"use strict";

// Nexus-only Tubi feasibility probe. Diagnostic output only.
// v0.2 tests Tubi's current public website flow instead of the retired /oz API:
// web search page -> public series/movie page -> episode URL -> embedded playback manifests.
// It does not return playable media.

const PROVIDER_NAME = "Tubi Nexus Probe";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DIAG_URL = "https://tubitv.com/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function clean(v){return String(v==null?"":v).replace(/\\u0026/g,"&").replace(/\\\//g,"/").replace(/&amp;/gi,"&").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
function short(v,n){const s=clean(v),m=n||175;return s.length>m?s.slice(0,m)+"…":s;}
function diag(stage,msg,title){return{name:`${PROVIDER_NAME} • DIAG ${stage} • ${short(msg,180)}`,title:title||"Tubi feasibility probe",url:DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};}
function norm(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function score(a,b){a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 100;if(a.startsWith(b)||b.startsWith(a))return 90;if(a.includes(b)||b.includes(a))return 80;const aw=a.split(" "),bw=b.split(" ");let x=0;for(const w of bw)if(w.length>1&&aw.includes(w))x++;return Math.round(x/Math.max(1,bw.length)*70);}

async function req(url){
  try{
    const res=await fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8","Accept-Language":"en-US,en;q=0.9","Referer":"https://tubitv.com/"},skipSizeCheck:true});
    return{ok:!!res.ok,status:Number(res.status||0),url:String(res.url||url),text:String(await res.text()||"")};
  }catch(e){return{ok:false,status:0,url,text:"",error:String(e&&e.message||e)};}
}
async function jreq(url){const r=await req(url);let data=null;try{data=JSON.parse(r.text);}catch(_){}return{...r,data};}

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

function slugText(href){const s=String(href||"").split(/[?#]/)[0].split("/").filter(Boolean).pop()||"";return clean(s.replace(/-/g," "));}
function candidateLinks(html,info){
  const out=[];
  const re=/<a\b[^>]*href=["']([^"']*(?:\/series\/\d+\/|\/movies\/\d+\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(String(html||"")))&&out.length<100){
    let href=String(m[1]||"").replace(/\\\//g,"/");if(href.startsWith("/"))href="https://tubitv.com"+href;if(!/^https?:\/\//i.test(href))continue;
    const title=clean(m[2])||slugText(href);const isSeries=/\/series\/\d+\//i.test(href);const isMovie=/\/movies\/\d+\//i.test(href);
    if(info.type==="tv"&&!isSeries)continue;if(info.type==="movie"&&!isMovie)continue;
    const s=Math.max(score(title,info.title),score(slugText(href),info.title));
    const idm=href.match(/\/(?:series|movies)\/(\d+)\//i);const id=idm?idm[1]:"";
    if(!id||s<45)continue;
    const key=href.replace(/[?#].*$/,"").replace(/\/$/,"");if(out.some(x=>x.key===key))continue;
    out.push({key,href:key,title:title||slugText(href),id,score:s});
  }
  return out.sort((a,b)=>b.score-a.score);
}

async function searchWeb(info){
  const q=encodeURIComponent(info.title);
  const urls=[`https://tubitv.com/search/${q}`,`https://tubitv.com/search?search=${q}`,`https://www.tubitv.com/search/${q}`];
  const attempts=[],found=[];
  for(const url of urls){
    const r=await req(url);const rows=r.ok?candidateLinks(r.text,info):[];
    attempts.push({url:r.url||url,status:r.status,bytes:r.text.length,candidates:rows.length,hasData:/window\.__data\s*=/.test(r.text),hasReact:/window\.__REACT_QUERY_STATE__\s*=/.test(r.text)});
    for(const x of rows)if(!found.some(y=>y.key===x.key))found.push(x);
    if(found.some(x=>x.score>=90))break;
  }
  return{attempts,found:found.sort((a,b)=>b.score-a.score)};
}

function episodeLinks(html,season,episode){
  const wantedS=Number(season||1),wantedE=Number(episode||1),out=[];
  const re=/(?:https?:\\?\/\\?\/[^"'\s<]+)?\/tv-shows\/(\d+)\/s(\d{1,2})[-_:]?e(\d{1,3})[-_/][^"'\s<\\]*/gi;
  let m;
  while((m=re.exec(String(html||"")))&&out.length<300){
    const s=Number(m[2]),e=Number(m[3]);if(s!==wantedS||e!==wantedE)continue;
    let href=String(m[0]||"").replace(/\\\//g,"/");if(href.startsWith("/"))href="https://tubitv.com"+href;if(!/^https?:\/\//i.test(href))href="https://tubitv.com/tv-shows/"+m[1]+`/s${String(s).padStart(2,"0")}-e${String(e).padStart(2,"0")}`;
    href=href.replace(/["'<].*$/,"");if(!out.some(x=>x.id===m[1]))out.push({id:m[1],href,s,e});
  }
  return out;
}

function manifestInfo(html){
  const text=String(html||"").replace(/\\\//g,"/").replace(/\\u0026/g,"&");
  const urls=[],re=/https?:\/\/[^"'\s<]+(?:\.m3u8|\.mpd)(?:\?[^"'\s<]*)?/gi;let m;
  while((m=re.exec(text))&&urls.length<20){const u=m[0].replace(/&quot;.*$/i,"");if(!urls.includes(u))urls.push(u);}
  const types=[];for(const t of["hlsv3","hlsv6","dash","hlsv6_widevine","dash_widevine","hlsv6_playready_psshv0","hlsv6_fairplay"])if(text.toLowerCase().includes(t))types.push(t);
  const clear=urls.filter(u=>!/(widevine|playready|fairplay)/i.test(u));
  return{urls,clear,types,hasData:/window\.__data\s*=/.test(text),hasReact:/window\.__REACT_QUERY_STATE__\s*=/.test(text),drm:/widevine|playready|fairplay/i.test(text)};
}

async function getStreams(inputId,mediaType,season,episode){
  const rows=[],type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",info=await tmdbInfo(inputId,type);
  if(!info)return[diag("TMDB",`unable to resolve ${inputId}`)];
  const display=type==="movie"?`${info.title}${info.year?` (${info.year})`:""}`:`${info.title} S${String(Number(season||1)).padStart(2,"0")}E${String(Number(episode||1)).padStart(2,"0")}`;
  rows.push(diag("TMDB",`title=${info.title} • year=${info.year||"?"} • imdb=${info.imdb||"?"} • type=${type}`,display));

  const s=await searchWeb(info);
  for(const a of s.attempts)rows.push(diag("WEB SEARCH",`${a.status||"ERR"} • bytes=${a.bytes} • candidates=${a.candidates} • data=${a.hasData?"yes":"no"} • react=${a.hasReact?"yes":"no"} • ${a.url.replace(/^https?:\/\//,"")}`,display));
  if(!s.found.length){rows.push(diag("SEARCH RESULT","current Tubi web search returned no parseable title links; legacy /oz API is retired (401)",display));return rows.slice(0,16);}
  for(const c of s.found.slice(0,4))rows.push(diag("CANDIDATE",`score=${c.score} • id=${c.id} • ${c.title} • ${c.href.replace(/^https?:\/\//,"")}`,display));
  const best=s.found[0];if(best.score<70){rows.push(diag("STOP",`best title score ${best.score} is too weak`,display));return rows.slice(0,16);}

  let mediaPage=best.href,mediaId=best.id;
  if(type==="tv"){
    const show=await req(best.href);
    rows.push(diag("SERIES PAGE",`${show.status||"ERR"} • bytes=${show.text.length} • data=${/window\.__data\s*=/.test(show.text)?"yes":"no"} • react=${/window\.__REACT_QUERY_STATE__\s*=/.test(show.text)?"yes":"no"}`,display));
    if(!show.ok)return rows.slice(0,16);
    const eps=episodeLinks(show.text,season,episode);
    rows.push(diag("EPISODE MAP",eps.length?`S${season||1}E${episode||1} → id=${eps[0].id} • ${eps[0].href.replace(/^https?:\/\//,"")}`:`no S${season||1}E${episode||1} link found in series page HTML`,display));
    if(!eps.length)return rows.slice(0,16);
    mediaPage=eps[0].href;mediaId=eps[0].id;
  }

  const page=await req(mediaPage),p=manifestInfo(page.text);
  rows.push(diag("VIDEO PAGE",`${page.status||"ERR"} • id=${mediaId} • bytes=${page.text.length} • data=${p.hasData?"yes":"no"} • react=${p.hasReact?"yes":"no"}`,display));
  if(!page.ok)return rows.slice(0,16);
  rows.push(diag("RESOURCES",`manifests=${p.urls.length} • clearCandidates=${p.clear.length} • drmMarkers=${p.drm?"yes":"no"} • types=${p.types.join(",")||"none"}`,display));
  if(p.clear.length){let host="";try{host=new URL(p.clear[0]).host;}catch(_){}rows.push(diag("PLAYBACK SHAPE",`clear manifest detected • host=${host||"?"} • kind=${/\.mpd/i.test(p.clear[0])?"dash":"hls"}`,display));}
  rows.push(diag("VERDICT",p.clear.length?"current Tubi webpage exposes at least one clear HLS/DASH manifest; controlled playback probe is feasible":(p.drm?"only DRM-marked resources detected in this page snapshot":"no manifest URL detected; embedded state needs deeper parser"),display));
  return rows.slice(0,16);
}

module.exports={getStreams};
