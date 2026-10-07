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
function norm(v){return clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();}
async function detailForTitle(title,context){
 const owns=d=>d&&[d.name].concat(d.altNames||[]).some(n=>norm(n)===norm(title));
 const usable=d=>owns(d)&&Array.isArray(d.episodes)&&d.episodes.some(e=>Number(e.number)===context.episode&&Array.isArray(e.streamUrls)&&e.streamUrls.some(x=>x&&clean(x.url)));
 const direct=await json(API_URL+"/drama/detail?slug="+encodeURIComponent(slug(title)),context);if(usable(direct))return direct;
 const search=await json(API_URL+"/drama/search?q="+encodeURIComponent(title)+"&page=1",context),rows=search&&Array.isArray(search.body)?search.body:[];
 const wanted=norm(title),ranked=rows.map(x=>{const names=[x&&x.name].concat(Array.isArray(x&&x.altNames)?x.altNames:[]).filter(Boolean).map(norm);let score=99;if(names.some(n=>n===wanted))score=0;else if(names.some(n=>n.includes(wanted)||wanted.includes(n)))score=1;return {x,score};}).filter(y=>y.x&&y.x.slug).sort((a,b)=>a.score-b.score);
 if(!ranked.length||ranked[0].score>1)return null;
 for(const candidate of ranked.filter(x=>x.score===0).slice(0,3)){
  if(candidate.x.slug===slug(title))continue;
  const detail=await json(API_URL+"/drama/detail?slug="+encodeURIComponent(candidate.x.slug),context);if(usable(detail))return detail;
 }return null;
}
function abs(u,b){try{const url=new URL(u,b);return /^https?:$/.test(url.protocol)?url.toString():"";}catch(_){return "";}}
function swId(u){var m=clean(u).match(/\/[efd]\/([a-zA-Z0-9]+)/);return m?m[1]:"";}
function note(stage,detail){lastDiagnostics.push({stage:stage,detail:detail});}
async function request(url,headers,context,binary){
 const ms=Math.max(1,Math.min(4000,context.deadline-Date.now()));
 if(context.cancelled||Date.now()>=context.deadline)throw Error("resolution deadline");
 if(typeof setTimeout!=="function"||typeof clearTimeout!=="function")throw Error("runtime timers unavailable");
 let timer;const controller=typeof AbortController==="function"?new AbortController():null;
 if(controller&&context.controllers)context.controllers.add(controller);
 try{return await Promise.race([(async()=>{
  const r=await fetch(url,{headers:headers,redirect:"follow",skipSizeCheck:true,timeout:ms,...(controller?{signal:controller.signal}:{})});
  if(!r||!r.ok)throw Error("HTTP "+(r&&r.status||0));
  let body;
  if(binary&&r.body&&typeof r.body.getReader==='function'){
   const reader=r.body.getReader(),chunk=await reader.read();await reader.cancel();body=Array.from(chunk.value||[]).slice(0,65536);
  }else if(binary&&typeof r.arrayBuffer==='function')body=Array.from(new Uint8Array(await r.arrayBuffer()));
  else body=typeof r.text==="function"?await r.text():JSON.stringify(await r.json());
  return {body:body,url:r.url||url};
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>{if(controller)controller.abort();reject(Error("request timeout"));},ms);})]);}
 finally{clearTimeout(timer);if(controller&&context.controllers)context.controllers.delete(controller);}
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
 if(!out.length){const re=/(?:\bfile|"file"|'file')\s*:\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;let m;while((m=re.exec(decoded))&&out.length<4){const url=literal(m[1]);if(/\.m3u8(?:\?|$)/i.test(url))out.push(abs(url,base));}}
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
function videoHeaders(page){const origin=new URL(page).origin;return {"User-Agent":UA,Referer:origin+"/",Origin:origin};}
function qualityLabel(h){return !h?'Unknown Auto':(h>=4320?'2x4K 8K ':h>=2160?'4K ':h>=1440?'Enhanced QHD ':h>=1080?'FHD ':h>=720?'HD ':h>=540?'HD-Low ':h>=480?'SD ':h>=360?'SD-Low ':'SD-Very Low ')+h+'p';}
function subtitleRows(tracks,headers){return (tracks||[]).map(x=>({...x,name:x.name||x.label||'Subtitle',headers:x.headers||headers}));}
function u32(b,i){return i>=0&&i+3<b.length?(((b[i]<<24)>>>0)+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3])>>>0:0;}
function asciiAt(b,i,s){for(let j=0;j<s.length;j++)if(b[i+j]!==s.charCodeAt(j))return false;return true;}
function mp4Height(b){
 for(let i=4;i+4<b.length;i++)if(asciiAt(b,i,'tkhd')){
  const start=i-4,size=u32(b,start),end=start+size;if(size>=40&&end<=b.length){const h=u32(b,end-4)/65536;if(h>=100&&h<=10000)return Math.round(h);}
 }
 return 0;
}
function h264Height(b){
 let start=-1;
 for(let i=0;i+5<b.length;i++){
  const three=b[i]===0&&b[i+1]===0&&b[i+2]===1,four=b[i]===0&&b[i+1]===0&&b[i+2]===0&&b[i+3]===1,n=i+(four?4:three?3:0);
  if(n>i&&(b[n]&31)===7){start=n+1;break;}
 }
 if(start<0)return 0;let end=b.length;
 for(let i=start;i+4<b.length;i++)if(b[i]===0&&b[i+1]===0&&(b[i+2]===1||(b[i+2]===0&&b[i+3]===1))){end=i;break;}
 const raw=b.slice(start,end),rb=[];for(let i=0;i<raw.length;i++){if(i+2<raw.length&&raw[i]===0&&raw[i+1]===0&&raw[i+2]===3){rb.push(0,0);i+=2;}else rb.push(raw[i]);}
 let bit=0;const bits=n=>{let v=0;for(let k=0;k<n;k++){if(bit>=rb.length*8)throw Error('short SPS');v=(v<<1)|((rb[bit>>3]>>(7-(bit&7)))&1);bit++;}return v;};
 const ue=()=>{let z=0;while(bits(1)===0&&z<32)z++;return ((1<<z)-1)+(z?bits(z):0);},se=()=>{const v=ue();return v&1?(v+1)>>1:-(v>>1);};
 try{
  const profile=bits(8);bits(8);bits(8);ue();let chroma=1,separate=0;
  if([100,110,122,244,44,83,86,118,128,138,139,134,135].includes(profile)){chroma=ue();if(chroma===3)separate=bits(1);ue();ue();bits(1);if(bits(1)){const count=chroma!==3?8:12;for(let i=0;i<count;i++)if(bits(1)){let last=8,next=8,size=i<6?16:64;for(let j=0;j<size;j++){if(next!==0)next=(last+se()+256)%256;last=next===0?last:next;}}}}
  ue();const pct=ue();if(pct===0)ue();else if(pct===1){bits(1);se();se();for(let i=0,n=ue();i<n;i++)se();}
  ue();bits(1);const w=ue(),h=ue(),frameOnly=bits(1);if(!frameOnly)bits(1);bits(1);
  let left=0,right=0,top=0,bottom=0;if(bits(1)){left=ue();right=ue();top=ue();bottom=ue();}
  const subW=chroma===3?1:2,subH=chroma===1?2:1,cropX=(separate?1:subW),cropY=(separate?1:subH)*(2-frameOnly);
  const height=(2-frameOnly)*(h+1)*16-cropY*(top+bottom);return height>=100&&height<=10000?height:0;
 }catch(_){return 0;}
}
function detectedHeight(b){return mp4Height(b)||h264Height(b)||0;}
async function probeHlsHeight(child,base,headers,context){
 const segment=child.split(/\r?\n/).find(x=>x.trim()&&!x.startsWith('#'));if(!segment)return 0;
 try{const r=await request(abs(segment,base),{...headers,Range:'bytes=0-65535'},context,true);return detectedHeight(r.body);}catch(_){return 0;}
}
function streamTag(context,hasSelectable,audioCount){
 if(audioCount>1)return '[DUAL]';
 if(hasSelectable)return context.language==='en'?'[DUB+SUB]':'[SUB]';
 if(/sub/i.test(clean(context.episodeType))&&context.language!=='en')return '[HSUB]';
 return context.language==='en'?'[DUB]':'[UNK]';
}
async function playable(url,page,context,subtitles,exportedHeaders){
 const headers=exportedHeaders||videoHeaders(page);
 try{
  const response=await request(url,headers,context),body=response.body.trim();if(!body.startsWith('#EXTM3U'))throw Error('not HLS');
  const video=variants(body,response.url).sort((a,b)=>b.height-a.height),selected=video[0];
  if(selected&&selected.codecs&&!/avc|hev|hvc|vp0?9|av01|mp4v/i.test(selected.codecs))throw Error('audio-only variant');
  const child=selected?(await request(selected.url,headers,context)).body:body;
  if(!child.trim().startsWith('#EXTM3U')||!/#EXTINF:/.test(child)||!/#EXT-X-ENDLIST/.test(child))throw Error('invalid video playlist');
  const audio=new Set([...body.matchAll(/#EXT-X-MEDIA:[^\r\n]+/g)].filter(m=>/TYPE=AUDIO(?:,|$)/.test(m[0])&&/URI=/.test(m[0])).map(m=>m[0]));
  const captions=/#EXT-X-MEDIA:[^\r\n]*TYPE=SUBTITLES[^\r\n]*URI=/.test(body)||(subtitles||[]).length,tag=streamTag(context,!!captions,audio.size);
  const duration=[...child.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s,m)=>s+Number(m[1]),0);if(!(duration>0))throw Error('empty video');
  const height=selected&&selected.height||await probeHlsHeight(child,selected?selected.url:response.url,headers,context),label=qualityLabel(height);
  return {name:PROVIDER_NAME+' • '+label+' • '+tag,title:context.title,url:response.url,quality:height?height+'p':'Auto',provider:PROVIDER_NAME,type:'m3u8',headers:headers,subtitles:subtitleRows(subtitles,headers)};
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
function base64Bytes(s){
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];let bits=0,value=0;
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s)||s.length%4===1)throw Error('invalid base64');
 for(const c of s.replace(/=+$/,'')){value=(value<<6)|chars.indexOf(c);bits+=6;if(bits>=8){bits-=8;out.push((value>>bits)&255);}}return out;
}
function base64(s){
 const bytes=unescape(encodeURIComponent(s)),chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];
 for(let i=0;i<bytes.length;i+=3){const a=bytes.charCodeAt(i),b=bytes.charCodeAt(i+1),c=bytes.charCodeAt(i+2),n=(a<<16)|((b||0)<<8)|(c||0);out.push(chars[n>>>18],chars[(n>>>12)&63],i+1<bytes.length?chars[(n>>>6)&63]:'=',i+2<bytes.length?chars[n&63]:'=');}return out.join('');
}
// Small AES-CBC decoder for the public Vidbasic player configuration. No remote JS executes.
// Kept independent of native crypto modules so the same provider works on all Nuvio runtimes.
function aesUrl(value,key,iv){
 const data=base64Bytes(value),k=Array.from(key,c=>c.charCodeAt(0)),initial=Array.from(iv,c=>c.charCodeAt(0));
 if(k.length!==32||initial.length!==16||!data.length||data.length%16)throw Error('invalid AES input');
 function mul(a,b){let n=0;while(b){if(b&1)n^=a;a=(a<<1)^((a&128)?283:0);b>>=1;}return n&255;}
 const box=[],inverse=[];for(let x=0;x<256;x++){let y=0;if(x){y=1;for(let j=0;j<254;j++)y=mul(y,x);}const rot=n=>((y<<n)|(y>>(8-n)))&255;const z=y^rot(1)^rot(2)^rot(3)^rot(4)^99;box[x]=z;inverse[z]=x;}
 const expanded=k.slice();let rc=1;while(expanded.length<240){let t=expanded.slice(-4),pos=expanded.length;if(pos%32===0){t.push(t.shift());t=t.map(x=>box[x]);t[0]^=rc;rc=mul(rc,2);}else if(pos%32===16)t=t.map(x=>box[x]);for(let j=0;j<4;j++)expanded.push(expanded[pos-32+j]^t[j]);}
 const output=[];let previous=initial;
 for(let start=0;start<data.length;start+=16){let state=data.slice(start,start+16);const add=r=>{for(let i=0;i<16;i++)state[i]^=expanded[r*16+i];};add(14);
  for(let r=13;r>=0;r--){const old=state.slice();for(let row=0;row<4;row++)for(let c=0;c<4;c++)state[c*4+row]=inverse[old[((c-row+4)%4)*4+row]];add(r);
   if(r)for(let c=0;c<4;c++){const i=c*4,a=state.slice(i,i+4);state[i]=mul(a[0],14)^mul(a[1],11)^mul(a[2],13)^mul(a[3],9);state[i+1]=mul(a[0],9)^mul(a[1],14)^mul(a[2],11)^mul(a[3],13);state[i+2]=mul(a[0],13)^mul(a[1],9)^mul(a[2],14)^mul(a[3],11);state[i+3]=mul(a[0],11)^mul(a[1],13)^mul(a[2],9)^mul(a[3],14);}
  }for(let i=0;i<16;i++)output.push(state[i]^previous[i]);previous=data.slice(start,start+16);
 }
 const pad=output[output.length-1];if(pad<1||pad>16||!output.slice(-pad).every(x=>x===pad))throw Error('invalid AES padding');
 const text=decodeURIComponent(output.slice(0,-pad).map(x=>'%'+x.toString(16).padStart(2,'0')).join(''));if(!/^https?:\/\//.test(text))throw Error('invalid decrypted URL');return text;
}
function vidbasicData(body,page){
 const cipher=body.match(/data-name="crypto"\s+data-value="([^"]+)"/),keys=body.match(/key=CryptoJS[^;]+?\]\(('\d+'(?:\+'\d+')*)\),iv=CryptoJS[^;]+?\]\(('\d+'(?:\+'\d+')*)\)/);
 if(!cipher||!keys)throw Error('unsupported Vidbasic player');
 const join=s=>[...s.matchAll(/'(\d+)'/g)].map(x=>x[1]).join(''),key=join(keys[1]),iv=join(keys[2]),url=aesUrl(cipher[1],key,iv),sub=new URL(page).searchParams.get('sub');
 return {url,subtitles:sub?[{url:aesUrl(sub,key,iv),language:'en',label:'English'}]:[]};
}
function captions(body,page){
 const block=unpack(body).match(/tracks\s*:\s*\[([\s\S]*?)\]/),out=[];if(!block)return out;
 for(const m of block[1].matchAll(/\{[^{}]*\}/g)){const file=m[0].match(/(?:file|"file")\s*:\s*(['"])(.*?)\1/),kind=m[0].match(/(?:kind|"kind")\s*:\s*(['"])(.*?)\1/),label=m[0].match(/(?:label|"label")\s*:\s*(['"])(.*?)\1/);if(file&&kind&&/^(captions|subtitles)$/i.test(kind[2]))out.push({url:abs(file[2],page),language:label&&/english/i.test(label[2])?'en':'und',label:label?label[2]:'Subtitle'});}return out.filter(x=>x.url);
}
async function mediaRow(url,isHls,page,context,subs,headers){
 if(!abs(url,page))return null;
 if(isHls)return playable(url,page,context,subs,headers);
 try{const r=await request(url,{...(headers||videoHeaders(page)),Range:'bytes=0-65535'},context,true),b=typeof r.body==='string'?Array.from(r.body,c=>c.charCodeAt(0)):r.body;
  if(b.length<12||String.fromCharCode(...b.slice(4,8))!=='ftyp')throw Error('not MP4');
  const height=detectedHeight(b),tag=streamTag(context,(subs||[]).length>0,0),label=qualityLabel(height);
  return {name:PROVIDER_NAME+' • '+label+' • '+tag,title:context.title,url:r.url,quality:height?height+'p':'Auto',provider:PROVIDER_NAME,type:'mp4',headers:headers||videoHeaders(page),subtitles:subtitleRows(subs,headers||videoHeaders(page))};
 }catch(e){note('media',e.message);return null;}
}
async function hostFallback(host,context){
 const u=clean(host.url),kind=(clean(host.source)+' '+u).toLowerCase();
 if(/streamwish|dwish|cybervynx|hglink|hgcloud|vibuxer/.test(kind))return (await resolveWish([host],context))[0]||null;
 let page=u;if(/streamtape|watchadsontape/.test(kind)){const id=swId(u);if(!id)return null;page='https://streamtape.com/e/'+id;}
 else if(/vidmoly/.test(kind))page=u.replace(/^https?:\/\/[^/]+/,'https://vidmoly.biz');
 else if(!/vidbasic|vidhide|dlions|smoothpre|minochinos|mixdrop|dood|d000d|do0od|playmogo/.test(kind))return null;
 try{
  const r=await request(page,videoHeaders(/vidmoly/.test(kind)?'https://vidmoly.biz':BASE_URL),context),body=unpack(r.body);page=r.url;
  if(/vidbasic/.test(kind)){
   const title=r.body.match(/<title>([^<]+)<\/title>/i),wanted=norm(context.title);if(!title||!norm(title[1]).includes(wanted)||!new RegExp('Episode\\s+'+context.episode+'(?:\\D|$)','i').test(title[1]))throw Error('Vidbasic episode ownership mismatch');
   const frame=r.body.match(/<iframe[^>]+id="embedvideo"[^>]+src="([^"]+)"/i);if(!frame)throw Error('missing Standard Server');const target=abs(frame[1].replace(/&amp;/g,'&'),page);
   if(!target||new URL(target).origin!==new URL(page).origin||new URL(target).pathname!=='/3rdplayer.html'||new URL(target).searchParams.get('id')!==new URL(page).pathname.split('/').pop())throw Error('invalid Standard Server identity');
   const p=await request(target,videoHeaders(page),context),data=vidbasicData(p.body,target);return mediaRow(data.url,/\.m3u8(?:\?|$)/i.test(data.url),page,context,data.subtitles);
  }
  if(/dood|d000d|do0od|playmogo/.test(kind)){const pass=body.match(/\/pass_md5\/[^'"\s]+/);if(!pass)return null;const p=await request(abs(pass[0],page),{'User-Agent':UA,Referer:page},context),token=pass[0].split('/').pop(),url=clean(p.body)+Math.random().toString(36).slice(2,12)+'?token='+encodeURIComponent(token)+'&expiry='+Date.now();return mediaRow(url,false,page,context,[]);}
  if(/streamtape|watchadsontape/.test(kind)){
   const expression=body.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*([^;]+)/),literals=expression&&[...expression[1].matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g)];if(!literals||literals.length<2)return null;
   let tail=literal(literals[1][0]);const offsets=[...expression[1].matchAll(/\.substring\((\d+)\)/g)];for(const x of offsets)tail=tail.slice(Number(x[1]));return mediaRow(abs(literal(literals[0][0])+tail,page),false,page,context,[]);
  }
  const mix=body.match(/(?:MDCore|Core)\.wurl\s*=\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/),urls=mix?[abs(literal(mix[1]),page)]:playerLinks(body,page);
  for(const url of urls){const row=await mediaRow(url,!mix,page,context,captions(body,page));if(row)return row;}
 }catch(e){note('host',e.message);}return null;
}
async function apiHost(host,context){
 const value=base64(clean(host.url)),source=clean(host.source).toLowerCase();
 // Live AsiaFlix strips its source label prefix before calling the resolver (Yuzono v32 does not).
 const server=source.startsWith('asiaflix-')?source.split('-').pop():source,result=await json(API_URL+'/drama/get-stream-url?value='+encodeURIComponent(value)+'&server='+encodeURIComponent(server),context);
 const subs=(result&&Array.isArray(result.subtitles)?result.subtitles:[]).map(x=>({url:abs(x.url||x.file,BASE_URL),language:x.language||x.lang||'und',label:x.label||x.name||'Subtitle'})).filter(x=>x.url);
 for(const file of result&&Array.isArray(result.sources)?result.sources:[]){if(!file||!file.url||file.isTickCounter)continue;const row=await mediaRow(file.url,file.isM3U8===true||/\.m3u8(?:\?|$)/i.test(file.url),BASE_URL,context,subs);if(row)return row;}
 return null;
}
async function resolveEpisode(entries,context){
 const unique=[...new Map(entries.filter(x=>x&&abs(x.url,BASE_URL)).map(x=>[x.url,x])).values()];
 // Prefer ordinary resolver-supported hosts; aliases that time out cannot starve a working source.
 const rank=x=>/^streamwish$/i.test(x.source)?0:/^mixdrop$/i.test(x.source)?1:/vidbasic/i.test(x.source)?2:3;
 unique.sort((a,b)=>rank(a)-rank(b));context.controllers=new Set();
 // A bounded batch tries first-party media before any extractor in that batch.
 // Each worker validates its own API response; the first usable result wins.
 const first=jobs=>new Promise(resolve=>{let pending=jobs.length;if(!pending)return resolve(null);for(const job of jobs)job.then(row=>{if(row)resolve(row);if(!--pending)resolve(null);},()=>{if(!--pending)resolve(null);});});
 try{for(let i=0;i<unique.length&&Date.now()<context.deadline;i+=3){const batch=unique.slice(i,i+3);let row=await first(batch.map(host=>apiHost(host,context)));if(row)return [row];row=await first(batch.map(host=>hostFallback(host,context)));if(row)return [row];}return [];}
 finally{context.cancelled=true;for(const c of context.controllers)c.abort();}
}
async function getStreams(inputId,mediaType,season,episode){
 lastDiagnostics=[];const context={deadline:Date.now()+12000};
 var id=clean(inputId),type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",epNo=Number(episode||1);
 if(!/^\d+$/.test(id))return [];
 var meta=await json("https://api.themoviedb.org/3/"+type+"/"+id+"?api_key="+TMDB_API_KEY,context);if(!meta)return [];
 var title=clean(type==="movie"?(meta.title||meta.original_title):(meta.name||meta.original_name));
 context.episode=epNo;var d=await detailForTitle(title,context);if(!d)return [];
 var eps=Array.isArray(d.episodes)?d.episodes:[],ep=eps.find(function(x){return Number(x&&x.number)===epNo;});if(!ep)return [];
 var urls=Array.isArray(ep.streamUrls)?ep.streamUrls:[];
 context.title=title;context.episode=Number(ep.number);context.episodeType=clean(ep.type);context.language=meta.original_language;return resolveEpisode(urls,context);
}
if(typeof module!=="undefined")module.exports={getStreams:getStreams,__test:{literal,unpack,playerLinks,playable,base64,aesUrl,vidbasicData,resolveEpisode,diagnostics:()=>lastDiagnostics.slice()}};
