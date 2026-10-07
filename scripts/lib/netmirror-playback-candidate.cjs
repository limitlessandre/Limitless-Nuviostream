// Investigation prototype only. Production does not import this module.
// Promotion requires live repeated-fetch evidence under the exported headers.
const baseline = require('../../custom/providers/netmirror-standalone-nexus-v1.js').__test;
const unique = values => [...new Set(values)].sort();
const text = value => String(value == null ? '' : value).trim();
const aliases = {eng:'en',kor:'ko',jpn:'ja',ara:'ar',ces:'cs',deu:'de',spa:'es',fra:'fr',por:'pt',zho:'zh',dan:'da',ell:'el',fin:'fi',heb:'he',hin:'hi',hrv:'hr',hun:'hu',ind:'id',ita:'it',msa:'ms',nob:'nb',nld:'nl',pol:'pl',ron:'ro',rus:'ru',swe:'sv',tam:'ta',tel:'te',tha:'th',tur:'tr',ukr:'uk',vie:'vi'};
const names = {Arabic:'ar',Czech:'cs',Danish:'da',German:'de',Greek:'el',English:'en',Spanish:'es','European Spanish':'es-ES','Latin American Spanish':'es-419',Finnish:'fi',French:'fr',Hebrew:'he',Hindi:'hi',Croatian:'hr',Hungarian:'hu',Indonesian:'id',Italian:'it',Japanese:'ja',Korean:'ko',Malay:'ms',Norwegian:'nb',Dutch:'nl',Polish:'pl','Brazilian Portuguese':'pt-BR',Portuguese:'pt',Romanian:'ro',Russian:'ru',Swedish:'sv',Thai:'th',Turkish:'tr',Ukrainian:'uk',Vietnamese:'vi','Chinese (Simplified)':'zh-Hans','Chinese (Traditional)':'zh-Hant','Filipino (Tagalog)':'fil',Catalan:'ca',Basque:'eu',Galician:'gl',Tamil:'ta',Telugu:'te'};
const known = new Set(Object.values(names).map(x=>x.split('-')[0]).concat(Object.values(aliases),'und'));

function language(value) {
  let raw=text(value).replace(/^\d+[-_]/,'').replace(/\.\[CC\]|\[CC\]|\(\d+\)/gi,'').replace(/_/g,'-').trim();
  const named=Object.entries(names).find(([name])=>name.toLowerCase()===raw.toLowerCase());
  if(named)return named[1];
  const parts=raw.split('-');const primary=aliases[parts[0].toLowerCase()]||parts[0].toLowerCase();
  if(!known.has(primary))return 'und';
  return [primary,...parts.slice(1).map(p=>p.length===2?p.toUpperCase():p.length===4?p[0].toUpperCase()+p.slice(1).toLowerCase():p)].join('-');
}

function normalizeSubtitle(track, headers={}) {
  const url=text(track.url||track.file||track.uri);if(!url)return null;
  let absolute;
  try {const parsed=new URL(url,'https://subscdn.top/');if(!/^https?:$/.test(parsed.protocol))return null;absolute=parsed.href;}catch{return null;}
  let file=new URL(absolute).pathname.split('/').pop();
  try {file=decodeURIComponent(file);}catch{}
  file=file.replace(/\.(?:srt|vtt|m3u8)$/i,'');
  const name=text(track.name||track.label);
  const code=[track.language,track.lang,file,name].map(language).find(x=>x!=='und')||'und';
  const baseName=Object.entries(names).find(([,value])=>value===code)?.[0]||code;
  let label=name||baseName;
  if(/\[CC\]/i.test(file)&&!/\[CC\]/i.test(label))label+=' [CC]';
  const edition=file.match(/\(\d+\)/);if(edition&&!label.includes(edition[0]))label+=' '+edition[0];
  return {url:absolute,language:code,name:label,headers:{...headers,...(track.headers||{})}};
}

function subtitleKey(track) {
  // Only the known NetMirror /files/<episode>/<episode>-lang.srt and
  // /subs/<episode>/lang.m3u8 routes are declared equivalent. No language-only merge.
  const url=new URL(track.url);const match=url.pathname.match(/^\/(?:files\/(\d+)\/\d+-|subs\/(\d+)\/)(.+)\.(?:srt|vtt|m3u8)$/i);
  const media=/(?:^|\.)subscdn\.top$/.test(url.hostname)&&match ? `${match[1]||match[2]}:${match[3].toLowerCase()}` : baseline.mediaIdentity(track.url);
  return `${language(track.language)}|${media}`;
}

