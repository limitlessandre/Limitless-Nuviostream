"use strict";

// Temporary Nexus-only diagnostic shim for the existing generic season-title resolver.
// It keeps the same provider identity and production WCO remains untouched.
// The shim only strengthens duplicate-candidate diagnostics so ambiguous WCO links
// are visible in Nuvio even when the inner resolver's earlier debug patch does not fire.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-power-rangers-nexus-v2.js";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
let cached = null;

function diag(message, season, episode) {
  const clean = String(message || "unknown error").replace(/\s+/g, " ").trim().slice(0, 180);
  return [{
    name: `${PROVIDER_NAME} • DIAG SHIM • ${clean}`,
    title: `Power Rangers S${String(Number(season || 1)).padStart(2, "0")}E${String(Number(episode || 1)).padStart(2, "0")}`,
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
}

function patchWrapper(source) {
  let out = String(source || "");
  if (!out) return "";

  const tail = [
    '  if (!out.includes(marker)) return "";',
    '  out = out.replace(marker, replacement);',
    '',
    '  return out;',
    '}'
  ].join("\n");

  if (!out.includes(tail)) return "";

  const injected = [
    '  if (!out.includes(marker)) return "";',
    '  out = out.replace(marker, replacement);',
    '',
    '  // Diagnostic hardening: leave more room for candidate rows.',
    '  out = out.replace("if(!rows||rows.length>=14)return;", "if(!rows||rows.length>=30)return;");',
    '',
    '  // If the inner duplicate-debug replacement did not match, attach labels/URLs',
    '  // to the original ambiguous-return path directly.',
    '  out = out.replace(',
    '    "  if(episodes.length!==1)return{streams:[],count:episodes.length};",',
    '    "  if(episodes.length!==1){const dbg=episodes.slice(0,4).map(function(x,i){const label=String(x.cleanTitle||x.text||\"untitled\").replace(/\\\\s+/g,\" \" ).trim().slice(0,52);const href=String(x.href||\"\").replace(/^https?:\\\\/\\\\//,\"\").slice(0,76);return String(i+1)+\":S\"+String(x.season==null?\"nil\":x.season)+\" \"+label+\" @ \"+href;}).join(\" || \");return{streams:[],count:episodes.length,debug:dbg};}"',
    '  );',
    '',
    '  // Guarantee NUMBER DUB/SUB rows are emitted when debug payloads exist.',
    '  out = out.replace(',
    '    "__wcoResolverDiagPush(__diag, \\\"NUMBER CHECK\\\", `${__r.attempt.kind} ${__r.attempt.title} • dubMatches=${dub.count} subMatches=${sub.count}`, __displayTitle);",',
    '    "__wcoResolverDiagPush(__diag, \\\"NUMBER CHECK\\\", `${__r.attempt.kind} ${__r.attempt.title} • dubMatches=${dub.count} subMatches=${sub.count}`, __displayTitle);\\n      if(dub&&dub.debug)__wcoResolverDiagPush(__diag,\\\"NUMBER DUB\\\",dub.debug,__displayTitle);\\n      if(sub&&sub.debug)__wcoResolverDiagPush(__diag,\\\"NUMBER SUB\\\",sub.debug,__displayTitle);"',
    '  );',
    '',
    '  return out;',
    '}'
  ].join("\n");

  return out.replace(tail, injected);
}

async function loadProvider() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const raw = String(await res.text() || "");
    const source = patchWrapper(raw);
    if (!source || !source.includes("module.exports")) return null;

    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    }) || mod.exports;

    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const provider = await loadProvider();
    if (!provider) return diag("diagnostic shim failed to load", season, episode);
    return await provider.getStreams(inputId, mediaType, season, episode);
  } catch (err) {
    return diag(String(err && err.message || err), season, episode);
  }
}

module.exports = { getStreams };
