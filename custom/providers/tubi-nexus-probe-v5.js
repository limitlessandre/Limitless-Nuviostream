"use strict";

// Tubi Nexus Probe v0.5
// Uses Tubi's current anonymous-device bearer-token flow, then probes the
// production search/content APIs. Diagnostic output only. No media is returned.

const PROVIDER_NAME = "Tubi Nexus Probe";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DIAG_URL = "https://tubitv.com/favicon.ico";
const WEB = "https://tubitv.com";
const ACCOUNT = "https://account.production-public.tubi.io";
const SEARCH = "https://search.production-public.tubi.io";
const CONTENT = "https://content-cdn.production-public.tubi.io";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const ALGORITHM = "TUBI-HMAC-SHA256";
const SIGNED_HEADERS = "content-type";

function clean(v){return String(v==null?"":v).replace(/\s+/g," ").trim();}
function short(v,n){const s=clean(v),m=n||175;return s.length>m?s.slice(0,m)+"…":s;}
function diag(stage,msg,title){return{name:`${PROVIDER_NAME} • DIAG ${stage} • ${short(msg,180)}`,title:title||"Tubi feasibility probe",url:DIAG_URL,quality:"DIAG",language:"Debug",provider:PROVIDER_NAME,type:"mp4"};}
function norm(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function score(a,b){a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 100;if(a.startsWith(b)||b.startsWith(a))return 90;if(a.includes(b)||b.includes(a))return 80;const aw=a.split(" "),bw=b.split(" ");let hit=0;for(const w of bw)if(w.length>1&&aw.includes(w))hit++;return Math.round(hit/Math.max(1,bw.length)*70);}

function utf8(s){
  const out=[];s=String(s||"");
  for(let i=0;i<s.length;i++){
    let c=s.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF&&i+1<s.length){const d=s.charCodeAt(++i);c=0x10000+((c-0xD800)<<10)+(d-0xDC00);}
    if(c<0x80)out.push(c);
    else if(c<0x800)out.push(0xC0|(c>>6),0x80|(c&63));
    else if(c<0x10000)out.push(0xE0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
    else out.push(0xF0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));
  }
  return out;
}
function rotr(x,n){return (x>>>n)|(x<<(32-n));}
function sha256Bytes(input){
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const b=Array.from(input||[]),bitLen=b.length*8;b.push(0x80);while((b.length%64)!==56)b.push(0);
  const hi=Math.floor(bitLen/0x100000000),lo=bitLen>>>0;
  b.push((hi>>>24)&255,(hi>>>16)&255,(hi>>>8)&255,hi&255,(lo>>>24)&255,(lo>>>16)&255,(lo>>>8)&255,lo&255);
  let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  for(let off=0;off<b.length;off+=64){
    const w=new Array(64);
    for(let i=0;i<16;i++){const j=off+i*4;w[i]=((b[j]<<24)|(b[j+1]<<16)|(b[j+2]<<8)|b[j+3])>>>0;}
    for(let i=16;i<64;i++){const a=w[i-15],z=w[i-2],s0=(rotr(a,7)^rotr(a,18)^(a>>>3))>>>0,s1=(rotr(z,17)^rotr(z,19)^(z>>>10))>>>0;w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}
    let [a,c,d,e,f,g,h,i8]=H;let bb=c;
    // named this way only to keep the working variables compact below
    let A=a,B=bb,C=d,D=e,E=f,F=g,G=h,HH=i8;
    for(let i=0;i<64;i++){
      const S1=(rotr(E,6)^rotr(E,11)^rotr(E,25))>>>0,ch=((E&F)^((~E)&G))>>>0;
      const t1=(HH+S1+ch+K[i]+w[i])>>>0;
      const S0=(rotr(A,2)^rotr(A,13)^rotr(A,22))>>>0,maj=((A&B)^(A&C)^(B&C))>>>0;
      const t2=(S0+maj)>>>0;
      HH=G;G=F;F=E;E=(D+t1)>>>0;D=C;C=B;B=A;A=(t1+t2)>>>0;
    }
    H=[(H[0]+A)>>>0,(H[1]+B)>>>0,(H[2]+C)>>>0,(H[3]+D)>>>0,(H[4]+E)>>>0,(H[5]+F)>>>0,(H[6]+G)>>>0,(H[7]+HH)>>>0];
  }
  const out=[];for(const x of H)out.push((x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);return out;
}
function sha256Text(s){return sha256Bytes(utf8(s));}
function hex(bytes){return Array.from(bytes||[]).map(x=>(x&255).toString(16).padStart(2,"0")).join("");}
function concat(a,b){return Array.from(a||[]).concat(Array.from(b||[]));}
function hmac(key,msg){
  let k=Array.from(key||[]);if(k.length>64)k=sha256Bytes(k);while(k.length<64)k.push(0);
  const i=k.map(x=>x^0x36),o=k.map(x=>x^0x5c);return sha256Bytes(concat(o,sha256Bytes(concat(i,utf8(msg)))));
}
const B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(bytes,urlSafe){let out="",a=Array.from(bytes||[]);for(let i=0;i<a.length;i+=3){const n=(a[i]<<16)|((a[i+1]||0)<<8)|(a[i+2]||0);out+=B64[(n>>>18)&63]+B64[(n>>>12)&63]+(i+1<a.length?B64[(n>>>6)&63]:"=")+(i+2<a.length?B64[n&63]:"=");}return urlSafe?out.replace(/\+/g,"-").replace(/\//g,"_"):out;}
function b64decode(s){s=String(s||"").replace(/-/g,"+").replace(/_/g,"/").replace(/[^A-Za-z0-9+/=]/g,"");const out=[];let bits=0,val=0;for(const ch of s){if(ch==="=")break;const p=B64.indexOf(ch);if(p<0)continue;val=(val<<6)|p;bits+=6;if(bits>=8){bits-=8;out.push((val>>>bits)&255);}}return out;}
function randomBytes(n){const out=new Array(n);try{if(typeof crypto!=="undefined"&&crypto&&typeof crypto.getRandomValues==="function"){const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a);}}catch(_){}for(let i=0;i<n;i++)out[i]=Math.floor(Math.random()*256);return out;}
function uuid(){const b=randomBytes(16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=hex(b);return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function stamp(){return new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");}
function qs(obj){return Object.keys(obj).map(k=>encodeURIComponent(k)+"="+encodeURIComponent(String(obj[k]))).join("&");}

async function request(url,opts){
  opts=opts||{};try{
    const res=await fetch(url,{method:opts.method||"GET",body:opts.body,headers:{"User-Agent":UA,"Accept":opts.accept||"application/json,text/plain,*/*","Accept-Language":"en-US,en;q=0.9","Origin":WEB,"Referer":opts.referer||WEB+"/",...(opts.headers||{})},skipSizeCheck:true});
    const text=String(await res.text()||"");let data=null;try{data=JSON.parse(text);}catch(_){}
    return{ok:!!res.ok,status:Number(res.status||0),text,data,url:String(res.url||url)};
  }catch(e){return{ok:false,status:0,text:"",data:null,url,error:String(e&&e.message||e)};}
}
async function tmdbInfo(inputId,mediaType){
  const type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",raw=String(inputId||"").trim();let id=/^\d+$/.test(raw)?Number(raw):null;
  if(!id&&/^tt\d+$/i.test(raw)){const f=await request(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);const list=type==="movie"?f.data&&f.data.movie_results:f.data&&f.data.tv_results;id=Array.isArray(list)&&list[0]&&list[0].id?Number(list[0].id):null;}
  if(!id)return null;const r=await request(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`),d=r.data;if(!d)return null;
  return{id,type,title:clean(type==="movie"?(d.title||d.original_title):(d.name||d.original_name)),year:clean(type==="movie"?d.release_date:d.first_air_date).slice(0,4),imdb:clean(d.imdb_id||(d.external_ids&&d.external_ids.imdb_id))};
}

async function anonymousToken(deviceId){
  const verifier=hex(randomBytes(16)),challenge=b64(sha256Text(verifier),true);
  const p1={challenge,version:"1.0.0",platform:"web",device_id:deviceId},body1=JSON.stringify(p1);
  const keyRes=await request(`${ACCOUNT}/device/anonymous/signing_key`,{method:"POST",body:body1,referer:WEB+"/login",headers:{"Content-Type":"application/json"}});
  if(!keyRes.ok||!keyRes.data||!keyRes.data.id||!keyRes.data.key)return{deviceId,keyRes,tokenRes:null,token:""};
  const p2={verifier,id:keyRes.data.id,platform:"web",device_id:deviceId},body2=JSON.stringify(p2),path="/device/anonymous/token";
  const can=["POST",path,"","content-type:application/json","",SIGNED_HEADERS,hex(sha256Text(body2))].join("\n"),ts=stamp();
  const sts=[ALGORITHM,ts,hex(sha256Text(can))].join("\n");
  let sk=concat(utf8("TUBI"),b64decode(keyRes.data.key));sk=hmac(sk,ts.split("T")[0]);sk=hmac(sk,"tubi_request");const sig=hex(hmac(sk,sts));
  const params={"X-Tubi-Algorithm":ALGORITHM,"X-Tubi-Date":ts,"X-Tubi-Expires":30,"X-Tubi-SignedHeaders":SIGNED_HEADERS,"X-Tubi-Signature":sig};
  const tokenRes=await request(`${ACCOUNT}${path}?${qs(params)}`,{method:"POST",body:body2,referer:WEB+"/login",headers:{"Content-Type":"application/json"}});
  return{deviceId,keyRes,tokenRes,token:clean(tokenRes.data&&tokenRes.data.access_token)};
}
function apiHeaders(auth){return{"Authorization":"Bearer "+auth.token,"Cookie":"deviceId="+auth.deviceId+";"};}
function orderedSearch(data){
  if(Array.isArray(data))return data;if(!data||typeof data!=="object")return[];const contents=data.contents&&typeof data.contents==="object"?data.contents:{},out=[];
  for(const c of data.containers||[]){for(const item of(c.items||c.children||[])){const id=typeof item==="object"?item&&item.id:item;if(id!=null&&contents[id]&&!out.includes(contents[id]))out.push(contents[id]);}}
  if(out.length)return out;for(const k of Object.keys(contents))out.push(contents[k]);return out.length?out:(Array.isArray(data.results)?data.results:[]);
}
function itemTitle(x){return clean(x&&(x.title||x.name));}
function itemId(x){return clean(x&&(x.id||x.content_id||x.contentId));}
function itemType(x){return clean(x&&(x.type||x.content_type||x.contentType||x.kind)).toLowerCase();}
function itemYear(x){return clean(x&&(x.year||x.release_year||x.releaseYear)).slice(0,4);}
function typeOkay(x,wanted){const t=itemType(x);if(!t)return true;if(wanted==="tv")return /series|show|^s$|tv/.test(t)&&!/^v$|movie|film/.test(t);return /movie|film|^v$/.test(t)&&!/series|show|^s$/.test(t);}
function resourceSummary(d){const list=Array.isArray(d&&d.video_resources)?d.video_resources:[];let clear=0,drm=0,first="";const types=[];for(const r of list){const t=clean(r&&r.type).toLowerCase(),u=clean(r&&r.manifest&&r.manifest.url);if(t&&!types.includes(t))types.push(t);if(u&&(/widevine|playready|fairplay/.test(t)||clean(r&&r.license_server&&r.license_server.url)))drm++;else if(u&&/hlsv3|hlsv6|dash/.test(t)){clear++;if(!first)first=u;}}let host="";try{if(first)host=new URL(first).host;}catch(_){}return{total:list.length,clear,drm,types,host};}

async function getStreams(inputId,mediaType,season,episode){
  const rows=[],type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",info=await tmdbInfo(inputId,type);if(!info)return[diag("TMDB",`unable to resolve ${inputId}`)];
  const display=type==="movie"?`${info.title}${info.year?` (${info.year})`:""}`:`${info.title} S${String(Number(season||1)).padStart(2,"0")}E${String(Number(episode||1)).padStart(2,"0")}`;
  rows.push(diag("TMDB",`title=${info.title} • year=${info.year||"?"} • imdb=${info.imdb||"?"} • type=${type}`,display));

  const auth=await anonymousToken(uuid());
  rows.push(diag("AUTH KEY",`${auth.keyRes&&auth.keyRes.status||"ERR"} • json=${auth.keyRes&&auth.keyRes.data?"yes":"no"} • id=${auth.keyRes&&auth.keyRes.data&&auth.keyRes.data.id?"yes":"no"} • key=${auth.keyRes&&auth.keyRes.data&&auth.keyRes.data.key?"yes":"no"}`,display));
  rows.push(diag("AUTH TOKEN",`${auth.tokenRes&&auth.tokenRes.status||"ERR"} • json=${auth.tokenRes&&auth.tokenRes.data?"yes":"no"} • bearer=${auth.token?"yes":"no"}${auth.tokenRes&&!auth.token?` • ${short(auth.tokenRes.text,65)}`:""}`,display));
  if(!auth.token){rows.push(diag("VERDICT","anonymous bearer token could not be obtained; current Tubi API is not usable from this runtime yet",display));return rows;}

  const sh=apiHeaders(auth),searchUrl=`${SEARCH}/api/v3/search?${qs({search:info.title,include_channels:"true",include_linear:"true",is_kids_mode:"false"})}`;
  const sr=await request(searchUrl,{headers:sh}),items=orderedSearch(sr.data).filter(x=>itemId(x)&&itemTitle(x)&&typeOkay(x,type));
  const scored=items.map(x=>({raw:x,id:itemId(x),title:itemTitle(x),kind:itemType(x),year:itemYear(x),score:score(itemTitle(x),info.title)+(itemYear(x)&&info.year&&itemYear(x)===info.year?15:0)})).sort((a,b)=>b.score-a.score);
  rows.push(diag("API SEARCH",`${sr.status||"ERR"} • json=${sr.data?"yes":"no"} • items=${items.length} • matched=${scored.length}`,display));
  for(const c of scored.slice(0,4))rows.push(diag("API CANDIDATE",`score=${c.score} • id=${c.id} • type=${c.kind||"?"} • year=${c.year||"?"} • ${c.title}`,display));
  if(!scored.length||scored[0].score<70){rows.push(diag("VERDICT","bearer auth works, but no safe Tubi title match was found",display));return rows.slice(0,18);}

  const best=scored[0];let targetId=best.id;
  if(type==="tv"){
    const seasonsRes=await request(`${CONTENT}/api/v3/series/${encodeURIComponent(best.id)}/episodes?platform=web`,{headers:sh}),seasons=seasonsRes.data&&Array.isArray(seasonsRes.data.episodes_by_season)?seasonsRes.data.episodes_by_season:[];
    rows.push(diag("SEASONS",`${seasonsRes.status||"ERR"} • json=${seasonsRes.data?"yes":"no"} • seasons=${seasons.length}`,display));
    const wantedS=Number(season||1),wantedE=Number(episode||1);
    const params={app_id:"tubitv",platform:"web",content_id:best.id,device_id:auth.deviceId,include_channels:"true","video_resources[]":"hlsv6","pagination[season]":wantedS,"pagination[page_in_season]":1,"pagination[page_size_in_season]":20};
    let cu=`${CONTENT}/api/v3/content?${qs(params)}&video_resources%5B%5D=hlsv3&video_resources%5B%5D=hlsv6_widevine_nonclearlead&limit_resolutions%5B%5D=h264_1080p&limit_resolutions%5B%5D=h265_1080p`;
    const page=await request(cu,{headers:sh}),kids=page.data&&Array.isArray(page.data.children)?page.data.children:[];
    const ep=kids.find((x,i)=>Number(x&&x.episode_number||x&&x.episode||x&&x.num||(i+1))===wantedE);
    rows.push(diag("EPISODE MAP",`${page.status||"ERR"} • children=${kids.length} • S${wantedS}E${wantedE}=${ep&&itemId(ep)?"id="+itemId(ep):"not found"}`,display));
    if(!ep||!itemId(ep)){rows.push(diag("VERDICT","bearer auth and title search work, but episode mapping needs adjustment",display));return rows.slice(0,18);}targetId=itemId(ep);
  }

  const cp={app_id:"tubitv",platform:"web",content_id:targetId,device_id:auth.deviceId,include_channels:"true","video_resources[]":"hlsv6"};
  const contentUrl=`${CONTENT}/api/v3/content?${qs(cp)}&video_resources%5B%5D=hlsv3&video_resources%5B%5D=hlsv6_widevine_nonclearlead&limit_resolutions%5B%5D=h264_1080p&limit_resolutions%5B%5D=h265_1080p`;
  const cr=await request(contentUrl,{headers:sh}),rs=resourceSummary(cr.data);
  rows.push(diag("API CONTENT",`${cr.status||"ERR"} • json=${cr.data?"yes":"no"} • id=${targetId} • resources=${rs.total}`,display));
  rows.push(diag("RESOURCES",`clear=${rs.clear} • drm=${rs.drm} • types=${rs.types.join(",")||"none"}${rs.host?` • clearHost=${rs.host}`:""}`,display));
  rows.push(diag("VERDICT",rs.clear>0?"current Tubi anonymous API exposes at least one clear HLS/DASH resource; controlled playback provider is feasible":(rs.drm>0?"title mapped successfully but only DRM resources were returned for this item":"auth/search/content work, but no playback resource was returned for this item"),display));
  return rows.slice(0,18);
}

module.exports={getStreams};