function normalizeSubtitles(external=[], embedded=[], headers={}) {
  const result=new Map();
  // Separate caption files win for a proven identical track. Embedded-only
  // metadata remains in the intact HLS master and is also retained here.
  for(const [source,tracks]of [['external',external],['embedded',embedded]])for(const track of tracks){
    const normalized=normalizeSubtitle(track,headers);if(!normalized)continue;
    const key=subtitleKey(normalized);if(!result.has(key))result.set(key,{...normalized,source});
  }
  return [...result.values()];
}

function attributes(line) {
  return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m=>[m[1],m[2]??m[3]]));
}

function audioKey(track) {
  return JSON.stringify([language(track.language),track.name,track.characteristics||'',track.channels||'',track.default,track.autoselect,baseline.mediaIdentity(track.url||'')]);
}

function parsePlaylist(body,base) {
  if(!text(body).startsWith('#EXTM3U'))throw Error('not-hls');
  const lines=body.split(/\r?\n/).map(text),media=[],variants=[],segments=[];
  let duration=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(line.startsWith('#EXT-X-MEDIA:')){
      const a=attributes(line);
      media.push({type:a.TYPE,groupId:a['GROUP-ID'],language:language(a.LANGUAGE),name:a.NAME||'',url:a.URI?new URL(a.URI,base).href:'',
        characteristics:a.CHARACTERISTICS||'',channels:a.CHANNELS||'',default:a.DEFAULT==='YES',autoselect:a.AUTOSELECT==null?null:a.AUTOSELECT==='YES',forced:a.FORCED==='YES'});
    }
    if(line.startsWith('#EXT-X-STREAM-INF:')){
      const a=attributes(line);let next=i+1;while(next<lines.length&&!lines[next])next++;
      if(!lines[next]||lines[next].startsWith('#'))throw Error('missing-video-uri');
      const [width,height]=(a.RESOLUTION||'').split('x').map(Number);
      variants.push({url:new URL(lines[next],base).href,width:width||0,height:height||0,audio:a.AUDIO||'',subtitles:a.SUBTITLES||'',codecs:a.CODECS||''});
    }
    if(line.startsWith('#EXTINF:')){
      const seconds=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(seconds)||seconds<=0)throw Error('invalid-duration');
      duration+=seconds;let next=i+1;while(next<lines.length&&(!lines[next]||lines[next].startsWith('#')))next++;
      if(!lines[next])throw Error('missing-segment');segments.push(new URL(lines[next],base).href);
    }
  }
  const reachable=(type,field)=>media.filter(m=>m.type===type&&variants.some(v=>v[field]===m.groupId));
  const audio=new Map();for(const track of reachable('AUDIO','audio'))if(!audio.has(audioKey(track)))audio.set(audioKey(track),track);
  return {variants,audioTracks:[...audio.values()],subtitleTracks:reachable('SUBTITLES','subtitles'),duration,segments,endList:lines.includes('#EXT-X-ENDLIST')};
}

function identity(playlist) {
  return JSON.stringify({video:unique(playlist.variants.map(v=>JSON.stringify([baseline.mediaIdentity(v.url),v.width,v.height,v.codecs,v.audio,v.subtitles]))),
    audio:unique(playlist.audioTracks.map(audioKey)),
    subtitles:unique(playlist.subtitleTracks.map(t=>JSON.stringify([t.groupId,language(t.language),t.name,t.forced,t.default,t.autoselect,baseline.mediaIdentity(t.url)])))});
}

function durationPlausible(video, audios=[], runtimeSeconds) {
  if(!(video>0))return false;
  // Metadata is approximate: tolerate recaps, credits, alternate cuts and rounding.
  // Relative bounds preserve real short-form titles; there is no fixed minute floor.
  if(runtimeSeconds>0&&(video<runtimeSeconds*0.45&&runtimeSeconds-video>60||video>runtimeSeconds*1.9+120))return false;
  return audios.filter(x=>x>0).every(audio=>Math.abs(video-audio)<=Math.max(12,Math.max(video,audio)*0.15));
}

function signedQualitySource(url) {
  const params=new URL(url).searchParams;
  return /^(?:2160|1440|1080|720|480|360)p$/.test(params.get('q')||'')&&!!(params.get('in')||params.get('sign')||params.get('token'));
}

