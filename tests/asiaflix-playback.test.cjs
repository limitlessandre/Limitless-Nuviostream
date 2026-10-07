const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../custom/providers/asiaflix-nexus-v10.js'),'utf8');
const key='94588293375053432799222445521289',iv='5259228356829423',signed='https://cdn.test/master.m3u8?t=abc%2BDEF&s=1&f=episode1';
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Korean",LANGUAGE="ko",URI="ko.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="en.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"\nvideo.m3u8';
const child='#EXTM3U\n#EXTINF:20,\nsegment.ts\n#EXT-X-ENDLIST';
function encrypt(s){const c=crypto.createCipheriv('aes-256-cbc',Buffer.from(key),Buffer.from(iv));return Buffer.concat([c.update(s),c.final()]).toString('base64');}
const host={source:'vidbasic',url:'https://vidbasic.top/embed/control1'};
function runtime(opts={}){
 const title=opts.suffix?"The Prosecutor's Proposal":'Unang Pasok',calls=[];
 const record={name:title,episodes:[{number:2,streamUrls:[{source:'vidbasic',url:'https://vidbasic.top/embed/WRONG'}]},{number:1,streamUrls:opts.hosts||[host]}]};
 const context={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,console,fetch:async(u,o)=>{
  calls.push({u,o});const url=new URL(u);let b,status=200;
  if(url.host==='api.themoviedb.org')b={name:title,title,original_language:'tl'};
  else if(url.pathname.endsWith('/detail'))b=opts.suffix&&url.searchParams.get('slug')==='the-prosecutor-s-proposal'?{name:title,episodes:null}:opts.wrongTitle?{...record,name:'Another Film'}:record;
  else if(url.pathname.endsWith('/search'))b={body:[{name:'Other drama',slug:'unrelated'},{name:title,slug:'the-prosecutor-s-proposal-3'}]};
  else if(url.pathname.endsWith('/get-stream-url')){b=opts.api?{sources:[{url:signed,isM3U8:true}]}:{message:'INTERNAL_ERR'};status=opts.api?200:500;}
  else if(url.pathname==='/embed/dead')b='<title>File not found</title>';
  else if(url.pathname==='/embed/control1')b='<title>'+title+' (2026) Episode '+(opts.wrongEpisode?2:1)+'</title><iframe id="embedvideo" src="/3rdplayer.html?id='+(opts.wrongId?'wrong':'control1')+'&key=public&sub='+encodeURIComponent(encrypt('https://cdn.test/en.vtt'))+'"></iframe>';
  else if(url.pathname==='/3rdplayer.html')b='<script data-name="crypto" data-value="'+encrypt(signed)+'"></script><script>const key=CryptoJS["enc"]["Utf8"]["parse"](\'9458829337\'+\'5053432799\'+\'2224455212\'+\'89\'),iv=CryptoJS["enc"]["Utf8"]["parse"](\'5259228356\'+\'829423\');</script>';
  else if(url.pathname==='/master.m3u8')b=opts.badMaster||master;
  else if(url.pathname==='/video.m3u8')b=opts.badChild||child;
  else throw Error('unexpected request '+u);
  return {ok:status===200,status,url:u,text:async()=>typeof b==='string'?b:JSON.stringify(b)};
 }};vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,context);return {api:context.module.exports,calls};
}
test('empty direct slug searches exact title and resolves numeric suffix -3',async()=>{
 const h=runtime({suffix:true,api:true}),rows=await h.api.getStreams(322055,'tv',1,1);assert.equal(rows.length,1);assert.ok(h.calls.some(x=>x.u.includes('slug=the-prosecutor-s-proposal-3')));assert.equal(h.calls.some(x=>x.u.includes('slug=unrelated')),false);
});
test('direct slug returns first-party intact dual master without fallback',async()=>{
 const h=runtime({api:true}),rows=await h.api.getStreams(1788779,'movie',1,1);assert.equal(rows[0].url,signed);assert.match(rows[0].name,/HD 720p.*\[DUAL\]/);assert.equal(rows[0].headers.Referer,'https://asiaflix.net/');assert.equal(h.calls.some(x=>x.u.includes('vidbasic.top')),false);
});
test('first-party request preserves full host URL and uses website alias server normalization',async()=>{
 const entry={source:'AsiaFlix-Drama123.TV-StreamWish',url:'https://hglink.to/e/control?x=a%2Bb&signed=z'};
 const h=runtime({api:true,hosts:[entry]});await h.api.getStreams(1,'tv',1,1);const c=h.calls.find(x=>x.u.includes('get-stream-url')),u=new URL(c.u);assert.equal(Buffer.from(u.searchParams.get('value'),'base64').toString(),entry.url);assert.equal(u.searchParams.get('server'),'streamwish');assert.equal(c.o.headers['X-Access-Control'],'web');
});
test('500 first-party resolver falls back to Standard Server with signed HLS and English caption',async()=>{
 const h=runtime(),rows=await h.api.getStreams(1788779,'movie',1,1);assert.equal(rows.length,1);assert.equal(rows[0].url,signed);assert.equal(rows[0].headers.Referer,'https://vidbasic.top/');assert.equal(rows[0].subtitles[0].url,'https://cdn.test/en.vtt');assert.equal(rows[0].subtitles[0].language,'en');assert.equal(h.calls.some(x=>/WRONG|\.js|jah|favicon/.test(x.u)),false);
});
test('dead first source does not suppress a different same-episode host',async()=>{
 const h=runtime({hosts:[{source:'vidbasic',url:'https://vidbasic.top/embed/dead'},host]});assert.equal((await h.api.getStreams(1,'tv',1,1)).length,1);assert.ok(h.calls.some(x=>x.u.includes('/embed/dead')));
});
test('wrong embedded episode or iframe identity is rejected before media fetch',async()=>{
 for(const opts of [{wrongEpisode:true},{wrongId:true},{wrongTitle:true}]){const h=runtime(opts);assert.equal((await h.api.getStreams(1,'tv',1,1)).length,0);assert.equal(h.calls.some(x=>x.u.includes('cdn.test')),false);}
});
test('missing episode never resolves the available different episode',async()=>{
 const h=runtime();assert.equal((await h.api.getStreams(1,'tv',1,9)).length,0);assert.equal(h.calls.some(x=>x.u.includes('get-stream-url')),false);
});
test('HTML master, bad child, and audio-only master fail closed',async()=>{
 for(const opts of [{badMaster:'<html>error</html>'},{badChild:'<html>error</html>'},{badMaster:'#EXTM3U\n#EXT-X-STREAM-INF:CODECS="mp4a.40.2"\nvideo.m3u8'}]){const h=runtime(opts);assert.equal((await h.api.getStreams(1,'tv',1,1)).length,0);}
});
test('AES decoder agrees with native AES across block boundaries and rejects corrupt data',()=>{
 const h=runtime();for(const size of [1,15,16,17,31,32,100,256]){const url='https://cdn.test/'+('a'.repeat(size))+'?x=é&signed=%2B';assert.equal(h.api.__test.aesUrl(encrypt(url),key,iv),url);}assert.throws(()=>h.api.__test.aesUrl('bad',key,iv));assert.throws(()=>h.api.__test.aesUrl(encrypt('not a URL'),key,iv));
});
test('standalone base64 encoding handles UTF-8 without runtime globals',()=>{
 const h=runtime();for(const value of ['https://host/e/abc?token=+/=','https://host/字幕'])assert.equal(h.api.__test.base64(value),Buffer.from(value).toString('base64'));
});
test('first-party headers reach both master and video child; captions carry Nuvio name/language/headers',async()=>{
 const h=runtime(),rows=await h.api.getStreams(1,'tv',1,1),sub=rows[0].subtitles[0];assert.equal(sub.name,'English');assert.equal(sub.language,'en');assert.equal(sub.headers.Referer,'https://vidbasic.top/');
 for(const c of h.calls.filter(x=>/cdn\.test/.test(x.u)))assert.equal(c.o.headers.Origin,'https://vidbasic.top');
});
test('a stalled response body is bounded by the same request deadline',async()=>{
 const context={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,fetch:async u=>({ok:true,status:200,url:u,text:()=>new Promise(()=>{})})};vm.createContext(context);vm.runInContext(source,context);const t=Date.now();assert.equal(await context.module.exports.__test.playable(signed,'https://asiaflix.net',{deadline:t+30}),null);assert.ok(Date.now()-t<500);
});
test('legacy host fallbacks are dispatched independently with preserved media URLs',async()=>{
 for(const kind of ['vidhide','vidmoly','mixdrop','streamtape','doodstream']){
  const requests=[],origin={vidhide:'https://smoothpre.com/v/id',vidmoly:'https://vidmoly.to/embed-id.html',mixdrop:'https://mixdrop.ps/e/id',streamtape:'https://watchadsontape.com/e/id',doodstream:'https://dood.wf/e/id'}[kind];
  const direct='https://cdn.test/movie.mp4?token=exact%2Bvalue',context={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,fetch:async(u,o)=>{
   requests.push({u,o});let body,status=200;
   if(u.includes('get-stream-url')){status=500;body='{"message":"INTERNAL_ERR"}';}
   else if(u.includes('/pass_md5/'))body='https://cdn.test/movie.mp4/';
   else if(u.startsWith('https://cdn.test/movie.mp4'))body='\u0000\u0000\u0000\u0018ftypisom00000000';
   else if(u===signed)body=master;
   else if(u==='https://cdn.test/video.m3u8')body=child;
   else if(kind==='mixdrop')body='MDCore.wurl="'+direct+'";';
   else if(kind==='streamtape')body="document.getElementById('robotlink').innerHTML = '//cdn.test/' + ('xcdmovie.mp4?token=exact%2Bvalue').substring(3);";
   else if(kind==='doodstream')body="$.get('/pass_md5/abc/token123', function(data) {});";
   else body='sources:[{file:"'+signed+'"}]';
   return {ok:status===200,status,url:u,text:async()=>body};
  }};vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,context);const rows=await context.module.exports.__test.resolveEpisode([{source:kind,url:origin}],{deadline:Date.now()+1000,title:'Control',episode:1});assert.equal(rows.length,1,kind);
  if(kind==='vidmoly')assert.ok(requests.some(x=>x.u.startsWith('https://vidmoly.biz/')));
  if(kind==='streamtape')assert.ok(requests.some(x=>x.u.startsWith('https://streamtape.com/e/')));
  if(kind==='doodstream')assert.match(rows[0].url,/^https:\/\/cdn\.test\/movie\.mp4\/[a-z0-9]+\?token=token123&expiry=\d+$/);
  else assert.equal(rows[0].url,kind==='mixdrop'||kind==='streamtape'?direct:signed);
 }
});
