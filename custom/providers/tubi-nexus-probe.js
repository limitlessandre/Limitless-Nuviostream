"use strict";

// Nexus-only Tubi feasibility probe. Diagnostic output only.
// v0.3 parses Tubi's embedded window.__data / __REACT_QUERY_STATE__ state
// instead of relying only on rendered anchor tags. No media is returned.

const PROVIDER_NAME = "Tubi Nexus Probe";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DIAG_URL = "https://tubitv.com/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function clean(v){return String(v==null?"":v).replace(/\\u0026/g,"&").replace(/\\\//g,"/").replace(/&amp;/gi,"&").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
function short(v,n){const s=clean(v),m=n||175;return s.length>m?s.slice(0,m)+"…":s;}
function diag(stage,msg,title){return{name:`${PROVIDER_NAME} • DIAG ${stage} • ${short(msg,180)}`,title:title||"Tubi feasibility probe",url:DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};}
function norm(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function slug(v){return norm(v).replace(/\s+/g,"-");}
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

function extractAssignedJson(html,marker){
  const text=String(html||"");const at=text.indexOf(marker);if(at<0)return null;
  let i=at+marker.length;while(i<text.length&&/[\s=]/.test(text[i]))i++;
  while(i<text.length&&text[i]!=="{"&&text[i]!=="[")i++;
  if(i>=text.length)return null;
  const open=text[i],close=open==="{"?"}":"]";let depth=0,inStr=false,esc=false,end=-1;
  for(let j=i;j<text.length;j++){
    const ch=text[j];if(inStr){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch==='"')inStr=false;continue;}
    if(ch==='"'){inStr=true;continue;}if(ch===open)depth++;else if(ch===close){depth--;if(depth===0){end=j+1;break;}}
  }
  if(end<0)return null;try{return JSON.parse(text.slice(i,end));}catch(_){return null;}
}
function states(html){return[extractAssignedJson(html,"window.__data"),extractAssignedJson(html,"window.__REACT_QUERY_STATE__")].filter(Boolean);}

function walk(root,fn){const stack=[root],seen=new Set();let count=0;while(stack.length&&count<12000){const v=stack.pop();if(!v||typeof v!=="object"||seen.has(v))continue;seen.add(v);count++;fn(v);if(Array.isArray(v)){for(let i=0;i<v.length;i++)stack.push(v[i]);}else{for(const k of Object.keys(v))stack.push(v[k]);}}return count;}
function objectId(o){return clean(o&&((o.id!=null&&o.id)||o.content_id||o.contentId||o.video_id||o.videoId||o.series_id||o.seriesId));}
function objectTitle(o){return clean(o&&(o.title||o.name||o.label||o.display_name||o.displayName));}
function objectYear(o){return clean(o&&(o.year||o.release_year||o.releaseYear||o.release_date||o.releaseDate)).slice(0,4);}
function objectType(o){return clean(o&&(o.type||o.content_type||o.contentType||o.kind||o.entity_type||o.entityType)).toLowerCase();}
function objectUrl(o){return clean(o&&(o.url||o.href||o.permalink||o.web_url||o.webUrl||o.path));}

