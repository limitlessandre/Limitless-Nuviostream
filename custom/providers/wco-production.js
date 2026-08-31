"use strict";

const PROVIDER_NAME = "WCO";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const MODULE_URLS = {
  core: `${BRANCH_RAW}/wco.js`,
  special: `${BRANCH_RAW}/wco-special-test-v2.js`,
  episode0: `${BRANCH_RAW}/wco-episode0-test.js`
};

const cache = Object.create(null);

function augmentCoreMirrors(source) {
  const startMarker = "async function extractEmbed(embedUrl, variant, displayTitle, info)";
  const endMarker = "async function candidatePage(candidate)";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) return source;

  const replacement = [
    'async function extractEmbed(embedUrl, variant, displayTitle, info) {',
    '  if (!embedUrl || /user\\.wcostream\\.tv\\/check-login/i.test(embedUrl)) return [];',
    '  if (!/embed\\.wcostream/i.test(embedUrl)) return [];',
    '  const lookup = await playerLookup(embedUrl);',
    '  if (!lookup) return [];',
    '  const lookupRes = await req(lookup, { headers: { "Accept": "application/json, text/javascript, */*; q=0.01", "Referer": embedUrl, "Origin": originOf(embedUrl), "X-Requested-With": "XMLHttpRequest" } });',
    '  if (!lookupRes.ok) return [];',
    '  let data;',
    '  try { data = JSON.parse(lookupRes.text); } catch (_) { return []; }',
    '  const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]).slice(0, 2);',
    '  if (!hosts.length) return [];',
    '  const finalVariant = variant || "Original";',
    '  const meta = variantMeta(finalVariant, info.originalLanguage);',
    '  const qualities = [data.fhd ? ["1080p", data.fhd] : null, data.fullhd ? ["1080p", data.fullhd] : null, data.hd ? ["720p", data.hd] : null, data.enc ? ["480p", data.enc] : null].filter(Boolean);',
    '  const out = [];',
    '  for (let mirrorIndex = 0; mirrorIndex < hosts.length; mirrorIndex++) {',
    '    const mirrorHost = hosts[mirrorIndex];',
    '    const usedQuality = new Set();',
    '    for (const item of qualities) {',
    '      const quality = item[0];',
    '      if (usedQuality.has(quality)) continue;',
    '      const mediaRes = await req(mirrorHost + "/getvid?evid=" + encodeURIComponent(String(item[1])) + "&json", { headers: { "Referer": embedUrl, "Origin": originOf(embedUrl) } });',
    '      if (!mediaRes.ok) continue;',
    '      const media = resolvedValue(mediaRes.text, mediaRes.url);',
    '      if (!media) continue;',
    '      usedQuality.add(quality);',
    '      out.push({ name: PROVIDER_NAME + " • " + quality + " • " + meta.label, title: displayTitle, url: media, quality: quality, language: meta.language, provider: PROVIDER_NAME, type: /\\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4", headers: { "Referer": embedUrl, "Origin": originOf(embedUrl), "User-Agent": UA }, _variant: finalVariant, _mirrorIndex: mirrorIndex + 1, _mirrorKey: mirrorHost });',
    '    }',
    '  }',
    '  return out;',
    '}',
    ''
  ].join("\n");

  return source.slice(0, start) + replacement + source.slice(end);
}

