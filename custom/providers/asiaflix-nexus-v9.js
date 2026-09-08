"use strict";
const PROVIDER_NAME="AsiaFlix Test";
const BASE_URL="https://asiaflix.net";
const API_URL="https://api.asiaflix.net/v1";
const TMDB_API_KEY="1865f43a0549ca50d341dd9ab8b29f49";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147 Safari/537.36";
const API_HEADERS={"User-Agent":UA,"Accept":"application/json, text/plain, */*","X-Access-Control":"web"};
const SW_DOMAINS=["streamwish.com","niramirus.com","medixiru.com"];
function clean(v){return String(v==null?"":v).trim();}
function slug(v){return clean(v).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");}
function host(u){try{return new URL(u).hostname;}catch(_){return "unknown";}}
function diag(label,detail){return {name:PROVIDER_NAME+" • DIAG "+label+" • "+detail,title:detail,url:BASE_URL+"/favicon.ico",quality:"DIAG",language:"Unavailable",provider:PROVIDER_NAME,type:"mp4",subtitles:[]};}
async function json(url){try{var r=await fetch(url,{headers:API_HEADERS,redirect:"follow",skipSizeCheck:true});if(!r||!r.ok)return null;return await r.json();}catch(_){return null;}}
async function text(url){try{var r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,*/*","Referer":BASE_URL+"/"},redirect:"follow",skipSizeCheck:true});var body=r?await r.text():"";return {status:r?Number(r.status||0):0,body:body,finalUrl:r&&r.url?r.url:url};}catch(e){return {status:0,body:"",finalUrl:url};}}
function swId(u){var m=clean(u).match(/\/[efd]\/([a-zA-Z0-9]+)/);return m?m[1]:"";}
async function getStreams(inputId,mediaType,season,episode){
  var id=clean(inputId),type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv",epNo=Number(episode||1);
  if(!/^\d+$/.test(id))return [diag("TMDB","numeric TMDB id required for this test")];
  var meta=await json("https://api.themoviedb.org/3/"+type+"/"+id+"?api_key="+TMDB_API_KEY);
  if(!meta)return [diag("TMDB","metadata request failed")];
  var title=clean(type==="movie"?(meta.title||meta.original_title):(meta.name||meta.original_name));
  var d=await json(API_URL+"/drama/detail?slug="+encodeURIComponent(slug(title)));
  if(!d)return [diag("DETAIL",title+" not found by direct slug")];
  var eps=Array.isArray(d.episodes)?d.episodes:[],ep=type==="movie"?eps[0]:eps.find(function(x){return Number(x&&x.number)===epNo;});
  if(!ep)return [diag("EPISODE",title+" E"+epNo+" not found")];
  var urls=Array.isArray(ep.streamUrls)?ep.streamUrls:[],sw=urls.find(function(x){return /streamwish/i.test(clean(x&&x.source))||/(dwish|streamwish|cybervynx|vibuxer)/i.test(clean(x&&x.url));});
  if(!sw)return [diag("STREAMWISH","not present")];
  var original=clean(sw.url),sid=swId(original),out=[diag("MATCH OK",title+" • E"+epNo+" • StreamWish="+host(original)),diag("STREAMWISH ID",sid||"not found")];
  if(!sid){var a=await text(original);out.push(diag("ORIGINAL","HTTP "+a.status+" • body="+a.body.length+" • final="+host(a.finalUrl)));return out;}
  for(var i=0;i<SW_DOMAINS.length;i++){
    var u="https://"+SW_DOMAINS[i]+"/"+sid,r=await text(u);
    out.push(diag("STREAMWISH TRY "+(i+1),SW_DOMAINS[i]+" • HTTP "+r.status+" • body="+r.body.length+" • final="+host(r.finalUrl)+" • m3u8="+(/m3u8/i.test(r.body)?"yes":"no")+" • mainjs="+(/\/main\.js/i.test(r.body)?"yes":"no")+" • packed="+(/eval\(function\(p,a,c/i.test(r.body)?"yes":"no")));
  }
  return out;
}
if(typeof module!=="undefined")module.exports={getStreams:getStreams};
