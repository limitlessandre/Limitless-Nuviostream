"use strict";

// 1Shows Nexus probe v0.1.10
// Recovers encrypted Vidrock blobs recursively per top-level server and follows
// JSON/JS wrapper responses until a validated HLS/direct media URL is found.

const PROVIDER_NAME="1Shows Test";
const SITE_BASE="https://www.1shows.org";
const TMDB_API_KEY="1865f43a0549ca50d341dd9ab8b29f49";
const VIDZEE_API="https://core.vidzee.wtf";
const VIDZEE_ORIGIN="https://player.vidzee.wtf";
const VIDROCK_BASE="https://vidrock.ru";
const USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const VIDZEE_RC4_KEY_HEX="e4f9b27d8c1a6ef5037db98ac54e21f0b9d6c3a781fe42ad65c0e9b73f148a2d";
const VIDROCK_AES_KEY_HEX="7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
const VIDZEE_SERVERS=["ipcloud","v6:Hindi","dcloud","tik"];

function clean(v){return String(v==null?"":v).trim();}
function short(v,n){var t=clean(v).replace(/\s+/g," "),m=Number(n)||205;return t.length>m?t.slice(0,m-1)+"…":t;}
function mediaTypeOf(v){return String(v||"tv").toLowerCase()==="movie"?"movie":"tv";}
function hostOf(u){try{return new URL(u).hostname;}catch(_){return "unknown-host";}}
function inferHeight(t){var m=clean(t).match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?:[^0-9]|$)/i);return m?Number(m[1]):0;}
function tier(h){h=Number(h||0);if(h>=2160)return "4K "+h+"p";if(h>=1440)return "Enhanced QHD "+h+"p";if(h>=1080)return "FHD "+h+"p";if(h>=720)return "HD "+h+"p";if(h>=480)return "SD "+h+"p";return h?"SD-Low "+h+"p":"Unknown Auto";}
function diag(label,detail){return {name:PROVIDER_NAME+" • DIAG "+label+(detail?" • "+short(detail,205):""),title:clean(detail)||PROVIDER_NAME+" diagnostic",url:SITE_BASE+"/favicon.ico",quality:"DIAG",language:"Unavailable",provider:PROVIDER_NAME,type:"mp4",subtitles:[]};}
function pathFor(id,type,s,e){return type==="tv"?"tv/"+id+"/"+s+"/"+e:"movie/"+id;}

async function fetchJson(url,headers){
  try{
    var h={"User-Agent":USER_AGENT,"Accept":"application/json,text/plain,*/*"};
    headers=headers||{};Object.keys(headers).forEach(function(k){h[k]=headers[k];});
    var r=await fetch(url,{headers:h,redirect:"follow",skipSizeCheck:true});
    if(!r)return {ok:false,status:0,data:null,error:"no response"};
    var status=Number(r.status||0);if(!r.ok)return {ok:false,status:status,data:null,error:"HTTP "+(status||"ERR")};
    return {ok:true,status:status,data:await r.json(),error:""};
  }catch(e){return {ok:false,status:0,data:null,error:clean(e&&e.message?e.message:e)||"request error"};}
}
async function fetchText(url,headers){
  try{
    var h={"User-Agent":USER_AGENT,"Accept":"application/json,application/vnd.apple.mpegurl,application/x-mpegURL,text/javascript,application/javascript,text/plain,video/*,*/*"};
    headers=headers||{};Object.keys(headers).forEach(function(k){h[k]=headers[k];});
    var r=await fetch(url,{headers:h,redirect:"follow",skipSizeCheck:true});
    if(!r)return {ok:false,status:0,error:"no response",url:clean(url),contentType:"",text:""};
    var status=Number(r.status||0),ct="";try{ct=clean(r.headers&&r.headers.get?r.headers.get("content-type"):"");}catch(_){}
    var finalUrl=clean(r.url)||clean(url);if(!r.ok)return {ok:false,status:status,error:"HTTP "+(status||"ERR"),url:finalUrl,contentType:ct,text:""};
    var text="";try{text=await r.text();}catch(e){return {ok:false,status:status,error:"body read failed",url:finalUrl,contentType:ct,text:""};}
    if(text.length>180000)text=text.slice(0,180000);
    return {ok:true,status:status,error:"",url:finalUrl,contentType:ct,text:text};
  }catch(e){return {ok:false,status:0,error:clean(e&&e.message?e.message:e)||"transport error",url:clean(url),contentType:"",text:""};}
}