function augmentSpecialSource(source) {
  source = source.replace(
    /function variant\(v,forced\)\{[\s\S]*?\}function meta\(v,lang\)\{[\s\S]*?\}/,
    [
      'function variant(v,forced){v=String(v||"").toLowerCase();if(/subbed|\\bsub\\b/.test(v))return"Sub";if(/dubbed|\\bdub\\b/.test(v))return"Dub";return forced||"Original";}',
      'function specialLanguageName(code){const c=String(code||"en").toLowerCase();return({en:"English",ja:"Japanese",ko:"Korean",zh:"Chinese",es:"Spanish",fr:"French",de:"German",it:"Italian",pt:"Portuguese"})[c]||c.toUpperCase()||"Original";}',
      'function meta(v,lang){const base=specialLanguageName(lang);if(v==="Sub")return{label:base==="Japanese"?"Japanese + English Hard Subs":base+" + Hard Subs",language:base};if(v==="Dub")return base==="English"?{label:"English Audio",language:"English"}:{label:"English Dub",language:"English"};return{label:base+" (Original)",language:base};}'
    ].join("\n")
  );

  source = source.replace(
    /async function entries\(seriesUrl,t\)\{[\s\S]*?\}\nfunction b64/,
    [
      'async function entries(seriesUrl,t){const base=String(seriesUrl).replace(/[?#].*$/,"").replace(/\\/$/,""),byHref=new Map();for(const p of [{u:`${base}/?season=all`,v:null},{u:`${base}/?season=all&lang=dub`,v:"Dub"},{u:`${base}/?season=all&lang=sub`,v:"Sub"}]){const r=await req(p.u,{headers:{"Referer":seriesUrl}});if(!r.ok)continue;for(const x of links(r.body,p.u,null)){if(/\\/anime\\//i.test(x.href))continue;const id=`${x.text} ${x.href}`;if(!distinct(id,t.aliases))continue;let rec=byHref.get(x.href);if(!rec){rec={href:x.href,text:x.text,score:best(id,t.aliases),contexts:new Set(),explicit:new Set()};byHref.set(x.href,rec);}rec.score=Math.max(rec.score,best(id,t.aliases));rec.contexts.add(p.v||"All");const detected=variant(id,null);if(detected!=="Original")rec.explicit.add(detected);}}const out=[];for(const rec of byHref.values()){let resolved="Original";if(rec.explicit.size===1)resolved=Array.from(rec.explicit)[0];else if(rec.explicit.size===0){const hasDub=rec.contexts.has("Dub"),hasSub=rec.contexts.has("Sub");if(hasDub&&!hasSub)resolved="Dub";else if(hasSub&&!hasDub)resolved="Sub";}out.push({href:rec.href,text:rec.text,variant:resolved,score:rec.score});}return out.sort((a,b)=>b.score-a.score).slice(0,8);}',
      'function b64'
    ].join("\n")
  );

  const marker = "async function getStreams(inputId,mediaType,season,episode)";
  const exportMarker = "module.exports={getStreams};";
  const start = source.indexOf(marker);
  const end = source.indexOf(exportMarker, start);
  if (start < 0 || end < 0) return source;

  const replacement = [
    'function fractionalNo(v){const s=String(v||"");let m=s.match(/\\bEpisode\\s*(\\d+\\.\\d+)\\b/i);if(!m)m=s.match(/episode[-_ ]?(\\d+\\.\\d+)(?:\\D|$)/i);return m?m[1]:"";}',
    'async function fractionalEntries(seriesUrl,wantedVariant){const base=String(seriesUrl||"").replace(/[?#].*$/,"").replace(/\\/$/,"");const lang=wantedVariant==="Sub"?"sub":"dub",u=base+"/?season=all&lang="+lang,r=await req(u,{headers:{"Referer":seriesUrl}});if(!r.ok)return[];const out=[];for(const x of links(r.body,u,null)){if(/\\/anime\\//i.test(x.href))continue;const id=x.text+" "+x.href;if(!fractionalNo(id))continue;const detected=variant(id,null),resolved=detected==="Original"?wantedVariant:detected;if(!out.some(y=>y.href===x.href))out.push({...x,variant:resolved});}return out;}',
    'async function getStreams(inputId,mediaType,season,episode){const type=String(mediaType||"").toLowerCase()==="movie"?"movie":"tv";if(type==="tv"&&+season!==0)return[];try{const t=await target(inputId,type,season,episode);if(!t)return debug("NO TMDB TARGET",null);const parents=await seriesCandidates(t);let reason="";for(const p of parents){const matched=await entries(p.href,t),collected=[],variants=new Set();for(const e of matched){const r=await extract(e,t);if(r.streams.length){collected.push(...r.streams);variants.add(e.variant);}else if(!reason)reason=r.reason;}if(type==="tv"&&collected.length){for(const wanted of ["Dub","Sub"]){if(variants.has(wanted))continue;const frac=await fractionalEntries(p.href,wanted);if(frac.length!==1)continue;const r=await extract(frac[0],t);if(r.streams.length){collected.push(...r.streams);variants.add(frac[0].variant);}}}if(collected.length)return collected;}if(reason)return debug(reason.slice(0,140),t);return debug(parents.length?"SERIES "+parents[0].text+" • NO SPECIAL MATCH":"NO SERIES MATCH • "+t.title,t);}catch(_){return debug("RUNTIME ERROR",null);}}',
    ''
  ].join("\n");

  return source.slice(0, start) + replacement + source.slice(end);
}

