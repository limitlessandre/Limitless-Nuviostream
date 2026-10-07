// Diagnostic-only binary probe. Nuvio's text-only fetch bridge is not changed.
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../../netmirror-evidence/device-followup');
const data=JSON.parse(fs.readFileSync(path.join(dir,'stability.json')));
function tsStreams(bytes){
 const streams=[];
 for(let start=0;start<Math.min(188,bytes.length);start++){
  if(bytes[start]!==0x47||bytes[start+188]!==0x47)continue;
  for(let packet=start;packet+188<=bytes.length;packet+=188){
   if(bytes[packet]!==0x47)break;
   const control=(bytes[packet+3]>>4)&3;if(!(control&1)||!(bytes[packet+1]&0x40))continue;
   let p=packet+4;if(control&2)p+=1+bytes[p];if(p>=packet+188)continue;p+=1+bytes[p];
   if(bytes[p]!==2)continue;
   const end=Math.min(packet+188,p+3+((bytes[p+1]&15)<<8|bytes[p+2])-4);
   let q=p+12+((bytes[p+10]&15)<<8|bytes[p+11]);
   while(q+5<=end){streams.push({type:bytes[q],pid:(bytes[q+1]&31)<<8|bytes[q+2]});q+=5+((bytes[q+3]&15)<<8|bytes[q+4]);}
  }
  break;
 }
 return [...new Map(streams.map(s=>[s.type+':'+s.pid,s])).values()];
}
(async()=>{
 const results=[];
 for(const title of data.titles)for(const selected of title.selected||[]){
  for(const [kind,url]of [['video',selected.hls.variants[0].url],['english',selected.audioTracks.find(t=>t.language==='en')?.url]]){
   if(!url)continue;
   const playlist=await(await fetch(url,{headers:selected.headers,signal:AbortSignal.timeout(6000)})).text();
   const segment=playlist.split(/\r?\n/).find(l=>l.trim()&&!l.startsWith('#'));if(!segment)throw Error('Missing segment');
   const segmentUrl=new URL(segment,url).href;
   const r=await fetch(segmentUrl,{headers:{...selected.headers,Range:'bytes=0-65535'},signal:AbortSignal.timeout(6000)});
   const reader=r.body.getReader();const chunks=[];let length=0;
   while(length<65536){const next=await reader.read();if(next.done)break;chunks.push(next.value);length+=next.value.length;}
   await reader.cancel();const bytes=Buffer.concat(chunks.map(x=>Buffer.from(x))).subarray(0,65536);
   const streams=tsStreams(bytes);const hasVideo=streams.some(s=>[1,2,0x10,0x1b,0x24,0x42].includes(s.type));
   results.push({title:title.title,kind,url:segmentUrl.split('?')[0],status:r.status,headers:selected.headers,bytes:bytes.length,streams,hasVideo});
   console.log(title.title,kind,r.status,'video='+hasVideo,'PMT types='+streams.map(s=>s.type.toString(16)).join(','));
  }
 }
 fs.writeFileSync(path.join(dir,'packet-validation.json'),JSON.stringify(results,null,2)+'\n');
 if(results.filter(r=>r.kind==='video').length!==3||results.some(r=>r.kind==='video'&&!r.hasVideo))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