async function resolveTmdbId(inputId,type){
  var raw=clean(inputId);if(/^\d+$/.test(raw))return Number(raw);if(!/^tt\d+$/i.test(raw))return null;
  var r=await fetchJson("https://api.themoviedb.org/3/find/"+encodeURIComponent(raw)+"?api_key="+TMDB_API_KEY+"&external_source=imdb_id",{});
  var rows=type==="movie"?(r.data&&r.data.movie_results):(r.data&&r.data.tv_results);
  return Array.isArray(rows)&&rows[0]&&rows[0].id?Number(rows[0].id):null;
}

function hexToBytes(hex){var out=[],t=clean(hex).replace(/[^0-9a-f]/gi,"");for(var i=0;i+1<t.length;i+=2)out.push(parseInt(t.slice(i,i+2),16));return out;}
function base64ToBytes(value){var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",text=clean(value).replace(/-/g,"+").replace(/_/g,"/").replace(/[^A-Za-z0-9+/=]/g,""),out=[],buffer=0,bits=0;for(var i=0;i<text.length;i++){var ch=text[i];if(ch==="=")break;var idx=chars.indexOf(ch);if(idx<0)continue;buffer=(buffer<<6)|idx;bits+=6;if(bits>=8){bits-=8;out.push((buffer>>bits)&255);}}return out;}
function utf8Decode(bytes){var escaped="";for(var i=0;i<bytes.length;i++)escaped+="%"+Number(bytes[i]&255).toString(16).padStart(2,"0");try{return decodeURIComponent(escaped);}catch(_){return String.fromCharCode.apply(null,bytes);}}
function rc4Drop2048(keyBytes,dataBytes){var s=[],j=0,i;for(i=0;i<256;i++)s[i]=i;for(i=0;i<256;i++){j=(j+s[i]+keyBytes[i%keyBytes.length])&255;var t=s[i];s[i]=s[j];s[j]=t;}i=0;j=0;for(var d=0;d<2048;d++){i=(i+1)&255;j=(j+s[i])&255;var t2=s[i];s[i]=s[j];s[j]=t2;}var out=[];for(var k=0;k<dataBytes.length;k++){i=(i+1)&255;j=(j+s[i])&255;var t3=s[i];s[i]=s[j];s[j]=t3;out[k]=(dataBytes[k]^s[(s[i]+s[j])&255])&255;}return out;}
function decryptVidzee(blob){try{var p=JSON.parse(utf8Decode(rc4Drop2048(hexToBytes(VIDZEE_RC4_KEY_HEX),base64ToBytes(blob))));return p&&typeof p==="object"?p:null;}catch(_){return null;}}
function normalizeUrl(text){var raw=clean(text).replace(/\\\//g,"/");if(/^https?:\/\//i.test(raw))return raw;if(/^\/\//.test(raw))return "https:"+raw;try{var p=JSON.parse(raw);if(typeof p==="string")return normalizeUrl(p);if(p&&typeof p==="object"){var keys=["url","file","source","src","link","stream","playlist","manifest","data"];for(var i=0;i<keys.length;i++){var u=normalizeUrl(p[keys[i]]);if(u)return u;}}}catch(_){}var m=raw.match(/https?:\/\/[^\s"'`\\]+/i);return m?clean(m[0]):"";}
async function decryptVidrock(blob){try{if(typeof crypto==="undefined"||!crypto.subtle||typeof Uint8Array==="undefined")return {ok:false,error:"crypto unavailable"};var data=base64ToBytes(blob);if(data.length<29)return {ok:false,error:"ciphertext too short"};var iv=new Uint8Array(data.slice(0,12)),ct=new Uint8Array(data.slice(12)),kb=new Uint8Array(hexToBytes(VIDROCK_AES_KEY_HEX));var key=await crypto.subtle.importKey("raw",kb,{name:"AES-GCM"},false,["decrypt"]);var plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:iv,tagLength:128},key,ct);var bytes=new Uint8Array(plain);var text=typeof TextDecoder!=="undefined"?new TextDecoder().decode(bytes):utf8Decode(Array.prototype.slice.call(bytes));return {ok:true,url:normalizeUrl(text),preview:short(text,80)};}catch(e){return {ok:false,error:clean(e&&e.message?e.message:e)||"decrypt failed"};}}

function responseShape(data){if(Array.isArray(data))return "array["+data.length+"]";if(data&&typeof data==="object")return "object{"+Object.keys(data).slice(0,8).join(",")+"}";return typeof data+":"+short(data,60);}
function isCipherCandidate(v){var t=clean(v);return t.length>=24&&!/^https?:\/\//i.test(t)&&/^[A-Za-z0-9+/_=-]+$/.test(t);}
function collectServerCandidates(node,depth,out){
  if(depth>5||node==null)return;
  if(typeof node==="string"){
    var t=clean(node);if(isCipherCandidate(t))out.push(t);else if((t[0]==="{"||t[0]==="[")&&t.length<120000){try{collectServerCandidates(JSON.parse(t),depth+1,out);}catch(_){}}
    return;
  }
  if(Array.isArray(node)){for(var i=0;i<node.length;i++)collectServerCandidates(node[i],depth+1,out);return;}
  if(typeof node==="object"){
    var preferred=["url","encrypted","cipher","ciphertext","value","source","src","file","stream","payload","token","data"];
    var seenKeys={};
    for(var p=0;p<preferred.length;p++){var k=preferred[p];if(Object.prototype.hasOwnProperty.call(node,k)){seenKeys[k]=1;collectServerCandidates(node[k],depth+1,out);}}
    var keys=Object.keys(node);for(var j=0;j<keys.length;j++){var kk=keys[j];if(!seenKeys[kk])collectServerCandidates(node[kk],depth+1,out);}
  }
}
function collectVidrockEntries(data){
  var out=[],seen={};
  if(data&&typeof data==="object"&&!Array.isArray(data)){
    var servers=Object.keys(data);
    for(var i=0;i<servers.length;i++){
      var name=servers[i],list=[];collectServerCandidates(data[name],0,list);
      for(var j=0;j<list.length;j++){
        var blob=clean(list[j]);if(seen[name+"|"+blob])continue;seen[name+"|"+blob]=1;
        out.push({name:name,blob:blob,language:clean(data[name]&&data[name].language)||"Auto",candidate:j+1});
      }
    }
  } else {
    var root=[];collectServerCandidates(data,0,root);for(var r=0;r<root.length;r++)out.push({name:"server"+(r+1),blob:root[r],language:"Auto",candidate:1});
  }
  return out;
}

function resolveUrl(base,rel){try{return new URL(clean(rel),clean(base)).toString();}catch(_){return clean(rel);}}
function parseMaster(text,base){var lines=String(text||"").split(/\r?\n/),out=[];for(var i=0;i<lines.length;i++){var line=clean(lines[i]);if(!/^#EXT-X-STREAM-INF:/i.test(line))continue;var attrs=line.slice(line.indexOf(":")+1),uri="";for(var j=i+1;j<lines.length;j++){var n=clean(lines[j]);if(!n||n[0]==="#")continue;uri=n;break;}if(!uri)continue;var r=attrs.match(/RESOLUTION=\d+x(\d+)/i),b=attrs.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);out.push({url:resolveUrl(base,uri),height:r?Number(r[1]):inferHeight(uri),bandwidth:b?Number(b[1]):0});}out.sort(function(a,b){return (b.height-a.height)||(b.bandwidth-a.bandwidth);});return out;}
function collectHttpUrls(node,base,out,path,depth){
  if(depth>5||node==null)return;
  if(typeof node==="string"){
    var raw=String(node).replace(/\\\//g,"/");var m=raw.match(/https?:\/\/[^\s"'`<>]+/gi)||[];for(var i=0;i<m.length;i++)out.push({url:clean(m[i]),path:path});if(/^\/\//.test(clean(raw)))out.push({url:"https:"+clean(raw),path:path});return;
  }
  if(Array.isArray(node)){for(var a=0;a<node.length;a++)collectHttpUrls(node[a],base,out,path+"["+a+"]",depth+1);return;}
  if(typeof node==="object"){var keys=Object.keys(node);for(var j=0;j<keys.length;j++){var k=keys[j];collectHttpUrls(node[k],base,out,path?path+"."+k:k,depth+1);}}
}
function extractUrls(text,base){
  var out=[],seen={},raw=String(text||"").replace(/\\\//g,"/");
  var re=/https?:\/\/[^\s"'`<>]+/gi,m;while((m=re.exec(raw))!==null)out.push({url:clean(m[0]),path:"text"});
  try{collectHttpUrls(JSON.parse(raw),base,out,"json",0);}catch(_){}
  var dedup=[];for(var i=0;i<out.length;i++){var u=out[i].url.replace(/["'`;,)\]]+$/g,"");if(/^\/\//.test(u))u="https:"+u;if(!/^https?:\/\//i.test(u)||seen[u])continue;seen[u]=1;var score=0;if(/\.m3u8(?:$|[?#])/i.test(u))score+=100;if(/\.mp4(?:$|[?#])/i.test(u))score+=90;if(/stream|playlist|source|file|manifest|url/i.test(out[i].path||""))score+=25;if(/stream|cdn|media|video/i.test(u))score+=10;dedup.push({url:u,path:out[i].path||"",score:score});}
  dedup.sort(function(a,b){return b.score-a.score;});return dedup;
}
async function resolveTransport(server,url,referer,depth,visited,chain){
  if(depth>3)return {ok:false,diag:server+" • "+chain+" depth-limit • host="+hostOf(url)};
  visited=visited||{};if(visited[url])return {ok:false,diag:server+" • loop • host="+hostOf(url)};visited[url]=1;
  var first=await fetchText(url,{"User-Agent":USER_AGENT,"Referer":referer||VIDROCK_BASE+"/"});
  if(!first.ok)return {ok:false,diag:server+" • "+chain+" "+first.error+" • host="+hostOf(first.url)};
  var ct=clean(first.contentType),txt=String(first.text||"");
  if(/^#EXTM3U/i.test(txt)||/mpegurl|m3u8/i.test(ct)||/\.m3u8(?:$|[?#])/i.test(first.url)){
    var vars=parseMaster(txt,first.url),pick=vars[0]||{url:first.url,height:inferHeight(first.url)};
    return {ok:true,url:pick.url,height:pick.height||inferHeight(pick.url),referer:first.url,diag:server+" • "+chain+"→HLS"+(vars.length?" MASTER "+vars.length:"")+" • host="+hostOf(first.url)};
  }
  if(/\.mp4(?:$|[?#])/i.test(first.url)||/^video\//i.test(ct))return {ok:true,url:first.url,height:inferHeight(first.url),referer:referer,diag:server+" • "+chain+"→DIRECT • host="+hostOf(first.url)};
  var candidates=extractUrls(txt,first.url);
  for(var i=0;i<candidates.length&&i<5;i++){
    var next=candidates[i].url;if(next===first.url||visited[next])continue;
    var nested=await resolveTransport(server,next,first.url,depth+1,visited,chain+(/json/i.test(ct)||/^\s*[\[{]/.test(txt)?"→JSON":"→WRAP"));
    if(nested.ok)return nested;
  }
  return {ok:false,diag:server+" • "+chain+" • HTTP "+first.status+" • "+(ct||"unknown")+" • host="+hostOf(first.url)+" • urls="+candidates.length+" • preview="+short(txt,86)};
}

async function catalogProbe(id,type,s,e){if(type==="movie")return {result:await fetchJson(SITE_BASE+"/api/movie/"+id,{"Referer":SITE_BASE+"/"}),episodes:[],selected:null};var r=await fetchJson(SITE_BASE+"/api/tv/"+id+"/season/"+s,{"Referer":SITE_BASE+"/"}),eps=r.ok&&r.data&&Array.isArray(r.data.episodes)?r.data.episodes:[];return {result:r,episodes:eps,selected:eps.find(function(ep){return Number(ep&&ep.episode_number)===Number(e);})||null};}
async function vidzeeProbe(id,type,s,e,server){var r=await fetchJson(VIDZEE_API+"/streams/"+pathFor(id,type,s,e)+"?s="+encodeURIComponent(server)+"&e=1",{"Referer":VIDZEE_ORIGIN+"/","Origin":VIDZEE_ORIGIN});if(!r.ok)return {server:server,ok:false,error:r.error};var blob=clean(r.data&&r.data.c),d=blob?decryptVidzee(blob):null,u=clean(d&&d.url);return /^https?:\/\//i.test(u)?{server:server,ok:true,url:u,language:clean(d&&d.language)||"Auto"}:{server:server,ok:false,error:d?"decoded-no-url":"decrypt-failed"};}
async function vidrockProbe(id,type,s,e){
  var r=await fetchJson(VIDROCK_BASE+"/api/"+pathFor(id,type,s,e),{"Referer":VIDROCK_BASE+"/","Origin":VIDROCK_BASE});
  if(!r.ok)return {ok:false,error:r.error,shape:"",serverCount:0,entries:[],streams:[],errors:[]};
  var entries=collectVidrockEntries(r.data),streams=[],errors=[],serverDone={},topKeys=r.data&&typeof r.data==="object"&&!Array.isArray(r.data)?Object.keys(r.data):[];
  for(var i=0;i<entries.length&&i<24;i++){
    var x=entries[i];if(serverDone[x.name])continue;var dec=await decryptVidrock(x.blob);
    if(dec.ok&&/^https?:\/\//i.test(clean(dec.url))){serverDone[x.name]=1;streams.push({server:x.name,url:clean(dec.url),language:x.language});}
    else if(errors.length<8)errors.push(x.name+"#"+x.candidate+"="+(dec.error||"no-url"));
  }
  return {ok:true,error:"",shape:responseShape(r.data),serverCount:topKeys.length,entries:entries,streams:streams,errors:errors};
}
function streamRow(id,type,s,e,label,url,language,height,referer){var h=height||inferHeight(url);return {name:PROVIDER_NAME+" • "+tier(h)+" • "+label,title:"TMDB "+id+(type==="tv"?" • S"+s+"E"+e:" • Movie"),url:url,quality:h?h+"p":"Auto",language:language||"Auto",headers:{"User-Agent":USER_AGENT,"Referer":referer||VIDROCK_BASE+"/"},provider:PROVIDER_NAME,type:/\.mp4(?:$|[?#])/i.test(url)?"mp4":"m3u8",subtitles:[]};}

async function getStreams(inputId,mediaType,season,episode){
  var type=mediaTypeOf(mediaType),s=Number(season||1),e=Number(episode||1),id=await resolveTmdbId(inputId,type);if(!id)return [diag("TMDB FAILED","input="+inputId+" • type="+type)];
  var results=await Promise.all([catalogProbe(id,type,s,e),Promise.all(VIDZEE_SERVERS.map(function(x){return vidzeeProbe(id,type,s,e,x);})),vidrockProbe(id,type,s,e)]),catalog=results[0],vidzee=results[1],vidrock=results[2],rows=[],seen={};
  var c=catalog.result;rows.push(c&&c.ok?diag("CATALOG OK","TMDB "+id+(type==="tv"?" • S"+s+" • episodes="+catalog.episodes.length+(catalog.selected?" • E"+e+"="+(clean(catalog.selected.name)||"found"):" • E"+e+"=missing"):" • movie")):diag("CATALOG FAIL","TMDB "+id+" • "+(c?c.error:"no response")));
  var vzOk=0,vzFail=[];for(var i=0;i<vidzee.length;i++){var p=vidzee[i];if(!p.ok){vzFail.push(p.server+"="+p.error);continue;}vzOk++;if(!seen[p.url]){seen[p.url]=1;rows.unshift(streamRow(id,type,s,e,"VidZee "+p.server,p.url,p.language,inferHeight(p.url),VIDZEE_ORIGIN+"/"));}}
  rows.push(diag("VIDZEE","servers="+vzOk+"/"+VIDZEE_SERVERS.length+(vzFail.length?" • "+vzFail.join(" • "):"")));
  var vrValidated=0;
  if(!vidrock.ok)rows.push(diag("VIDROCK FAIL",vidrock.error));
  else{
    rows.push(diag("VIDROCK API","HTTP 200 • shape="+vidrock.shape+" • servers="+vidrock.serverCount+" • candidates="+vidrock.entries.length+" • decrypted="+vidrock.streams.length+(vidrock.errors.length?" • "+vidrock.errors.join(" | "):"")));
    for(var j=0;j<vidrock.streams.length;j++){
      var vp=vidrock.streams[j],val=await resolveTransport(vp.server,vp.url,VIDROCK_BASE+"/",0,{},"ROOT");rows.push(diag("VIDROCK STREAM",val.diag));
      if(val.ok&&!seen[val.url]){seen[val.url]=1;vrValidated++;rows.unshift(streamRow(id,type,s,e,"Vidrock "+vp.server,val.url,vp.language,val.height,val.referer||vp.url));break;}
    }
  }
  var playable=vzOk+vrValidated;rows.push(diag("REQUEST","TMDB "+id+" • "+type+(type==="tv"?" • S"+s+"E"+e:"")+" • playable="+playable));if(playable===0)rows.splice(1,0,diag("NO STREAM","Catalog matched, but VidZee/Vidrock returned no validated playable source"));return rows;
}

if(typeof globalThis!=="undefined")globalThis.getStreams=getStreams;
