// Read-only follow-up gate. Does not change the production provider or manifest.
// Raw signing/cookie data remains in the sibling private evidence directory.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const candidate=require('./lib/netmirror-playback-candidate.cjs');
const directory=path.resolve(__dirname,'../../netmirror-evidence/device-followup');
fs.mkdirSync(directory,{recursive:true});
const evidence={baseline:'b0d86c9',started:new Date().toISOString(),requests:[],titles:[]};
const deadline=Date.now()+240000;
const save=()=>fs.writeFileSync(path.join(directory,'stability.json'),JSON.stringify(evidence,null,2));
async function read(url,options={}){
 if(Date.now()>=deadline)throw Error('probe deadline');
 const record={url:String(url),headers:options.headers,method:options.method||'GET',started:new Date().toISOString()};evidence.requests.push(record);
 try{
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(6000)});
  const body=await r.text();Object.assign(record,{status:r.status,urlAfterRedirect:r.url,body});save();
  return{ok:r.ok,status:r.status,url:r.url,headers:r.headers,text:async()=>body,json:async()=>JSON.parse(body)};
 }catch(e){record.error=e.message;save();throw e;}
}
const code=execFileSync('git',['show','b0d86c9:custom/providers/netmirror-standalone-nexus-v1.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
const sandbox={module:{exports:{}},URL,atob,AbortController,setTimeout,clearTimeout,console,fetch:read};
vm.createContext(sandbox);
vm.runInContext(code+'\nmodule.exports.probe={mobileBypass,mobileRequest,mobileJson,resolveApiUrl,buildNewTvHeaders,MOBILE_WEB_UA,NET27_UA};',sandbox);
const transport=sandbox.module.exports.probe;
async function verify(title,row,context){
 const rejected=[];
 const result=await candidate.verifyCandidate(row,context,{
  // A later fetch models the player's separate request, not just a back-to-back cache hit.
  delays:[0,2000,8000],pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  read:async(url,headers)=>{const r=await read(url,{headers});if(!r.ok)throw Error('HTTP '+r.status);return{url:r.url,body:await r.text()};},
  rejected:r=>rejected.push(r)
 });
 title.candidates.push({route:row.route,label:row.label,url:row.url,exportedHeaders:row.headers,result,rejected});save();
 console.log(title.title,row.route,row.label,result?'PASS '+result.quality:'REJECT '+rejected[0]?.reason);
 return result;
}
(async()=>{
 console.log('Acquiring fresh mobile verification; production stays unchanged.');
 const cookie=await transport.mobileBypass({deadline:Date.now()+52000});
 if(!cookie)throw Error('Fresh mobile verification unavailable; live replacement gate NOT satisfied');
 for(const [name,tmdbId,episodeId,originalLanguage]of [['Teach You a Lesson',276161,'81947712','ko'],['Centaurworld',93233,'81048667','en'],['Squid Game',93405,'81262746','ko']]){
  const entry={title:name,tmdbId,episodeId,candidates:[]};evidence.titles.push(entry);
  const metadata=await(await read(`https://api.themoviedb.org/3/tv/${tmdbId}/season/1/episode/1?api_key=1865f43a0549ca50d341dd9ab8b29f49`)).json();
  entry.runtimeSeconds=Number(metadata.runtime)*60;
  const context={title:name,tmdbId,season:1,episode:1,episodeId,originalLanguage,runtimeSeconds:entry.runtimeSeconds};
  const apiHeaders={'User-Agent':transport.MOBILE_WEB_UA,Accept:'*/*','Accept-Language':'en-IN,en-US;q=0.9,en;q=0.8','X-Requested-With':'app.netmirror.netmirrornew',Referer:'https://net52.cc/mobile/home?app=1',Cookie:'t_hash_t='+cookie+'; ott=nf; hd=on'};
  const exportedHeaders={...apiHeaders};delete exportedHeaders.Cookie;delete exportedHeaders['X-Requested-With'];
  const payload=await transport.mobileJson(`https://net52.cc/mobile/playlist.php?id=${episodeId}&t=${encodeURIComponent(name)}&tm=${Math.floor(Date.now()/1000)}`,apiHeaders,{deadline});
  const entries=sandbox.module.exports.__test.playlistEntries(payload).filter(e=>sandbox.module.exports.__test.playlistEpisodeMatches(e,episodeId));
  const accepted=[];
  // Audit every returned source; never synthesize a quality URL not supplied by NetMirror.
  for(const playlist of entries)for(const source of playlist.sources||[]){
   const subtitles=(playlist.tracks||[]).filter(t=>/caption|subtitle/i.test(t.kind||''));
   const result=await verify(entry,{url:new URL(source.file,'https://net52.cc').href,headers:exportedHeaders,subtitles,route:'mobile',label:source.label},context);
   if(result)accepted.push(result);
  }
  entry.selected=candidate.selectCandidates(accepted,context);
  // Final player-style revalidation after all candidate selection, with another delay.
  entry.playerChecks=[];
  for(const selected of entry.selected){
   const rejections=[];const result=await candidate.verifyCandidate(selected,context,{delays:[5000,1000,1000],pause:ms=>new Promise(r=>setTimeout(r,ms)),read:async(url,headers)=>{const r=await read(url,{headers});if(!r.ok)throw Error('HTTP '+r.status);return{url:r.url,body:await r.text()};},rejected:r=>rejections.push(r)});
   entry.playerChecks.push({url:selected.url,passed:!!result&&result.validation.fingerprint===selected.validation.fingerprint,rejections});
  }
  entry.gatePassed=entry.selected.length>0&&entry.playerChecks.every(c=>c.passed);
  save();console.log(name,'live replacement gate',entry.gatePassed?'PASS':'FAIL');
 }
 evidence.gatePassed=evidence.titles.length===3&&evidence.titles.every(t=>t.gatePassed);save();
 if(!evidence.gatePassed)process.exitCode=1;
})().catch(e=>{evidence.error=e.message;save();console.error(e.message);process.exitCode=1;});
