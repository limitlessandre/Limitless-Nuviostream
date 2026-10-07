"use strict";
const PROVIDER_NAME="AsiaFlix Test";
const BASE_URL="https://asiaflix.net";
const API_URL="https://api.asiaflix.net/v1";
const TMDB_API_KEY="1865f43a0549ca50d341dd9ab8b29f49";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147 Safari/537.36";
const API_HEADERS={"User-Agent":UA,"Accept":"application/json, text/plain, */*","X-Access-Control":"web"};
const SW_DOMAINS=["niramirus.com","medixiru.com"];

let lastDiagnostics=[];
function clean(v){return String(v==null?"":v).trim();}
function slug(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");}
function abs(u,b){try{const url=new URL(u,b);return /^https?:$/.test(url.protocol)?url.toString():"";}catch(_){return "";}}
function swId(u){var m=clean(u).match(/\/[efd]\/([a-zA-Z0-9]+)/);return m?m[1]:"";}
function note(stage,detail){lastDiagnostics.push({stage:stage,detail:detail});}
async function request(url,headers,context){
 const ms=Math.max(1,Math.min(5000,context.deadline-Date.now()));
 if(Date.now()>=context.deadline)throw Error("resolution deadline");
 if(typeof setTimeout!=="function"||typeof clearTimeout!=="function")throw Error("runtime timers unavailable");
 let timer;const controller=typeof AbortController==="function"?new AbortController():null;
 try{return await Promise.race([(async()=>{
  const r=await fetch(url,{headers:headers,redirect:"follow",skipSizeCheck:true,timeout:ms,...(controller?{signal:controller.signal}:{})});
  if(!r||!r.ok)throw Error("HTTP "+(r&&r.status||0));
  const body=typeof r.text==="function"?await r.text():JSON.stringify(await r.json());
  return {body:body,url:r.url||url};
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>{if(controller)controller.abort();reject(Error("request timeout"));},ms);})]);}
 finally{clearTimeout(timer);}
}
async function json(url,context){try{return JSON.parse((await request(url,API_HEADERS,context)).body);}catch(e){note("api",e.message);return null;}}
// Static P.A.C.K.E.R decoding: never execute the remote player script.
function literal(value){
 let out='';for(let i=1;i<value.length-1;i++){
  let c=value[i];if(c!=='\\'){out+=c;continue;}c=value[++i];
  if(c==='x'||c==='u'){const n=c==='x'?2:4,hex=value.slice(i+1,i+1+n);if(!/^[0-9a-f]+$/i.test(hex)||hex.length!==n)throw Error('invalid escape');out+=String.fromCharCode(parseInt(hex,16));i+=n;}
  else if(c==='\n'){}else if(c==='\r'){if(value[i+1]==='\n')i++;}
  else out+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'})[c]||c;
 }return out;
}
function unpack(body){
 const re=/eval\(function\(p,a,c,k,e,[dr]\)[\s\S]*?\}\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\.split\(['"]\|['"]\)/g;
 let output=body;
 for(let round=0;round<3;round++){
  let changed=false;output=output.replace(re,(whole,payload,radix,count,words)=>{
   const base=Number(radix),n=Number(count);if(base<2||base>62||n>10000||payload.length>300000)return whole;
   const keys=literal(words).split('|'),digits='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
   const decoded=literal(payload).replace(/\b[0-9a-zA-Z]+\b/g,token=>{let index=0;for(const c of token){const digit=digits.indexOf(c);if(digit<0||digit>=base)return token;index=index*base+digit;if(index>=n)return token;}return keys[index]||token;});
   changed=true;return decoded;
  });if(!changed)break;
 }return output;
}

function playerLinks(body,base){
 if(/File Not Found|no longer available|locked watch or does not exist/i.test(body))return [];
 const decoded=unpack(body),match=decoded.match(/\b(?:var|let|const)\s+links\s*=\s*(\{[^;]+\})/),out=[];
 if(match){try{const links=JSON.parse(match[1]);for(const key of ['hls4','hls3','hls2'])if(typeof links[key]==='string')out.push(abs(links[key],base));}catch(_){}}
 if(!out.length){const re=/\bfile\s*:\s*(['"])(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)\1/g;let m;while((m=re.exec(decoded))&&out.length<4)out.push(abs(m[2],base));}
 return [...new Set(out.filter(Boolean))];
}
function variants(body,base){
 const lines=body.split(/\r?\n/),out=[];
 for(let i=0;i<lines.length;i++)if(/^#EXT-X-STREAM-INF:/.test(lines[i])){
  const resolution=lines[i].match(/RESOLUTION=(\d+)x(\d+)/),codecs=lines[i].match(/CODECS="([^"]+)"/);
  let n=i+1;while(n<lines.length&&(!lines[n].trim()||lines[n].startsWith('#')))n++;
  const url=abs(lines[n]||'',base);if(url)out.push({url:url,height:resolution?Number(resolution[2]):0,codecs:codecs?codecs[1]:''});
 }return out;
}
async function playable(url,page,context){
 const origin=new URL(page).origin,headers={"User-Agent":UA,Referer:origin+"/",Origin:origin};
 try{
  const response=await request(url,headers,context),body=response.body.trim();if(!body.startsWith('#EXTM3U'))throw Error('not HLS');
  const video=variants(body,response.url).sort((a,b)=>b.height-a.height),selected=video[0];
  if(selected&&selected.codecs&&!/avc|hev|hvc|vp0?9|av01|mp4v/i.test(selected.codecs))throw Error('audio-only variant');
  const child=selected?(await request(selected.url,headers,context)).body:body;
  if(!child.trim().startsWith('#EXTM3U')||!/#EXTINF:/.test(child)||!/#EXT-X-ENDLIST/.test(child))throw Error('invalid video playlist');
  const audio=new Set([...body.matchAll(/#EXT-X-MEDIA:TYPE=AUDIO,[^\r\n]+/g)].filter(m=>/URI=/.test(m[0])).map(m=>m[0]));
  const captions=/#EXT-X-MEDIA:TYPE=SUBTITLES,/.test(body),tag=audio.size>1?'[DUAL]':captions?'[SUB]':'[UNK]';
  const height=selected&&selected.height||0,label=height>=1080?'FHD '+height+'p':height>=720?'HD '+height+'p':height?'SD '+height+'p':'Auto';
  return {name:PROVIDER_NAME+' • '+label+' • '+tag,title:context.title,url:response.url,quality:height?height+'p':'Auto',provider:PROVIDER_NAME,type:'m3u8',headers:headers,subtitles:[]};
 }catch(e){note('manifest',e.message);return null;}
}
async function resolveWish(entries,context){
 const ids=[...new Set(entries.map(x=>swId(clean(x.url))).filter(Boolean))].slice(0,6),seen=new Set();
 for(const domain of SW_DOMAINS){
  const pages=await Promise.all(ids.map(async id=>{const page='https://'+domain+'/'+id;try{const r=await request(page,{'User-Agent':UA,Referer:BASE_URL+'/'},context);return {page:r.url,links:playerLinks(r.body,r.url)};}catch(e){note('player',e.message);return {page:page,links:[]};}}));
  for(const page of pages)for(const url of page.links){
   // A failed signature must not suppress a fresh token from another alias.
   const key=new URL(page.page).origin+' '+url;if(seen.has(key))continue;seen.add(key);
   const row=await playable(url,page.page,context);if(row)return [row];
  }
 }return [];
}
async function getStreams(inputId,mediaType,season,episode){
 lastDiagnostics=[];const context={deadline:Date.now()+15000};
 var id=clean(inputId),type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",epNo=Number(episode||1);
 if(!/^\d+$/.test(id))return [];
 var meta=await json("https://api.themoviedb.org/3/"+type+"/"+id+"?api_key="+TMDB_API_KEY,context);if(!meta)return [];
 var title=clean(type==="movie"?(meta.title||meta.original_title):(meta.name||meta.original_name));
 var d=await json(API_URL+"/drama/detail?slug="+encodeURIComponent(slug(title)),context);if(!d)return [];
 var eps=Array.isArray(d.episodes)?d.episodes:[],ep=type==="movie"?eps[0]:eps.find(function(x){return Number(x&&x.number)===epNo;});if(!ep)return [];
 var urls=Array.isArray(ep.streamUrls)?ep.streamUrls:[],sw=urls.filter(function(x){return /streamwish/i.test(clean(x&&x.source))||/(dwish|streamwish|cybervynx|vibuxer)/i.test(clean(x&&x.url));});
 context.title=title;return resolveWish(sw,context);
}
if(typeof module!=="undefined")module.exports={getStreams:getStreams,__test:{literal:literal,unpack:unpack,playerLinks:playerLinks,playable:playable,diagnostics:()=>lastDiagnostics.slice()}};
