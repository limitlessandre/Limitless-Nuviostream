const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../custom/providers');
function load(file, extra = '') {
  const mod = {exports:{}};
  new Function('module', 'exports', fs.readFileSync(path.join(directory,file),'utf8') + extra)(mod,mod.exports);
  return mod.exports;
}
const {createRequestContext} = load('wco-verification-nexus-v1.js');
const response = (url, body, status=200) => ({url,status,ok:status>=200&&status<300,headers:{get:()=>null},text:async()=>typeof body==='string'?body:JSON.stringify(body)});
const coreSource = fs.readFileSync(path.join(directory,'wco-verification-core-v1.js'),'utf8');
const anime = load('wco-verification-anime-v1.js', '\nmodule.exports.test={augmentAnimeIdentity,augmentAnimeEpisodeOwnership,augmentAnimeVariantCollection};').test;
const runtime = load('wco-verification-runtime-v1.js','\nmodule.exports.test={augmentCoreMirrors};').test;
function core(context, overrides='') {
  let source = runtime.augmentCoreMirrors(anime.augmentAnimeVariantCollection(anime.augmentAnimeEpisodeOwnership(anime.augmentAnimeIdentity(coreSource))));
  // Simulated tests never count as evidence of real verification or playback.
  source+='\nwcoPause=async ms=>{__wcoContext.waits.push(ms);};\n'+overrides+'\nmodule.exports.test={tmdbInfo,tvStreams,episodeLinks,finalize,playerLookup,getStreams};';
  const mod={exports:{}};new context.Function('module','exports','require',source)(mod,mod.exports,()=>{});
  return mod.exports.test;
}
test('concurrent duplicate TMDB requests and subset reads share a response', async()=>{
  let calls=0;const c=createRequestContext(async url=>{calls++;return response(url,{name:'Naruto',original_language:'ja'});});
  const full='https://api.themoviedb.org/3/tv/46260?api_key=test&append_to_response=alternative_titles';
  await Promise.all([c.fetch(full),c.fetch(full)]);
  const r=await c.fetch(full.replace('&append_to_response=alternative_titles',''));
  assert.equal((await r.json()).name,'Naruto');assert.equal(calls,1);c.close();
});
test('optional service failures are negative-cached by host, per extraction',async()=>{
  let calls=0;const c=createRequestContext(async url=>{calls++;return response(url,'unavailable',503);});
  await c.fetch('https://api.jikan.moe/v4/anime?q=first');await c.fetch('https://api.jikan.moe/v4/anime?q=second');assert.equal(calls,1);c.close();
});
test('a hung request cannot consume the extraction budget; closed contexts issue no requests',async()=>{
  let calls=0;const c=createRequestContext(async()=>{calls++;return new Promise(()=>{});},35);
  const started=Date.now();const r=await c.fetch('https://example.test/hung');assert.equal(r.ok,false);assert.ok(Date.now()-started<250);
  c.close();await c.fetch('https://example.test/next');assert.equal(calls,1);
});
test('search 503 has only one retry and opens a per-origin circuit',async()=>{
  let calls=0;const c=createRequestContext(async url=>{calls++;return response(url,'busy',503);});
  await c.fetch('https://www.wcostream.tv/search',{method:'POST',body:'first'});
  await c.fetch('https://www.wcostream.tv/search',{method:'POST',body:'second'});
  assert.equal(calls,2);c.close();
});
test('same iframe shares verification; mandatory delay follows a successful beacon',async()=>{
  const asked=[];const c=createRequestContext(async url=>{
    asked.push(new URL(url).pathname);
    if(url.includes('ad-verify'))return response(url,'',204);
    return response(url,url.includes('video-js.php')?'$.getJSON("/inc/embed/getvidlink.php?v=test")':'iframe');
  });c.waits=[];
  const api=core(c);const u='https://embed.wcostream.com/inc/embed/index.php?pid=test';
  const [a,b]=await Promise.all([api.playerLookup(u),api.playerLookup(u)]);
  assert.equal(a,b);assert.deepEqual(c.waits,[13000]);assert.equal(asked.filter(x=>x==='/ad-verify').length,1);c.close();
});
test('busy player has bounded retries and never treats beacon 204 as media',async()=>{
  let players=0;const c=createRequestContext(async url=>{
    if(url.includes('ad-verify'))return response(url,'',204);
    if(url.includes('video-js')){players++;return response(url,'Servers Busy',503);}
    return response(url,'iframe');
  });c.waits=[];const result=await core(c).playerLookup('https://embed.wcostream.com/inc/embed/index.php?pid=test');
  assert.equal(result,'');assert.equal(players,4);assert.deepEqual(c.waits,[13000,3000,3000]);c.close();
});
test('exact Naruto identity rejects Kai search results and sidebar episodes',async()=>{
  const urls=[];const c=createRequestContext(async url=>{urls.push(url);return response(url,url.includes('/search')?'<a href="https://www.wcostream.tv/anime/naruto-kai">Naruto Kai</a>':'missing',url.includes('/search')?200:404);});c.waits=[];
  const api=core(c);
  assert.deepEqual(api.episodeLinks('<a href="/naruto-kai-episode-1-english-subbed">Naruto Kai Episode 1</a>','https://www.wcostream.tv/anime/naruto',1,1,null,'Sub'),[]);
  assert.deepEqual(await api.tvStreams({title:'Naruto',titles:['Naruto'],isAnime:true,originalLanguage:'ja'},1,1),[]);
  assert.ok(!urls.some(u=>u.includes('/naruto-kai-episode-')));c.close();
});
test('season and episode mismatch safeguards remain enforced',()=>{
  const c=createRequestContext(()=>{});c.waits=[];const api=core(c);
  const page='https://www.wcostream.tv/anime/naruto';
  assert.equal(api.episodeLinks('<a href="/naruto-season-2-episode-1-english-dubbed">Naruto Season 2 Episode 1 English Dubbed</a>',page,1,1,null,'Dub').length,0);
  assert.equal(api.episodeLinks('<a href="/naruto-episode-2-english-dubbed">Naruto Episode 2 English Dubbed</a>',page,1,1,null,'Dub').length,0);
  c.close();
});
test('completed dub is returned when the optional sub lane never resolves',async()=>{
  const c=createRequestContext(async url=>response(url,'<h1>Naruto</h1>'));c.waits=[];
  // Test the actual transformed collection function with a short branch budget.
  c.bounded=async(work)=>Promise.race([work(),new Promise(resolve=>setTimeout(resolve,30))]);
  const api=core(c,`extractVariantFromSeries=async function(series,variant){if(variant==='Sub')return new Promise(()=>{});return [{url:'https://media.test/a.mp4',quality:'720p',_variant:'Dub',headers:{'User-Agent':'test'}}];};`);
  const rows=await api.tvStreams({title:'Naruto',titles:['Naruto'],isAnime:true,originalLanguage:'ja'},1,1);
  assert.equal(rows.length,1);assert.match(rows[0].name,/English Dub/);assert.equal(rows[0].headers['User-Agent'],'test');c.close();
});
test('shared file labels never manufacture selectable dual audio',()=>{
  const c=createRequestContext(()=>{});c.waits=[];const api=core(c);
  const rows=api.finalize([{url:'https://media.test/a',quality:'720p',_variant:'Dub'},{url:'https://media.test/a',quality:'720p',_variant:'Sub'}],{originalLanguage:'ja'});
  assert.equal(rows.length,1);assert.doesNotMatch(rows[0].name,/Dual/);c.close();
});
test('multiword ownership rejects One Piece recaps and LEGO but accepts an exact trusted alias',()=>{
  const c=createRequestContext(()=>{});c.waits=[];const api=core(c);
  const page='https://www.wcostream.tv/anime/one-piece';
  for(const slug of ['one-piece-gyojin-tou-hen','lego-one-piece','one-piece-barto-no-himitsu-no-heya']) {
    assert.equal(api.episodeLinks(`<a href="/${slug}-episode-1-english-subbed">Episode 1 English Subbed</a>`,page,1,1,null,'Sub',['One Piece']).length,0);
  }
  assert.equal(api.episodeLinks('<a href="/monster-rancher-episode-1-english-subbed">Episode 1 English Subbed</a>','https://www.wcostream.tv/anime/monster-farm',1,1,null,'Sub',['Monster Rancher']).length,1);c.close();
});
test('standalone movie lookup survives runtime augmentation and rejects ambiguous years',async()=>{
  const helpers=load('wco-verification-runtime-v1.js','\nmodule.exports.test={augmentSpecialSource};').test;
  const source=helpers.augmentSpecialSource(fs.readFileSync(path.join(directory,'wco-verification-special-v1.js'),'utf8'));
  let body=Array.from({length:1500},(_,i)=>`<a href="/unrelated-${i}">Unrelated ${i}</a>`).join('')+'<a href="/spirited-away-english-dubbed">Spirited Away English Dubbed</a>';
  const c=createRequestContext(async url=>response(url,body));
  const mod={exports:{}};new c.Function('module','exports','require',source+'\nmodule.exports.test={movieListEntries};')(mod,mod.exports,()=>{});
  assert.equal((await mod.exports.test.movieListEntries({aliases:['Spirited Away'],year:'2001'})).length,1);c.close();
  const other=createRequestContext(async url=>response(url,'<a href="/lion-king">The Lion King</a><a href="/lion-king-2019">The Lion King (2019)</a>'));
  const m={exports:{}};new other.Function('module','exports','require',source+'\nmodule.exports.test={movieListEntries};')(m,m.exports,()=>{});
  const rows=await m.exports.test.movieListEntries({aliases:['The Lion King'],year:'2019'});
  assert.equal(rows.length,1);assert.ok(rows[0].href.endsWith('2019'));other.close();
});
test('optional identity requests share an aggregate 2.5 second budget',async()=>{
  let calls=0;const c=createRequestContext(async()=>{calls++;return new Promise(()=>{});});
  const f=new c.Function('/* module.exports = { resolveAnimeIdentity } */ return fetch("https://api.jikan.moe/v4/anime?q=one");');
  const start=Date.now();assert.equal((await f()).ok,false);assert.ok(Date.now()-start<3000);
  assert.equal((await f()).ok,false);assert.equal(calls,1);c.close();
});
test('an exactly listed login-only movie returns empty without unrelated series searches',async()=>{
  const helpers=load('wco-verification-runtime-v1.js','\nmodule.exports.test={augmentSpecialSource};').test;
  const source=helpers.augmentSpecialSource(fs.readFileSync(path.join(directory,'wco-verification-special-v1.js'),'utf8'));
  const urls=[];const c=createRequestContext(async url=>{
    urls.push(url);
    if(url.includes('themoviedb'))return response(url,{title:'Spirited Away',release_date:'2001-07-20',original_language:'ja'});
    if(url.endsWith('/movie-list'))return response(url,'<a href="/spirited-away-english-dubbed">Spirited Away English Dubbed</a>');
    return response(url,'<iframe src="https://user.wcostream.tv/check-login"></iframe>');
  });
  const mod={exports:{}};new c.Function('module','exports','require',source)(mod,mod.exports,()=>{});
  assert.deepEqual(await mod.exports.getStreams('129','movie'),[]);assert.ok(!urls.some(u=>u.includes('/search')));c.close();
});
test('specials try a confident direct series once before searching',async()=>{
  const helpers=load('wco-verification-runtime-v1.js','\nmodule.exports.test={augmentSpecialSource};').test;
  const source=helpers.augmentSpecialSource(fs.readFileSync(path.join(directory,'wco-verification-special-v1.js'),'utf8'));
  const urls=[];const c=createRequestContext(async url=>{urls.push(url);return response(url,'<h1>SpongeBob SquarePants</h1>');});
  const mod={exports:{}};new c.Function('module','exports','require',source+'\nmodule.exports.test={seriesCandidates};')(mod,mod.exports,()=>{});
  const parents=await mod.exports.test.seriesCandidates({series:['SpongeBob SquarePants','Bob Esponja']});
  assert.equal(parents.length,1);assert.equal(urls.length,1);assert.ok(!urls[0].includes('/search'));c.close();
});
test('metadata prioritizes official romaji without admitting compilation or spin-off aliases',async()=>{
  const c=createRequestContext(async url=>response(url,{name:'Attack on Titan',original_name:'進撃の巨人',original_language:'ja',genres:[{id:16}],alternative_titles:{results:[{title:'Angriff auf Titan',iso_3166_1:'DE'},{title:'Shingeki no Kyojin',iso_3166_1:'JP'},{title:'Attack on Titan: Lost Girls',iso_3166_1:'US'},{title:'Shingeki no Kyojin The Final Season',iso_3166_1:'JP'},{title:'AOT',iso_3166_1:'US'}]}}));c.waits=[];
  const info=await core(c).tmdbInfo('1429','tv');
  assert.equal(info.titles[1],'Shingeki no Kyojin');assert.ok(!info.titles.some(t=>/Lost Girls|Final Season|^AOT$/.test(t)));c.close();
});
test('a failing optional movie lane cannot erase a completed movie result',async()=>{
  const helpers=load('wco-verification-runtime-v1.js','\nmodule.exports.test={augmentSpecialSource};').test;
  const source=helpers.augmentSpecialSource(fs.readFileSync(path.join(directory,'wco-verification-special-v1.js'),'utf8'));
  const c=createRequestContext(async url=>response(url,{title:'Example Film',release_date:'2001-01-01'}));
  const mod={exports:{}};new c.Function('module','exports','require',source+`
    movieListEntries=async()=>[{variant:'Dub'},{variant:'Sub'}];
    extract=async e=>{if(e.variant==='Sub')throw new Error('optional failure');return{streams:[{url:'https://media.test/verified',quality:'720p'}]};};
  `)(mod,mod.exports,()=>{});
  const rows=await mod.exports.getStreams('1','movie');assert.equal(rows.length,1);assert.equal(rows[0].quality,'720p');c.close();
});
test('episode zero retains its explicit season boundary',()=>{
  const api=load('wco-verification-episode0-v1.js','\nmodule.exports.test={episodeZeroEntries};').test;
  const html='<a href="/naruto-season-2-episode-0-english-dubbed">Naruto Season 2 Episode 0 English Dubbed</a><a href="/naruto-season-3-episode-0-english-dubbed">Naruto Season 3 Episode 0 English Dubbed</a><a href="/naruto-season-2-episode-1-english-dubbed">Naruto Season 2 Episode 1 English Dubbed</a>';
  const rows=api.episodeZeroEntries(html,'https://www.wcostream.tv/anime/naruto',2,'Dub');
  assert.equal(rows.length,1);assert.match(rows[0].href,/season-2-episode-0/);
});
test('a single search retry can recover 503 without closing the origin',async()=>{
  let calls=0;const c=createRequestContext(async url=>response(url,++calls===1?'busy':'search results',calls===1?503:200));
  const opts={method:'POST',body:'catara=Naruto'};
  const r=await c.fetch('https://www.wcostream.tv/search',opts);assert.equal(r.status,200);
  await c.fetch('https://www.wcostream.tv/search',opts);assert.equal(calls,2);c.close();
});
test('player retries recover a transient 503 without repeating verification',async()=>{
  let calls=0,beacons=0;const c=createRequestContext(async url=>{
    if(url.includes('ad-verify')){beacons++;return response(url,'',204);}
    if(url.includes('video-js.php'))return ++calls===1?response(url,'busy',503):response(url,'$.getJSON("/inc/embed/getvidlink.php?v=test")');
    return response(url,'iframe');
  });c.waits=[];
  assert.match(await core(c).playerLookup('https://embed.wcostream.com/inc/embed/index.php?pid=test'),/getvidlink/);
  assert.equal(beacons,1);assert.equal(calls,2);assert.deepEqual(c.waits,[13000,3000]);c.close();
});
test('cache revision applies only to Nexus WCO dependency URLs',async()=>{
  const urls=[];const c=createRequestContext(async url=>{urls.push(url);return response(url,'module source');});
  const prefix='https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/';
  await c.fetch(prefix+'wco-verification-core-v1.js');await c.fetch(prefix+'anime-identity.js');
  assert.ok(urls[0].endsWith('?rev=281'));assert.equal(urls[1],prefix+'anime-identity.js');c.close();
});
test('Power Rangers season searches cannot accept Turbo Dogs or Beyblade',async()=>{
  const helper=load('wco-power-rangers-nexus.js','\nmodule.exports.test={patchCore};').test;
  const legacy=fs.readFileSync(path.join(directory,'wco.js'),'utf8');
  const source=helper.patchCore(legacy);
  assert.ok(source);
  const c=createRequestContext(async url=>response(url,'<a href="https://www.wcostream.tv/anime/turbo-dogs">Turbo Dogs</a><a href="https://www.wcostream.tv/anime/beyblade-burst-turbo">Beyblade Burst Turbo</a><a href="https://www.wcostream.tv/anime/power-rangers-turbo">Power Rangers Turbo</a>'));
  const mod={exports:{}};new c.Function('module','exports','require',source+'\nmodule.exports.test={__wcoResolverSearch};')(mod,mod.exports,()=>{});
  const rows=await mod.exports.test.__wcoResolverSearch('Turbo');assert.equal(rows.length,1);assert.match(rows[0].href,/power-rangers-turbo/);c.close();
});
test('Power Rangers mapper can use the current verification core without losing its TMDB gate',()=>{
  const helper=load('wco-power-rangers-nexus.js','\nmodule.exports.test={patchCore};').test;
  const source=helper.patchCore(coreSource);
  assert.ok(source);assert.match(source,/Number\(info.id\) !== 2328/);assert.match(source,/__wcoContext.player/);
  assert.doesNotThrow(()=>new Function('module','exports',source));
});
test('known Power Rangers TV requests prioritize the season mapper; ordinary titles do not',async()=>{
  const source=fs.readFileSync(path.join(directory,'wco-verification-series-v1.js'),'utf8');
  function instance(){const mod={exports:{}};new Function('module','exports',source+`
    const seen=[];module.exports.seen=seen;
    loadModule=async url=>{seen.push(url);return{getStreams:async()=>[{url:'https://media.test/example',quality:'720p',name:'WCO',language:'English'}]};};
  `)(mod,mod.exports);return mod.exports;}
  let api=instance();assert.equal((await api.getStreams('2328','tv',5,1)).length,1);assert.match(api.seen[0],/power-rangers/);assert.equal(api.seen.length,1);
  api=instance();await api.getStreams('46260','tv',1,1);assert.match(api.seen[0],/verification-anime/);assert.equal(api.seen.length,1);
  api=instance();await api.getStreams('2328','tv',0,1);assert.match(api.seen[0],/verification-anime/);
});
function powerRangersParsers() {
  function evaluate(source,extra=''){const m={exports:{}};new Function('module','exports',source+extra)(m,m.exports);return m.exports;}
  const v3=evaluate(fs.readFileSync(path.join(directory,'wco-power-rangers-nexus-v3.js'),'utf8'),'\nmodule.exports.patch=patchV2Source;');
  const v2=evaluate(v3.patch(fs.readFileSync(path.join(directory,'wco-power-rangers-nexus-v2.js'),'utf8')),'\nmodule.exports.patch=patchResolver;');
  const v1=evaluate(v2.patch(fs.readFileSync(path.join(directory,'wco-power-rangers-nexus.js'),'utf8')),'\nmodule.exports.patch=patchCore;');
  return evaluate(v1.patch(coreSource),'\nmodule.exports.test={__wcoResolverNameEntries,__wcoResolverNumericEntries};').test;
}
test('Power Rangers multipart names match exactly across ordinal notation and ignore sidebar episodes',()=>{
  const p=powerRangersParsers();
  const html='<a href="/power-rangers-turbo-episode-1-shift-into-turbo-part-i">Episode 1 Shift Into Turbo, Part I SD</a><a href="/power-rangers-turbo-episode-2-shift-into-turbo-part-ii">Episode 2 Shift Into Turbo, Part II SD</a><a href="/unrelated-episode-1">Episode 1 Shift Into Turbo, Part I</a>';
  const url='https://www.wcostream.tv/anime/power-rangers-turbo';
  assert.equal(p.__wcoResolverNameEntries(html,url,'Shift into Turbo (1)','Dub',1).length,1);
  const rows=p.__wcoResolverNumericEntries(html,url,1,'Dub',1);assert.equal(rows.length,1);assert.match(rows[0].href,/part-i$/);
  assert.equal(p.__wcoResolverNameEntries(html,url,'Shift into Turbo (3)','Dub',1).length,0);
});
test('multipart matching also handles a second Power Rangers season without relaxing explicit season checks',()=>{
  const p=powerRangersParsers(),url='https://www.wcostream.tv/anime/power-rangers-zeo';
  const html='<a href="/power-rangers-zeo-episode-1-a-zeo-beginning-part-i">Episode 1 A Zeo Beginning, Part I SD</a>';
  assert.equal(p.__wcoResolverNameEntries(html,url,'A Zeo Beginning (1)','Dub',1).length,1);
  const wrong='<a href="/power-rangers-zeo-season-2-episode-1-a-zeo-beginning-part-i">Season 2 Episode 1 A Zeo Beginning, Part I SD</a>';
  assert.equal(p.__wcoResolverNameEntries(wrong,url,'A Zeo Beginning (1)','Dub',1).length,0);
});
test('OVA index matches an exactly named short film without accepting a different story or wrong explicit year',async()=>{
  const helper=load('wco-verification-runtime-v1.js','\nmodule.exports.test={augmentSpecialSource};').test;
  const source=helper.augmentSpecialSource(fs.readFileSync(path.join(directory,'wco-verification-special-v1.js'),'utf8'));
  const urls=[];const c=createRequestContext(async url=>{urls.push(url);return response(url,url.endsWith('/movie-list')?'': '<a href="/naruto-genie">Naruto OVA, the Genie, and the Three Wishes, Believe It! English Dubbed (2010)</a><a href="/naruto-genie-remake">Naruto OVA, the Genie, and the Three Wishes, Believe It! English Dubbed (2020)</a><a href="/naruto-other">Naruto OVA: Different Story</a>');});
  const mod={exports:{}};new c.Function('module','exports','require',source+'\nmodule.exports.test={movieListEntries};')(mod,mod.exports,()=>{});
  const rows=await mod.exports.test.movieListEntries({aliases:['Naruto, the Genie, and the Three Wishes, Believe It!'],year:'2010'});
  assert.equal(rows.length,1);assert.ok(rows[0].href.endsWith('/naruto-genie'));assert.ok(urls[1].endsWith('/ova-list'));c.close();
});
test('Desktop-style detached URL query parameters still receive revisions and metadata cache reuse',async()=>{
  const vm=require('node:vm');
  class DesktopUrl extends URL { constructor(...args){super(...args);Object.defineProperty(this,'searchParams',{value:new URLSearchParams(super.searchParams.toString())});} }
  const urls=[];const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(directory,'wco-verification-nexus-v1.js'),'utf8'),{module,URL:DesktopUrl,setTimeout,clearTimeout,AbortController});
  const c=module.exports.createRequestContext(async url=>{urls.push(url);return response(url,{name:'Naruto'});});
  await c.fetch('https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-verification-core-v1.js');
  assert.ok(urls[0].endsWith('?rev=281'));
  const meta='https://api.themoviedb.org/3/tv/46260?api_key=test';await c.fetch(meta+'&append_to_response=alternative_titles');await c.fetch(meta);assert.equal(urls.length,2);c.close();
});
test('confident metadata matches do not launch optional identity requests before returning completed streams',async()=>{
  const urls=[];const c=createRequestContext(async url=>{urls.push(url);return response(url,url.includes('themoviedb')?{name:'Naruto',original_name:'ナルト',original_language:'ja',genres:[{id:16}]}:'<h1>Naruto</h1>');});c.waits=[];
  const api=core(c,`extractVariantFromSeries=async function(series,variant){return [{url:'https://media.test/'+variant,quality:'720p',_variant:variant}];};`);
  const rows=await api.getStreams('46260','tv',1,1);assert.equal(rows.length,2);
  assert.ok(!urls.some(url=>/identity|jikan|anilist/.test(url)));c.close();
});
