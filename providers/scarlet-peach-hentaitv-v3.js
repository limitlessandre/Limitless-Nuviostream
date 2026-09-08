"use strict";

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/providers/scarlet-peach-hentaitv-v2.js";
let cached = null;

function diag(detail) {
  const text = String(detail || "Scarlet Peach HentaiTV wrapper failure");
  return [{
    name: `Scarlet Peach - HentaiTV • DIAG WRAPPER • ${text}`,
    title: text,
    url: "https://hentai.tv/favicon.ico",
    quality: "DIAG",
    language: "Unavailable",
    provider: "Scarlet Peach - HentaiTV",
    type: "mp4",
    subtitles: []
  }];
}

function patchSource(source) {
  let out = String(source || "");
  const pagePattern = /async function pageExists\(slug\)\{[\s\S]*?\}\nfunction titleQueries/;
  out = out.replace(pagePattern,
`async function pageExists(slug){const r=await safeFetch(\`${'${HENTAITV_BASE}'}/hentai/${'${slug}'}\`,{method:"GET",redirect:"follow",headers:{...browserHeaders(),Cookie:"inter=1"}});return !!(r&&r.ok);}\nfunction titleQueries`);

  const nhPattern = /async function nhplayerStreams\(html\)\{[\s\S]*?\}\nfunction videoSlugVariations/;
  out = out.replace(nhPattern,
`async function nhplayerStreams(html){const result={urls:[],diag:"nh=absent"};const m=String(html||"").match(/nhplayer\\.com\\/v\\/([a-zA-Z0-9_-]+)/i);if(!m)return result;result.diag=\`nhId=${'${m[1]}'}\`;const r=await safeFetch(\`https://nhplayer.com/v/${'${m[1]}'}/\`,{redirect:"follow",headers:{...browserHeaders(\`${'${HENTAITV_BASE}'}/\`),Cookie:"inter=1"}});if(!r){result.diag+=\" • nhHTTP=failed\";return result;}result.diag+=\` • nhHTTP=${'${r.status}'}\`;if(!r.ok)return result;const h=await readText(r);result.diag+=\` • nhHTML=${'${h?"yes":"no"}'} • nhLen=${'${h?h.length:0}'}\`;for(const u of directMediaFromHtml(h))if(!result.urls.includes(u))result.urls.push(u);result.diag+=\` • direct=${'${result.urls.length}'}\`;const d=h.match(/data-id=[\"']([^\"']+)[\"']/i);result.diag+=\` • dataId=${'${d?"yes":"no"}'}\`;if(d){const raw=decodeHtml(d[1]);const u=raw.match(/(?:^|[?&])u=([^&]+)/i)||raw.match(/u=([^&]+)/i);result.diag+=\` • u=${'${u?"yes":"no"}'}\`;if(u){let encoded=u[1];try{encoded=decodeURIComponent(encoded);}catch(_){}const x=decodeBase64(encoded);result.diag+=\` • b64=${'${x?"yes":"no"}'}\`;if(/^https?:\\/\\//i.test(x)&&/\\.(?:mp4|m3u8)(?:[?#]|$)/i.test(x)&&!result.urls.includes(x))result.urls.push(x);}}return result;}\nfunction videoSlugVariations`);

  const resolvePattern = /async function resolveStreamsFromSlug\(slug\)\{[\s\S]*?\}\nasync function pageExists/;
  out = out.replace(resolvePattern,
`async function resolveStreamsFromSlug(slug){const pageUrl=\`${'${HENTAITV_BASE}'}/hentai/${'${slug}'}\`;const page=await safeFetch(pageUrl,{redirect:"follow",headers:{...browserHeaders(),Cookie:"inter=1"}});let html="";if(page&&page.ok)html=await readText(page);let nhDiag=/nhplayer\\.com/i.test(html)?"nh=present":"nh=absent";if(html){const direct=directMediaFromHtml(html);if(direct.length)return{streams:direct.map(toStream),error:"",pageStatus:page.status,nh:true};const nh=await nhplayerStreams(html);nhDiag=nh.diag;if(nh.urls.length)return{streams:nh.urls.map(toStream),error:"",pageStatus:page.status,nh:true};const iframe=html.match(/iframe[^>]+src=[\"']([^\"']+source=[^\"']+)[\"']/i);if(iframe){const sm=decodeHtml(iframe[1]).match(/[?&]source=([^&]+)/i);if(sm){try{const u=decodeURIComponent(sm[1]);if(/^https?:\\/\\//i.test(u)&&/\\.(?:mp4|m3u8)(?:[?#]|$)/i.test(u))return{streams:[toStream(u)],error:"",pageStatus:page.status,nh:true};}catch(_){}}}}for(const vs of videoSlugVariations(slug)){const u=\`https://r2.1hanime.com/${'${vs}'}.mp4\`;if(await verifyR2(u))return{streams:[toStream(u)],error:"",pageStatus:page?page.status:"failed",nh:/nhplayer\\.com/i.test(html)};}return{streams:[],error:\`no media source; page HTTP ${'${page?page.status:"failed"}'} • html=${'${html?"yes":"no"}'} • ${'${nhDiag}'}\`,pageStatus:page?page.status:"failed",nh:/nhplayer\\.com/i.test(html)};}\nasync function pageExists`);

  if (!out.includes("nhHTTP=")) return null;
  return out;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = patchSource(await response.text());
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return diag("unable to load patched v2 provider");
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows : diag("provider returned non-array result");
  } catch (error) {
    return diag(error && error.message ? error.message : error);
  }
}

module.exports = { getStreams };