function stateCandidates(html,info){
  const out=[];let scanned=0;
  for(const st of states(html))scanned+=walk(st,o=>{
    const title=objectTitle(o),id=objectId(o);if(!title||!id||!/^[0-9]+$/.test(id))return;
    const type=objectType(o),rawUrl=objectUrl(o);let isSeries=/series|show|tv/.test(type)||/\/series\//i.test(rawUrl);let isMovie=/movie|film/.test(type)||/\/movies\//i.test(rawUrl);
    if(!isSeries&&!isMovie){if(Array.isArray(o.seasons)||Array.isArray(o.children))isSeries=true;}
    if(info.type==="tv"&&!isSeries)return;if(info.type==="movie"&&!isMovie)return;
    let s=score(title,info.title);const y=objectYear(o);if(y&&info.year&&y===info.year)s+=15;if(s<45)return;
    let href=rawUrl;if(href&&href.startsWith("/"))href="https://tubitv.com"+href;if(!/^https?:\/\//i.test(href))href=info.type==="tv"?`https://tubitv.com/series/${id}/${slug(title)}`:`https://tubitv.com/movies/${id}/${slug(title)}`;
    const key=href.replace(/[?#].*$/,"").replace(/\/$/,"");const old=out.find(x=>x.id===id||x.key===key);const row={key,href:key,title,id,year:y,type:type||info.type,score:s};if(!old)out.push(row);else if(s>old.score)Object.assign(old,row);
  });
  return{rows:out.sort((a,b)=>b.score-a.score),scanned};
}

function candidateLinks(html,info){
  const out=[];const re=/<a\b[^>]*href=["']([^"']*(?:\/series\/\d+\/|\/movies\/\d+\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(String(html||"")))&&out.length<100){let href=String(m[1]||"").replace(/\\\//g,"/");if(href.startsWith("/"))href="https://tubitv.com"+href;if(!/^https?:\/\//i.test(href))continue;const isSeries=/\/series\/\d+\//i.test(href),isMovie=/\/movies\/\d+\//i.test(href);if(info.type==="tv"&&!isSeries)continue;if(info.type==="movie"&&!isMovie)continue;const title=clean(m[2])||clean(href.split("/").pop().replace(/-/g," ")),s=score(title,info.title),idm=href.match(/\/(?:series|movies)\/(\d+)\//i),id=idm?idm[1]:"";if(!id||s<45)continue;const key=href.replace(/[?#].*$/,"").replace(/\/$/,"");if(!out.some(x=>x.key===key))out.push({key,href:key,title,id,score:s,year:"",type:info.type});}
  return out.sort((a,b)=>b.score-a.score);
}

async function searchWeb(info){
  const q=encodeURIComponent(info.title),urls=[`https://tubitv.com/search/${q}`,`https://tubitv.com/search?search=${q}`,`https://www.tubitv.com/search/${q}`],attempts=[],found=[];
  for(const url of urls){const r=await req(url),anchors=r.ok?candidateLinks(r.text,info):[],state= r.ok?stateCandidates(r.text,info):{rows:[],scanned:0},rows=anchors.concat(state.rows);attempts.push({url:r.url||url,status:r.status,bytes:r.text.length,anchors:anchors.length,state:state.rows.length,scanned:state.scanned,hasData:/window\.__data\s*=/.test(r.text),hasReact:/window\.__REACT_QUERY_STATE__\s*=/.test(r.text)});for(const x of rows){const old=found.find(y=>y.id===x.id||y.key===x.key);if(!old)found.push(x);else if(x.score>old.score)Object.assign(old,x);}if(found.some(x=>x.score>=100))break;}
  return{attempts,found:found.sort((a,b)=>b.score-a.score)};
}

function episodeFromState(html,season,episode){
  const wantedS=Number(season||1),wantedE=Number(episode||1),out=[];for(const st of states(html))walk(st,o=>{
    const id=objectId(o);if(!id||!/^[0-9]+$/.test(id))return;const title=objectTitle(o);let sn=Number(o.season_number||o.seasonNumber||o.season||0),en=Number(o.episode_number||o.episodeNumber||o.episode||o.num||o.number||0);const tm=title.match(/^S(\d+):?E(\d+)\s*[-:]/i);if(tm){sn=Number(tm[1]);en=Number(tm[2]);}if(sn!==wantedS||en!==wantedE)return;let href=objectUrl(o);if(href&&href.startsWith("/"))href="https://tubitv.com"+href;if(!/^https?:\/\//i.test(href))href=`https://tubitv.com/tv-shows/${id}/${slug(title||`s${sn}-e${en}`)}`;if(!out.some(x=>x.id===id))out.push({id,href,s:sn,e:en,title});});return out;
}
function episodeLinks(html,season,episode){const state=episodeFromState(html,season,episode);if(state.length)return state;const wantedS=Number(season||1),wantedE=Number(episode||1),out=[],re=/(?:https?:\\?\/\\?\/[^"'\s<]+)?\/tv-shows\/(\d+)\/s(\d{1,2})[-_:]?e(\d{1,3})[-_/][^"'\s<\\]*/gi;let m;while((m=re.exec(String(html||"")))&&out.length<300){const s=Number(m[2]),e=Number(m[3]);if(s!==wantedS||e!==wantedE)continue;let href=String(m[0]||"").replace(/\\\//g,"/");if(href.startsWith("/"))href="https://tubitv.com"+href;if(!/^https?:\/\//i.test(href))href=`https://tubitv.com/tv-shows/${m[1]}/s${String(s).padStart(2,"0")}-e${String(e).padStart(2,"0")}`;if(!out.some(x=>x.id===m[1]))out.push({id:m[1],href,s,e,title:""});}return out;}

function manifestInfo(html){
  const text=String(html||"").replace(/\\\//g,"/").replace(/\\u0026/g,"&"),urls=[],types=[],drmUrls=[];
  function add(url,type){url=clean(url);if(!/^https?:\/\//i.test(url))return;if(!/\.m3u8|\.mpd/i.test(url))return;if(!urls.includes(url))urls.push(url);type=clean(type).toLowerCase();if(type&&!types.includes(type))types.push(type);if(/widevine|playready|fairplay/i.test(type+" "+url)&&!drmUrls.includes(url))drmUrls.push(url);}
  for(const st of states(html))walk(st,o=>{const type=objectType(o);if(o.manifest&&typeof o.manifest==="object")add(o.manifest.url,type);add(o.manifest_url,type);add(o.manifestUrl,type);if(typeof o.url==="string"&&/\.m3u8|\.mpd/i.test(o.url))add(o.url,type);});
  const re=/https?:\/\/[^"'\s<]+(?:\.m3u8|\.mpd)(?:\?[^"'\s<]*)?/gi;let m;while((m=re.exec(text))&&urls.length<40)add(m[0],"");
  const clear=urls.filter(u=>!drmUrls.includes(u));return{urls,clear,types,drmUrls,hasData:/window\.__data\s*=/.test(text),hasReact:/window\.__REACT_QUERY_STATE__\s*=/.test(text)};
}

async function getStreams(inputId,mediaType,season,episode){
  const rows=[],type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",info=await tmdbInfo(inputId,type);if(!info)return[diag("TMDB",`unable to resolve ${inputId}`)];
  const display=type==="movie"?`${info.title}${info.year?` (${info.year})`:""}`:`${info.title} S${String(Number(season||1)).padStart(2,"0")}E${String(Number(episode||1)).padStart(2,"0")}`;rows.push(diag("TMDB",`title=${info.title} • year=${info.year||"?"} • imdb=${info.imdb||"?"} • type=${type}`,display));
  const s=await searchWeb(info);for(const a of s.attempts)rows.push(diag("WEB SEARCH",`${a.status||"ERR"} • bytes=${a.bytes} • anchors=${a.anchors} • state=${a.state} • scanned=${a.scanned} • data=${a.hasData?"yes":"no"} • react=${a.hasReact?"yes":"no"}`,display));
  if(!s.found.length){rows.push(diag("SEARCH RESULT","embedded Tubi state was present but no title candidate could be mapped",display));return rows.slice(0,16);}for(const c of s.found.slice(0,4))rows.push(diag("CANDIDATE",`score=${c.score} • id=${c.id} • type=${c.type||"?"} • year=${c.year||"?"} • ${c.title}`,display));
  const best=s.found[0];if(best.score<70){rows.push(diag("STOP",`best title score ${best.score} is too weak`,display));return rows.slice(0,16);}let mediaPage=best.href,mediaId=best.id;
  if(type==="tv"){const show=await req(best.href);rows.push(diag("SERIES PAGE",`${show.status||"ERR"} • bytes=${show.text.length} • data=${/window\.__data\s*=/.test(show.text)?"yes":"no"} • react=${/window\.__REACT_QUERY_STATE__\s*=/.test(show.text)?"yes":"no"}`,display));if(!show.ok)return rows.slice(0,16);const eps=episodeLinks(show.text,season,episode);rows.push(diag("EPISODE MAP",eps.length?`S${season||1}E${episode||1} → id=${eps[0].id} • ${eps[0].title||eps[0].href.replace(/^https?:\/\//,"")}`:`no S${season||1}E${episode||1} object/link found`,display));if(!eps.length)return rows.slice(0,16);mediaPage=eps[0].href;mediaId=eps[0].id;}
  const page=await req(mediaPage),p=manifestInfo(page.text);rows.push(diag("VIDEO PAGE",`${page.status||"ERR"} • id=${mediaId} • bytes=${page.text.length} • data=${p.hasData?"yes":"no"} • react=${p.hasReact?"yes":"no"}`,display));if(!page.ok)return rows.slice(0,16);rows.push(diag("RESOURCES",`manifests=${p.urls.length} • clear=${p.clear.length} • drm=${p.drmUrls.length} • types=${p.types.join(",")||"none"}`,display));if(p.clear.length){let host="";try{host=new URL(p.clear[0]).host;}catch(_){}rows.push(diag("PLAYBACK SHAPE",`clear manifest detected • host=${host||"?"} • kind=${/\.mpd/i.test(p.clear[0])?"dash":"hls"}`,display));}rows.push(diag("VERDICT",p.clear.length?"current Tubi state exposes a clear HLS/DASH manifest; controlled playback test is feasible":(p.drmUrls.length?"only DRM-marked manifests detected":"no manifest found in embedded state"),display));return rows.slice(0,16);
}

module.exports={getStreams};