async function verifyCandidate(row, context, io) {
  const rounds=[],headers={...(row.headers||{})};const started=Date.now();
  const delays=io.delays||[0,1500,4000];
  if(delays.length<3)throw Error('at-least-three-rounds-required');
  try{
    let expected;
    for(const delay of delays){
      if(delay)await io.pause(delay);
      const response=await io.read(row.url,headers);
      const master=parsePlaylist(response.body,response.url||row.url);
      if(!master.variants.length)throw Error('no-video-rendition');
      const members=[...master.variants,...master.audioTracks,...master.subtitleTracks];
      if(context.episodeId&&members.some(m=>{const id=m.url.match(/\/(?:files|subs)\/(\d+)\//)?.[1];return id&&id!==String(context.episodeId);}))throw Error('episode-identity-mismatch');
      const fingerprint=identity(master);
      if(expected&&expected!==fingerprint)throw Error('master-mutated');expected=fingerprint;
      const selectedAudio=master.audioTracks.filter(t=>t.default||['en',language(context.originalLanguage).split('-')[0]].includes(language(t.language).split('-')[0]));
      const children=new Map();
      const get=async url=>{if(!children.has(url))children.set(url,io.read(url,headers).then(r=>parsePlaylist(r.body,r.url||url)));return children.get(url);};
      const audioMedia=await Promise.all(selectedAudio.filter(t=>t.url).map(async t=>{
        const child=await get(t.url);
        if(child.variants.length||!child.endList||!child.segments.length||!(child.duration>0))throw Error('invalid-audio-media');
        return {duration:child.duration,segments:child.segments.map(baseline.mediaIdentity)};
      }));
      const audioDurations=audioMedia.map(m=>m.duration);
      const audioIdentity=JSON.stringify(audioMedia.map(m=>m.segments));
      if(rounds.length&&rounds[0].audioIdentity!==audioIdentity)throw Error('audio-child-mutated');
      const video=[];
      for(const variant of master.variants){
        const codecs=variant.codecs.toLowerCase();
        const videoCodec=/avc[13]|hev1|hvc1|vp0?9|av01|mp4v/.test(codecs);
        if(codecs&&!videoCodec||!videoCodec&&!(variant.width>0&&variant.height>0))throw Error('audio-only-rendition');
        if(master.audioTracks.some(t=>baseline.mediaIdentity(t.url)===baseline.mediaIdentity(variant.url))||/\/a\/\d+\//.test(variant.url))throw Error('audio-only-rendition');
        const child=await get(variant.url);
        if(child.variants.length||!child.endList||!child.segments.length)throw Error('not-complete-video-media');
        if(!durationPlausible(child.duration,audioDurations,context.runtimeSeconds))throw Error('implausible-video-duration');
        video.push({url:variant.url,height:variant.height,duration:child.duration,segmentCount:child.segments.length,
          segmentIdentity:child.segments.map(baseline.mediaIdentity)});
      }
      // A child can switch media while the parent URL remains unchanged.
      const videoIdentity=JSON.stringify(video.map(v=>[baseline.mediaIdentity(v.url),v.segmentIdentity]));
      if(rounds.length&&(rounds[0].videoIdentity!==videoIdentity||video.some((v,i)=>Math.abs(v.duration-rounds[0].video[i].duration)>Math.max(2,v.duration*0.01))))throw Error('video-child-mutated');
      const subtitles=normalizeSubtitles(row.subtitles||[],master.subtitleTracks,headers);
      rounds.push({master,video,videoIdentity,audioIdentity,audioDurations,subtitles,fingerprint});
    }
    const last=rounds.at(-1);
    return {...row,headers,quality:Math.max(...last.video.map(v=>v.height))+'p',hls:last.master,audioTracks:last.master.audioTracks,
      embeddedSubtitles:last.master.subtitleTracks,subtitles:last.subtitles,
      validation:{stable:true,rounds:rounds.length,elapsedMs:Date.now()-started,signedQuality:signedQualitySource(row.url),video:last.video,audioDurations:last.audioDurations,fingerprint:last.fingerprint}};
  }catch(error){if(io.rejected)io.rejected({url:row.url,reason:error.message,completedRounds:rounds.length});return null;}
}

function selectCandidates(rows, context) {
  const valid=rows.filter(r=>r&&r.validation?.stable&&r.validation.rounds>=3&&r.validation.video?.length);
  const score=row=>[row.validation.signedQuality?1:0,row.validation.rounds,(row.audioTracks||[]).length,(row.subtitles||[]).length,Number.parseInt(row.quality)||0];
  valid.sort((a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;});
  const seen=new Set();
  return valid.filter(row=>{
    const key=JSON.stringify([context.tmdbId,context.season,context.episode,row.quality,
      unique(row.hls.variants.map(v=>baseline.mediaIdentity(v.url))),unique(row.audioTracks.map(audioKey)),unique(normalizeSubtitles(row.subtitles,row.embeddedSubtitles).map(subtitleKey))]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
}

module.exports={language,normalizeSubtitle,normalizeSubtitles,subtitleKey,parsePlaylist,audioKey,identity,durationPlausible,signedQualitySource,verifyCandidate,selectCandidates};
