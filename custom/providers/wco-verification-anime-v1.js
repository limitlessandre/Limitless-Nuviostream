"use strict";

// WCO production adapter. Start with trusted TMDB aliases; consult the shared
// anime identity resolver only if direct matching produced no streams. Optional
// service failures must not delay already matched public streams.
//
// Anime episode ownership is alias-aware: WCO sometimes uses a dubbed/English slug
// for the series page and a romaji/native-derived slug for the subbed episode URL.
// We only allow that alternate ownership path for anime and only when a strong
// multi-token alias match is present, preserving sidebar/recent-release protection.
//
// Anime variant collection also spans multiple strong WCO series candidates. Some
// titles expose Dub on one WCO series page and Sub on another, so returning after the
// first playable candidate can silently lose one audio branch.
//
// Trusted anime aliases are also tried directly as /anime/<slug>/ candidates on the
// primary WCO origin. This covers titles such as Monster Farm -> Monster Rancher when
// WCO's search endpoint does not surface the otherwise valid series page.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-verification-runtime-v1.js";
let cached = null;

function coreAnimeAddonSource() {
  return `
const __WCO_IDENTITY_URL="https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
let __wcoIdentityCache=null;
async function __wcoLoadIdentity(){
  if(__wcoIdentityCache&&typeof __wcoIdentityCache.resolveAnimeIdentity==="function")return __wcoIdentityCache;
  try{
    const r=await fetch(__WCO_IDENTITY_URL,{skipSizeCheck:true});
    if(!r||!r.ok)return null;
    const s=String(await r.text()||"");
    const m={exports:{}};
    const f=new Function("module","exports","require",s+"\\n;return module.exports;");
    const x=f(m,m.exports,function(name){throw new Error("Unsupported nested require: "+name);})||m.exports;
    if(!x||typeof x.resolveAnimeIdentity!=="function")return null;
    __wcoIdentityCache=x;return x;
  }catch(_){return null;}
}
async function __wcoEnrichAnimeIdentity(info,inputId,type,season,episode){
  try{
    if(!info||!info.isAnime)return info;
    const helper=await __wcoLoadIdentity();
    if(!helper)return info;
    const identity=await __wcoContext.bounded(()=>helper.resolveAnimeIdentity(inputId,type,season,episode,TMDB_API_KEY),2500,null);
    if(!identity||!identity.isAnime)return info;
    const aliases=uniq([].concat(info.titles||[]).concat(identity.aliases||[])).filter(title=>isIdentityAlias(title,info.identityTitles||[info.title])).slice(0,24);
    if(!aliases.length)return info;
    return {...info,title:identity.title||info.title,titles:aliases,isAnime:true,malId:identity.malId||null,anilistId:identity.anilistId||null};
  }catch(_){return info;}
}
function __wcoDirectAnimeCandidates(info,existing){
  const prior=Array.isArray(existing)?existing:[];
  if(!info||!Array.isArray(info.titles))return prior;
  const direct=[],seen=new Set(prior.map(x=>String(x&&x.href||"")));
  const origin=ORIGINS&&ORIGINS.length?ORIGINS[0]:"https://www.wcostream.tv";
  for(const title of info.titles.slice(0,8)){
    const slug=String(normalize(title)||"").replace(/\\s+/g,"-").replace(/^-+|-+$/g,"");
    if(!slug||slug.length<3)continue;
    const href=origin+"/anime/"+slug+"/";
    if(seen.has(href))continue;
    seen.add(href);
    direct.push({href,title:String(title||""),variant:"Original",score:130});
  }
  return direct.concat(prior).slice(0,12);
}
`;
}

function augmentAnimeIdentity(source) {
  let out = String(source || "");
  const tmdbMarker = "async function tmdbInfo(inputId, mediaType) {";
  const getStreamsMarker = "const info = await tmdbInfo(inputId, type);\n    if (!info) return [];";
  if (!out.includes(tmdbMarker) || !out.includes(getStreamsMarker)) return out;
  out = out.replace(tmdbMarker, coreAnimeAddonSource() + "\n" + tmdbMarker);
  return out;
}

