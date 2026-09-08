"use strict";

// AsiaFlix Test v0.3.1
// Stage 1 against verified-working Yuzono AsiaFlix v32: catalog + episode + host inventory only.
// Deliberately does not enter host resolvers yet, because Nuvio's native fetch can block the provider window.

const PROVIDER_NAME = "AsiaFlix Test";
const BASE_URL = "https://asiaflix.net";
const API_URL = "https://api.asiaflix.net/v1";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const API_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Access-Control": "web"
};

function clean(v){ return String(v == null ? "" : v).trim(); }
function short(v,n){ var t=clean(v).replace(/\s+/g," "),m=Number(n)||260; return t.length>m?t.slice(0,m-1)+"…":t; }
function mediaTypeOf(v){ return String(v||"tv").toLowerCase()==="movie"?"movie":"tv"; }
function normalizeTitle(v){
  var t=clean(v).toLowerCase();
  try{ t=t.normalize("NFKD").replace(/[\u0300-\u036f]/g,""); }catch(_){}
  return t.replace(/&/g," and ").replace(/\b(the|a|an)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function slugify(v){
  var t=clean(v).toLowerCase();
  try{ t=t.normalize("NFKD").replace(/[\u0300-\u036f]/g,""); }catch(_){}
  return t.replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
function hostOf(u){ try{return new URL(clean(u).replace(/^\/\//,"https://")).hostname;}catch(_){return "unknown-host";} }
function diag(label,detail){ return {name:PROVIDER_NAME+" • DIAG "+label+(detail?" • "+short(detail):""),title:clean(detail)||PROVIDER_NAME+" diagnostic",url:BASE_URL+"/favicon.ico",quality:"DIAG",language:"Unavailable",provider:PROVIDER_NAME,type:"mp4",subtitles:[]}; }

async function fetchJson(url){
  try{
    var r=await fetch(url,{headers:API_HEADERS,redirect:"follow",skipSizeCheck:true});
    if(!r)return {ok:false,status:0,data:null,error:"no response"};
    var st=Number(r.status||0); if(!r.ok)return {ok:false,status:st,data:null,error:"HTTP "+(st||"ERR")};
    return {ok:true,status:st,data:await r.json(),error:""};
  }catch(e){ return {ok:false,status:0,data:null,error:clean(e&&e.message?e.message:e)||"request error"}; }
}
async function resolveTmdbId(inputId,type){
  var raw=clean(inputId); if(/^\d+$/.test(raw))return Number(raw); if(!/^tt\d+$/i.test(raw))return null;
  var r=await fetchJson("https://api.themoviedb.org/3/find/"+encodeURIComponent(raw)+"?api_key="+TMDB_API_KEY+"&external_source=imdb_id");
  var list=type==="movie"?(r.data&&r.data.movie_results):(r.data&&r.data.tv_results);
  return Array.isArray(list)&&list[0]&&list[0].id?Number(list[0].id):null;
}
async function tmdbMeta(id,type){
  var r=await fetchJson("https://api.themoviedb.org/3/"+type+"/"+id+"?api_key="+TMDB_API_KEY+"&append_to_response=alternative_titles");
  if(!r.ok||!r.data)return null;
  var d=r.data,title=clean(type==="movie"?(d.title||d.original_title):(d.name||d.original_name)),orig=clean(type==="movie"?(d.original_title||d.title):(d.original_name||d.name));
  var aliases=[]; function add(v){v=clean(v);if(v&&aliases.indexOf(v)<0)aliases.push(v);} add(title);add(orig);
  var alt=d.alternative_titles&&(d.alternative_titles.titles||d.alternative_titles.results); if(Array.isArray(alt))alt.forEach(function(x){add(x&&(x.title||x.name));});
  return {title:title,aliases:aliases.slice(0,10)};
}
async function details(slug){ return fetchJson(API_URL+"/drama/detail?slug="+encodeURIComponent(slug)); }
async function search(q){
  var r=await fetchJson(API_URL+"/drama/search?q="+encodeURIComponent(q)+"&page=1"),rows=[];
  if(r.ok&&r.data)rows=Array.isArray(r.data.body)?r.data.body:Array.isArray(r.data.results)?r.data.results:Array.isArray(r.data)?r.data:[];
  return {ok:r.ok,rows:rows,error:r.error||""};
}
function rowSlug(row){ var s=clean(row&&row.slug); if(s)return s; var u=clean(row&&row.url),m=u.match(/\/drama\/([^/?#]+)/i); return m?decodeURIComponent(m[1]):""; }
function matchesName(obj,meta){ var n=normalizeTitle(obj&&(obj.name||obj.title)); if(!n)return false; return (meta.aliases||[]).some(function(a){return normalizeTitle(a)===n;}); }
async function findTitle(meta){
  var direct=slugify(meta.title); if(direct){var d=await details(direct); if(d.ok&&d.data&&matchesName(d.data,meta))return {ok:true,data:d.data,slug:direct,via:"direct"};}
  var s=await search(meta.title); if(!s.ok)return {ok:false,error:s.error};
  var exact=s.rows.find(function(r){var names=[r&&r.name,r&&r.title].concat(Array.isArray(r&&r.altNames)?r.altNames:[]).map(normalizeTitle);return (meta.aliases||[]).some(function(a){return names.indexOf(normalizeTitle(a))>=0;});});
  if(!exact)return {ok:false,error:"no exact match • candidates="+s.rows.length};
  var slug=rowSlug(exact)||slugify(exact.name||exact.title),d2=await details(slug); if(!d2.ok||!d2.data)return {ok:false,error:d2.error||"detail failed"};
  return {ok:true,data:d2.data,slug:slug,via:"search"};
}
function findEpisode(entry,type,e){ var eps=Array.isArray(entry&&entry.episodes)?entry.episodes:[]; if(!eps.length)return null; if(type==="movie")return eps[0]; var wanted=Number(e||1); return eps.find(function(x){return Math.abs(Number(x&&x.number)-wanted)<0.001;})||null; }
function hostList(ep){ var a=ep&&(ep.streamUrls||ep.stream_urls||ep.urls); return Array.isArray(a)?a.filter(function(x){return clean(x&&x.url);}):[]; }

async function getStreams(inputId,mediaType,season,episode){
  var type=mediaTypeOf(mediaType),s=Number(season||1),e=Number(episode||1);
  if(type==="tv"&&s!==1)return [diag("SEASON UNSUPPORTED","AsiaFlix exposes a flat episode list; requested S"+s)];
  var tmdbId=await resolveTmdbId(inputId,type); if(!tmdbId)return [diag("TMDB","Could not resolve "+inputId)];
  var meta=await tmdbMeta(tmdbId,type); if(!meta)return [diag("TMDB","Metadata unavailable for "+tmdbId)];
  var target=await findTitle(meta); if(!target.ok)return [diag("NO MATCH",meta.title+" • "+target.error)];
  var ep=findEpisode(target.data,type,e); if(!ep)return [diag("NO EPISODE",meta.title+" • E"+e+" not found")];
  var hosts=hostList(ep);
  var summary=hosts.map(function(h,i){return (i+1)+":"+(clean(h&&h.source)||"?")+"@"+hostOf(h&&h.url);}).join(" | ");
  return [
    diag("MATCH OK",meta.title+" • E"+e+" • via="+target.via+" • hosts="+hosts.length),
    diag("HOSTS",summary||"none"),
    diag("STAGE", "Catalog/episode verified. Resolver calls intentionally disabled in v0.3.1 to isolate the host that stalls Nuvio.")
  ];
}

if(typeof module!=="undefined")module.exports={getStreams:getStreams};
