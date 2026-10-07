const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../custom/providers/asiaflix-production-v3.js'),'utf8');
// Only codec configuration bytes from the live first segment: no signed URL or media payload.
const liveSps=Array.from(Buffer.from('0000016764001facc86014016ec05a808080a000000300470100142000000781e30633400000000168e978f3c8','hex'));
function runtime(fetch){const box={module:{exports:{}},URL,Uint8Array,AbortController,setTimeout,clearTimeout,fetch};vm.createContext(box,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,box);return box.module.exports.__test;}
function syntheticSps(width,height){let bits='';const put=(n,size)=>bits+=n.toString(2).padStart(size,'0'),ue=n=>{const b=(n+1).toString(2);bits+='0'.repeat(b.length-1)+b;};put(66,8);put(0,8);put(31,8);ue(0);ue(0);ue(0);ue(0);ue(1);put(0,1);ue(width/16-1);ue(Math.ceil(height/16)-1);put(1,1);put(1,1);const crop=Math.ceil(height/16)*16-height;put(crop?1:0,1);if(crop){ue(0);ue(0);ue(0);ue(crop/2);}put(0,1);put(1,1);while(bits.length%8)bits+='0';return [0,0,0,1,103,...bits.match(/.{8}/g).map(x=>parseInt(x,2)),0,0,1,104,128];}
function packet(pid,payload){const out=Array(188).fill(255);out[0]=71;out[1]=(pid>>8)&31;out[2]=pid&255;out[3]=0x30;out[4]=183-payload.length;out[5]=0;for(let i=0;i<payload.length;i++)out[188-payload.length+i]=payload[i];return out;}
const media='#EXTM3U\n#EXTINF:2.733333,\n#EXT-X-BYTERANGE:494252@0\nhttps://cdn.test/asset.html\n#EXTINF:3.833333,\n#EXT-X-BYTERANGE:789036\nhttps://cdn.test/asset.html\n#EXT-X-ENDLIST';
function response(url,bytes,mode='arrayBuffer'){
 const body=Buffer.from(bytes);return {ok:true,status:206,url,headers:{get:n=>n==='content-range'?'bytes 0-'+(body.length-1)+'/6000000':null},
  ...(mode==='reader'?{body:{getReader:()=>{let done=false;return{read:async()=>done?{done:true}:(done=true,{done:false,value:new Uint8Array(body)}),cancel:async()=>{}};}}}:mode==='arrayBuffer'?{arrayBuffer:async()=>new Uint8Array(body).buffer}:{}),text:async()=>mode==='lossy'?body.toString('utf8'):body.toString('latin1')};
}
test('live H.264 SPS establishes 1280x720, independently of source names/bitrate',()=>{
 const api=runtime();const d=api.h264Dimensions(liveSps);assert.equal(d.width,1280);assert.equal(d.height,720);assert.equal(api.detectedHeight(liveSps),720);
});
test('different SPS values derive different cropped heights without title constants',()=>{
 const api=runtime();for(const [width,height] of [[1920,1080],[1280,720],[720,480],[1280,640],[320,180]]){const d=api.h264Dimensions(syntheticSps(width,height));assert.equal(d.width,width);assert.equal(d.height,height);}
});
test('SPS split across TS packets is reconstructed after transport headers are removed',()=>{
 const api=runtime(),b=[...packet(256,liveSps.slice(0,9)),...packet(257,[1,2,3,4]),...packet(256,liveSps.slice(9))];assert.equal(api.detectedHeight(b),720);
});
test('byte-range segments use each declared offset, including implicit continuation',()=>{
 const probes=runtime().hlsProbes(media,'https://cdn.test/index.m3u8');assert.equal(probes.length,2);assert.equal(probes[0].range,'bytes=0-32767');assert.equal(probes[1].range,'bytes=494252-527019');
});
test('init maps precede segments and short ranges never read beyond their declared size',()=>{
 const probes=runtime().hlsProbes('#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="100@20"\n#EXTINF:1,\nvideo.m4s','https://cdn.test/root/index.m3u8');assert.equal(probes[0].url,'https://cdn.test/root/init.mp4');assert.equal(probes[0].range,'bytes=20-119');assert.equal(probes[1].range,'bytes=0-32767');
});
test('invalid implicit offset is not guessed and identical ranges are not fetched twice',()=>{
 const api=runtime();assert.equal(api.hlsProbes('#EXTM3U\n#EXT-X-BYTERANGE:200\nasset.ts','https://cdn.test/').length,0);assert.equal(api.hlsProbes(media+ '\n#EXT-X-BYTERANGE:494252@0\nhttps://cdn.test/asset.html','https://cdn.test/').length,2);
});
for(const mode of ['reader','arrayBuffer','text'])test(mode+' byte transport keeps the live SPS, intact playback URL, captions and SUB tag',async()=>{
 const calls=[],bytes=Array(262144).fill(255);bytes.splice(1293,liveSps.length,...liveSps);const api=runtime(async(url,o)=>{calls.push({url,o});return o.headers.Range?response(url,bytes,mode):{ok:true,status:200,url,text:async()=>media};});
 const url='https://cdn.test/index.m3u8?signature=exact%2Bvalue',sub={url:'https://cdn.test/en.vtt',language:'en',name:'English'},row=await api.playable(url,'https://vidbasic.top/embed/episode',{deadline:Date.now()+1000,title:'Any Film',language:'tl',episodeType:'SUB'},[sub]);
 assert.equal(row.quality,'720p');assert.equal(row.name,'AsiaFlix • HD 720p • [SUB]');assert.equal(row.url,url);assert.equal(row.subtitles[0].url,sub.url);assert.equal(row.subtitles[0].language,'en');assert.equal(calls.filter(x=>x.o.headers.Range).length,1);assert.equal(row.headers.Referer,'https://vidbasic.top/');
});
test('irreversibly UTF-8-decoded binary does not invent a resolution or discard playback',async()=>{
 const api=runtime(async(url,o)=>o.headers.Range?response(url,liveSps,'lossy'):{ok:true,status:200,url,text:async()=>media});const row=await api.playable('https://cdn.test/index.m3u8','https://vidbasic.top',{deadline:Date.now()+1000,language:'tl'},[{url:'https://cdn.test/en.vtt',language:'en'}]);assert.equal(row.quality,'Auto');assert.match(row.name,/Unknown Auto.*\[SUB\]/);assert.equal(row.subtitles.length,1);
});
test('lossy text can preserve a verified MP4 signature without claiming codec quality',async()=>{
 const api=runtime(async url=>({ok:true,status:200,url,text:async()=>url.includes('get-stream-url')?JSON.stringify({sources:[{url:'https://cdn.test/video.mp4',isM3U8:false}],subtitles:[{url:'https://cdn.test/en.vtt',language:'en'}]}):'\x00\x00\x00\x18ftypisom\ufffd\ufffd'}));const rows=await api.resolveEpisode([{source:'mixdrop',url:'https://mixdrop.test/e/episode'}],{deadline:Date.now()+1000,language:'tl'});assert.equal(rows.length,1);assert.equal(rows[0].type,'mp4');assert.equal(rows[0].quality,'Auto');assert.match(rows[0].name,/\[SUB\]/);
});
test('unknown codec/container bytes remain Auto rather than guessed quality',()=>{
 const api=runtime();assert.equal(api.detectedHeight([0,1,2,3,4]),0);assert.equal(api.h264Dimensions([0,0,1,103]),null);
});
test('MP4/init track-header dimensions remain available as deterministic evidence',()=>{
 const b=Buffer.alloc(104);b.writeUInt32BE(12,0);b.write('ftyp',4);b.write('isom',8);b.writeUInt32BE(92,12);b.write('tkhd',16);b.writeUInt32BE(1280*65536,96);b.writeUInt32BE(640*65536,100);assert.equal(runtime().detectedHeight(Array.from(b)),640);
});
test('master RESOLUTION wins without probing audio tracks or video segments',async()=>{
 const calls=[],master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="en.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Korean",URI="ko.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,CODECS="avc1.640028",AUDIO="a"\nvideo.m3u8';const api=runtime(async(url)=>{calls.push(url);return {ok:true,status:200,url,text:async()=>url.includes('master')?master:media};});const row=await api.playable('https://cdn.test/master.m3u8','https://vidbasic.top',{deadline:Date.now()+1000},[]);assert.equal(row.quality,'1080p');assert.match(row.name,/FHD 1080p.*\[DUAL\]/);assert.equal(calls.length,2);assert.equal(row.url,'https://cdn.test/master.m3u8');
});
test('stalled quality probe returns existing playable row promptly',async()=>{
 const api=runtime(async(url,o)=>o.headers.Range?new Promise(()=>{}):{ok:true,status:200,url,text:async()=>media}),t=Date.now(),row=await api.playable('https://cdn.test/index.m3u8','https://vidbasic.top',{deadline:t+35},[]);assert.equal(row.quality,'Auto');assert.ok(Date.now()-t<500);
});
test('nonzero byte range ignored by a server cannot falsely validate a later segment',async()=>{
 const api=runtime(async(url,o)=>o.headers.Range?{...response(url,liveSps),status:200}:{ok:true,status:200,url,text:async()=>'#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:10000@1000\nasset.ts\n#EXT-X-ENDLIST'});const row=await api.playable('https://cdn.test/index.m3u8','https://vidbasic.top',{deadline:Date.now()+1000},[]);assert.equal(row.quality,'Auto');
});
