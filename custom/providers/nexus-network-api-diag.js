"use strict";

const PROVIDER_NAME = "Nexus API DIAG";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const TEST_TMDB_ID = 15130;
const TEST_IMDB_ID = "tt0218775";
const TEST_TITLE = "Monster Rancher";
const TIMEOUT_MS = 6000;
const WCO_ORIGINS = ["https://www.wcostream.tv","https://www.wcoflix.tv","https://www.wcoforever.net"];
const REANIME_ORIGINS = ["https://reanime.to","https://reanime.cz","https://reanime.net"];

function timeoutResult(url, started) {
  return { ok:false, status:0, url, text:"", ms:Date.now()-started, error:`TIMEOUT>${TIMEOUT_MS}ms` };
}

async function request(url, options) {
  const started = Date.now();
  const work = (async () => {
    try {
      const res = await fetch(url, {
        ...(options || {}),
        headers: {
          "User-Agent": UA,
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          ...((options && options.headers) || {})
        },
        skipSizeCheck: true
      });
      const text = String(await res.text() || "");
      return { ok:!!res.ok, status:Number(res.status || 0), url:String(res.url || url), text, ms:Date.now()-started };
    } catch (e) {
      return { ok:false, status:0, url, text:"", ms:Date.now()-started, error:String(e && e.message || e) };
    }
  })();
  const timer = new Promise(resolve => setTimeout(() => resolve(timeoutResult(url, started)), TIMEOUT_MS));
  return await Promise.race([work, timer]);
}

function short(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > (max || 120) ? text.slice(0, max || 120) + "…" : text;
}

function isCloudflare(text) {
  const s = String(text || "").toLowerCase();
  return s.includes("just a moment") || s.includes("cf-chl-") || s.includes("challenge-platform") || s.includes("cloudflare ray id") || s.includes("attention required");
}

function row(label, ok, detail, url) {
  const state = ok ? "OK" : "FAIL";
  return {
    name: `${PROVIDER_NAME} • ${state} • ${label}`,
    title: short(detail || "No detail", 220),
    url: url || "https://example.com/",
    quality: "DIAG",
    provider: PROVIDER_NAME,
    type: "mp4",
    language: state,
    subtitles: []
  };
}

async function probeFetch() {
  const r = await request("https://example.com/");
  return row("NUVIO FETCH", r.ok && /Example Domain/i.test(r.text), `HTTP ${r.status} • ${r.ms}ms • body=${r.text.length}${r.error ? ` • ${r.error}` : ""}`, r.url);
}

async function probeTmdb() {
  const url = `https://api.themoviedb.org/3/tv/${TEST_TMDB_ID}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const r = await request(url, { headers:{"Accept":"application/json"} });
  let data=null; try{data=JSON.parse(r.text);}catch(_){}
  const name=data&&(data.name||data.original_name), imdb=data&&data.external_ids&&data.external_ids.imdb_id;
  return { stream:row("TMDB", r.ok&&!!name, `HTTP ${r.status} • ${r.ms}ms • name=${name||"?"} • imdb=${imdb||"?"}${r.error ? ` • ${r.error}` : ""}`, "https://www.themoviedb.org/"), imdbId:imdb||TEST_IMDB_ID };
}

async function probeMalMapper(imdbId) {
  const url=`https://id-mapping-api-malid.hf.space/api/resolve?id=${encodeURIComponent(imdbId||TEST_IMDB_ID)}&s=1&e=1`;
  const r=await request(url,{headers:{"Accept":"application/json"}});
  let data=null; try{data=JSON.parse(r.text);}catch(_){}
  const malId=data&&Number(data.mal_id||0), malEpisode=data&&(data.mal_episode!=null?data.mal_episode:"?");
  return { stream:row("MAL ID MAPPER", r.ok&&!!malId, `HTTP ${r.status} • ${r.ms}ms • mal_id=${malId||"?"} • mal_episode=${malEpisode}${r.error ? ` • ${r.error}` : ""}`, "https://myanimelist.net/"), malId:malId||null };
}

