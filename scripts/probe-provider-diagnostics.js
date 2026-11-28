#!/usr/bin/env node
"use strict";
// Opt-in probe for TRUSTED repository code. vm is not a security sandbox.
// Fetch is replaced by HTTP 503; no real site/metadata/player requests are made.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),{sourceAudit}=require('./audit-provider-standards');
const child=`const fs=require('fs'),vm=require('vm');const input=JSON.parse(fs.readFileSync(0,'utf8'));const {pinnedPluginPredicates}=require(input.contract);
const fetch=async url=>({ok:false,status:503,url:String(url),headers:{get:()=>null},text:async()=>'',json:async()=>null,arrayBuffer:async()=>new ArrayBuffer(0)});
const c=vm.createContext({module:{exports:{}},fetch,URL,URLSearchParams,setTimeout,clearTimeout,AbortController,console:{log(){},warn(){},error(){}}});
const clean=s=>String(s||'').replace(/https?:\\/\\/[^\\s]+/gi,'[URL removed]').replace(/(?:token|cookie|authorization|secret|api[_-]?key)\\s*[:=].*/gi,'[redacted]').replace(/[\\u0000-\\u001f]/g,' ').slice(0,240);
(async()=>{let rows=[],uncaughtError='';try{vm.runInContext(input.source,c,{timeout:1000});rows=await c.module.exports.getStreams(85349,'tv',1,2);}catch(e){uncaughtError=e.name;}
console.log(JSON.stringify({silentEmpty:Array.isArray(rows)&&rows.length===0,uncaughtError,rows:(Array.isArray(rows)?rows:[]).map(r=>({name:clean(r.name),quality:clean(r.quality),urlClass:/^https?:/i.test(r.url||'')?'HTTP direct':/^magnet:/i.test(r.url||'')?'magnet':'other',autoplayEligibleInPinnedPluginPredicate:[false,true].some(p2pEnabled=>[false,true].some(debridEnabled=>pinnedPluginPredicates(r,{p2pEnabled,debridEnabled}).autoEligible===true))}))}));})();`;
function probeDiagnostics(root){const source=sourceAudit(root);return {scenario:'All entry-path requests are HTTP 503; trusted-code subprocesses, not a live/native test.',nativeDesktopExecuted:false,providers:source.providers.map(e=>{
 if(!e.path)return {...e,probeUnavailable:true};const r=spawnSync(process.execPath,['-e',child],{input:JSON.stringify({source:fs.readFileSync(path.join(root,e.path),'utf8'),contract:path.resolve(__dirname,'provider-standards/desktop-contract.js')}),encoding:'utf8',timeout:6000,maxBuffer:1024*1024});
 let result;try{result=JSON.parse(r.stdout);}catch(_){result={probeUnavailable:true,reason:r.error?.code==='ETIMEDOUT'?'Probe subprocess exceeded 6 seconds.':'Provider probe failed; no compliance conclusion.'};}
 return {id:e.id,name:e.name,version:e.version,gitBlob:e.gitBlob,...result};})};}
if(require.main===module){try{const arg=process.argv.slice(2);if(arg.length>1||arg[0]&&!arg[0].startsWith('--root='))throw Error();console.log(JSON.stringify(probeDiagnostics(path.resolve(arg[0]?.slice(7)||'.')),null,2));}catch(_){console.error('PROBE_INPUT_ERROR: provide a readable trusted repository root.');process.exitCode=2;}}
module.exports={probeDiagnostics};