function augmentAnimeEpisodeOwnership(source) {
  let out = String(source || "");
  const oldOwnership = `function episodeBelongsToSeries(href, pageUrl) {
  const series = seriesSlugParts(pageUrl);
  if (!series.slug) return true;
  const path = String(href || "").replace(/^https?:\\/\\/[^/]+/i, "").toLowerCase();
  if (path.includes(\`/\${series.slug}-episode-\`) || path.includes(\`/\${series.slug}-season-\`)) return true;
  if (!series.tokens.length) return true;
  const actual = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
  let hits = 0;
  for (const token of series.tokens) if (actual.has(token)) hits += 1;
  if (series.tokens.length === 1) return false;
  return hits >= Math.max(2, Math.ceil(series.tokens.length * 0.6));
}`;
  const newOwnership = `function episodeBelongsToSeries(href, pageUrl, allowedTitles) {
  const series = seriesSlugParts(pageUrl);
  if (!series.slug) return false;
  const path = String(href || "").replace(/^https?:\\/\\/[^/]+/i, "").split(/[?#]/)[0].toLowerCase();
  const slugs = [series.slug].concat((Array.isArray(allowedTitles) ? allowedTitles : []).map(title => normalize(title).replace(/\\s+/g, "-"))).filter(Boolean);
  return slugs.some(slug => path.startsWith("/" + slug + "-episode-") || path.startsWith("/" + slug + "-season-"));
}`;
  if (!out.includes(oldOwnership)) return out;
  out = out.replace(oldOwnership, newOwnership);
  out = out.replace(
    "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant) {",
    "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant, allowedTitles) {"
  );
  out = out.replace(
    "if (!episodeBelongsToSeries(href, pageUrl)) continue;",
    "if (!episodeBelongsToSeries(href, pageUrl, allowedTitles)) continue;"
  );
  out = out.replace(
    "episodeLinks(filtered.text, filteredUrl, wantedSeason, wantedEpisode, series.season, variant)",
    "episodeLinks(filtered.text, filteredUrl, wantedSeason, wantedEpisode, series.season, variant, info.isAnime ? info.titles : [])"
  );
  out = out.replace(
    "episodeLinks(series.page.text, series.pageUrl, wantedSeason, wantedEpisode, series.season, variant)",
    "episodeLinks(series.page.text, series.pageUrl, wantedSeason, wantedEpisode, series.season, variant, info.isAnime ? info.titles : [])"
  );
  out = out.replace(
    "if (!episodeBelongsToSeries(epPage.url || entry.href, series.pageUrl)) continue;",
    "if (!episodeBelongsToSeries(epPage.url || entry.href, series.pageUrl, info.isAnime ? info.titles : [])) continue;"
  );
  return out;
}

