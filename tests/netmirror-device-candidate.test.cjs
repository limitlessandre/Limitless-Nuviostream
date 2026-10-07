const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const proposal=require('../scripts/lib/netmirror-playback-candidate.cjs');
const baselineSource=require('node:child_process').execFileSync('git',['show','b0d86c9:custom/providers/netmirror-standalone-nexus-v1.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
const baselineSandbox={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,console};
vm.createContext(baselineSandbox);vm.runInContext(baselineSource,baselineSandbox);
const provider=baselineSandbox.module.exports.__test;
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/netmirror',name),'utf8');
const ctx={tmdbId:93233,season:1,episode:1,episodeId:'81048667',originalLanguage:'en',runtimeSeconds:1440};
const master=fixture('81048667-mobile.m3u8');
const fullMedia=fixture('device/81048667-video.m3u8');
const english=fixture('device/81048667-english.m3u8');
const tiny=fixture('device/centaurworld-19s.m3u8');
const auto='https://net52.cc/mobile/hls/81048667.m3u8?in=fixture-token&hd=on&hp=yes';
const mid='https://net52.cc/mobile/hls/81048667.m3u8?in=fixture-token&q=720p';
const headers={Referer:'https://net52.cc/mobile/home?app=1','User-Agent':'fixture-client'};
const row=(url=mid)=>({url,headers,subtitles:[],name:'NetMirror'});
function reader(options={}){
 let round=0;const calls=[],rejections=[];
 return {calls,rejections,delays:[0,0,0],pause:async()=>{},rejected:r=>rejections.push(r),read:async(url,h)=>{
  calls.push({url,headers:h});
  if(url===auto||url===mid||options.masterUrl===url){round++;return{url,body:typeof options.master==='function'?options.master(round):options.master||master};}
  const audio=/\/a\/\d+\//.test(url);return{url,body:audio?options.audio||english:typeof options.video==='function'?options.video(round):options.video||fullMedia};
 }};
}
test('baseline b0d86c9 accepts a 19-second video and never refetches its master',async()=>{
 const calls=[];const sandbox={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,console,fetch:async(url)=>{
  calls.push(url);return{ok:true,status:200,text:async()=>url===auto?master:/\/a\//.test(url)?english:tiny};
 }};
 vm.createContext(sandbox);vm.runInContext(baselineSource,sandbox);
 const accepted=await sandbox.module.exports.__test.inspectHls(row(auto),ctx,'81048667');
 assert.ok(accepted,'Baseline must reproduce the false acceptance');assert.equal(calls.filter(u=>u===auto).length,1);
 assert.equal(accepted.quality,'720p');assert.equal(accepted.audioTracks.length,32);
});
test('baseline first-wins dedup chooses Auto over the quality-specific URL',()=>{
 const hls=provider.parseHls(master,auto);
 const r={...row(auto),quality:'720p',hls,audioTracks:hls.audioTracks,embeddedSubtitles:[]};
 assert.equal(provider.semanticDedupe([r,{...r,url:mid}],ctx)[0].url,auto);
});
test('candidate rejects Centaurworld 19-second video even with a correct parent and full audio',async()=>{
 const io=reader({video:tiny});assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);
 assert.equal(io.rejections[0].reason,'implausible-video-duration');
});
test('candidate rejects a tiny item even if both audio and video shrink together',async()=>{
 const io=reader({video:tiny,audio:tiny});assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);
 assert.equal(io.rejections[0].reason,'implausible-video-duration');
});
test('legitimate shorts pass relative duration checks without a fixed minimum',()=>{
 assert.equal(proposal.durationPlausible(19,[19.1],20),true);
 assert.equal(proposal.durationPlausible(19,[19.1],60),true);
 assert.equal(proposal.durationPlausible(19,[19.1],1440),false);
 assert.equal(proposal.durationPlausible(19,[1450]),false);
});
test('candidate rejects masters that turn into audio-only content or another episode',async()=>{
 for(const bad of [tiny,master.replaceAll('/files/81048667/','/files/220884/'),master.replace(/RESOLUTION=[^,\n]+/g,'CODECS="mp4a.40.2"')]){
  const io=reader({master:n=>n===1?master:bad});assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);
  assert.equal(io.rejections[0].completedRounds,1);
 }
});
test('candidate checks repeated child durations and media identity, not just parent strings',async()=>{
 for(const video of [n=>n===1?fullMedia:tiny,n=>n===1?fullMedia:fullMedia.replace(/7043_/g,'wrongasset_')]){
  const io=reader({video});assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);
  assert.equal(io.rejections[0].completedRounds,1);
 }
});
test('candidate rejects changing audio and subtitle sets',async()=>{
 for(const transform of [m=>m.replace(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*LANGUAGE="eng"[^\n]*\n/,'') ,m=>m.replace('#EXT-X-STREAM-INF:','#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="newsubs",NAME="English",LANGUAGE="en",URI="https://subscdn.top/subs/81048667/en.m3u8"\n#EXT-X-STREAM-INF:SUBTITLES="newsubs",')]){
  const io=reader({master:n=>n===1?master:transform(master)});assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);
  assert.equal(io.rejections[0].reason,'master-mutated');
 }
});
test('stable Mid HD survives three exact-header fetches and beats equivalent Auto',async()=>{
 const io=reader();const stable=await proposal.verifyCandidate(row(),ctx,io);assert.ok(stable);
 assert.equal(stable.validation.rounds,3);assert.equal(io.calls.filter(c=>c.url===mid).length,3);
 assert.ok(io.calls.every(c=>JSON.stringify(c.headers)===JSON.stringify(headers)));
 const automatic=await proposal.verifyCandidate(row(auto),ctx,reader());assert.ok(automatic);
 const selected=proposal.selectCandidates([automatic,stable],ctx);assert.equal(selected.length,1);assert.equal(selected[0].url,mid);
});
test('unstable broader Auto cannot supersede a stable master; separate verified quality rows survive',async()=>{
 const stable=await proposal.verifyCandidate(row(),ctx,reader());
 const unstable={...stable,url:auto,quality:'1080p',validation:{...stable.validation,stable:false}};
 assert.deepEqual(proposal.selectCandidates([unstable,stable],ctx).map(r=>r.url),[mid]);
 const high={...stable,url:mid.replace('720p','1080p'),quality:'1080p',hls:{...stable.hls,variants:stable.hls.variants.map(v=>({...v,height:1080,url:v.url.replaceAll('720p','1080p')}))}};
 assert.equal(proposal.selectCandidates([stable,high],ctx).length,2);
});
test('Teach You a Lesson retains English and Korean; Squid Game retains multi-audio master',async()=>{
 for(const id of ['81947712','81262746']){
  const url=`https://net52.cc/mobile/hls/${id}.m3u8?q=720p&in=fixture-token`;
  const body=fixture(id+'-mobile.m3u8');
  const io=reader({masterUrl:url,master:body,video:fixture('device/'+id+'-video.m3u8'),audio:fixture('device/'+id+'-english.m3u8')});
  const result=await proposal.verifyCandidate(row(url),{...ctx,episodeId:id,runtimeSeconds:3600,originalLanguage:'ko'},io);
  assert.ok(result);assert.equal(result.url,url);assert.ok(result.audioTracks.some(t=>t.language==='en'));assert.ok(result.audioTracks.some(t=>t.language==='ko'));
 }
});
test('subtitle language codes strip content IDs and annotations without losing labels or regions',()=>{
 for(const [raw,expected]of [['ar','ar'],['en.[CC]','en'],['cs(1)','cs'],['es-ES.[CC]','es-ES'],['81947712-en.[CC]','en'],['81048667-pt-BR','pt-BR'],['81262746-zh-Hans','zh-Hans']])assert.equal(proposal.language(raw),expected);
 const cc=proposal.normalizeSubtitle({file:'https://subscdn.top/files/81947712/81947712-en.[CC].srt',label:'English [CC]'});
 assert.equal(cc.language,'en');assert.equal(cc.name,'English [CC]');
 const tracks=proposal.normalizeSubtitles([{file:'https://subscdn.top/files/81947712/81947712-en.srt',label:'English'},cc],[{url:'https://subscdn.top/subs/81947712/en.m3u8',language:'en',name:'English'}]);
 assert.equal(tracks.length,2);assert.ok(tracks.some(t=>t.name==='English'));assert.ok(tracks.some(t=>t.name==='English [CC]'));
});
test('audio cleanup preserves commentary, accessibility, channel and regional distinctions',()=>{
 const audio=(name,extra='')=>`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="eng",NAME="${name}",URI="en.m3u8"${extra}`;
 const body=['#EXTM3U',audio('English'),audio('English'),audio('English',',CHARACTERISTICS="public.accessibility.describes-video"'),audio('English',',CHANNELS="6"'),audio('English Commentary'),'#EXT-X-STREAM-INF:AUDIO="a",RESOLUTION=1280x720','video.m3u8'].join('\n');
 const parsed=proposal.parsePlaylist(body,'https://cdn.test/master.m3u8');assert.equal(parsed.audioTracks.length,4);
 assert.ok(parsed.audioTracks.some(t=>t.channels==='6'));assert.ok(parsed.audioTracks.some(t=>t.characteristics.includes('accessibility')));
});

