"use strict";

const PROVIDER_NAME = "WCO";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const MODULE_URLS = {
  core: `${BRANCH_RAW}/wco.js`,
  special: `${BRANCH_RAW}/wco-special-test-v2.js`,
  episode0: `${BRANCH_RAW}/wco-episode0-test.js`
};

const cache = Object.create(null);

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
    const host = mediaHost(stream.url);
    const key = `${quality}|${label}|${host}|${stream.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...stream, quality, _label: label, _host: host });
  }

  const byLabel = new Map();
  for (const stream of normalized) {
    if (!byLabel.has(stream._label)) byLabel.set(stream._label, []);
    byLabel.get(stream._label).push(stream);
  }

  const out = [];
  for (const [label, branch] of byLabel) {
    const hosts = [];
    for (const stream of branch) if (!hosts.includes(stream._host)) hosts.push(stream._host);

    const selectedHosts = hosts.slice(0, 2);
    for (let h = 0; h < selectedHosts.length; h++) {
      const host = selectedHosts[h];
      const candidates = branch
        .filter(x => x._host === host)
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
        const mirror = selectedHosts.length > 1 ? ` • Mirror ${h + 1}` : "";
        const { _label, _host, ...clean } = stream;
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
