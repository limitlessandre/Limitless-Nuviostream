#!/usr/bin/env node
"use strict";
// Entry-source heuristics only, never executes/fetches/rewrites a provider.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function sourceAudit(root){const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));const providers=[];
for(const e of manifest.scrapers.filter(e=>e.enabled)){
 let relative=e.filename.split('?')[0];
 if(/^https?:/.test(relative)){const u=new URL(relative);if(u.hostname!=='raw.githubusercontent.com'||!u.pathname.startsWith('/limitlessandre/Limitless-Nuviostream/')){providers.push({id:e.id,name:e.name,version:e.version,sourceReview:'External source not mapped to local repository; inspect separately.'});continue;}const m=u.pathname.match(/\/(custom\/providers\/[^/]+\.js)$/);relative=m?.[1];}
 if(!relative||relative.includes('\\')||relative.split('/').includes('..')||path.isAbsolute(relative)){providers.push({id:e.id,name:e.name,version:e.version,sourceReview:'Unmapped or unsafe source path.'});continue;}
 let bytes;try{bytes=fs.readFileSync(path.join(root,relative));}catch(_){providers.push({id:e.id,name:e.name,version:e.version,sourceReview:'Entry source missing locally; no compliance verdict.'});continue;}
 const s=bytes.toString(),count=re=>(s.match(re)||[]).length;
 providers.push({id:e.id,name:e.name,version:e.version,path:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),gitBlob:crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),facts:{canonicalLabelFunction:/function\s+(?:normalizeRow|qualityLabel)|qualityLabel\(/.test(s),topTwoPattern:/kept\.length\s*===?\s*2|picked\s*>=?\s*2|length\s*>?=?\s*2|slice\(0,\s*2\)/.test(s),diagnosticText:/\bDIAG\b/.test(s),httpIconLiteral:/https?:[^\s"']*(?:favicon|\.ico)/.test(s),hashlessSentinelLiteral:/magnet:\?dn=WCO%20Unified%20Diagnostic/.test(s),emptyArrayReturnCount:count(/return\s*\[\s*\]/g),rawCodeUrlCount:count(/https:\/\/raw\.githubusercontent\.com\//g),trackFields:/subtitles|subtitleTracks|audioTracks/.test(s)},review:'Heuristics only: inspect transitive code, emitted rows, evidence and native playback. Embedded historical strings may be unreachable; pattern presence/absence is not a compliance verdict.'});
}
return {mode:'nonblocking-source-audit',manifestVersion:manifest.version,providerCount:providers.length,providers,nativePlaybackProved:false};}
if(require.main===module){try{const arg=process.argv.slice(2);if(arg.length>1||arg[0]&&!arg[0].startsWith('--root='))throw Error();const root=path.resolve(arg[0]?.slice(7)||'.');console.log(JSON.stringify(sourceAudit(root),null,2));}catch(_){console.error('AUDIT_INPUT_ERROR: provide a readable repository root with manifest.json.');process.exitCode=2;}}
module.exports={sourceAudit};
