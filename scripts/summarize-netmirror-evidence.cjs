const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.resolve(root,'../netmirror-evidence');
const audit=JSON.parse(fs.readFileSync(path.join(dir,'hls-audit.json')));
function redact(value,key='') {
 if(/cookie/i.test(key)&&typeof value==='string')return value.split(';').map(x=>x.split('=')[0].trim()+'=<redacted>').join('; ');
 if(typeof value==='string')return value.replace(/([?&](?:in|sign|token|Signature|Policy|Key-Pair-Id|h|t_hash_t)=)[^&\s"\r\n]*/gi,'$1<redacted>');
 if(Array.isArray(value))return value.map(x=>redact(x));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));
 return value;
}
fs.mkdirSync(path.join(root,'docs/netmirror'),{recursive:true});
fs.mkdirSync(path.join(root,'tests/fixtures/netmirror'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/netmirror/transport-evidence.json'),JSON.stringify(redact({captured:'2026-10-06',baseline:'8df7879',reference:'40a3319ce03d9a6fb3a59aacf420341a24c4e630',masters:audit.masters,requests:audit.requests.map(({body,headersReceived,...r})=>({...r,hls:body?.trimStart().startsWith('#EXTM3U'),bodyPreview:body&&!body.startsWith('#EXTM3U')?body.slice(0,100):undefined}))}),null,2)+'\n');
const original=JSON.parse(fs.readFileSync(path.join(dir,'requests.json')));
for(const id of ['81947712','81048667','81262746']) {
 for(const [route,req]of [['mobile',original.find(x=>x.url.includes('/mobile/hls/'+id+'.m3u8'))],['newtv',audit.requests.find(x=>x.url.includes('/newtv/hls/nf/'+id+'.m3u8'))]])
 if(req?.body)fs.writeFileSync(path.join(root,`tests/fixtures/netmirror/${id}-${route}.m3u8`),redact(req.body));
}
console.log('Wrote redacted evidence and six captured master fixtures.');
