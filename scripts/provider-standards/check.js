"use strict";
// Read-only evidence-consistency checks. Does not fetch, execute, rewrite or filter providers.
const {diagnosticSafety}=require('./desktop-contract');
const TAGS=new Set(['DUB','HSUB','SUB','DUB+SUB','DUAL','UNK']);
const CODES=['NO SERIES MATCH','NO EPISODE MATCH','IDENTITY CONFLICT','NO SOURCE FOUND','NO VALID MEDIA','PLAYER FAILED','HTTP 403','HTTP 429','HTTP 503','NETWORK FAILED','TIMEOUT','METADATA FAILED','UNSUPPORTED CONTENT','RUNTIME ERROR'];
const WCO_CODES=['TMDB LOOKUP FAILED','EPISODE TITLE MISMATCH','NO SPECIAL MATCH','PLAYER VERIFICATION FAILED','PLAYER LOOKUP FAILED','EPISODE PAGE FAILED','NO PLAYER FOUND','EXTRACTION TIMEOUT','EXTRACTION FAILED','SERIES LOOKUP FAILED','SERIES NOT FOUND'];
function tier(h){return h>=4320?'2x4K 8K':h>=2160?'4K':h>=1440?'Enhanced QHD':h>=1080?'FHD':h>=720?'HD':h>=540?'HD-Low':h>=480?'SD':h>=360?'SD-Low':'SD-Very Low';}
const height=q=>/^[1-9]\d{1,4}p$/.test(String(q||''))?parseInt(q):0;
const language=x=>({english:'en',japanese:'ja',french:'fr'})[String(x||'').toLowerCase()]||String(x||'').toLowerCase();
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function resolution(e={}){const measured=e.media?.validated===true?Number(e.media.height)||0:0;
 const reported=e.source?.firstParty===true&&e.source.urlBound===true&&e.source.identityBound===true?Number(e.source.height)||0:0;return measured||reported;}
const array=value=>Array.isArray(value)?value:[];
function tracks(row,kind){return [...(kind==='audio'?array(row.audioTracks):[...array(row.subtitles),...array(row.subtitleTracks),...array(row.captions)]),...array(row.tracks).filter(t=>kind==='audio'?/audio/i.test(t.kind||t.type||''):/sub|caption|text/i.test(t.kind||t.type||''))];}
function softTracks(row){return tracks(row,'subtitle').filter(t=>typeof t==='string'?!!t.trim():!!(t?.url||t?.src||t?.file||t?.uri));}
function group(item,tag){const r=item.row,e=item.evidence||{},trackKey=kind=>tracks(r,kind).map(t=>typeof t==='string'?'unspecified':[t.language||t.lang||t.srclang,t.name||t.label,t.channels,t.role].join('|')).sort();return stable([tag,language(e.media?.audioLanguage||e.source?.audioLanguage||r.language),trackKey('audio'),trackKey('subtitle'),e.mirror?.independent===true?e.mirror.key:'single']);}
function expectedTag(row,e,policy){const audio=tracks(row,'audio'),actual=e.media?.validated===true?language(e.media.audioLanguage):'';
 const source=e.source?.firstParty===true&&e.source.identityBound===true&&e.source.urlBound===true?e.source:{};
 const rule=array(policy.verifications).find(v=>v.reference&&v.provider===policy.provider&&v.streamClass===source.streamClass&&v.audioLanguage===language(actual||source.audioLanguage||row.language));
 const multiple=new Set(audio.filter(t=>t?.selectable===true).map(t=>stable([t.id,t.language||t.lang,t.name||t.label,t.channels,t.role]))).size>1||e.media?.validated===true&&e.media.selectableAudioTracks>1||source.multipleSelectableAudio===true;
 const dub=actual?actual.split('-')[0]==='en':source.audioLanguage?language(source.audioLanguage).split('-')[0]==='en':source.dubVerified===true||e.content?.trusted===true&&e.content.originalLanguage==='en';
 const hard=source.hardSubsVerified===true||rule?.tag==='HSUB';
 return multiple?'DUAL':softTracks(row).length?dub?'DUB+SUB':'SUB':dub?'DUB':hard?'HSUB':'UNK';}
