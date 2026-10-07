const fs=require('node:fs'), path=require('node:path');
const dir=path.resolve(__dirname,'../../netmirror-evidence');
const requests=JSON.parse(fs.readFileSync(path.join(dir,'requests.json')));
const results=[];
async function get(url,headers={},body) {
 const item={url,headers};results.push(item);
 try {const r=await fetch(url,{headers,body,method:body?'POST':'GET',signal:AbortSignal.timeout(8000)});Object.assign(item,{status:r.status,finalUrl:r.url,headersReceived:Object.fromEntries(r.headers),body:await r.text()});}catch(e){item.error=e.message;}
 fs.writeFileSync(path.join(dir,'returned-links.json'),JSON.stringify(results,null,2));return item;
}
(async()=>{
 for(const req of requests.filter(x=>x.url.includes('/newtv/player.php')&&x.body)) {
  const player=JSON.parse(req.body), id=new URL(req.url).searchParams.get('id');
  const headers={Referer:player.referer,'User-Agent':'Mozilla/5.0'};
  console.log(id,'newtv');
  const master=await get(player.video_link,headers);
  if(master.body?.trimStart().startsWith('#EXTM3U')) {
   const links=[...master.body.matchAll(/URI="([^"]+)"/g)].map(m=>m[1]).concat(master.body.split(/\r?\n/).filter(x=>x&&!x.startsWith('#')));
   for(const link of [...new Set(links)]) await get(new URL(link,master.finalUrl).href,headers);
  }
  console.log(id,'mobile');
  await get('https://net52.cc/mobile/playlist.php?id='+id+'&t=probe&tm='+Math.floor(Date.now()/1000),{...headers,'X-Requested-With':'app.netmirror.netmirrornew',Cookie:'ott=nf; hd=on'});
  console.log(id,'native');
  const nativeHeaders={...headers,Referer:'https://net77.cc/home',Origin:'https://net77.cc','X-Requested-With':'XMLHttpRequest'};
  const warm=await get('https://net77.cc/home',nativeHeaders);
  const cookies=warm.headersReceived?.['set-cookie'];
  if(cookies) nativeHeaders.Cookie=cookies.split(/,(?=\s*[^;,\s]+=)/).map(x=>x.split(';')[0]).join('; ');
  const play=await get('https://net77.cc/play.php',{...nativeHeaders,'Content-Type':'application/x-www-form-urlencoded'},'id='+id);
  try {const h=JSON.parse(play.body).h;if(h)await get('https://net52.cc/playlist.php?id='+id+'&t=probe&tm='+Math.floor(Date.now()/1000)+'&h='+encodeURIComponent(h),nativeHeaders);}catch{}
 }
 console.log('Completed',results.length,'requests; raw responses saved outside Git.');
})();
