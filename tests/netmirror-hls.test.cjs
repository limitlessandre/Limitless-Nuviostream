const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../custom/providers/netmirror-standalone-nexus-v1.js'),'utf8');
const fixture=(id,route='mobile')=>fs.readFileSync(path.join(__dirname,`fixtures/netmirror/${id}-${route}.m3u8`),'utf8');
const media='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST';
const response=(body,extra={})=>({ok:true,status:200,text:async()=>typeof body==='string'?body:JSON.stringify(body),...extra});
const context=(extra={})=>({tmdbId:276161,mediaType:'tv',season:1,episode:1,originalLanguage:'ko',title:'Teach You a Lesson',aliases:[],...extra});
function harness(fetch,extras={}){
 const calls=[];const sandbox={URL,AbortController,setTimeout,clearTimeout,atob,console,module:{exports:{}},
  fetch:async(url,options)=>{calls.push({url:String(url),options});return fetch(String(url),options);},...extras};
 vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,sandbox);
 return{api:sandbox.module.exports,helpers:sandbox.module.exports.__test,calls};
}
function row(api,body,url='https://net52.cc/mobile/hls/81947712.m3u8?in=one',extra={}){
 const hls=api.parseHls(body,url);return{url,quality:Math.max(...hls.variants.map(v=>v.height))+'p',hls,audioTracks:hls.audioTracks,embeddedSubtitles:hls.subtitleTracks,subtitles:[],...extra};
}
test('captured mobile masters preserve reachable audio groups and actual qualities',()=>{
 const h=harness(()=>{throw Error('offline');});
 for(const [id,count,height]of [['81947712',20,1080],['81048667',32,720],['81262746',25,1080]]){
  const r=row(h.helpers,fixture(id));assert.equal(r.audioTracks.length,count);
  assert.equal(r.quality,height+'p');assert.ok(r.audioTracks.some(t=>t.language==='en'));
  assert.ok(r.audioTracks.some(t=>t.language==='ko'));assert.equal(r.embeddedSubtitles.length,0);
  assert.equal(h.helpers.classification(r,context()),'[DUAL]');
  assert.equal(r.audioTracks.find(t=>t.language==='en').default,true);
  assert.equal(r.audioTracks[0].autoselect,null);
 }
});
test('NewTV embedded subtitle groups preserve names, flags, languages and relative URI resolution',()=>{
 const h=harness(()=>{});const r=row(h.helpers,fixture('81947712','newtv'));
 assert.equal(r.embeddedSubtitles.length,9);const en=r.embeddedSubtitles.find(t=>t.name==='English');
 assert.equal(en.groupId,'subs');assert.equal(en.default,true);assert.equal(en.autoselect,true);
 const parsed=h.helpers.parseHls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="eng",NAME="English, Commentary",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=5,AUDIO="a"\nvideo.m3u8','https://host.test/dir/master.m3u8');
 assert.equal(parsed.audioTracks[0].name,'English, Commentary');assert.equal(parsed.audioTracks[0].url,'https://host.test/dir/audio.m3u8');
});
test('orphan audio declarations and repeated identical tracks do not create false DUAL',()=>{
 const h=harness(()=>{});const track='#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="eng",NAME="English",URI="en.m3u8"';
 const body=`#EXTM3U\n${track}\n${track}\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="unused",LANGUAGE="kor",NAME="Korean",URI="ko.m3u8"\n#EXT-X-STREAM-INF:AUDIO="a"\nvideo.m3u8`;
 const r=row(h.helpers,body);assert.equal(r.audioTracks.length,1);assert.equal(h.helpers.classification(r,context()),'[DUB]');
});
test('naming uses actual audio/subtitle evidence, never TMDB original language alone',()=>{
 const classify=harness(()=>{}).helpers.classification;
 const subs=[{url:'https://subs.test/en.vtt',language:'en'}];
 for(const [r,tag]of [[{},'[UNK]'],[{subtitles:subs},'[UNK]'],[{audioLanguage:'eng'},'[DUB]'],[{audioLanguage:'en',subtitles:subs},'[DUB+SUB]'],[{audioLanguage:'ko',subtitles:subs},'[SUB]'],[{audioLanguage:'ko'},'[UNK]'],[{hardSub:true},'[HSUB]']])assert.equal(classify(r,context({originalLanguage:'en'})),tag);
});
test('rejects correct-looking NewTV audio/subtitles when video belongs to common asset 220884',async()=>{
 const h=harness(()=>response(fixture('81947712','newtv')));
 assert.equal(await h.helpers.inspectHls({url:'https://tv.test/master.m3u8',headers:{}},context(),'81947712'),null);
 assert.equal(h.calls.length,1);assert.match(h.helpers.diagnostics().at(-1).reason,/identity mismatch/);
});
test('HTTP 200 HTML in a child rejects the master, and no cookie leaks to playback hosts',async()=>{
 const h=harness(url=>response(url.includes('master')?fixture('81947712'):'<h1>Only Valid Users Allowed</h1>'));
 h.helpers.mobileSetCookies(new Headers({'set-cookie':'t_hash_t=secret; Domain=net52.cc; Path=/; Secure'}),'https://net52.cc/mobile/home');
 const result=await h.helpers.inspectHls({url:'https://net52.cc/master.m3u8',headers:{Referer:'https://net52.cc/mobile/home',Cookie:'t_hash_t=secret'}},context(),'81947712');
 assert.equal(result,null);assert.ok(h.calls.every(c=>!c.options.headers.Cookie));
 assert.ok(h.calls.every(c=>c.options.headers.Referer==='https://net52.cc/mobile/home'));
});
test('semantic dedup ignores signing and duplicate STREAM-INF entries without discarding audio sets',()=>{
 const a=harness(()=>{}).helpers;const first=row(a,fixture('81048667'),'https://net52.cc/mobile/hls/81048667.m3u8?in=one');
 const second=row(a,fixture('81048667').replace(/<redacted>/g,'new-signature'),'https://net52.cc/mobile/hls/81048667.m3u8?q=720p&in=two');
 assert.equal(a.semanticDedupe([first,second],context()).length,1);
 const english={...first,audioTracks:[first.audioTracks.find(t=>t.language==='en')]};
 const korean={...first,audioTracks:[first.audioTracks.find(t=>t.language==='ko')]};
 assert.equal(a.semanticDedupe([english,korean],context()).length,2);
 assert.equal(a.semanticDedupe([first,{...first,subtitles:[{language:'en',url:'https://subs.test/en.vtt'}]}],context()).length,2);
 assert.notEqual(a.mediaIdentity('https://cdn.test/file.mp4?lang=en&sign=one'),a.mediaIdentity('https://cdn.test/file.mp4?lang=ko&sign=two'));
 assert.notEqual(a.mediaIdentity('https://cdn.test/a.mp4?sign=one'),a.mediaIdentity('https://cdn.test/b.mp4?sign=two'));
});
test('an intact multi-quality master replaces its contained rendition but not a different asset',()=>{
 const a=harness(()=>{}).helpers;const master=row(a,fixture('81947712'));const low={...master,url:master.url+'&q=720p',quality:'720p',hls:{...master.hls,variants:[master.hls.variants[1]]}};
 assert.equal(a.semanticDedupe([low,master],context()).length,1);
 const other={...low,hls:{...low.hls,variants:[{...low.hls.variants[0],url:'https://cdn.test/different.m3u8'}]}};
 assert.equal(a.semanticDedupe([master,other],context()).length,2);
});
test('subtitle merging accepts object/array playlists only for the matched episode',()=>{
 const a=harness(()=>{}).helpers;const entry={image2:'https://img.test/81947712.jpg',sources:[{file:'/mobile/hls/81947712.m3u8'}]};
 assert.equal(a.playlistEntries(entry).length,1);assert.equal(a.playlistEntries([entry]).length,1);
 assert.equal(a.playlistEpisodeMatches(entry,'81947712'),true);
 assert.equal(a.playlistEpisodeMatches(entry,'81048667'),false);
 assert.equal(a.playlistEpisodeMatches({...entry,id:'different'},'81947712'),false);
});
test('cookie storage respects host-only, domain, path, expiry and origin boundaries',()=>{
 const a=harness(()=>{}).helpers;
 a.mobileSetCookies(new Headers({'set-cookie':'one=secret; Path=/mobile; Secure'}),'https://net52.cc/mobile/home');
 assert.match(a.mobileCookieHeader('https://net52.cc/mobile/playlist.php'),/one=secret/);
 assert.equal(a.mobileCookieHeader('https://userver.net52.cc/mobile/playlist.php'),'');
 assert.equal(a.mobileCookieHeader('https://net52.cc/mobile-evil'),'');
 a.mobileSetCookies(new Headers({'set-cookie':'bad=secret; Domain=evil.test'}),'https://net52.cc/mobile/home');
 assert.equal(a.mobileCookieHeader('https://evil.test/'),'');
 assert.equal(a.playbackHeaders('https://cdn.test/master.m3u8',{Cookie:'secret',Origin:'private',Referer:'https://net52.cc/'}).Cookie,undefined);
 a.mobileSetCookies(new Headers({'set-cookie':'one=gone; Path=/mobile; Max-Age=0'}),'https://net52.cc/mobile/home');
 assert.equal(a.mobileCookieHeader('https://net52.cc/mobile/playlist.php'),'');
});
test('fetch and body stalls settle on deadlines even when the transport ignores abort',async()=>{
 for(const fetch of [()=>new Promise(()=>{}),()=>({ok:true,text:()=>new Promise(()=>{})})]){
  const h=harness(fetch);const start=Date.now();
  await assert.rejects(h.helpers.request('https://stalled.test/',{}, {deadline:Date.now()+25}),/timeout/);
  assert.ok(Date.now()-start<500);
 }
 const h=harness(()=>new Promise(()=>{}));
 const result=await h.helpers.runStage(context(),'stall',25,c=>h.helpers.request('https://stalled.test/',{},c));
 assert.equal(result.length,0);assert.ok(h.calls[0].options.signal.aborted);
});
test('timerless runtimes fail promptly instead of busy-waiting or starting unbounded requests',async()=>{
 const h=harness(()=>{throw Error('must not fetch');},{setTimeout:undefined,clearTimeout:undefined});
 await assert.rejects(h.helpers.request('https://test/'),/timers unavailable/);assert.equal(h.calls.length,0);
});
test('successful mobile playlist survives const regression and collapses Centaurworld duplicate rows',async()=>{
 const h=harness(url=>{
  if(url.includes('/mobile/home'))return response('<div data-addhash="test"></div>');
  if(url.includes('userver.net52'))return response('ok');
  if(url.includes('verify2.php'))return response({statusup:'All Done'},{headers:new Headers({'set-cookie':'t_hash_t=test; Path=/; Secure'})});
  if(url.includes('/mobile/playlist.php'))return response([{image2:'https://img.test/81048667.jpg',sources:[{file:'/mobile/hls/81048667.m3u8?in=one',label:'Auto'},{file:'/mobile/hls/81048667.m3u8?q=720p&in=two',label:'Mid HD'}],tracks:[{kind:'captions',file:'https://subscdn.top/subs/81048667/en.[CC].vtt',label:'English [CC]'}]}]);
  if(url.includes('/mobile/hls/'))return response(fixture('81048667'));
  return response(media);
 },{setTimeout:(fn,ms)=>setTimeout(fn,ms===10000?0:ms)});
 const rows=await h.helpers.fetchFromNetflixMobile(context({originalLanguage:'en',shared:{netflixMatch:{targetId:'81048667',title:'Centaurworld'}}}),true);
 assert.equal(rows.length,1);assert.equal(rows[0].audioTracks.length,32);assert.equal(rows[0].subtitles.length,1);
 assert.equal(h.helpers.classification(rows[0],context()),'[DUAL]');assert.equal(rows[0].headers.Cookie,undefined);
 assert.ok(h.helpers.diagnostics().some(x=>x.event==='dedup'));
});
