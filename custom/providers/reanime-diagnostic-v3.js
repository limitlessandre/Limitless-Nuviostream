"use strict";

const PROVIDER_NAME = "Re:ANIME Diagnostic";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const DOMAINS = ["https://reanime.to", "https://reanime.cz", "https://reanime.net"];
const HEADERS = {"User-Agent":"Mozilla/5.0","Accept":"application/json, text/plain, */*"};

function diag(label, detail) {
  const clean = String(detail == null ? "" : detail).replace(/\s+/g, " ").trim().slice(0, 260);
  return { name:`${PROVIDER_NAME} • ${label}${clean?` • ${clean}`:""}`, title:`${label}${clean?` • ${clean}`:""}`, url:"https://reanime.to/favicon.ico", quality:"Debug", provider:PROVIDER_NAME, type:"mp4", language:"Diagnostic", subtitles:[] };
}

async function probe(url, options={}) {
  try {
    const r = await fetch(url,{...options,headers:{...HEADERS,...(options.headers||{})},skipSizeCheck:true});
    const text = String(await r.text() || "");
    let data=null; try{data=text?JSON.parse(text):null;}catch(_){}
    return {ok:!!r.ok,status:r.status,data,text};
  } catch(e) { return {ok:false,status:0,data:null,text:"",error:String(e&&e.message||e)}; }
}

function titleText(v){
  if(!v)return"";
  if(typeof v==="string")return v;
  return [v.english,v.romaji,v.native,v.userPreferred].filter(Boolean).join(" / ");
}
function slugOf(c){return String(c&&(c.anime_id||c.animeId||c.slug||c.id)||"").trim();}
function resultsOf(d){if(Array.isArray(d))return d;if(d&&Array.isArray(d.results))return d.results;if(d&&Array.isArray(d.data))return d.data;return[];}

async function gql(query,variables){
  return await probe("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query,variables})});
}

async function getStreams(inputId, mediaType="tv", season=1, episode=1){
  const rows=[];
  try{
    const type=String(mediaType||"tv").toLowerCase();
    rows.push(diag("INPUT",`id=${inputId} type=${type} S${season} E${episode}`));
    if(type==="movie"||Number(season)!==0){rows.push(diag("STOP","Season 0 only"));return rows;}

    const tmdbId=/^\d+$/.test(String(inputId))?Number(inputId):null;
    if(!tmdbId){rows.push(diag("STOP","numeric TMDB id required for this diagnostic"));return rows;}

    const show=await probe(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
    const special=await probe(`https://api.themoviedb.org/3/tv/${tmdbId}/season/0/episode/${episode}?api_key=${TMDB_API_KEY}`);
    const showTitle=show.data&&(show.data.name||show.data.original_name)||"";
    const specialTitle=special.data&&special.data.name||"";
    rows.push(diag("TMDB",`show=${showTitle} special=${specialTitle}`));

    let candidate=null, detail=null;
    for(const q of [`${showTitle} ${specialTitle}`.trim(),specialTitle].filter(Boolean)){
      const s=await probe(`${DOMAINS[0]}/api/v1/search?q=${encodeURIComponent(q)}&limit=10&offset=0`,{headers:{Referer:`${DOMAINS[0]}/home`}});
      const list=resultsOf(s.data);
      rows.push(diag("REANIME SEARCH",`HTTP ${s.status} hits=${list.length} q=${q}`));
      if(list.length){candidate=list[0];break;}
    }
    if(!candidate){rows.push(diag("FAIL","no Re:ANIME candidate"));return rows;}

    const slug=slugOf(candidate);
    rows.push(diag("REANIME CAND",`slug=${slug} anilist=${candidate.anilist_id||candidate.anilist||0} title=${titleText(candidate.title)}`));
    const d=await probe(`${DOMAINS[0]}/api/v1/anime/${encodeURIComponent(slug)}`,{headers:{Referer:`${DOMAINS[0]}/home`}});
    detail=d.data||{};
    const malId=Number(detail.mal_id||candidate.mal_id||0)||0;
    const storedAni=Number(detail.anilist_id||detail.anilist||candidate.anilist_id||candidate.anilist||0)||0;
    const detailTitle=titleText(detail.title)||titleText(candidate.title);
    rows.push(diag("REANIME DETAIL",`HTTP ${d.status} mal=${malId||"none"} anilist=${storedAni||"none"} format=${detail.format||candidate.format||"?"} title=${detailTitle}`));

    if(malId){
      const byMal=await gql("query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal format episodes title{english romaji native}}}",{idMal:malId});
      const m=byMal.data&&byMal.data.data&&byMal.data.data.Media;
      rows.push(diag("ANILIST BY MAL",m?`id=${m.id} idMal=${m.idMal||"none"} format=${m.format} eps=${m.episodes} title=${titleText(m.title)}`:`HTTP ${byMal.status} none for MAL ${malId}`));
    }

    const searchTerms=[detailTitle, String(detailTitle||"").replace(/\s*-\s*(Shugo Jutsushi Fitz|Guardian Fitz).*$/i,"").replace(/Season\s*2\s*-?\s*Episode\s*0.*$/i,"Season 2"), `${showTitle} Season 2`].filter(Boolean);
    const ids=[];
    const seen=new Set();
    for(const term of searchTerms){
      const a=await gql("query($search:String){Page(page:1,perPage:5){media(search:$search,type:ANIME){id idMal format episodes title{english romaji native}}}}",{search:term});
      const media=a.data&&a.data.data&&a.data.data.Page&&a.data.data.Page.media||[];
      rows.push(diag("ANILIST SEARCH",`q=${term} HTTP ${a.status} hits=${media.length}`));
      for(const m of media.slice(0,3)){
        rows.push(diag("ANILIST CAND",`id=${m.id} mal=${m.idMal||"none"} format=${m.format} eps=${m.episodes} title=${titleText(m.title)}`));
        if(m.id&&!seen.has(m.id)){seen.add(m.id);ids.push(m.id);}
      }
      if(ids.length) break;
    }

    if(storedAni&&!seen.has(storedAni))ids.unshift(storedAni);
    if(!ids.length){rows.push(diag("FAIL","no AniList candidates recovered"));return rows;}

    for(const aid of ids.slice(0,3)){
      for(const ep of [0,1]){
        let hit=false;
        for(const base of DOMAINS){
          const f=await probe(`${base}/api/flix/${aid}/${ep}`,{headers:{Referer:`${base}/home`}});
          const servers=f.data&&Array.isArray(f.data.servers)?f.data.servers:[];
          rows.push(diag(`FLIX ${aid}/${ep}`,`${base.replace(/^https:\/\//,"")} HTTP ${f.status} success=${!!(f.data&&f.data.success)} servers=${servers.length}`));
          if(servers.length){
            const kinds=[...new Set(servers.map(x=>`${x.serverName||"?"}:${x.dataType||"?"}`))].join(",");
            rows.push(diag("SUCCESS",`AniList=${aid} episode=${ep} servers=${servers.length} ${kinds}`));
            hit=true;break;
          }
        }
        if(hit)return rows;
      }
    }

    rows.push(diag("FAIL","AniList candidates found but Flix episode 0/1 had no servers"));
    return rows;
  }catch(e){rows.push(diag("ERROR",String(e&&e.message||e)));return rows;}
}

if(typeof module!=="undefined"&&module.exports)module.exports={getStreams};else globalThis.getStreams=getStreams;