function auditRows(input={}){const items=input.items===undefined?[]:input.items,issues=[],parsed=[];const policy=input.policy||{};
 const add=(code,message,index,severity='error')=>issues.push({code,severity,...(index==null?{}:{row:index}),message});
 if(!Array.isArray(items))return {issues:[{code:'INPUT_SCHEMA',severity:'error',message:'items must be an array.'}],checked:0};
 if(Object.hasOwn(input,'items')&&items.length===0){if(policy.diagnosticTransportUnavailable===true&&CODES.includes(input.failure?.code))add('DIAGNOSTIC_API_LIMIT','Empty output retains a typed internal failure because no safe diagnostic transport is available; native display remains unresolved.',null,'review');else add('UNEXPLAINED_EMPTY','Empty result needs an observed typed failure and a documented safe-transport limitation.');}
 const seen=new Set();let playable=0,diagnostics=0;
 for(const [i,item]of items.entries()){
  const row=item?.row,e=item?.evidence||{};if(!row||typeof row!=='object'){add('ROW_SCHEMA','Provide {row,evidence} objects.',i);continue;}
  for(const field of ['audioTracks','subtitles','subtitleTracks','captions','tracks'])if(row[field]!=null&&!Array.isArray(row[field]))add('TRACK_SCHEMA','Track metadata must use arrays.',i);
  const name=String(row.name||''),diag=/\b(?:DIAG|INFO)\b/.test(name)||/^(DIAG|DEBUG|INFO)$/i.test(row.quality||'');
  if(diag){diagnostics++;const prefix=String(policy.provider||row.provider||'');const body=name.startsWith(prefix+' • DIAG ')?name.slice((prefix+' • DIAG ').length):'';
   const allowed=[...CODES,...(prefix==='WCO'&&policy.allowWcoLegacyCodes===true?WCO_CODES:[])];
   if(!body||!allowed.some(c=>body.startsWith(c+' • ')&&body.slice(c.length+3).trim()))add('DIAGNOSTIC_FORMAT','Use Provider • DIAG CODE • concise explanation with a canonical or scoped documented code.',i);
   let diagnosticText=name+' '+String(row.title||'');for(let n=0;n<2;n++){try{diagnosticText=decodeURIComponent(diagnosticText);}catch(_){break;}}
   if(name.length>240||String(row.title||'').length>400||/[\p{Cc}\p{Cf}]|[a-z][a-z0-9+.-]*:\/\/|<[^>]*>|\bbearer\s+\S+|(?:token|cookie|authorization|secret|api[_-]?key)\s*[:=]/iu.test(diagnosticText))add('DIAGNOSTIC_SANITIZATION','Diagnostic contains a URL, credential-like assignment, controls or excessive length.',i);
   const safe=diagnosticSafety(row,policy.desktopContract);if(!safe.profileSafe)add('DIAGNOSTIC_PLAYBACK_SAFETY',safe.reason,i);
   else add('NATIVE_DIAGNOSTIC_VALIDATION','Pinned-source predicate check passed; confirm actual Desktop build/display and all playback modes.',i,'review');
   if(row.headers||softTracks(row).length||tracks(row,'audio').length)add('DIAGNOSTIC_MEDIA_METADATA','Diagnostics must not carry playback headers or media tracks.',i);
   continue;
  }
  playable++;
  const parts=name.split(' • '),tag=(parts[2]||'').match(/^\[([^\]]+)\]$/)?.[1];
  if(parts.length<3||parts.length>4||!parts[0]||!TAGS.has(tag)||policy.provider&&parts[0]!==policy.provider)add('STREAM_NAME','Expected Provider • canonical quality • [recognized TAG] • optional useful disambiguator.',i);
  const h=height(row.quality),expected=h?tier(h)+' '+h+'p':'Unknown Auto';
  if(parts[1]!==expected||!h&&!['Auto','Unknown Auto'].includes(row.quality))add('QUALITY_LABEL','Quality tier/name must use the actual height or Unknown Auto.',i);
  const reliable=resolution(e);if(h&&h!==reliable)add('QUALITY_EVIDENCE','Numeric quality lacks matching measured or exact-URL/identity-bound first-party evidence, or contradicts measured dimensions.',i);
  if(!h&&reliable)add('QUALITY_EVIDENCE_IGNORED','Trustworthy resolution was available but discarded.',i);
  if(e.media?.validated!==true)add('MEDIA_UNVERIFIED','Playable media validation evidence is absent; a filename/URL alone proves nothing.',i);
  if(!/^https?:\/\//i.test(String(row.url||'')))add('PLAYABLE_URL','Ordinary media must expose a validated HTTP(S) media URL.',i);
  const key=stable([row.url,row.headers||{}]);if(seen.has(key))add('DUPLICATE_MEDIA','Identical media URL and playback headers appear more than once.',i);seen.add(key);
  if(e.media?.selectableSubtitlesAvailable===true&&!softTracks(row).length)add('SELECTABLE_SUBTITLES_DROPPED','Verified selectable subtitle availability was not preserved in output tracks.',i);
  if(e.media?.validated===true&&e.media.audioLanguage&&row.language&&language(e.media.audioLanguage).split('-')[0]!==language(row.language).split('-')[0])add('LANGUAGE_CONTRADICTION','Displayed language contradicts verified media audio.',i);
  const want=expectedTag(row,e,policy);if(tag&&tag!==want)add('CLASSIFICATION_EVIDENCE','Tag conflicts with available evidence; expected ['+want+']. Language alone cannot establish hard/soft subtitles or multiple selectable audio.',i);
  if(/Mirror\s*\d+/i.test(parts[3]||'')&&!(e.mirror?.independent===true&&e.mirror.key))add('MIRROR_EVIDENCE','Mirror label lacks verified independent-source evidence.',i);
  if(parts[3]&&!/^Mirror [1-9]\d*$/.test(parts[3])&&!(e.disambiguator?.useful===true&&e.disambiguator.label===parts[3]))add('DISAMBIGUATOR','Use Mirror N or document why this exact disambiguator distinguishes useful sources.',i);
  if(e.mirror?.independent===true&&!e.mirror.key)add('MIRROR_KEY','Independent mirrors require a stable meaningful key.',i);
  parsed.push({item,tag,h,index:i,key:group(item,tag)});
 }
 if(playable&&diagnostics)add('DIAGNOSTIC_CLUTTER','Valid streams and final error diagnostics are mixed; return valid streams without final-failure clutter.');
 for(const key of new Set(parsed.map(x=>x.key))){const rows=parsed.filter(x=>x.key===key),heights=new Set(rows.filter(x=>x.h).map(x=>x.h));
  if(heights.size>2)add('EXCESS_QUALITIES','More than two distinct evidenced heights in one audio/track/mirror group.');
  if(rows.filter(x=>x.h).length>heights.size)add('REDUNDANT_QUALITY','Repeated known resolution in one group needs an independently evidenced mirror/variant.');
 }
 if(input.candidateInventory!=null&&!Array.isArray(input.candidateInventory))add('INPUT_SCHEMA','candidateInventory must be an array.');
 if(Array.isArray(input.candidateInventory)){for(const candidate of input.candidateInventory){if(!candidate?.row||candidate.evidence?.media?.validated!==true)continue;
   const tag=String(candidate.row.name||'').match(/\[([^\]]+)\]/)?.[1],key=group(candidate,tag),kept=parsed.filter(x=>x.key===key),same=kept.some(x=>x.item.row.url===candidate.row.url&&stable(x.item.row.headers||{})===stable(candidate.row.headers||{}));
   if(same)continue;const h=resolution(candidate.evidence),retained=[...new Set(kept.map(x=>x.h).filter(Boolean))].sort((a,b)=>b-a);
   if(h&&(!retained.length||h>retained[retained.length-1]||retained.length<2&&!retained.includes(h)))add('SUPERIOR_QUALITY_DROPPED','A valid candidate with an available superior/distinct quality was lost before final selection.');
   if(!h&&(retained.length<2||!policy.unknownOmissionException?.reference||!policy.unknownOmissionException?.reason))add('UNKNOWN_SOURCE_COLLAPSE','Distinct valid unknown-resolution candidate was discarded without two evidenced alternatives and a documented scoped exception.');
  }}else add('SELECTION_COMPLETENESS_UNPROVED','No candidate inventory supplied; omitted superior/unknown sources cannot be checked. Do not treat this as proof of full selection correctness.',null,'review');
 return {checked:items.length,issues,nativePlaybackProved:false};
}
function auditManifest(manifest,baseline,scope={}){const issues=[],add=(code,message)=>issues.push({code,severity:'error',message});
 if(!manifest||!Array.isArray(manifest.scrapers)||typeof manifest.version!=='string'){add('MANIFEST_SCHEMA','Require root version and scrapers array.');return issues;}
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version))add('MANIFEST_VERSION','Use a semantic root manifest version.');
 const ids=new Set();for(const e of manifest.scrapers){if(!e||!e.id||ids.has(e.id))add('MANIFEST_ID','Each provider needs a unique stable ID.');ids.add(e?.id);
  if(e?.id&&!/^[a-z0-9][a-z0-9-]*$/.test(e.id))add('MANIFEST_ID','Provider ID must be a stable lowercase identifier.');
  if(e?.version&&!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(e.version))add('MANIFEST_VERSION','Use a semantic provider version.');
  for(const k of ['name','version','filename'])if(typeof e?.[k]!=='string'||!e[k].trim())add('MANIFEST_METADATA','Provider '+String(e?.id||'?')+' lacks '+k+'.');
  if(typeof e?.enabled!=='boolean'||!Array.isArray(e.supportedTypes)||!e.supportedTypes.length||e.supportedTypes.some(t=>!['movie','tv','anime'].includes(t)))add('MANIFEST_TYPES','enabled and supportedTypes must be explicit and valid.');
  if(e?.filename&&(/\\/.test(e.filename)||/^[a-z][a-z0-9+.-]*:/i.test(e.filename)&&!/^https?:\/\//i.test(e.filename)||!/^(?:https?:\/\/|[a-zA-Z0-9_-])/.test(e.filename)||!/\.js(?:\?[^\s]*)?$/.test(e.filename)||/^(?:data|javascript):|(?:^|\/)\.\.(?:\/|$)/i.test(e.filename)))add('MANIFEST_FILENAME','Provider filename must address JavaScript without traversal or executable inline schemes.');
 }
 if(baseline){const allowed=new Set(scope.updatedProviderIds||[]);for(const old of baseline.scrapers||[]){const now=manifest.scrapers.find(e=>e.id===old.id);if(!now)add('MANIFEST_ID_CHANGED','Existing provider ID removed: '+old.id);else if(!allowed.has(old.id)&&stable(now)!==stable(old))add('UNRELATED_MANIFEST_CHANGE','Unrelated provider metadata changed: '+old.id);else if(allowed.has(old.id)&&now.name!==old.name&&!scope.allowNameChange)add('MANIFEST_NAME_CHANGED','Upgrades preserve display name unless explicitly authorized.');}
  for(const e of manifest.scrapers)if(!(baseline.scrapers||[]).some(x=>x.id===e.id)&&!(scope.newProviderIds||[]).includes(e.id))add('UNAUTHORIZED_MANIFEST_ENTRY','New provider ID outside declared change scope: '+e.id);
 }
 return issues;}
function audit(input={}){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Input must be an object.');if(Array.isArray(input.scrapers))input={manifest:input};if(!Object.hasOwn(input,'items')&&!input.manifest)throw Error('Provide items or manifest.');const result=auditRows(input);if(input.manifest)result.issues.push(...auditManifest(input.manifest,input.baselineManifest,input.changeScope));result.errors=result.issues.filter(i=>i.severity==='error').length;return result;}
module.exports={audit,auditRows,auditManifest,tier,expectedTag,resolution,CODES};
