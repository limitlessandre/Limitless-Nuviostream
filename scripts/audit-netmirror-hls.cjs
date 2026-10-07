const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../../netmirror-evidence');
const captured=JSON.parse(fs.readFileSync(path.join(dir,'requests.json')));
const additional=JSON.parse(fs.readFileSync(path.join(dir,'returned-links.json')));
const report={masters:[],requests:[]};
const save=()=>fs.writeFileSync(path.join(dir,'hls-audit.json'),JSON.stringify(report,null,2));
const attributes=line=>Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m=>[m[1],m[2]??m[3]]));
function parse(body,base){const lines=body.split(/\r?\n/).map(x=>x.trim()),media=[],variants=[];lines.forEach((l,i)=>{if(l.startsWith('#EXT-X-MEDIA:')){const a=attributes(l);if(a.URI)a.url=new URL(a.URI,base).href;media.push(a);}if(l.startsWith('#EXT-X-STREAM-INF:'))variants.push({...attributes(l),url:new URL(lines[i+1],base).href});});return{media,variants};}
async function request(url,headers={},body,range=false){
 const h={...headers};if(!/^https:\/\/(?:[^/]+\.)?(?:net52|net77|net22|net27)\.cc(?:\/|$)/.test(url)){delete h.Cookie;delete h.Origin;}if(range)h.Range='bytes=0-1023';
 const e={url,headers:h};report.requests.push(e);const start=Date.now();
 try{const r=await fetch(url,{headers:h,method:body?'POST':'GET',body,signal:AbortSignal.timeout(8000)});e.status=r.status;e.contentType=r.headers.get('content-type');e.finalUrl=r.url;if(range){const reader=r.body.getReader();const b=await reader.read();e.firstBytes=Buffer.from(b.value||[]).subarray(0,64).toString('hex');await reader.cancel();}else e.body=await r.text();}catch(err){e.error=err.message;}e.ms=Date.now()-start;save();return e;
}
async function audit(url,headers,route,id){
 const response=await request(url,headers);const result={route,id,url,headers,status:response.status,error:response.error};report.masters.push(result);
 if(!response.body?.trimStart().startsWith('#EXTM3U')){result.invalidBody=response.body?.slice(0,150);save();return;}
 Object.assign(result,parse(response.body,response.finalUrl));result.children=[];
 const links=[...new Set([...result.media.map(x=>x.url),...result.variants.map(x=>x.url)].filter(Boolean))];
 for(let i=0;i<links.length;i+=6)await Promise.all(links.slice(i,i+6).map(async link=>{const c=await request(link,headers);result.children.push({url:link,status:c.status,hls:c.body?.trimStart().startsWith('#EXTM3U'),error:c.error});}));
 // Fetch a small byte range from the first video segment and the English/original audio segments.
 for(const link of [result.variants[0]?.url,...result.media.filter(x=>x.TYPE==='AUDIO'&&['eng','kor'].includes(x.LANGUAGE)).map(x=>x.url)]){
  const c=report.requests.find(x=>x.url===link&&x.body?.startsWith('#EXTM3U'));const segment=c?.body.split(/\r?\n/).find(x=>x&&!x.startsWith('#'));if(segment)await request(new URL(segment,c.finalUrl).href,headers,undefined,true);
 }save();
}
(async()=>{
 for(const req of captured.filter(x=>x.url.includes('/newtv/player.php')&&x.body)){
  const p=JSON.parse(req.body),id=new URL(req.url).searchParams.get('id');
  console.log(id,'NewTV');await audit(p.video_link,{Referer:p.referer,'User-Agent':'Mozilla/5.0'},'newtv',id);
 }
 for(const req of captured.filter(x=>x.url.includes('/mobile/playlist.php')&&x.body)){
  const id=new URL(req.url).searchParams.get('id'),entries=JSON.parse(req.body);
  for(const src of entries.flatMap(e=>e.sources||[])){console.log(id,'mobile',src.label);await audit(new URL(src.file,'https://net52.cc').href,req.headers,'mobile '+src.label,id);}
  const headers={...req.headers,Referer:'https://net77.cc/home',Origin:'https://net77.cc','Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'};
  const play=await request('https://net77.cc/play.php',headers,'id='+id);
  try{const h=JSON.parse(play.body).h;if(h){const pl=await request('https://net52.cc/playlist.php?id='+id+'&t=probe&tm='+Math.floor(Date.now()/1000)+'&h='+encodeURIComponent(h),headers);for(const s of JSON.parse(pl.body).flatMap(x=>x.sources||[])){console.log(id,'native',s.label);await audit(new URL(s.file,'https://net52.cc').href,headers,'native '+s.label,id);}}}catch(e){report.requests.push({route:'native',id,error:e.message});}
 }
 for(const title of JSON.parse(fs.readFileSync(path.join(dir,'results.json'))))for(const row of title.paths.net27.rows)await request(row.url,row.headers,undefined,true);
 save();console.log('Audit complete',report.masters.length,'masters');
})();
