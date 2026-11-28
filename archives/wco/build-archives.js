"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function frozenProvider(sources,entry){
 const nativeFetch=(...args)=>fetch(...args),NativeFunction=Function;
 async function frozenFetch(url,options){
  const u=new URL(String(url));
  if(u.hostname!=='raw.githubusercontent.com')return nativeFetch(url,options);
  const key=u.origin+u.pathname,body=sources[key];
  if(typeof body!=='string')throw Error('Unfrozen JavaScript dependency: '+key);
  return {ok:true,status:200,url:String(url),headers:{get:()=>null},text:async()=>body,json:async()=>JSON.parse(body)};
 }
 function FrozenFunction(...parameters){const body=parameters.pop(),extra=['fetch','Function'].filter(name=>!parameters.includes(name)),factory=new NativeFunction(...parameters,...extra,body);return (...args)=>factory(...args,...extra.map(name=>name==='fetch'?frozenFetch:FrozenFunction));}
 const module={exports:{}};
 return FrozenFunction('module','exports','require',sources[entry]+'\n;return module.exports;')(module,module.exports,name=>{throw Error('Unsupported archive require: '+name);})||module.exports;
}
const inventory=[];
for(const label of ['master-2.7.1','nexus-2.8.1']){
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,label+'.json'),'utf8'));
 for(const [url,source]of Object.entries(data.sources)){
  const bytes=Buffer.from(source),blob=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(blob!==data.lock[url].gitBlob)throw Error('Frozen blob mismatch: '+url);
  for(const dep of data.lock[url].dependencies)if(!data.sources[dep])throw Error('Missing dependency: '+dep);
 }
 const code='"use strict";\n// Reproducible historical WCO archive; all code dependencies are embedded.\nconst archive_'+label.replace(/[^a-z0-9]/g,'_')+'=('+frozenProvider.toString()+')('+JSON.stringify(data.sources)+','+JSON.stringify(data.entryUrl)+');\n'+
 'if(typeof module!=="undefined"&&module.exports)module.exports=archive_'+label.replace(/[^a-z0-9]/g,'_')+';\nelse{globalThis.getStreams=archive_'+label.replace(/[^a-z0-9]/g,'_')+'.getStreams;globalThis.onSettings=archive_'+label.replace(/[^a-z0-9]/g,'_')+'.onSettings;}\n';
 const name={'master-2.7.1':'wco-master-271-archive-lab.js','nexus-2.8.1':'wco-nexus-281-archive-lab.js'}[label];
 const output=process.argv.find(x=>x.startsWith('--output-dir='))?.slice(13)||path.resolve(__dirname,'../../providers');fs.mkdirSync(output,{recursive:true});
 const target=path.join(output,name);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==code)throw Error('Archive stale: '+label);}else fs.writeFileSync(target,code);
 inventory.push({label,artifact:path.basename(target),dependencies:Object.keys(data.sources).length-1,jsFiles:Object.keys(data.sources).length,bytes:Buffer.byteLength(code),sha256:crypto.createHash('sha256').update(code).digest('hex')});
}
if(!process.argv.includes('--check'))fs.writeFileSync(path.join(__dirname,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify(inventory,null,2));
