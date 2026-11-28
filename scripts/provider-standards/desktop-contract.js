"use strict";
// Conservative port of the inspected plugin-result path, not the native app.
const PROFILE='nuviodesktop-plugin-1ece6d7ae5dbda29d0ab05952375692a56d81078';
const SENTINEL='magnet:?dn=WCO%20Unified%20Diagnostic';
function diagnosticSafety(row,profile){
 const raw=row?.url,url=typeof raw==='string'?raw.trim():raw&&typeof raw.url==='string'?raw.url.trim():'';
 if(!url)return {visible:false,profileSafe:false,reason:'Blank/missing URL is filtered by the inspected plugin parser.',nativeValidationRequired:true};
 const hash=String(row.infoHash||'').trim();
 if(row.serverTarget||row.clientResolve||row.externalUrl||row.ytId||row.debridCacheStatus||row.sources?.length||hash)return {visible:true,profileSafe:false,reason:'Diagnostic carries a playback, external, P2P or debrid target.',nativeValidationRequired:true};
 if(profile!==PROFILE)return {visible:true,profileSafe:false,reason:'Unknown or unspecified client contract; diagnostic safety is unproved.',nativeValidationRequired:true};
 // Deliberately whitelist only the audited current sentinel. An arbitrary custom
 // URI, other magnet, torrent URL, HTTP icon, data URL or javascript URL is not approved.
 if(url!==SENTINEL)return {visible:true,profileSafe:false,reason:'URL is not the exact conditionally verified hashless plugin sentinel.',nativeValidationRequired:true};
 return {visible:true,profileSafe:true,reason:'Excluded by direct/P2P/debrid predicates only on the pinned plugin path; not universally approved.',nativeValidationRequired:true};
}
module.exports={PROFILE,SENTINEL,diagnosticSafety};
// Port only parser visibility and shared playback eligibility for the pinned
// plugin path. Preference ordering, native player/network/UI are not emulated.
function pinnedPluginPredicates(row,{p2pEnabled=false,debridEnabled=false}={}){
 const raw=row?.url,url=typeof raw==='string'?raw.trim():typeof raw?.url==='string'?raw.url.trim():'';
 if(!url)return {visible:false,hasPlayableSource:false,selectable:false,autoEligible:false};
 const magnet=/^magnet:/i.test(url),torrent=/^torrent:\/\//i.test(url),direct=!magnet&&!torrent;
 const valid=h=>/^[a-f0-9]{40}$/i.test(h||'')||/^[a-z2-7]{32}$/i.test(h||'');
 let hash=valid(row.infoHash)?row.infoHash:null;
 if(!hash&&magnet){try{const xt=new URL(url).searchParams.getAll('xt').find(x=>/^urn:btih:/i.test(x));const candidate=xt?.replace(/^urn:btih:/i,'');if(valid(candidate))hash=candidate;}catch(_){}}
 // Conservative: no torrent:// representation is approved by diagnosticSafety.
 if(torrent)return {visible:true,hasPlayableSource:true,selectable:null,autoEligible:null,notModelled:true};
 const p2p=p2pEnabled&&!!hash&&!direct;
 const debrid=false; // plugin:/plugin-repo: never meets isInstalledAddonStream.
 return {visible:true,hasPlayableSource:true,selectable:direct||p2p||debrid,autoEligible:direct||p2p||debrid};
}
module.exports.pinnedPluginPredicates=pinnedPluginPredicates;
