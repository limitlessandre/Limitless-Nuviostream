"use strict";

// Production-only WCO safety layer.
// Keeps the existing production provider behavior, but patches the loaded core so
// episode discovery cannot consume unrelated Recent Releases/sidebar links from a
// valid series page. It deliberately does NOT add a second title/page-identity gate,
// because WCO aliases can differ from TMDB titles (for example Monster Farm/Rancher).
// The Power Rangers fallback resolver is not changed by this file.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production.js";
let cached = null;

function patchProductionSource(raw) {
  let source = String(raw || "");
  const augmentMarker = "function augmentCoreMirrors(source) {";
  if (!source || !source.includes(augmentMarker)) return "";

  const helper = `
function __wcoInjectSeriesAffinity(coreSource) {
  let src = String(coreSource || "");
  const NL = String.fromCharCode(10);
  const startMarker = "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant) {";
  const endMarker = "function iframeLink(html, pageUrl)";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) return "";

  const helperCode = [
    'function __wcoAffinityTokens(value) {',
    '  const stop = new Set(["the","and","of","a","an","anime","cartoon","series","season","watch","online","english","dubbed","subbed","dub","sub","episode"]);',
    '  return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 2 && !stop.has(x));',
    '}',
    'function __wcoSeriesTokens(url) {',
    '  const m = String(url || "").match(/\\/anime\\/([^/?#]+)/i);',
    '  return m && m[1] ? __wcoAffinityTokens(m[1]) : [];',
    '}',
    'function __wcoEpisodeBelongsToSeries(href, pageUrl) {',
    '  const wanted = __wcoSeriesTokens(pageUrl);',
    '  if (!wanted.length) return true;',
    '  const path = String(href || "").replace(/^https?:\\/\\/[^/]+/i, "");',
    '  const actual = new Set(__wcoAffinityTokens(path));',
    '  let hits = 0;',
    '  for (const token of wanted) if (actual.has(token)) hits += 1;',
    '  if (wanted.length === 1) return hits === 1;',
    '  return hits >= Math.max(2, Math.ceil(wanted.length * 0.6));',
    '}',
    ''
  ].join(NL);

  let episodeBlock = src.slice(start, end);
  const hrefNeedle = '    if (!href || !text) continue;';
  if (!episodeBlock.includes(hrefNeedle)) return "";
  episodeBlock = episodeBlock.replace(
    hrefNeedle,
    hrefNeedle + NL + '    if (!__wcoEpisodeBelongsToSeries(href, pageUrl)) continue;'
  );
  return src.slice(0, start) + helperCode + episodeBlock + src.slice(end);
}
`;

  source = source.replace(augmentMarker, helper + "\n" + augmentMarker);

  // augmentCoreMirrors is the first occurrence of this splice marker in the production
  // wrapper. Apply the ownership guard immediately after its existing embed patch.
  const spliceMarker = "  source = source.slice(0, start) + replacement + source.slice(end);";
  if (!source.includes(spliceMarker)) return "";
  source = source.replace(
    spliceMarker,
    spliceMarker + "\n  source = __wcoInjectSeriesAffinity(source);\n  if (!source) return \"\";"
  );
  return source;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const patched = patchProductionSource(await res.text());
    if (!patched || !patched.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
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
  try { return await base.onSettings(); }
  catch (_) { return []; }
}

module.exports = { getStreams, onSettings };
