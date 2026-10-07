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
async function apiText(url){try{var r=await fetch(url,{headers:API_HEADERS,redirect:"follow",skipSizeCheck:true});var body=r?await r.text():"";return {status:r?Number(r.status||0):0,body:body,finalUrl:r&&r.url?r.url:url};}catch(e){return {status:0,body:"",finalUrl:url};}}
function b64(v){try{if(typeof btoa==="function")return btoa(v);}catch(_){}var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",s=String(v),out="",i=0;while(i<s.length){var a=s.charCodeAt(i++)&255,b=i<s.length?s.charCodeAt(i++)&255:NaN,d=i<s.length?s.charCodeAt(i++)&255:NaN;out+=chars[a>>2]+chars[((a&3)<<4)|(b>>4)]+(isNaN(b)?"=":chars[((b&15)<<2)|(d>>6)])+(isNaN(d)?"=":chars[d&63]);}return out;}
async function text(url){try{var r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,*/*","Referer":BASE_URL+"/"},redirect:"follow",skipSizeCheck:true});var body=r?await r.text():"";return {status:r?Number(r.status||0):0,body:body,finalUrl:r&&r.url?r.url:url};}catch(e){return {status:0,body:"",finalUrl:url};}}
function swId(u){var m=clean(u).match(/\/[efd]\/([a-zA-Z0-9]+)/);return m?m[1]:"";}
function allMatches(s,re,max){var out=[],m;while((m=re.exec(s))&&out.length<(max||8)){out.push(m[1]||m[0]);if(!re.global)break;}return out;}
function abs(u,b){try{return new URL(u,b).toString();}catch(_){return u;}}
function swDeep(body,base){var low=body.toLowerCase(),idx=low.indexOf("manifest"),ctx=idx>=0?body.slice(Math.max(0,idx-260),Math.min(body.length,idx+620)):"";var urls=allMatches(body,/(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/ig,4);var rel=allMatches(body,/(\/stream\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/ig,4).map(function(x){return abs(x,base);});var packed=/eval\(function\(p,a,c,k,e,[dr]\)/i.test(body);return {packed:packed,urls:urls.concat(rel),ctx:short(ctx,760)};}
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
  var sid=swId(clean(sw.url)),out=[diag("MATCH OK",title+" • E"+epNo+" • id="+(sid||"none"))];
  var resolver=API_URL+"/drama/get-stream-url?value="+encodeURIComponent(b64(clean(sw.url)))+"&server="+encodeURIComponent(clean(sw.source||"streamwish").toLowerCase());
  var ar=await apiText(resolver),aj=null;try{aj=JSON.parse(ar.body);}catch(_){}
  var sources=aj&&Array.isArray(aj.sources)?aj.sources:[];
  out.push(diag("API RESOLVER","HTTP "+ar.status+" • source="+clean(sw.source||"streamwish")+" • sources="+sources.length+" • body="+short(ar.body,180)));
  for(var z=0;z<sources.length&&z<4;z++){var sf=sources[z]||{};out.push(diag("API SOURCE "+(z+1),"host="+host(sf.url)+" • m3u8="+String(!!sf.isM3U8)+" • url="+short(sf.url,180)));}
  if(!sid)return out;
  for(var i=0;i<SW_DOMAINS.length;i++){
    var u="https://"+SW_DOMAINS[i]+"/"+sid,r=await text(u),q=inspect(r.body,r.finalUrl);
    var deep=swDeep(r.body,r.finalUrl);out.push(diag("SW PAGE "+(i+1),SW_DOMAINS[i]+" • HTTP "+r.status+" • body="+r.body.length+" • title="+(q.title||"none")+" • inline="+q.inline+" • packed="+deep.packed+" • m3u8="+deep.urls.length+" • words="+(q.words.join(",")||"none")));if(deep.urls.length)out.push(diag("SW M3U8 "+(i+1),deep.urls.slice(0,3).join(" | ")));if(deep.ctx)out.push(diag("SW MANIFEST CTX "+(i+1),deep.ctx));
    out.push(diag("SW LINKS "+(i+1),"scripts="+(q.scripts.map(host).join(",")||"none")+" • iframes="+(q.iframes.map(host).join(",")||"none")+" • forms="+(q.forms.map(host).join(",")||"none")+" • meta="+(q.meta||"none")));
    if(q.scripts.length){out.push(diag("SW SCRIPT URL "+(i+1),q.scripts.slice(0,3).join(" | ")));for(var j=0;j<q.scripts.length&&j<3;j++){var sr=await text(q.scripts[j]),sb=sr.body||"",keys=["ajax","fetch(","XMLHttpRequest","manifest","m3u8","player","source","file","xupload"].filter(function(k){return sb.toLowerCase().indexOf(k.toLowerCase())>=0;}),hits=[];var patterns=[/url\s*[:=]\s*["']([^"']+)["']/ig,/fetch\(\s*["']([^"']+)["']/ig,/ajax[^\n]{0,180}/ig,/manifest[^\n]{0,220}/ig];for(var p=0;p<patterns.length;p++){var mm;while((mm=patterns[p].exec(sb))&&hits.length<6)hits.push(short(mm[1]||mm[0],220));}var focus=[];["ajax_find_copies","xupload","player","file","source"].forEach(function(k){var pos=sb.toLowerCase().indexOf(k.toLowerCase());if(pos>=0)focus.push(k+"=>"+short(sb.slice(Math.max(0,pos-420),Math.min(sb.length,pos+900)),1100));});out.push(diag("SW JS "+(i+1)+"."+(j+1),host(q.scripts[j])+" • HTTP "+sr.status+" • body="+sb.length+" • keys="+(keys.join(",")||"none")+" • hits="+(hits.join(" | ")||"none")));if(focus.length)out.push(diag("SW JS CTX "+(i+1)+"."+(j+1),focus.join(" || ")));if(/xupload\.js/i.test(q.scripts[j])){var af=sb.indexOf("ajax_find_copies");if(af>=0)out.push(diag("SW AJAX COPIES "+(i+1),short(sb.slice(Math.max(0,af-1200),Math.min(sb.length,af+5200)),6200)));var ps=sb.indexOf("player_start");if(ps>=0)out.push(diag("SW PLAYER START "+(i+1),short(sb.slice(Math.max(0,ps-1200),Math.min(sb.length,ps+4200)),5200)));var funcs=[];["function ajax_find_copies","ajax_find_copies =","ajax_find_copies=","function setFormAction","setFormAction =","setFormAction="].forEach(function(k){var pos=sb.indexOf(k);if(pos>=0)funcs.push(k+"=>"+short(sb.slice(pos,Math.min(sb.length,pos+2400)),2300));});var lits=[],re=/(?:ajax|player|embed|download|stream)[A-Za-z0-9_./?=&-]{0,100}/ig,rm;while((rm=re.exec(sb))&&lits.length<30)lits.push(rm[0]);out.push(diag("SW XUPLOAD FUNC "+(i+1),funcs.length?funcs.join(" || "):"none"));out.push(diag("SW XUPLOAD TOKENS "+(i+1),lits.length?lits.join(" | "):"none"));}}}
    if(q.iframes.length)out.push(diag("SW IFRAME URL "+(i+1),q.iframes.slice(0,3).join(" | ")));
  }
  return out;
}
if(typeof module!=="undefined")module.exports={getStreams:getStreams};
