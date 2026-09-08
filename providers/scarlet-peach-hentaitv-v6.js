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
`function unescapeSlashes(value){let s=String(value||"");while(s.indexOf("\\\\/")>=0)s=s.replace("\\\\/","/");return s;}\nfunction stripOuterQuotes(value){let s=String(value||"").trim();if(s.length>=2){const a=s.charAt(0),b=s.charAt(s.length-1);if((a==='"'&&b==='"')||(a==="'"&&b==="'"))s=s.slice(1,-1);}return s;}\nfunction normalizeMediaUrl(value,base){let u=stripOuterQuotes(unescapeSlashes(decodeHtml(String(value||""))));if(!u)return"";try{u=decodeURIComponent(u);}catch(_){}if(/^\\/\\//.test(u))u="https:"+u;else if(/^\\//.test(u))u="https://nhplayer.com"+u;else if(!/^https?:\\/\\//i.test(u)&&base){try{u=new URL(u,base).href;}catch(_){}}return /^https?:\\/\\//i.test(u)?u:"";}\nasync function nhplayerStreams(html){
  const result={urls:[],diag:"nh=absent"};
  const m=String(html||"").match(/nhplayer\\.com\\/v\\/([a-zA-Z0-9_-]+)/i);
  if(!m)return result;
  const nhPage=\`https://nhplayer.com/v/${'${m[1]}'}/\`;
  result.diag=\`nhId=${'${m[1]}'}\`;
  const r=await safeFetch(nhPage,{redirect:"follow",headers:{...browserHeaders(\`${'${HENTAITV_BASE}'}/\`),Cookie:"inter=1"}});
  if(!r){result.diag+=" • nhHTTP=failed";return result;}
  result.diag+=\` • nhHTTP=${'${r.status}'}\`;
  if(!r.ok)return result;
  const h=await readText(r);
  result.diag+=\` • nhHTML=${'${h?"yes":"no"}'} • nhLen=${'${h?h.length:0}'}\`;
  for(const u of directMediaFromHtml(h))if(!result.urls.includes(u))result.urls.push(u);
  result.diag+=\` • direct=${'${result.urls.length}'}\`;
  const d=h.match(/data-id=["']([^"']+)["']/i);
  result.diag+=\` • dataId=${'${d?"yes":"no"}'}\`;
  if(d){
    const raw=decodeHtml(d[1]).trim();
    const oldU=raw.match(/(?:^|[?&])u=([^&]+)/i)||raw.match(/u=([^&]+)/i);
    if(oldU){
      result.diag+=" • mode=u";
      let encoded=oldU[1];try{encoded=decodeURIComponent(encoded);}catch(_){}
      const x=decodeBase64(encoded);result.diag+=\` • b64=${'${x?"yes":"no"}'}\`;
      const finalUrl=normalizeMediaUrl(x,nhPage);if(finalUrl&&!result.urls.includes(finalUrl))result.urls.push(finalUrl);
    } else {
      let playerUrl="";
      if(/^https?:\\/\\//i.test(raw))playerUrl=raw;
      else if(/^\\/\\//.test(raw))playerUrl="https:"+raw;
      else if(/^\\//.test(raw))playerUrl="https://nhplayer.com"+raw;
      else if(/^(?:player\\.php|embed|player\\/)/i.test(raw))playerUrl="https://nhplayer.com/"+raw.replace(/^\\/+/ ,"");
      if(playerUrl){
        result.diag+=" • mode=hop";
        const p=await safeFetch(playerUrl,{redirect:"follow",headers:{...browserHeaders(nhPage),Cookie:"inter=1"}});
        result.diag+=\` • hopHTTP=${'${p?p.status:"failed"}'}\`;
        if(p&&p.ok){
          const ph=await readText(p);
          result.diag+=\` • hopHTML=${'${ph?"yes":"no"}'} • hopLen=${'${ph?ph.length:0}'}\`;
          const media=directMediaFromHtml(ph);
          for(const u of media)if(!result.urls.includes(u))result.urls.push(u);
          let rawFile="";
          const text=unescapeSlashes(String(ph||""));
          const fm=text.match(/file\\s*:\\s*["']([^"']+)["']/i)||text.match(/file["']?\\s*[:=]\\s*["']([^"']+)["']/i)||text.match(/(?:source|url)["']?\\s*[:=]\\s*["']([^"']+)["']/i);
          if(fm)rawFile=fm[1];
          if(!rawFile){try{const j=JSON.parse(text);rawFile=j.file||j.source||j.url||j.src||"";}catch(_){} }
          if(!rawFile&&/^\\s*(?:https?:)?\\/\\//i.test(text))rawFile=stripOuterQuotes(text);
          const finalUrl=normalizeMediaUrl(rawFile,playerUrl);
          result.diag+=\` • hopDirect=${'${media.length}'} • hopFile=${'${rawFile?"yes":"no"}'} • hopUrl=${'${finalUrl?"yes":"no"}'}\`;
          if(finalUrl&&!result.urls.includes(finalUrl))result.urls.push(finalUrl);
        }
      } else {
        result.diag+=" • mode=raw";
        const decoded=decodeBase64(raw);result.diag+=\` • rawB64=${'${decoded?"yes":"no"}'}\`;
        const finalUrl=normalizeMediaUrl(decoded,nhPage);if(finalUrl&&!result.urls.includes(finalUrl))result.urls.push(finalUrl);
      }
    }
  }
  return result;
}\nfunction videoSlugVariations`);

  const resolvePattern = /async function resolveStreamsFromSlug\(slug\)\{[\s\S]*?\}\nasync function pageExists/;
  out = out.replace(resolvePattern,
`async function resolveStreamsFromSlug(slug){const pageUrl=\`${'${HENTAITV_BASE}'}/hentai/${'${slug}'}\`;const page=await safeFetch(pageUrl,{redirect:"follow",headers:{...browserHeaders(),Cookie:"inter=1"}});let html="";if(page&&page.ok)html=await readText(page);let nhDiag=/nhplayer\\.com/i.test(html)?"nh=present":"nh=absent";if(html){const direct=directMediaFromHtml(html);if(direct.length)return{streams:direct.map(toStream),error:""};const nh=await nhplayerStreams(html);nhDiag=nh.diag;if(nh.urls.length)return{streams:nh.urls.map(toStream),error:""};}for(const vs of videoSlugVariations(slug)){const u=\`https://r2.1hanime.com/${'${vs}'}.mp4\`;if(await verifyR2(u))return{streams:[toStream(u)],error:""};}return{streams:[],error:\`no media source; page HTTP ${'${page?page.status:"failed"}'} • html=${'${html?"yes":"no"}'} • ${'${nhDiag}'}\`};}\nasync function pageExists`);

  return out.includes("hopFile=") ? out : null;
}

async function loadBase(){
  if(cached&&typeof cached.getStreams==="function")return cached;
  try{
    const response=await fetch(BASE_URL,{skipSizeCheck:true});
    if(!response||!response.ok)return null;
    const source=patchSource(await response.text());
    if(!source)return null;
    const mod={exports:{}};
    const factory=new Function("module","exports","require",source+"\n;return module.exports;");
    const exported=factory(mod,mod.exports,function(name){throw new Error("Unsupported nested require: "+name);})||mod.exports;
    if(!exported||typeof exported.getStreams!=="function")return null;
    cached=exported;return cached;
  }catch(_){return null;}
}

async function getStreams(inputId,mediaType,season,episode){
  const base=await loadBase();
  if(!base)return diag("unable to load patched v2 provider");
  try{const rows=await base.getStreams(inputId,mediaType,season,episode);return Array.isArray(rows)?rows:diag("provider returned non-array result");}
  catch(error){return diag(error&&error.message?error.message:error);}
}

module.exports={getStreams};