async function loadModule(key) {
  if (cache[key] && typeof cache[key].getStreams === "function") return cache[key];
  const url = MODULE_URLS[key];
  if (!url) return null;
  try {
    const res = await fetch(url, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    let source = String(await res.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    if (key === "core") source = augmentCoreMirrors(source);
    if (key === "special") source = augmentSpecialSource(source);
    const mod = { exports: {} };
    const localRequire = function(name) {
      throw new Error(`Unsupported nested require: ${name}`);
    };
    const factory = new Function("module", "exports", "require", `${source}\n;return module.exports;`);
    const exported = factory(mod, mod.exports, localRequire) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cache[key] = exported;
    return exported;
  } catch (_) {
    return null;
  }
}

function isDebug(stream) {
  const name = String(stream && stream.name || "");
  const quality = String(stream && stream.quality || "");
  return !stream || !stream.url || /\bDIAG\b/i.test(name) || /^Debug$/i.test(quality);
}

function productionLabel(stream) {
  const name = String(stream && stream.name || "").toLowerCase();
  const lang = String(stream && stream.language || "").trim();
  if (name.includes("dual audio")) return "Dual Audio + Subs";
  if (name.includes("multi audio")) return "Multi Audio + Subs";
  if (name.includes("english audio")) return "English Audio";
  if (name.includes("english dub")) return "English Dub";
  if (name.includes("hard subs")) {
    if (/^japanese$/i.test(lang)) return "Japanese + English Hard Subs";
    return `${lang || "Original"} + Hard Subs`;
  }
  if (name.includes("english (original)")) return "English (Original)";
  if (name.includes("japanese (original)")) return "Japanese (Original)";
  return lang || "Original";
}

function qualityRank(value) {
  const q = String(value || "").toLowerCase();
  const m = q.match(/(\d{3,4})p/);
  if (m) return Number(m[1]);
  if (q.includes("4k") || q.includes("2160")) return 2160;
  return 0;
}

function mediaHost(url) {
  const m = String(url || "").match(/^https?:\/\/([^/:?#]+)/i);
  return m ? m[1].toLowerCase() : "unknown";
}

function cleanStreams(streams) {
  const normalized = [];
  const seen = new Set();

  for (const stream of streams || []) {
    if (isDebug(stream)) continue;
    const quality = String(stream.quality || "Auto");
    const label = productionLabel(stream);
    const explicitMirror = Number(stream._mirrorIndex || 0);
    const host = mediaHost(stream.url);
    const mirrorKey = explicitMirror > 0 ? `explicit-${explicitMirror}` : "single";
    const key = `${quality}|${label}|${mirrorKey}|${stream.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...stream, quality, _label: label, _host: host, _mirrorKey: mirrorKey, _explicitMirror: explicitMirror });
  }

  const byLabel = new Map();
  for (const stream of normalized) {
    if (!byLabel.has(stream._label)) byLabel.set(stream._label, []);
    byLabel.get(stream._label).push(stream);
  }

  const out = [];
  for (const [label, branch] of byLabel) {
    const mirrorKeys = [];
    for (const stream of branch) if (!mirrorKeys.includes(stream._mirrorKey)) mirrorKeys.push(stream._mirrorKey);
    const selectedMirrors = mirrorKeys.slice(0, 2);

    for (let m = 0; m < selectedMirrors.length; m++) {
      const mirrorKey = selectedMirrors[m];
      const candidates = branch
        .filter(x => x._mirrorKey === mirrorKey)
        .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));

      const picked = [];
      const usedQualities = new Set();
      for (const stream of candidates) {
        const qKey = String(stream.quality || "Auto").toLowerCase();
        if (usedQualities.has(qKey)) continue;
        usedQualities.add(qKey);
        picked.push(stream);
        if (picked.length >= 2) break;
      }

      for (const stream of picked) {
        const mirror = selectedMirrors.length > 1 ? ` • Mirror ${m + 1}` : "";
        const { _label, _host, _mirrorKey, _explicitMirror, _mirrorIndex, ...clean } = stream;
        out.push({
          ...clean,
          name: `${PROVIDER_NAME}${mirror} • ${stream.quality} • ${label}`,
          provider: PROVIDER_NAME
        });
      }
    }
  }

  return out;
}

async function run(key, inputId, mediaType, season, episode) {
  const mod = await loadModule(key);
  if (!mod) return [];
  try {
    return cleanStreams(await mod.getStreams(inputId, mediaType, season, episode));
  } catch (_) {
    return [];
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();

  if (type === "movie") {
    return await run("special", inputId, "movie", season, episode);
  }

  if (Number(season) === 0) {
    const titleMatched = await run("special", inputId, type, season, episode);
    if (titleMatched.length) return titleMatched;
    return await run("episode0", inputId, type, season, episode);
  }

  return await run("core", inputId, type, season, episode);
}

module.exports = { getStreams };
