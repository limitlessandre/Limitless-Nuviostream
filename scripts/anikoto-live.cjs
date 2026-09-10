// Live discovery and transport checks. Does not claim Nuvio playback.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {patchSource} = require('../custom/providers/anikototv-nexus-v6');
const {start} = require('../tools/anikoto-relay');
const root = path.resolve(__dirname,'../custom/providers');
async function boundedFetch(url, options={}) {
  const started=Date.now();const r=await fetch(url,{...options,signal:AbortSignal.timeout(8000)});
  console.log('REQUEST',new URL(url).hostname,new URL(url).pathname,r.status,Date.now()-started);
  return r;
}
async function main() {
  const segmentCount=Math.min(30,Math.max(1,Number(process.argv[2]||5)));
  let failures=0;
  const code=patchSource(fs.readFileSync(path.join(root,'anikototv-nexus-v5.js'),'utf8'),fs.readFileSync(path.join(root,'anikoto-sources.js'),'utf8'));
  const c=vm.createContext({module:{exports:{}},fetch:boundedFetch,URL,TextDecoder,TextEncoder,Uint8Array,crypto,atob,setTimeout,clearTimeout,console});
  vm.runInContext(code+'\nmodule.exports.canary=async()=>{const identity={title:"Mushoku Tensei: Jobless Reincarnation",animeAliases:["Mushoku Tensei: Isekai Ittara Honki Dasu"],anilistId:108465,malId:39535};const servers=await aniSources.discover(identity,1);return {servers,rows:(await Promise.all(["sub","dub"].map(mode=>aniSources.resolveMode(identity,1,mode)))).flat()};};',c);
  const result=await c.module.exports.canary();
  if(!result.rows.some(x=>x.mode==='sub')||!result.rows.some(x=>x.mode==='dub'))throw new Error('Canary requires both SUB and DUB');
  console.log('DISCOVERED',JSON.stringify(result.servers.map(x=>({name:x.name,mode:x.mode}))));
  console.log('SOURCES',JSON.stringify(result.rows.map(x=>({server:x.server,mode:x.mode,host:new URL(x.url).hostname,subtitles:x.subtitles.length}))));
  const app=await start({port:0});
  try {
    for (const row of result.rows) {
      const startTime=Date.now();
      try {
        let validated=false;
        let url='http://127.0.0.1:'+app.port+'/play?url='+encodeURIComponent(row.url)+'&embed='+encodeURIComponent(row.embed)+'&mode='+row.mode+'&referer='+encodeURIComponent(row.headers.Referer);
        for (let depth=0;depth<4;depth++) {
          const r=await fetch(url,{signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok||!text.startsWith('#EXTM3U'))throw new Error('playlist '+r.status+' '+text.slice(0,100));
          const lines=text.split('\n').filter(x=>x&&!x.startsWith('#'));
          if(text.includes('#EXT-X-STREAM-INF')) {url=lines[0];continue;}
          for (const segment of lines.slice(0,segmentCount)) {
            const begin=Date.now(),response=await fetch(segment,{signal:AbortSignal.timeout(30000)}),data=new Uint8Array(await response.arrayBuffer());
            if(!response.ok||data[0]!==71||data[188]!==71||data[376]!==71)throw new Error('segment '+response.status+' '+(!response.ok?new TextDecoder().decode(data).slice(0,200):'invalid TS'));
            console.log('SEGMENT',row.server,row.mode,data.length,Date.now()-begin+'ms');
          }
          validated=true;console.log('TRANSPORT_OK',row.server,row.mode,Date.now()-startTime+'ms');break;
        }
        if(!validated)throw new Error('Playlist recursion exhausted');
      } catch(e) {failures++;console.log('TRANSPORT_FAIL',row.server,row.mode,e.message);}
      for(const sub of row.subtitles) {
        const r=await fetch('http://127.0.0.1:'+app.port+'/subtitle?url='+encodeURIComponent(sub.url),{signal:AbortSignal.timeout(30000)});
        const body=await r.text(),valid=r.ok&&body.replace(/^\uFEFF/,'').startsWith('WEBVTT');console.log('SUBTITLE',row.mode,sub.name,r.status,valid?'VTT':'unverified',body.length);if(!valid)failures++;
      }
    }
    console.log('CACHE',JSON.stringify(app.relay.stats));
  } finally {await app.close();}
  if(failures)throw new Error(failures+' live transport checks failed');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
