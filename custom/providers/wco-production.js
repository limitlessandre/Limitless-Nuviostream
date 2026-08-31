"use strict";

const PROVIDER_NAME = "WCO";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const MODULE_URLS = {
  core: `${BRANCH_RAW}/wco.js`,
  special: `${BRANCH_RAW}/wco-special-test-v2.js`,
  episode0: `${BRANCH_RAW}/wco-episode0-test.js`
};

const cache = Object.create(null);

function replaceFunction(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) return source;
  return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
}

function augmentMirrorExtraction(source, key) {
  if (key === "core") {
    const replacement = `async function extractEmbed(embedUrl, variant, displayTitle, info) {
  if (!embedUrl || /user\\.wcostream\\.tv\\/check-login/i.test(embedUrl)) return [];
  if (!/embed\\.wcostream/i.test(embedUrl)) return [];
  const lookup = await playerLookup(embedUrl);
  if (!lookup) return [];
  const lookupRes = await req(lookup, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": embedUrl,
      "Origin": originOf(embedUrl),
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!lookupRes.ok) return [];
  let data;
  try { data = JSON.parse(lookupRes.text); } catch (_) { return []; }
  const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]).slice(0, 2);
  if (!hosts.length) return [];
  const finalVariant = variant || "Original";
  const meta = variantMeta(finalVariant, info.originalLanguage);
  const qualities = [
    data.fhd ? ["1080p", data.fhd] : null,
    data.fullhd ? ["1080p", data.fullhd] : null,
    data.hd ? ["720p", data.hd] : null,
    data.enc ? ["480p", data.enc] : null
  ].filter(Boolean);
  const out = [];
  for (let mirrorIndex = 0; mirrorIndex < hosts.length; mirrorIndex++) {
    const host = hosts[mirrorIndex];
    const resolvedQualities = new Set();
    for (const item of qualities) {
      const quality = item[0];
      if (resolvedQualities.has(quality)) continue;
      const mediaRes = await req(\`${host}/getvid?evid=\${encodeURIComponent(String(item[1]))}&json\`, {
        headers: { "Referer": embedUrl, "Origin": originOf(embedUrl) }
      });
      if (!mediaRes.ok) continue;
      const media = resolvedValue(mediaRes.text, mediaRes.url);
      if (!media) continue;
      resolvedQualities.add(quality);
      out.push({
        name: \`${PROVIDER_NAME} • \${quality} • \${meta.label}\`,
        title: displayTitle,
        url: media,
        quality,
        language: meta.language,
        provider: PROVIDER_NAME,
        type: /\\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4",
        headers: {
          "Referer": embedUrl,
          "Origin": originOf(embedUrl),
          "User-Agent": UA
        },
        _variant: finalVariant,
        _mirrorKey: host,
        _mirrorIndex: mirrorIndex + 1
      });
    }
  }
  return out;
}`;
    return replaceFunction(source, "async function extractEmbed(embedUrl, variant, displayTitle, info)", "async function candidatePage(candidate)", replacement);
  }

  if (key === "special") {
    const replacement = `async function extract(e,t){const page=await req(e.href,{headers:{"Referer":\`${origin(e.href)}/\`}});if(!page.ok)return{streams:[],reason:\`MATCHED \${e.text} • HTTP \${page.status}\`};const frame=iframe(page.body,e.href);if(!frame)return{streams:[],reason:\`MATCHED \${e.text} • NO IFRAME\`};if(/check-login/i.test(frame))return{streams:[],reason:\`MATCHED \${e.text} • PREMIUM\`};const l=await lookup(frame);if(!l)return{streams:[],reason:\`MATCHED \${e.text} • NO PLAYER\`};const jr=await req(l,{headers:{"Referer":frame,"Origin":origin(frame),"X-Requested-With":"XMLHttpRequest"}});if(!jr.ok)return{streams:[],reason:\`MATCHED \${e.text} • LOOKUP \${jr.status}\`};let d;try{d=JSON.parse(jr.body);}catch(_){return{streams:[],reason:\`MATCHED \${e.text} • BAD JSON\`};}const hs=uniq([host(d.server),host(d.cdn)]).slice(0,2),m=meta(e.variant,t.lang),qs=[d.fhd?["1080p",d.fhd]:null,d.fullhd?["1080p",d.fullhd]:null,d.hd?["720p",d.hd]:null,d.enc?["480p",d.enc]:null].filter(Boolean),out=[];for(let mi=0;mi<hs.length;mi++){const h=hs[mi],done=new Set();for(const q of qs){if(done.has(q[0]))continue;const r=await req(\`${h}/getvid?evid=\${encodeURIComponent(String(q[1]))}&json\`,{headers:{"Referer":frame,"Origin":origin(frame)}});if(!r.ok)continue;const u=mediaValue(r.body,r.url);if(!u)continue;done.add(q[0]);out.push({name:\`${PROVIDER_NAME} • \${q[0]} • \${m.label} • \${e.text}\`,title:t.title,url:u,quality:q[0],language:m.language,provider:PROVIDER_NAME,type:/\\.m3u8(?:[?#]|$)/i.test(u)?"m3u8":"mp4",headers:{"Referer":frame,"Origin":origin(frame),"User-Agent":UA},_mirrorKey:h,_mirrorIndex:mi+1});}}return{streams:out,reason:out.length?"":\`MATCHED \${e.text} • NO MEDIA\`};}`;
    return replaceFunction(source, "async function extract(e,t)", "async function getStreams(inputId,mediaType,season,episode)", replacement);
  }

  if (key === "episode0") {
    const replacement = `async function extract(entry, info, fallbackSeason) {
  const p = await req(entry.href, { headers: { "Referer": \`${origin(entry.href)}/\` } });
  if (!p.ok) return [];
  const frame = iframe(p.body, entry.href);
  if (!frame || /check-login/i.test(frame)) return [];
  const l = await lookup(frame);
  if (!l) return [];
  const jr = await req(l, { headers: { "Referer": frame, "Origin": origin(frame), "X-Requested-With": "XMLHttpRequest" } });
  if (!jr.ok) return [];
  let d;
  try { d = JSON.parse(jr.body); } catch (_) { return []; }
  const hs = uniq([host(d.server), host(d.cdn)]).slice(0, 2);
  const qs = [d.fhd ? ["1080p", d.fhd] : null, d.fullhd ? ["1080p", d.fullhd] : null, d.hd ? ["720p", d.hd] : null, d.enc ? ["480p", d.enc] : null].filter(Boolean);
  const isSub = entry.variant === "Sub";
  const label = isSub ? "Japanese + English Hard Subs" : "English Dub";
  const language = isSub ? "Japanese" : "English";
  const out = [];
  for (let mirrorIndex = 0; mirrorIndex < hs.length; mirrorIndex++) {
    const h = hs[mirrorIndex];
    const resolvedQualities = new Set();
    for (const [quality, token] of qs) {
      if (resolvedQualities.has(quality)) continue;
      const mr = await req(\`${h}/getvid?evid=\${encodeURIComponent(String(token))}&json\`, { headers: { "Referer": frame, "Origin": origin(frame) } });
      if (!mr.ok) continue;
      const media = mediaValue(mr.body, mr.url);
      if (!media) continue;
      resolvedQualities.add(quality);
      out.push({
        name: \`${PROVIDER_NAME} • \${quality} • \${label} • S0E\${fallbackSeason}→S\${fallbackSeason}E0\`,
        title: \`${info.title} • WCO Season \${fallbackSeason} Episode 0\`,
        url: media,
        quality,
        language,
        provider: PROVIDER_NAME,
        type: /\\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4",
        headers: { "Referer": frame, "Origin": origin(frame), "User-Agent": UA },
        _mirrorKey: h,
        _mirrorIndex: mirrorIndex + 1
      });
    }
  }
  return out;
}`;
    return replaceFunction(source, "async function extract(entry, info, fallbackSeason)", "async function getStreams(inputId, mediaType, season, episode)", replacement);
  }

  return source;
}