test('production contains the same playback policy that passed the pre-production gate',()=>{
 const actual=require('../custom/providers/netmirror-standalone-nexus-v1.js').__test.playback;
 const normalize=fn=>fn.toString().replace('rounds.at(-1)','rounds[rounds.length - 1]').replace(/\s+/g,' ');
 for(const key of Object.keys(proposal))assert.equal(normalize(actual[key]),normalize(proposal[key]),key);
});

test('new production rejects the reported tiny video that the baseline accepts',async()=>{
 const production=require('../custom/providers/netmirror-standalone-nexus-v1.js').__test.playback;
 const io=reader({video:tiny});assert.equal(await production.verifyCandidate(row(),ctx,io),null);
 assert.equal(io.rejections[0].reason,'implausible-video-duration');
});

test('video segment reordering is a content change even when duration and URLs are otherwise equal',async()=>{
 const reversed=fullMedia.replace(/7043_000/g,'TEMP').replace(/7043_001/g,'7043_000').replace(/TEMP/g,'7043_001');
 const io=reader({video:n=>n===1?fullMedia:reversed});
 assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);assert.equal(io.rejections[0].reason,'video-child-mutated');
});

test('invalid default/English audio fails validation instead of advertising unusable DUAL',async()=>{
 const io=reader({audio:'#EXTM3U\n#EXT-X-ENDLIST'});
 assert.equal(await proposal.verifyCandidate(row(),ctx,io),null);assert.equal(io.rejections[0].reason,'invalid-audio-media');
 assert.equal(proposal.normalizeSubtitle({url:'javascript:bad',label:'English'}),null);
});
