"use strict";
const PROVIDER_NAME="AsiaFlix Test";
const BASE_URL="https://asiaflix.net";
const API_URL="https://api.asiaflix.net/v1";
const TMDB_API_KEY="1865f43a0549ca50d341dd9ab8b29f49";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147 Safari/537.36";
const API_HEADERS={"User-Agent":UA,"Accept":"application/json, text/plain, */*","X-Access-Control":"web"};
const SW_DOMAINS=["niramirus.com","medixiru.com"];
function clean(v){return String(v==null?"":v).trim();}
function short(v,n){var s=clean(v).replace(/\s+/g," "),m=n||260;return s.length>m?s.slice(0,m-1)+"…":s;}
function slug(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");}
function host(u){try{return new URL(u).hostname;}catch(_){return "unknown";}}
function diag(label,detail){return {name:PROVIDER_NAME+" • DIAG "+label+" • "+short(detail),title:short(detail),url:BASE_URL+"/favicon.ico",quality:"DIAG",language:"Unavailable",provider:PROVIDER_NAME,type:"mp4",subtitles:[]};}
async function json(url){try{var r=await fetch(url,{headers:API_HEADERS,redirect:"follow",skipSizeCheck:true});if(!r||!r.ok)return null;return await r.json();}catch(_){return null;}}
async function text(url){try{var r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,*/*","Referer":BASE_URL+"/"},redirect:"follow",skipSizeCheck:true});var body=r?await r.text():"";return {status:r?Number(r.status||0):0,body:body,finalUrl:r&&r.url?r.url:url};}catch(e){return {status:0,body:"",finalUrl:url};}}
function swId(u){var m=clean(u).match(/\/[efd]\/([a-zA-Z0-9]+)/);return m?m[1]:"";}
function allMatches(s,re,max){var out=[],m;while((m=re.exec(s))&&out.length<(max||8)){out.push(m[1]||m[0]);if(!re.global)break;}return out;}
function abs(u,b){try{return new URL(u,b).toString();}catch(_){return u;}}
function inspect(body,base){
  var title=(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";
  var scripts=allMatches(body,/<script[^>]+src=["']([^"']+)["']/ig,8).map(function(x){return abs(x,base);});
  var iframes=allMatches(body,/<iframe[^>]+src=["']([^"']+)["']/ig,6).map(function(x){return abs(x,base);});
  var forms=allMatches(body,/<form[^>]+action=["']([^"']+)["']/ig,4).map(function(x){return abs(x,base);});
  var meta=(body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']([^"']+)/i)||[])[1]||"";
  var inline=(body.match(/<script(?![^>]+src=)[^>]*>/ig)||[]).length;
  var words=["player","jwplayer","sources","file:","playlist","manifest","m3u8","fetch(","XMLHttpRequest","atob(","eval(","document.location","window.location"].filter(function(x){return body.toLowerCase().indexOf(x.toLowerCase())>=0;});
  return {title:short(title,80),scripts:scripts,iframes:iframes,forms:forms,meta:short(meta,120),inline:inline,words:words};
}
async function getStreams(inputId,mediaType,season,episode){
  var id=clean(inputId),type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",epNo=Number(episode||1);
  if(!/^\d+$/.test(id))return [diag("TMDB","numeric TMDB id required")];
  var meta=await json("https://api.themoviedb.org/3/"+type+"/"+id+"?api_key="+TMDB_API_KEY);if(!meta)return [diag("TMDB","metadata request failed")];
  var title=clean(type==="movie"?(meta.title||meta.original_title):(meta.name||meta.original_name));
  var d=await json(API_URL+"/drama/detail?slug="+encodeURIComponent(slug(title)));if(!d)return [diag("DETAIL",title+" not found")];
  var eps=Array.isArray(d.episodes)?d.episodes:[],ep=type==="movie"?eps[0]:eps.find(function(x){return Number(x&&x.number)===epNo;});if(!ep)return [diag("EPISODE",title+" E"+epNo+" not found")];
  var urls=Array.isArray(ep.streamUrls)?ep.streamUrls:[],sw=urls.find(function(x){return /streamwish/i.test(clean(x&&x.source))||/(dwish|streamwish|cybervynx|vibuxer)/i.test(clean(x&&x.url));});if(!sw)return [diag("STREAMWISH","not present")];
  var sid=swId(clean(sw.url)),out=[diag("MATCH OK",title+" • E"+epNo+" • id="+(sid||"none"))];if(!sid)return out;
  for(var i=0;i<SW_DOMAINS.length;i++){
    var u="https://"+SW_DOMAINS[i]+"/"+sid,r=await text(u),q=inspect(r.body,r.finalUrl);
    out.push(diag("SW PAGE "+(i+1),SW_DOMAINS[i]+" • HTTP "+r.status+" • body="+r.body.length+" • title="+(q.title||"none")+" • inline="+q.inline+" • words="+(q.words.join(",")||"none")));
    out.push(diag("SW LINKS "+(i+1),"scripts="+(q.scripts.map(host).join(",")||"none")+" • iframes="+(q.iframes.map(host).join(",")||"none")+" • forms="+(q.forms.map(host).join(",")||"none")+" • meta="+(q.meta||"none")));
    if(q.scripts.length)out.push(diag("SW SCRIPT URL "+(i+1),q.scripts.slice(0,3).join(" | ")));
    if(q.iframes.length)out.push(diag("SW IFRAME URL "+(i+1),q.iframes.slice(0,3).join(" | ")));
  }
  return out;
}
if(typeof module!=="undefined")module.exports={getStreams:getStreams};