function augmentAnimeVariantCollection(source) {
  let out = String(source || "");
  const oldTv = `async function tvStreams(info, season, episode) {
  const wantedSeason = Number(season || 1);
  const wantedEpisode = Number(episode || 1);
  const candidates = await searchWco(info, wantedSeason);
  const displayTitle = \`${'${info.title}'} S${'${String(wantedSeason).padStart(2, "0")}'}E${'${String(wantedEpisode).padStart(2, "0")}'}\`;

  for (const candidate of candidates.slice(0, 6)) {
    const series = await candidatePage(candidate);
    if (!series) continue;
    if (series.season != null && series.season !== wantedSeason) continue;

    const dub = await extractVariantFromSeries(series, "Dub", wantedSeason, wantedEpisode, displayTitle, info);
    const sub = await extractVariantFromSeries(series, "Sub", wantedSeason, wantedEpisode, displayTitle, info);
    const combined = dub.concat(sub);
    if (combined.length) return finalize(combined, info);
  }
  return [];
}`;
  const newTv = `async function tvStreams(info, season, episode) {
  const wantedSeason = Number(season || 1), wantedEpisode = Number(episode || 1);
  const displayTitle = \`\${info.title} S\${String(wantedSeason).padStart(2, "0")}E\${String(wantedEpisode).padStart(2, "0")}\`;
  const collected = [], attempted = new Set(), knownSeries = [];
  let haveDub = false, haveSub = false;
  const remaining = () => typeof __wcoContext === "undefined" ? 60000 : __wcoContext.remaining();
  async function collect(candidates) {
    for (const candidate of candidates.slice(0, 4)) {
      if (remaining() < 18000) break;
      const key = basePageUrl(candidate.href);
      if (attempted.has(key)) continue;
      attempted.add(key);
      const requestedSlug = key.split("/").pop().replace(/[-_]/g, " ");
      if (/\\/anime\\//i.test(key) && !info.titles.some(title => normalize(title) && normalize(title) === normalize(requestedSlug))) continue;
      const series = await candidatePage(candidate);
      if (!series || (series.season != null && series.season !== wantedSeason)) continue;
      // A prefix match (Naruto -> Naruto Kai/Shippuden) is not identity evidence.
      const slug = String(series.pageUrl).replace(/[?#].*$/, "").replace(/\\/$/, "").split("/").pop().replace(/[-_]/g, " ");
      if (!info.titles.some(title => normalize(title) && normalize(title) === normalize(slug))) continue;
      knownSeries.push({href: series.pageUrl, title: candidate.title});
      const lane = async variant => {
        if (remaining() < 17000) return;
        try {
          const rows = await extractVariantFromSeries(series, variant, wantedSeason, wantedEpisode, displayTitle, info);
          if (rows.length) {
            collected.push(...rows);
            if (variant === "Dub") haveDub = true; else haveSub = true;
          }
        } catch (_) { /* Keep the other lane's completed rows. */ }
      };
      const work = () => Promise.all([haveDub ? Promise.resolve() : lane("Dub"), haveSub ? Promise.resolve() : lane("Sub")]);
      if (typeof __wcoContext === "undefined") await work();
      else await __wcoContext.bounded(work, remaining() - 1200, null);
      if (haveDub && (haveSub || remaining() < 21000)) break;
    }
  }
  // Confident direct slugs first, for cartoons as well as anime; retain all the
  // existing season/episode ownership validation inside extractVariantFromSeries.
  await collect(__wcoDirectAnimeCandidates(info, []));
  if (!collected.length && info.isAnime && remaining() >= 24000) {
    info = await __wcoEnrichAnimeIdentity(info, info.id, "tv", season, episode);
    await collect(__wcoDirectAnimeCandidates(info, []));
  }
  if (!collected.length && remaining() >= 21000) {
    if (knownSeries.length) {
      const mirrors = ORIGINS.slice(1).flatMap(origin => knownSeries.slice(0, 1).map(candidate => ({...candidate, href: origin + candidate.href.slice(originOf(candidate.href).length)})));
      await collect(mirrors);
    } else await collect(await searchWco(info, wantedSeason));
  }
  return collected.length ? finalize(collected, info) : [];
}`;
  if (!out.includes(oldTv)) return out;
  return out.replace(oldTv, newTv);
}

function patchProduction(source) {
  let out = String(source || "");
  const marker = 'if (key === "core") source = augmentCoreMirrors(source);';
  if (!out.includes(marker)) return "";
  out = out.replace('"use strict";', '"use strict";\n\n' + augmentAnimeIdentity.toString() + '\n' + coreAnimeAddonSource.toString() + '\n' + augmentAnimeEpisodeOwnership.toString() + '\n' + augmentAnimeVariantCollection.toString() + '\n');
  out = out.replace(marker, 'if (key === "core") source = augmentCoreMirrors(augmentAnimeVariantCollection(augmentAnimeEpisodeOwnership(augmentAnimeIdentity(source))));');
  return out;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck:true });
    if (!res || !res.ok) return null;
    const patched = patchProduction(String(await res.text() || ""));
    if (!patched || !patched.includes("module.exports")) return null;
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return exported;
  } catch (_) { return null; }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try { return await base.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
}

async function onSettings() {
  const base = await loadBase();
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

module.exports = { getStreams, onSettings };
