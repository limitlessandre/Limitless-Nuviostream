// Read-only, independent transport probe. Raw results stay outside the repository.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const out = path.resolve(__dirname, '../../netmirror-evidence');
fs.mkdirSync(out, { recursive: true });
const log = [];
const deadline = Date.now() + 300000;
async function request(url, opts = {}) {
  if (Date.now() >= deadline) throw new Error('Diagnostic run deadline');
  const start = Date.now();
  const event = { url: String(url), headers: opts.headers, method: opts.method || 'GET' };
  log.push(event);
  try {
    const response = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
    const body = await response.text();
    Object.assign(event, { status: response.status, ms: Date.now() - start, finalUrl: response.url, responseHeaders: Object.fromEntries(response.headers), body });
    return { ok: response.ok, status: response.status, headers: response.headers, url: response.url, text: async () => body, json: async () => JSON.parse(body) };
  } catch (e) { event.error = e.message; event.ms = Date.now() - start; throw e; }
  finally { fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(log, null, 2)); }
}
const sandbox = { fetch: request, URL, Buffer, atob, console, setTimeout, clearTimeout, module: { exports: {} } };
vm.createContext(sandbox);
// Pin the pre-fix implementation, so the const regression remains reproducible.
const baseline = execFileSync('git', ['show','8df7879:custom/providers/netmirror-standalone-nexus-v1.js'], {cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
vm.runInContext(baseline + '\nmodule.exports.probe = {tmdbContext,fetchFromPlatform,fetchFromNetflixMobile,fetchFromNetflixDirect,diagnostics,NEW_TV_BASE_HEADERS,MOBILE_WEB_UA};', sandbox);
const p = sandbox.module.exports.probe;
function attributes(line) { const result = {}; for (const m of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) result[m[1]] = m[2] ?? m[3]; return result; }
async function hls(row) {
  if (/\.mp4(?:[?#]|$)/i.test(row.url)) return {url:row.url,type:'mp4',note:'Use audit-netmirror-hls.cjs for bounded byte-range validation'};
  try {
    const r = await request(row.url, { headers: row.headers });
    const body = await r.text();
    if (!body.trimStart().startsWith('#EXTM3U')) return { url: row.url, status: r.status, hls: false };
    const lines = body.split(/\r?\n/); const media = [], variants = [];
    lines.forEach((line, i) => {
      if (line.startsWith('#EXT-X-MEDIA:')) { const a = attributes(line); if (a.URI) a.url = new URL(a.URI, r.url).href; media.push(a); }
      if (line.startsWith('#EXT-X-STREAM-INF:')) variants.push({ ...attributes(line), url: new URL(lines[i+1], r.url).href });
    });
    const children = [];
    for (const url of [...new Set([...media.map(x=>x.url), ...variants.map(x=>x.url)].filter(Boolean))]) {
      try { const c = await request(url, { headers: row.headers }); children.push({ url, status: c.status, hls: (await c.text()).trimStart().startsWith('#EXTM3U') }); }
      catch(e) { children.push({ url, error:e.message }); }
    }
    return { url: row.url, status:r.status, headers:row.headers, media, variants, children };
  } catch(e) { return { url:row.url,error:e.message }; }
}
(async () => {
  const results = [];
  for (const title of ['Teach You a Lesson','Centaurworld','Squid Game']) {
    const search = await (await request('https://api.themoviedb.org/3/search/tv?api_key=1865f43a0549ca50d341dd9ab8b29f49&query='+encodeURIComponent(title))).json();
    const hit = search.results.find(x=>x.name.toLowerCase()===title.toLowerCase());
    if (!hit) { results.push({title,error:'No exact TMDB match',search}); continue; }
    const context = await p.tmdbContext(hit.id,'tv',1,1); context.queries=[title];
    const result = {title, context, paths:{}}; results.push(result);
    for (const [name,run] of [['newtv',()=>p.fetchFromPlatform('netflix',context)],['mobile',()=>p.fetchFromNetflixMobile(context,true)],['net27',()=>p.fetchFromNetflixDirect(context)]]) {
      console.log(title, name);
      try { const rows = await run(); result.paths[name]={rows,hls:await Promise.all(rows.map(hls))}; }
      catch(e) {result.paths[name]={error:e.message};}
      fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
    }
    result.diagnostics=p.diagnostics();
    const nativeId = result.diagnostics.filter(x=>x.event==='generic-accepted').at(-1)?.playerId;
    if (nativeId) {
      const headers={ 'User-Agent':p.MOBILE_WEB_UA, Referer:'https://net77.cc/home', Origin:'https://net77.cc', 'X-Requested-With':'XMLHttpRequest' };
      try {
        await request('https://net77.cc/home',{headers});
        const play=await (await request('https://net77.cc/play.php',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:'id='+encodeURIComponent(nativeId)})).json();
        result.paths.native={play};
        if(play.h) result.paths.native.playlist=await (await request('https://net52.cc/playlist.php?id='+nativeId+'&t='+encodeURIComponent(title)+'&tm='+Math.floor(Date.now()/1000)+'&h='+encodeURIComponent(play.h),{headers})).json();
      } catch(e) { result.paths.native={error:e.message}; }
    }
    try { result.paths.net27Reference=await (await request('https://net27.cc/api/embed-tmdb/'+hit.id+'?type=tv&s=1&e=1',{headers:{Referer:'https://videodownloader.site/','User-Agent':p.MOBILE_WEB_UA}})).json(); }
    catch(e) {result.paths.net27Reference={error:e.message};}
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
    console.log(title, JSON.stringify(Object.fromEntries(Object.entries(result.paths).map(([k,v])=>[k,v.error||v.rows?.length||v.ok||'no rows']))));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
