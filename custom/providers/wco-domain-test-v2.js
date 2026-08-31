"use strict";

const PROVIDER_NAME = "WCO Domain Test";
const BRANCH_RAW = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers";
const EPISODE_TEST_URL = `${BRANCH_RAW}/wco-domain-test.js`;
const PRODUCTION_URL = `${BRANCH_RAW}/wco-production.js`;

// Normal episodes keep using the existing five-domain diagnostic tester.
// Movies and Season 0 use only the proven production candidates plus the primary control.
const MEDIA_DOMAINS = [
  "https://www.wcostream.tv",
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net"
];

let episodeTest = null;
let rawProduction = null;
const productionCache = new Map();
const productionErrors = new Map();

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].replace(/^www\./i, "") : String(url || "");
}

function qualityRank(value) {
  const q = String(value || "").toLowerCase();
  const m = q.match(/(\d{3,4})/);
  if (m) return Number(m[1]);
  if (q.includes("4k") || q.includes("2160")) return 2160;
  return 0;
}

function streamBranch(stream) {
  const name = String(stream && stream.name || "").toLowerCase();
  const lang = String(stream && stream.language || "").toLowerCase();
  if (name.includes("dual audio")) return "Dual";
  if (name.includes("multi audio")) return "Multi";
  if (name.includes("english dub")) return "Dub";
  if (name.includes("hard sub") || name.includes("english sub")) return "Sub";
  if (name.includes("english (original)")) return "EnglishOriginal";
  if (name.includes("japanese (original)")) return "JapaneseOriginal";
  if (lang === "english") return "EnglishOriginal";
  if (lang === "japanese") return "JapaneseOriginal";
  return "Other";
}

function branchLabel(branch, stream) {
  if (branch === "Dual") return "Dual Audio + Subs";
  if (branch === "Multi") return "Multi Audio + Subs";
  if (branch === "Dub") return "English Dub";
  if (branch === "Sub") return "Sub / Hard Subs";
  if (branch === "EnglishOriginal") return "English (Original)";
  if (branch === "JapaneseOriginal") return "Japanese (Original)";
  return String(stream && stream.language || "Original");
}