function augmentSpecialSource(source) {
  const marker = "async function getStreams(inputId,mediaType,season,episode)";
  const exportMarker = "module.exports={getStreams};";
  const start = source.indexOf(marker);
  const end = source.indexOf(exportMarker, start);
  if (start < 0 || end < 0) return source;

  const replacement = [
    'function fractionalNo(v){const s=String(v||"");let m=s.match(/\\bEpisode\\s*(\\d+\\.\\d+)\\b/i);if(!m)m=s.match(/episode[-_ ]?(\\d+\\.\\d+)(?:\\D|$)/i);return m?m[1]:"";}',
    'async function fractionalEntries(seriesUrl,wantedVariant){const base=String(seriesUrl||"").replace(/[?#].*$/,"").replace(/\\/$/,"");const lang=wantedVariant==="Sub"?"sub":"dub",u=base+"/?season=all&lang="+lang,r=await req(u,{headers:{"Referer":seriesUrl}});if(!r.ok)return[];const out=[];for(const x of links(r.body,u,wantedVariant)){if(/\\/anime\\//i.test(x.href))continue;const id=x.text+" "+x.href;if(!fractionalNo(id))continue;if(!out.some(y=>y.href===x.href))out.push({...x,variant:wantedVariant});}return out;}',
    'async function getStreams(inputId,mediaType,season,episode){const type=String(mediaType||"").toLowerCase()==="movie"?"movie":"tv";if(type==="tv"&&+season!==0)return[];try{const t=await target(inputId,type,season,episode);if(!t)return debug("NO TMDB TARGET",null);const parents=await seriesCandidates(t);let reason="";for(const p of parents){const matched=await entries(p.href,t),collected=[],variants=new Set();for(const e of matched){const r=await extract(e,t);if(r.streams.length){collected.push(...r.streams);variants.add(e.variant);}else if(!reason)reason=r.reason;}if(type==="tv"&&collected.length){for(const wanted of ["Dub","Sub"]){if(variants.has(wanted))continue;const frac=await fractionalEntries(p.href,wanted);if(frac.length!==1)continue;const r=await extract(frac[0],t);if(r.streams.length){collected.push(...r.streams);variants.add(wanted);}}}if(collected.length)return collected;}if(reason)return debug(reason.slice(0,140),t);return debug(parents.length?"SERIES "+parents[0].text+" • NO SPECIAL MATCH":"NO SERIES MATCH • "+t.title,t);}catch(_){return debug("RUNTIME ERROR",null);}}',
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
    source = augmentMirrorExtraction(source, key);
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
  if (name.includes("dual audio")) return "Dual Audio + Subs";
  if (name.includes("multi audio")) return "Multi Audio + Subs";
  if (name.includes("japanese + english hard subs")) return "Japanese + English Hard Subs";
  if (name.includes("english dub")) return "English Dub";
  if (name.includes("english (original)")) return "English (Original)";
  if (name.includes("japanese (original)")) return "Japanese (Original)";
  const lang = String(stream && stream.language || "").trim();
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
    const mirrorKey = String(stream._mirrorKey || mediaHost(stream.url) || "unknown").toLowerCase();
    const mirrorIndex = Number(stream._mirrorIndex || 0);
    const key = `${quality}|${label}|${mirrorKey}|${stream.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...stream, quality, _label: label, _mirrorKey: mirrorKey, _mirrorIndex: mirrorIndex });
  }

  const byLabel = new Map();
  for (const stream of normalized) {
    if (!byLabel.has(stream._label)) byLabel.set(stream._label, []);
    byLabel.get(stream._label).push(stream);
  }

  const out = [];
  for (const [label, branch] of byLabel) {
    const mirrors = [];
    const ordered = branch.slice().sort((a, b) => {
      const ai = a._mirrorIndex || 999;
      const bi = b._mirrorIndex || 999;
      return ai - bi;
    });
    for (const stream of ordered) if (!mirrors.includes(stream._mirrorKey)) mirrors.push(stream._mirrorKey);

    const selectedMirrors = mirrors.slice(0, 2);
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
        const { _label, _mirrorKey, _mirrorIndex, ...clean } = stream;
        out.push({
          ...clean,
          name: `${PROVIDER_NAME} • Mirror ${m + 1} • ${stream.quality} • ${label}`,
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
