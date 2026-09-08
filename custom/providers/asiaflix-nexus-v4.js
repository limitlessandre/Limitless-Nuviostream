"use strict";

// AsiaFlix Test v0.3.0
// Rebased on verified-working Yuzono AsiaFlix v32 behavior.
// Flow: TMDB -> AsiaFlix search/detail -> episode streamUrls -> API resolver, with direct VidMoly fallback.

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
const VIDEO_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Referer": BASE_URL + "/",
  "Origin": BASE_URL
};
const VIDMOLY_BASE = "https://vidmoly.biz";
const VIDMOLY_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
  "Referer": VIDMOLY_BASE + "/",
  "Origin": VIDMOLY_BASE
};

function clean(v){ return String(v == null ? "" : v).trim(); }
function short(v,n){ var t=clean(v).replace(/\s+/g," "),m=Number(n)||220; return t.length>m?t.slice(0,m-1)+"…":t; }
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
function inferHeight(t){ var m=clean(t).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i); return m?Number(m[1]):0; }
function tier(h){ h=Number(h||0); if(h>=2160)return "4K "+h+"p"; if(h>=1440)return "QHD "+h+"p"; if(h>=1080)return "FHD "+h+"p"; if(h>=720)return "HD "+h+"p"; if(h>=480)return "SD "+h+"p"; return h?"SD-Low "+h+"p":"Unknown Auto"; }
function diag(label,detail){ return {name:PROVIDER_NAME+" • DIAG "+label+(detail?" • "+short(detail,260):""),title:clean(detail)||PROVIDER_NAME+" diagnostic",url:BASE_URL+"/favicon.ico",quality:"DIAG",language:"Unavailable",provider:PROVIDER_NAME,type:"mp4",subtitles:[]}; }
function streamRow(label,url,height,type){
  var h=Number(height||inferHeight(url)||0);
  return {name:PROVIDER_NAME+" • "+tier(h)+" • "+label,title:PROVIDER_NAME,url:url,quality:h?h+"p":"Auto",language:"Original",headers:VIDEO_HEADERS,provider:PROVIDER_NAME,type:type||(/\.m3u8(?:$|[?#])/i.test(url)?"m3u8":"mp4"),subtitles:[]};
}

async function fetchJson(url,headers){
  try{
    var h={}; Object.keys(API_HEADERS).forEach(function(k){h[k]=API_HEADERS[k];}); headers=headers||{}; Object.keys(headers).forEach(function(k){h[k]=headers[k];});
    var r=await fetch(url,{headers:h,redirect:"follow",skipSizeCheck:true});
    if(!r)return {ok:false,status:0,data:null,error:"no response"};
    var st=Number(r.status||0); if(!r.ok)return {ok:false,status:st,data:null,error:"HTTP "+(st||"ERR")};
    return {ok:true,status:st,data:await r.json(),error:"",url:clean(r.url)||url};
  }catch(e){ return {ok:false,status:0,data:null,error:clean(e&&e.message?e.message:e)||"request error"}; }
}
async function fetchText(url,headers){
  try{
    var h={"User-Agent":USER_AGENT,"Accept":"text/html,application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*"}; headers=headers||{}; Object.keys(headers).forEach(function(k){h[k]=headers[k];});
    var r=await fetch(url,{headers:h,redirect:"follow",skipSizeCheck:true});
    if(!r)return {ok:false,status:0,text:"",error:"no response",url:url};
    var st=Number(r.status||0); if(!r.ok)return {ok:false,status:st,text:"",error:"HTTP "+(st||"ERR"),url:clean(r.url)||url};
    var txt=""; try{txt=await r.text();}catch(_){} if(txt.length>220000)txt=txt.slice(0,220000);
    return {ok:true,status:st,text:txt,error:"",url:clean(r.url)||url};
  }catch(e){ return {ok:false,status:0,text:"",error:clean(e&&e.message?e.message:e)||"request error",url:url}; }
}

async function resolveTmdbId(inputId,type){
  var raw=clean(inputId); if(/^\d+$/.test(raw))return Number(raw); if(!/^tt\d+$/i.test(raw))return null;
  var r=await fetchJson("https://api.themoviedb.org/3/find/"+encodeURIComponent(raw)+"?api_key="+TMDB_API_KEY+"&external_source=imdb_id",{});
  var list=type==="movie"?(r.data&&r.data.movie_results):(r.data&&r.data.tv_results);
  return Array.isArray(list)&&list[0]&&list[0].id?Number(list[0].id):null;
}
async function tmdbMeta(id,type){
  var r=await fetchJson("https://api.themoviedb.org/3/"+type+"/"+id+"?api_key="+TMDB_API_KEY+"&append_to_response=alternative_titles",{});
  if(!r.ok||!r.data)return null;
  var d=r.data,title=clean(type==="movie"?(d.title||d.original_title):(d.name||d.original_name)),orig=clean(type==="movie"?(d.original_title||d.title):(d.original_name||d.name));
  var aliases=[]; function add(v){v=clean(v);if(v&&aliases.indexOf(v)<0)aliases.push(v);} add(title);add(orig);
  var alt=d.alternative_titles&&(d.alternative_titles.titles||d.alternative_titles.results); if(Array.isArray(alt))alt.forEach(function(x){add(x&&(x.title||x.name));});
  return {title:title,aliases:aliases.slice(0,10)};
}
async function details(slug){ return fetchJson(API_URL+"/drama/detail?slug="+encodeURIComponent(slug),{}); }
async function search(q){
  var r=await fetchJson(API_URL+"/drama/search?q="+encodeURIComponent(q)+"&page=1",{}),rows=[];
  if(r.ok&&r.data){ rows=Array.isArray(r.data.body)?r.data.body:Array.isArray(r.data.results)?r.data.results:Array.isArray(r.data)?r.data:[]; }
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

function base64Encode(value){
  var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",text=unescape(encodeURIComponent(String(value||""))),out="";
  for(var i=0;i<text.length;i+=3){var a=text.charCodeAt(i),b=i+1<text.length?text.charCodeAt(i+1):NaN,c=i+2<text.length?text.charCodeAt(i+2):NaN,n=(a<<16)|((isNaN(b)?0:b)<<8)|(isNaN(c)?0:c);out+=chars[(n>>18)&63]+chars[(n>>12)&63]+(isNaN(b)?"=":chars[(n>>6)&63])+(isNaN(c)?"=":chars[n&63]);}
  return out;
}
async function apiResolve(host){
  var source=clean(host&&host.source)||"Server",u=clean(host&&host.url); if(!u)return {source:source,files:[],error:"empty url"};
  var endpoint=API_URL+"/drama/get-stream-url?value="+encodeURIComponent(base64Encode(u))+"&server="+encodeURIComponent(source.toLowerCase());
  var r=await fetchJson(endpoint,{}),files=[];
  if(r.ok&&r.data&&Array.isArray(r.data.sources))files=r.data.sources.map(function(f){return {url:clean(f&&f.url),isM3U8:Boolean(f&&f.isM3U8)};}).filter(function(f){return f.url;});
  return {source:source,files:files,error:r.ok?(files.length?"":"no sources"):r.error};
}

function resolveUrl(base,u){ try{return new URL(u,base).toString();}catch(_){return u;} }
function parseMaster(text,base){
  var lines=String(text||"").split(/\r?\n/),out=[];
  for(var i=0;i<lines.length;i++)if(/^#EXT-X-STREAM-INF:/i.test(lines[i])){var info=lines[i],u="";for(var j=i+1;j<lines.length;j++){var q=clean(lines[j]);if(!q)continue;if(q[0]!=="#"){u=resolveUrl(base,q);break;}}if(u){var m=info.match(/RESOLUTION=\d+x(\d+)/i),h=m?Number(m[1]):inferHeight(info);out.push({url:u,height:h});}}
  out.sort(function(a,b){return b.height-a.height;}); return out;
}
async function expandHls(label,url,headers){
  var r=await fetchText(url,headers); if(!r.ok)return [];
  if(String(r.text||"").indexOf("#EXTM3U")<0)return [];
  var variants=parseMaster(r.text,r.url||url); if(!variants.length)return [streamRow(label,r.url||url,inferHeight(label),"m3u8")];
  return variants.map(function(v){return streamRow(label,v.url,v.height,"m3u8");});
}
async function extractVidmoly(host){
  var original=clean(host&&host.url),source=clean(host&&host.source)||"VidMoly"; if(!original)return [];
  var fixed=original; try{var x=new URL(original);fixed=VIDMOLY_BASE+x.pathname+x.search;}catch(_){}
  var page=await fetchText(fixed,VIDMOLY_HEADERS); if(!page.ok)return [];
  var sm=page.text.match(/sources\s*:\s*(.+?]),/is); if(!sm)return [];
  var urls=[],re=/file\s*:\s*["'](.+?)["']/g,m; while((m=re.exec(sm[1]))!==null)if(m[1])urls.push(m[1]);
  var out=[]; for(var i=0;i<urls.length;i++){var rows=await expandHls(source+" • VidMoly",urls[i],VIDMOLY_HEADERS);out=out.concat(rows);} return out;
}

async function getStreams(inputId,mediaType,season,episode){
  var type=mediaTypeOf(mediaType),s=Number(season||1),e=Number(episode||1),out=[];
  if(type==="tv"&&s!==1)return [diag("SEASON UNSUPPORTED","AsiaFlix exposes a flat episode list; requested S"+s)];
  var tmdbId=await resolveTmdbId(inputId,type); if(!tmdbId)return [diag("TMDB","Could not resolve "+inputId)];
  var meta=await tmdbMeta(tmdbId,type); if(!meta)return [diag("TMDB","Metadata unavailable for "+tmdbId)];
  var target=await findTitle(meta); if(!target.ok)return [diag("NO MATCH",meta.title+" • "+target.error)];
  var ep=findEpisode(target.data,type,e); if(!ep)return [diag("NO EPISODE",meta.title+" • E"+e+" not found")];
  var hosts=hostList(ep),summary=hosts.slice(0,8).map(function(h){return (clean(h&&h.source)||"?")+"@"+hostOf(h&&h.url);}).join(" | ");
  out.push(diag("MATCH OK",meta.title+" • E"+e+" • via="+target.via+" • hosts="+hosts.length));
  out.push(diag("HOSTS",summary||"none"));

  // Upstream v32 explicitly bypasses the API resolver for VidMoly because it 500s there.
  var vidmoly=hosts.filter(function(h){return /vidmoly/i.test(clean(h&&h.url));});
  for(var vm=0;vm<vidmoly.length;vm++){
    var vr=await extractVidmoly(vidmoly[vm]); if(vr.length)return out.concat(vr);
  }

  // Mirror upstream behavior for API-supported hosts. Keep this initial port conservative: first two hosts only.
  var attempted=0,errors=[];
  for(var i=0;i<hosts.length&&attempted<2;i++){
    var h=hosts[i]; if(/vidmoly/i.test(clean(h&&h.url)))continue; attempted++;
    var rr=await apiResolve(h); if(rr.files.length){
      for(var f=0;f<rr.files.length;f++){
        var file=rr.files[f],label=rr.source;
        if(file.isM3U8||/\.m3u8(?:$|[?#])/i.test(file.url)){var rows=await expandHls(label,file.url,VIDEO_HEADERS);out=out.concat(rows.length?rows:[streamRow(label,file.url,0,"m3u8")]);}
        else out.push(streamRow(label,file.url,0,"mp4"));
      }
    }else errors.push(rr.source+"="+rr.error);
  }
  if(out.some(function(x){return x.quality!=="DIAG";}))return out;
  out.push(diag("NO STREAM","attempted="+attempted+(errors.length?" • "+errors.join(" | "):"")));
  return out;
}

if(typeof module!=="undefined")module.exports={getStreams:getStreams};
