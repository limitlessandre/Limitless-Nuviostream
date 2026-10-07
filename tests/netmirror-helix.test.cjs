const test = require("node:test");
const assert = require("node:assert/strict");

function walk(value, trail = [], out = []) {
  if (Array.isArray(value)) { value.forEach((v,i)=>walk(v,trail.concat(i),out)); return out; }
  if (!value || typeof value !== "object") return out;
  for (const [key,item] of Object.entries(value)) {
    const next=trail.concat(key);
    if (typeof item === "string" && (/^https?:\/\//i.test(item) || /url|file|src|stream|audio|caption|subtitle|master|playlist/i.test(key))) out.push({path:next.join("."),key,value:item});
    walk(item,next,out);
  }
  return out;
}
function kind(url) {
  if (/220884/.test(url)) return "wrong-220884";
  if (/tran-audio/i.test(url)) return "audio-resource";
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/\.(?:vtt|srt)(?:[?#]|$)/i.test(url)) return "subtitle";
  return "other";
}
function assetIds(value){return [...new Set(walk(value).flatMap(x=>(x.value.match(/\/files\/(\d+)\//g)||[]).map(s=>s.match(/\d+/)[0])))];}

test("Helix inventories nested fast-path media instead of only streams[]",()=>{
  const fixture={ok:true,streams:[{url:"https://cdn.test/video.mp4"}],captions:[{url:"https://cdn.test/en.vtt"}],extra:{audio:{file:"https://cdn.test/tran-audio/en.mp4"},master:"https://cdn.test/files/81947712/master.m3u8"}};
  const rows=walk(fixture);
  assert.ok(rows.some(x=>x.path==="extra.audio.file"));
  assert.ok(rows.some(x=>kind(x.value)==="audio-resource"));
  assert.deepEqual(assetIds(fixture),["81947712"]);
});

test("Helix treats common asset 220884 as a hard failure signal",()=>{
  assert.equal(kind("https://cdn.test/files/220884/720p/720p.m3u8?in=x"),"wrong-220884");
});

test("Helix recognizes a potential rich HLS bridge independently of MP4 qualities",()=>{
  const fixture={streams:[{url:"https://cdn.test/a.mp4",resolution:720}],metadata:{playlist:"https://cdn.test/files/81048667/master.m3u8"}};
  const inventory=walk(fixture).map(x=>({...x,kind:kind(x.value)}));
  assert.equal(inventory.filter(x=>x.kind==="mp4").length,1);
  assert.equal(inventory.filter(x=>x.kind==="hls").length,1);
});
