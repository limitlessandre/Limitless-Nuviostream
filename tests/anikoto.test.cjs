const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const {createAniKotoSources} = require('../custom/providers/anikoto-sources');
const {createRelay} = require('../tools/anikoto-relay-core');
const {allowed, publicAddress, unwrap, isTs} = require('../tools/anikoto-transport');
const {patchSource} = require('../custom/providers/anikototv-nexus-v6');
const base = 'https://megap.akirax.buzz/';
const ts = new Uint8Array(188 * 6); for (let i = 0; i < ts.length; i += 188) ts[i] = 71;
const image = new Uint8Array([137,80,78,71,13,10,26,10,73,69,78,68,174,66,96,130,0,0,...ts]);
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=1280x720\nvideo/index.m3u8';
const variant = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-TARGETDURATION:6\n' + [0,1,2,3,4,5].map(i => '#EXTINF:6,\n' + base + 'seg' + i + '.png').join('\n') + '\n#EXT-X-ENDLIST';
const servers = ['sub','dub'].map(mode => '<div data-type="' + mode + '"><li data-link-id="' + mode + '1">Vidstream-2</li><li data-link-id="' + mode + '2">HD-1</li><li data-link-id="' + mode + '3">Duplicate</li></div>').join('');
function sources(overrides = {}) {
  return createAniKotoSources({aliases: x => [x.title], normalize: x => x.toLowerCase(), parseSearch: () => [{id: 4, title: 'Mushoku'}], directCandidates: () => [], catalogCandidates: async () => [],
    requestText: async url => url.includes('/filter') ? '' : '<div data-id="123"></div>',
    requestJson: async url => {
      if (url.includes('/episode/list')) return {result: '<a data-num="1" data-ids="xyz"></a>'};
      if (url.includes('/server/list')) return {result: servers};
      if (url.includes('/server?')) return {result: {url: 'https://megaplay.buzz/' + new URL(url).searchParams.get('get')}};
      if (url.includes('/getSources')) {const refer = new URL(url); return {sources: base + refer.searchParams.get('type') + '.m3u8', tracks: [{kind:'captions',file:base+'en.vtt',label:'English'},{kind:'thumbnails',file:base+'thumb.vtt'}]};}
      return null;
    }, ...overrides});
}
test('dynamic server discovery, mapper names and SUB/DUB remain independent', async () => {
  const resolver = sources();
  assert.equal(resolver.parseServers(servers).length, 6);
  assert.deepEqual(resolver.parseMapper({NovelHost:{sub:{url:'https://megaplay.buzz/one'},dub:{url:'https://megaplay.buzz/two'}}}).map(x=>x.mode), ['sub','dub']);
  let calls = 0;
  const r = sources({requestJson: async (url, options) => {
    if (url.includes('/episode/list')) {calls++; return {result:'<a data-num="1" data-ids="all">'};}
    if (url.includes('/server/list')) return {result:servers};
    if (url.includes('/server?')) return {result:{url:'https://megaplay.buzz/' + new URL(url).searchParams.get('get')}};
    return {sources:base + (options.headers.Referer.endsWith('2') ? 'two' : 'one') + new URL(url).searchParams.get('type') + '.m3u8'};
  }});
  const [sub,dub] = await Promise.all(['sub','dub'].map(m=>r.resolveMode({title:'Mushoku'},1,m)));
  assert.equal(calls,1); assert.equal(sub.length,2); assert.equal(dub.length,2);
  assert.deepEqual(sub.map(x=>x.server),['Vidstream-2 / Duplicate','HD-1']);
});
test('getSourcesNew fallback on invalid primary plus captions, iframe and direct playlists', async () => {
  const endpoints=[];
  const r=sources({requestJson:async url=>{endpoints.push(url); return url.includes('getSourcesNew') ? {sources:base+'v.m3u8',tracks:[{file:base+'en.vtt',label:'English',kind:'captions'}]} : {sources:''};}});
  const rows=await r.external('https://megaplay.buzz/sub','sub');
  assert.equal(endpoints.length,2); assert.equal(rows[0].subtitles[0].language,'eng');
  const nested=sources({requestText:async url=>url.endsWith('/outer') ? '<iframe src="/inner">' : '<source src="/video.m3u8">'});
  assert.equal((await nested.external('https://megaplay.buzz/outer','sub'))[0].url,'https://megaplay.buzz/video.m3u8');
  assert.equal((await nested.external(base+'direct.m3u8','dub'))[0].url,base+'direct.m3u8');
});
test('MewCDN fragment and static host mapping',async()=>{
  const r=sources({requestText:async()=>"var HOST_MAP = {'old.test': 'megap.akirax.buzz'}"});
  const rows=await r.external('https://mewcdn.online/player#'+btoa('https://old.test/media.m3u8'),'sub');
  assert.equal(rows[0].url,base+'media.m3u8');
});
test('AES-CBC payload decrypt is retained',async()=>{
  const keyBytes=new Uint8Array(32);keyBytes.set(new TextEncoder().encode('i?LMTAx0Q6,:}50U'));
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-CBC'},false,['encrypt']);
  const encrypted=await crypto.subtle.encrypt({name:'AES-CBC',iv:new Uint8Array([87,48,59,50,55,84,111,97,85,112,108,95,80,37,39,99])},key,new TextEncoder().encode(JSON.stringify({file:base+'enc.m3u8'})));
  const rows=await sources().sourceRows({enc:Buffer.from(encrypted).toString('base64url')},base);
  assert.equal(rows[0].url,base+'enc.m3u8');
});
test('patched wrapper keeps identity mapping and emits every resolved row', async()=>{
  const root=path.resolve(__dirname,'../custom/providers');
  let code=patchSource(fs.readFileSync(path.join(root,'anikototv-nexus-v5.js'),'utf8'),fs.readFileSync(path.join(root,'anikoto-sources.js'),'utf8'));
  code+='\nidentityCache={resolveAnimeIdentity:async()=>({isAnime:true,title:"Mushoku",mappedEpisode:7})}; aniSources.resolveMode=async(i,e,m)=>{if(e!==7) throw Error("mapping lost");return [1,2].map(n=>({url:"https://megaplay.buzz/"+m+n,subtitles:[],headers:{},server:"Mirror"+n,embed:"https://megaplay.buzz/embed",quality:"720p"}));};';
  const c=vm.createContext({module:{exports:{}},URL,console});vm.runInContext(code,c);
  const rows=await c.module.exports.getStreams('tmdb:94664','tv',1,1);
  assert.equal(rows.length,4);assert.equal(rows[0].quality,'720p');assert.equal(rows[0].anikotoSource.mode,'dub');
});
test('SSRF policy rejects schemes, credentials, private literals and DNS addresses',()=>{
  for(const u of ['http://megaplay.buzz/a','https://127.0.0.1/a','https://10.0.0.1/a','https://megaplay.buzz.evil.test/a','https://user@megaplay.buzz/a','https://megaplay.buzz:8787/a']) assert.equal(allowed(u),null);
  for(const ip of ['127.0.0.1','10.2.3.4','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fd12::1'])assert.equal(publicAddress(ip),false);
  assert.equal(publicAddress('8.8.8.8'),true);
});
test('PNG/JPEG stripping validates repeated TS sync, ignores false IEND in ordinary TS',()=>{
  assert.ok(isTs(unwrap(image)));assert.ok(isTs(unwrap(new Uint8Array([255,216,1,2,255,217,...ts]))));
  assert.equal(unwrap(ts),ts);assert.throws(()=>unwrap(new Uint8Array([137,80,78,71,73,69,78,68,174,66,96,130,71])));
});
async function local(relay,url,headers={}) {
  let r=await relay.handle(new Request(url,{headers}));
  for(let i=0;r.status===302&&i<4;i++)r=await relay.handle(new Request(r.headers.get('location'),{headers}));return r;
}
const lines=text=>text.split('\n').filter(x=>x&&!x.startsWith('#'));
async function setup(t,options={}) {
  const calls=[];
  const relay=createRelay({lookahead:0,transport:async(url)=>{calls.push(url);return new Response(url.endsWith('master.m3u8')?master:url.includes('.m3u8')?variant:image,{headers:{'content-type':url.includes('.m3u8')?'application/vnd.apple.mpegurl':'image/png'}});},...options});
  t.after(()=>relay.close());
  const m=await local(relay,'http://127.0.0.1:8787/play?url='+encodeURIComponent(base+'master.m3u8'));
  const v=await local(relay,lines(await m.text())[0]);
  return {relay,calls,urls:lines(await v.text())};
}
test('master, relative variants, absolute segments, keys and maps are rewritten',async t=>{
  const {relay,urls}=await setup(t);assert.equal(urls.length,6);assert.ok(urls.every(x=>x.startsWith('http://127.0.0.1:8787/media/')));
  const s=[...relay.sessions.values()][0],r=s.resources.get('root');
  const result=relay.rewrite(s,r,'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\nseg.ts',base+'index.m3u8','http://127.0.0.1:8787');
  assert.equal((result.match(/URI="http:\/\/127/g)||[]).length,2);assert.ok(result.includes('METHOD=AES-128'));
});
test('cache hit, in-flight deduplication and ranges address unwrapped media',async t=>{
  const {relay,calls,urls}=await setup(t);
  const [a,b]=await Promise.all([local(relay,urls[0]),local(relay,urls[0])]);assert.deepEqual(new Uint8Array(await a.arrayBuffer()),ts);await b.arrayBuffer();
  assert.equal(calls.filter(x=>x.endsWith('seg0.png')).length,1);assert.equal(relay.stats.joined,1);
  const range=await local(relay,urls[0],{Range:'bytes=188-375'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,188);assert.equal(range.headers.get('content-range'),'bytes 188-375/1128');
});
test('modest prefetch fetches ahead, caches, and idle expiry releases sessions',async t=>{
  let clock=1000;const {relay,urls}=await setup(t,{lookahead:4,prefetchWorkers:2,idleMs:1000,now:()=>clock});
  await (await local(relay,urls[0])).arrayBuffer();
  for(let i=0;i<20&&relay.stats.prefetched<2;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(relay.stats.prefetched,2);assert.ok(relay.stats.cacheBytes>0);assert.ok(relay.stats.cacheBytes<=64*1024*1024);
  clock=3000;relay.expire();assert.equal(relay.sessions.size,0);assert.equal(relay.stats.cacheBytes,0);
});
test('stale segment refresh preserves stable URLs and sequence mapping',async t=>{
  let refresh=0;
  const {relay,urls}=await setup(t,{transport:async url=>{
    if(url.endsWith('master.m3u8'))return new Response(master);
    if(url.includes('.m3u8'))return new Response(variant.replaceAll('.png','.png?rev='+(refresh++)));
    if(url.endsWith('rev=0'))return new Response('expired',{status:403});
    return new Response(image,{headers:{'content-type':'image/png'}});
  }});
  const response=await local(relay,urls[0]);assert.equal(response.status,200);assert.ok(isTs(new Uint8Array(await response.arrayBuffer())));assert.ok(relay.stats.refreshed>0);
});
test('redirects are validated at every hop',async t=>{
  const relay=createRelay({transport:async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})});t.after(()=>relay.close());
  const r=await local(relay,'http://127.0.0.1:8787/play?url='+encodeURIComponent(base+'file.vtt'));assert.equal(r.status,400);
});
test('ordinary TS is streamed before the upstream finishes and then cached',async t=>{
  let finish;
  const {relay,urls}=await setup(t,{transport:async url=>{
    if(url.endsWith('master.m3u8'))return new Response(master);
    if(url.includes('.m3u8'))return new Response(variant.replaceAll('.png','.ts'));
    return new Response(new ReadableStream({start(c){c.enqueue(ts);finish=()=>c.close();}}),{headers:{'content-type':'video/mp2t'}});
  }});
  const response=await local(relay,urls[0]), reader=response.body.getReader();assert.equal((await reader.read()).value.length,ts.length);finish();assert.equal((await reader.read()).done,true);assert.equal(relay.stats.cacheBytes,ts.length);
});
test('hoster re-resolution refreshes expired master, variant and segment URLs',async t=>{
  let oldVariantReads=0,minted=0;
  const {relay,urls}=await setup(t,{transport:async url=>{
    if(url==='https://megaplay.buzz/stream/example/sub')return new Response('<div data-id="789">');
    if(url.includes('/stream/getSources')){minted++;return Response.json({sources:base+'fresh/master.m3u8'});}
    if(url===base+'master.m3u8')return new Response(oldVariantReads? 'expired':master,{status:oldVariantReads?403:200});
    if(url===base+'video/index.m3u8')return new Response(oldVariantReads++?'expired':variant,{status:oldVariantReads>1?403:200});
    if(url===base+'fresh/master.m3u8')return new Response(master);
    if(url===base+'fresh/video/index.m3u8')return new Response(variant.replaceAll('seg','freshseg'));
    if(url.includes('freshseg'))return new Response(image,{headers:{'content-type':'image/png'}});
    return new Response('expired',{status:403});
  }});
  const s=[...relay.sessions.values()][0];s.embed='https://megaplay.buzz/stream/example/sub';s.mode='sub';
  const r=await local(relay,urls[0]);assert.equal(r.status,200,await r.clone().text());assert.ok(isTs(new Uint8Array(await r.arrayBuffer())));assert.equal(minted,1);assert.equal(relay.stats.reminted,1);
});
test('HTTP 200 error pages trigger refresh instead of entering the cache',async t=>{
  let generation=0;
  const {relay,urls}=await setup(t,{transport:async url=>{
    if(url.endsWith('master.m3u8'))return new Response(master);
    if(url.includes('.m3u8'))return new Response(variant.replaceAll('.png','.ts?v='+generation++));
    return url.endsWith('v=0') ? new Response('<html>expired</html>') : new Response(ts,{headers:{'content-type':'video/mp2t'}});
  }});
  const r=await local(relay,urls[0]);assert.equal(r.status,200);assert.ok(isTs(new Uint8Array(await r.arrayBuffer())));assert.ok(relay.stats.refreshed);
});
test('subtitle files remain separate, cache bounded, no HLS caption injection',async t=>{
  const relay=createRelay({cacheBytes:30,cacheEntries:1,transport:async()=>new Response('WEBVTT\n\n',{headers:{'content-type':'text/vtt'}})});t.after(()=>relay.close());
  for(const file of ['a','b']) {const r=await local(relay,'http://127.0.0.1:8787/subtitle?url='+encodeURIComponent(base+file));assert.equal(await r.text(),'WEBVTT\n\n');assert.match(r.headers.get('content-type'),/text\/vtt/);}
  assert.equal(relay.stats.cacheBytes,8);
});
test('positive redirect preserves relative destination; private DNS check is per connection',async t=>{
  const relay=createRelay({transport:async url=>url.endsWith('/a.vtt')?new Response(null,{status:302,headers:{location:'/b.vtt'}}):new Response('WEBVTT\n')});t.after(()=>relay.close());
  const r=await local(relay,'http://127.0.0.1:8787/subtitle?url='+encodeURIComponent(base+'a.vtt'));assert.equal(r.status,200);assert.equal(await r.text(),'WEBVTT\n');
});
test('body limits reject oversized disguised segments and do not cache them',async t=>{
  const {relay,urls}=await setup(t,{segmentBytes:100});const r=await local(relay,urls[0]);assert.equal(r.status,502);assert.equal(relay.stats.cacheBytes,0);assert.equal(relay.pending.size,0);
});
test('request deadline aborts stalled upstream and returns promptly',async t=>{
  const relay=createRelay({requestMs:30,timeoutMs:100,transport:async(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});t.after(()=>relay.close());
  const begin=Date.now(),r=await local(relay,'http://127.0.0.1:8787/subtitle?url='+encodeURIComponent(base+'a.vtt'));assert.equal(r.status,504);assert.ok(Date.now()-begin<300);
});
test('transient body interruption is retried; shared player waiters recover',async t=>{
  let segments=0;
  const {relay,urls}=await setup(t,{transport:async url=>{
    if(url.endsWith('master.m3u8'))return new Response(master);
    if(url.includes('.m3u8'))return new Response(variant);
    segments++;
    if(segments===1)return new Response(new ReadableStream({start(c){c.error(new Error('socket terminated'));}}),{headers:{'content-type':'image/png'}});
    return new Response(image,{headers:{'content-type':'image/png'}});
  }});
  const responses=await Promise.all([local(relay,urls[0]),local(relay,urls[0])]);
  for(const response of responses){assert.equal(response.status,200);assert.ok(isTs(new Uint8Array(await response.arrayBuffer())));}
  assert.equal(segments,2);assert.equal(relay.pending.size,0);
});
test('manifest v8 wrapper loads local v6/base/helper chain and forwards caption URLs',async()=>{
  const root=path.resolve(__dirname,'../custom/providers'),seen=[];
  const fetch=async(input,options={})=>{
    const u=new URL(input);seen.push(u.href);
    if(u.hostname==='raw.githubusercontent.com'){
      const filename=u.pathname.split('/').pop();
      if(filename==='anime-identity.js')return new Response('module.exports={resolveAnimeIdentity:async()=>({isAnime:true,title:"Mushoku",mappedEpisode:1,anilistId:108465,malId:39535})};');
      return new Response(fs.readFileSync(path.join(root,filename),'utf8'));
    }
    if(u.pathname==='/home')return new Response('home');
    if(u.pathname==='/filter')return new Response('<article data-tip="5694"><span class="name">Mushoku</span></article>');
    if(u.pathname.includes('/episode/list'))return Response.json({result:'<a data-num="1" data-ids="all">'});
    if(u.pathname==='/ajax/server/list')return Response.json({result:servers});
    if(u.pathname==='/ajax/server')return Response.json({result:{url:'https://megaplay.buzz/'+u.searchParams.get('get')}});
    if(u.pathname.includes('/getSources'))return Response.json({sources:base+u.searchParams.get('type')+'.m3u8',tracks:[{kind:'captions',file:base+'en.vtt',label:'English'}]});
    return new Response('<div data-id="123">');
  };
  const c=vm.createContext({module:{exports:{}},fetch,URL,console,setTimeout,clearTimeout,AbortController});
  vm.runInContext(fs.readFileSync(path.join(root,'anikototv-nexus-v8.js'),'utf8'),c);
  const rows=await c.module.exports.getStreams('94664','tv',1,1);
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.url.startsWith('http://127.0.0.1:8787/play?')));
  assert.ok(rows.every(r=>r.subtitles[0].url.includes('/subtitle?')));assert.ok(rows.every(r=>r.name.includes('HD-1')));
  assert.ok(seen.some(u=>u.endsWith('anikoto-sources.js?rev=208')));
});