function cleanDetail(value) {
  return String(value || "")
    .replace(/https?:\/\/www\./gi, "")
    .replace(/https?:\/\//gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function fetchSource(url) {
  try {
    const res = await fetch(url, { skipSizeCheck: true });
    if (!res || !res.ok) return "";
    return String(await res.text() || "");
  } catch (_) {
    return "";
  }
}

function evaluateModule(source) {
  try {
    const mod = { exports: {} };
    const factory = new Function(
      "module",
      "exports",
      "require",
      String(source || "") + "\n;return module.exports;"
    );
    return factory(
      mod,
      mod.exports,
      function(name) { throw new Error("Unsupported nested require: " + name); }
    ) || mod.exports;
  } catch (_) {
    return null;
  }
}

async function episodeModule() {
  if (episodeTest && typeof episodeTest.getStreams === "function") return episodeTest;
  const source = await fetchSource(EPISODE_TEST_URL);
  if (!source) return null;
  const exported = evaluateModule(source);
  if (!exported || typeof exported.getStreams !== "function") return null;
  episodeTest = exported;
  return episodeTest;
}

async function productionSource() {
  if (rawProduction) return rawProduction;
  rawProduction = await fetchSource(PRODUCTION_URL);
  return rawProduction;
}

function domainSpecialAddon() {
  return `
function __domainSpecialSlug(value){
  return String(value||"").toLowerCase()
    .replace(/&amp;|&/g," and ")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}
async function __domainDirectSeriesCandidates(t){
  const out=[];
  for(const seed of (t.series||[]).slice(0,6)){
    const slug=__domainSpecialSlug(seed);
    if(!slug)continue;
    const u=ORIGINS[0]+"/anime/"+slug;
    const r=await req(u,{headers:{"Referer":ORIGINS[0]+"/"}});
    if(!r.ok)continue;
    const hm=String(r.body||"").match(/<h1\\b[^>]*>([\\s\\S]*?)<\\/h1>/i);
    const tm=String(r.body||"").match(/<title\\b[^>]*>([\\s\\S]*?)<\\/title>/i);
    const label=text((hm&&hm[1])||(tm&&tm[1])||seed);
    const href=r.url||u;
    const s=best(label+" "+href,t.series);
    if(s<70)continue;
    out.push({href:href,text:label||seed,score:s});
    if(s>=95)break;
  }
  return out.sort((a,b)=>b.score-a.score).filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i).slice(0,6);
}
const __domainOriginalSeriesCandidates=seriesCandidates;
seriesCandidates=async function(t){
  const normal=await __domainOriginalSeriesCandidates(t);
  if(normal&&normal.length)return normal;
  return await __domainDirectSeriesCandidates(t);
};
`;
}

function patchProductionForOrigin(source, origin) {
  let patched = String(source || "");
  patched = patched.replace(
    /const PROVIDER_NAME\s*=\s*"WCO"\s*;/,
    'const PROVIDER_NAME = "WCO Domain Test";'
  );

  const needle = 'let source = String(await res.text() || "");';
  const inject = needle + "\n" +
    `    source = source.replace(/const ORIGINS\\s*=\\s*\\[[\\s\\S]*?\\];/, 'const ORIGINS = [${JSON.stringify(origin)}];');`;

  if (!patched.includes(needle)) return "";
  patched = patched.replace(needle, inject);

  // Add a direct /anime/<series-slug> fallback after the production special
  // augmentation has run. This only affects the isolated domain tester.
  const specialNeedle = '    if (key === "special") source = augmentSpecialSource(source);';
  if (patched.includes(specialNeedle)) {
    const addon = domainSpecialAddon();
    const specialReplacement = [
      '    if (key === "special") {',
      '      source = augmentSpecialSource(source);',
      `      source = source.replace("module.exports={getStreams};", ${JSON.stringify(addon + '\nmodule.exports={getStreams};')});`,
      '    }'
    ].join("\n");
    patched = patched.replace(specialNeedle, specialReplacement);
  }

  // The production wrapper normally strips Debug streams. During this isolated
  // domain test, keep one underlying debug result when cleaning produced nothing
  // so the UI can show the actual movie/special failure stage.
  const runNeedle = '    return cleanStreams(await mod.getStreams(inputId, mediaType, season, episode));';
  const runReplacement = [
    '    const __rawDomainStreams = await mod.getStreams(inputId, mediaType, season, episode);',
    '    const __cleanDomainStreams = cleanStreams(__rawDomainStreams);',
    '    if (__cleanDomainStreams.length) return __cleanDomainStreams;',
    '    const __debugDomainStream = (__rawDomainStreams || []).find(isDebug);',
    '    return __debugDomainStream ? [__debugDomainStream] : [];'
  ].join("\n");
  if (patched.includes(runNeedle)) patched = patched.replace(runNeedle, runReplacement);

  return patched;
}

async function productionFor(origin) {
  if (productionCache.has(origin)) return productionCache.get(origin);
  const raw = await productionSource();
  if (!raw) {
    productionErrors.set(origin, "production WCO source could not be downloaded");
    return null;
  }

  const patched = patchProductionForOrigin(raw, origin);
  if (!patched) {
    productionErrors.set(origin, "could not inject isolated origin into production loader");
    return null;
  }

  const exported = evaluateModule(patched);
  if (!exported || typeof exported.getStreams !== "function") {
    productionErrors.set(origin, "isolated production WCO module failed to load");
    return null;
  }

  productionCache.set(origin, exported);
  return exported;
}

function pickBest(streams, origin, route) {
  const best = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const quality = String(stream.quality || "");
    const name = String(stream.name || "");
    if (/\bDIAG\b/i.test(name) || /^Debug$/i.test(quality)) continue;

    const branch = streamBranch(stream);
    if (branch === "Other") continue;
    const previous = best.get(branch);
    if (!previous || qualityRank(stream.quality) > qualityRank(previous.quality)) {
      best.set(branch, stream);
    }
  }

  const out = [];
  for (const [branch, stream] of best.entries()) {
    const clean = { ...stream };
    const frontendHost = hostOf(origin);
    const mediaHost = hostOf(clean.url);
    clean.provider = PROVIDER_NAME;
    clean.name = `${PROVIDER_NAME} • ${route} • ${frontendHost} → ${mediaHost} • ${clean.quality || "Auto"} • ${branchLabel(branch, clean)}`;
    out.push(clean);
  }
  return out;
}

function underlyingDebug(streams) {
  for (const stream of streams || []) {
    const quality = String(stream && stream.quality || "");
    const name = String(stream && stream.name || "");
    if (/^Debug$/i.test(quality) || /\bDIAG\b/i.test(name)) {
      return name || String(stream && stream.title || "underlying WCO diagnostic");
    }
  }
  return "";
}

function diagnosticStream(origin, route, detail) {
  const frontendHost = hostOf(origin);
  const safeDetail = cleanDetail(detail || "no playable stream returned");
  return {
    name: `${PROVIDER_NAME} • ${route} • ${frontendHost} • DIAG • ${safeDetail}`,
    title: `${route} fallback diagnostic: ${frontendHost}`,
    url: `${origin}/`,
    quality: "144p",
    language: "Diagnostic",
    provider: PROVIDER_NAME,
    type: "mp4",
    headers: { "Referer": `${origin}/` }
  };
}

async function runMediaRoute(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  const route = type === "movie" ? "MOVIE" : "SEASON 0";
  const out = [];

  for (const origin of MEDIA_DOMAINS) {
    const mod = await productionFor(origin);
    if (!mod) {
      out.push(diagnosticStream(origin, route, productionErrors.get(origin) || "isolated production module unavailable"));
      continue;
    }

    try {
      const streams = await mod.getStreams(inputId, mediaType, season, episode);
      const picked = pickBest(streams, origin, route);
      if (picked.length) {
        out.push(...picked);
      } else {
        const reason = underlyingDebug(streams) || "production WCO returned no playable stream for this item";
        out.push(diagnosticStream(origin, route, reason));
      }
    } catch (e) {
      out.push(diagnosticStream(origin, route, "runtime error: " + String(e && e.message || e)));
    }
  }

  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();

  if (type === "movie" || Number(season) === 0) {
    return await runMediaRoute(inputId, mediaType, season, episode);
  }

  const mod = await episodeModule();
  if (!mod) return [];
  try {
    return await mod.getStreams(inputId, mediaType, season, episode);
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
