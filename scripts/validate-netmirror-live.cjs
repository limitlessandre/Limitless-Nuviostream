const fs=require('node:fs'),path=require('node:path');
const provider=require('../custom/providers/netmirror-standalone-nexus-v1.js');
const output=path.resolve(__dirname,'../../netmirror-evidence/validation.json');
const results=[];
(async()=>{
 for(const [title,id]of [['Teach You a Lesson',276161],['Centaurworld',93233],['Squid Game',93405]]){
  console.log('Resolving',title);const start=Date.now();
  const rows=await provider.getStreams(id,'tv',1,1);
  const result={title,id,elapsedMs:Date.now()-start,rows,diagnostics:provider.__test.diagnostics()};results.push(result);
  fs.writeFileSync(output,JSON.stringify(results,null,2));
  console.log(JSON.stringify({title,ms:result.elapsedMs,rows:rows.map(r=>({name:r.name,url:r.url.split('?')[0],audio:r.audioTracks?.map(t=>t.language),subtitles:r.subtitles?.length,embeddedSubtitles:r.embeddedSubtitles?.length})),rejections:result.diagnostics.filter(x=>x.event==='stage-failed'||x.event==='hls-rejected')}));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
