// Supplement the mobile quality audit with every fresh native sources[] row.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const candidate=require('./lib/netmirror-playback-candidate.cjs');
const dir=path.resolve(__dirname,'../../netmirror-evidence/device-followup');
const prior=JSON.parse(fs.readFileSync(path.join(dir,'stability.json')));
const requests=[],titles=[];
async function fetchRecorded(url,options={}){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(6000)});const body=await r.text();
 requests.push({url:String(url),headers:options.headers,status:r.status,body});
 return{ok:r.ok,status:r.status,headers:r.headers,url:r.url,text:async()=>body,json:async()=>JSON.parse(body)};
}
const code=execFileSync('git',['show','b0d86c9:custom/providers/netmirror-standalone-nexus-v1.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
const sandbox={module:{exports:{}},fetch:fetchRecorded,URL,AbortController,setTimeout,clearTimeout,atob,console};
vm.createContext(sandbox);vm.runInContext(code,sandbox);const api=sandbox.module.exports.__test;
const seed=prior.requests.find(r=>r.url.includes('/mobile/playlist.php'))?.headers?.Cookie;
if(seed)for(const pair of seed.split(';'))api.mobileSetCookies(new Headers({'set-cookie':pair.trim()+'; Domain=net52.cc; Path=/; Secure'}),'https://net52.cc/mobile/home');
(async()=>{
 for(const title of prior.titles){
  const start=requests.length;
  const context={title:title.title,tmdbId:title.tmdbId,season:1,episode:1,mediaType:'tv',originalLanguage:title.title==='Centaurworld'?'en':'ko',runtimeSeconds:title.runtimeSeconds,deadline:Date.now()+25000,shared:{netflixMatch:{targetId:title.episodeId}}};
  try{await api.fetchFromNetflixNative(context);}catch{}
  const playlist=requests.slice(start).find(r=>new URL(r.url).pathname==='/playlist.php');
  const record={title:title.title,candidates:[]};titles.push(record);
  if(!playlist){record.error='Native playlist unavailable';continue;}
  const headers={...api.playbackHeaders(playlist.url,playlist.headers)};delete headers.Cookie;delete headers.Origin;
  for(const entry of api.playlistEntries(JSON.parse(playlist.body)).filter(e=>api.playlistEpisodeMatches(e,title.episodeId)))for(const source of entry.sources||[]){
   const rejections=[];const row={url:new URL(source.file,'https://net52.cc').href,headers,subtitles:(entry.tracks||[]).filter(t=>/caption|subtitle/i.test(t.kind||''))};
   const result=await candidate.verifyCandidate(row,{...context,episodeId:title.episodeId},{delays:[0,2000,8000],pause:ms=>new Promise(r=>setTimeout(r,ms)),read:async(url,headers)=>{const r=await fetchRecorded(url,{headers});if(!r.ok)throw Error('HTTP '+r.status);return{url:r.url,body:await r.text()};},rejected:r=>rejections.push(r)});
   record.candidates.push({label:source.label,url:row.url,result,rejections});
   console.log(title.title,source.label,result?'PASS '+result.quality:'REJECT '+rejections[0]?.reason);
  }
 }
 fs.writeFileSync(path.join(dir,'native-quality-audit.json'),JSON.stringify({titles,requests},null,2)+'\n');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