async function probeAniList(malId) {
  if(!malId)return row("ANILIST",false,"Skipped because MAL mapper returned no MAL id","https://anilist.co/");
  const query="query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native} synonyms}}";
  const r=await request("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query,variables:{idMal:Number(malId)}})});
  let data=null; try{data=JSON.parse(r.text);}catch(_){}
  const media=data&&data.data&&data.data.Media, title=media&&media.title&&(media.title.english||media.title.romaji||media.title.native);
  return row("ANILIST",r.ok&&!!media,`HTTP ${r.status} • ${r.ms}ms • id=${media&&media.id||"?"} • title=${title||"?"}${r.error ? ` • ${r.error}` : ""}`,"https://anilist.co/");
}

async function probeReAnime() {
  const probes=await Promise.all(REANIME_ORIGINS.map(async base=>{
    const r=await request(`${base}/api/v1/search?q=${encodeURIComponent(TEST_TITLE)}&limit=5&offset=0`,{headers:{"Accept":"application/json, text/plain, */*","Referer":`${base}/home`}});
    let data=null; try{data=JSON.parse(r.text);}catch(_){}
    const results=Array.isArray(data)?data:(data&&Array.isArray(data.results)?data.results:[]);
    return {base,r,results};
  }));
  for(const p of probes){
    if(p.r.ok&&p.results.length){const first=p.results[0]||{},id=first.anime_id||first.animeId||first.id||first.slug||"?";return row("RE:ANIME API",true,`${p.base} • HTTP ${p.r.status} • ${p.r.ms}ms • results=${p.results.length} • first=${id}`,p.base);}
  }
  const detail=probes.map(p=>`${p.base.replace(/^https?:\/\//,"")}:${p.r.status||0}/${p.r.error||"no-results"}`).join(" • ");
  return row("RE:ANIME API",false,detail,REANIME_ORIGINS[0]);
}

async function probeFlixCloud() {
  const r=await request("https://flixcloud.cc/"); const cf=isCloudflare(r.text); const ok=r.ok&&!cf;
  return row("FLIXCLOUD",ok,`HTTP ${r.status} • ${r.ms}ms • body=${r.text.length} • cloudflare=${cf?"YES":"no"}${r.error ? ` • ${r.error}` : ""}`,r.url||"https://flixcloud.cc/");
}

async function probeWco(base) {
  const url=`${base}/anime/monster-rancher/?season=all&lang=dub`,r=await request(url,{headers:{"Referer":`${base}/`}}),cf=isCloudflare(r.text),hasTitle=/Monster\s+Rancher/i.test(r.text),hasEpisode=/Episode\s*1/i.test(r.text)||/monster-rancher-episode-1/i.test(r.text),ok=r.ok&&!cf&&hasTitle&&hasEpisode;
  return row(`WCO ${base.replace(/^https?:\/\/(?:www\.)?/i,"")}`,ok,`HTTP ${r.status} • ${r.ms}ms • body=${r.text.length} • cloudflare=${cf?"YES":"no"} • title=${hasTitle?"yes":"no"} • ep1=${hasEpisode?"yes":"no"}${r.error ? ` • ${r.error}` : ""}`,r.url||url);
}

async function getStreams(inputId,mediaType,season,episode) {
  const fetchP=probeFetch();
  const tmdbP=probeTmdb();
  const reanimeP=probeReAnime();
  const flixP=probeFlixCloud();
  const wcoP=Promise.all(WCO_ORIGINS.map(probeWco));
  const malP=probeMalMapper(TEST_IMDB_ID);

  const [fetchRow,tmdb,reanimeRow,flixRow,wcoRows,mal]=await Promise.all([fetchP,tmdbP,reanimeP,flixP,wcoP,malP]);
  const aniRow=await probeAniList(mal.malId);
  return [fetchRow,tmdb.stream,mal.stream,aniRow,reanimeRow,flixRow].concat(wcoRows);
}

module.exports={getStreams};
