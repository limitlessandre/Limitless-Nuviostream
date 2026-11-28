"use strict";
// Source-only reproduction; never downloads JavaScript or reads local reports.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const input=JSON.parse(fs.readFileSync(path.join(__dirname,'unified-test-0.1.3.json'),'utf8')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'wco-lab-repro-'));
try{
 for(const [name,source]of Object.entries(input.files)){
  if(!/^(?:custom\/providers\/wco-unified\/[a-zA-Z0-9_.\/-]+|scripts\/build-wco-unified\.js)$/.test(name)||name.split('/').includes('..'))throw Error('Unexpected archive path');
  const dest=path.join(temp,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source);
 }
 cp.execFileSync(process.execPath,[path.join(temp,'scripts/build-wco-unified.js')],{stdio:'inherit'});
 const bytes=fs.readFileSync(path.join(temp,'custom/providers/wco-unified.js'));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==input.artifactSha256)throw Error('Reproduced hash mismatch');
 const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9)||path.resolve(__dirname,'../../providers/wco-unified-013-archive-lab.js');
 if(process.argv.includes('--check')){if(!fs.readFileSync(output).equals(bytes))throw Error('Archived standalone mismatch');}else{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 console.log('Verified source-only Unified archive: '+input.artifactSha256);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
