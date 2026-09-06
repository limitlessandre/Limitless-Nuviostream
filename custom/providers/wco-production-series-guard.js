"use strict";

// Production-only WCO safety layer.
// Keeps the existing production provider behavior, but patches the loaded core so
// episode discovery cannot consume unrelated Recent Releases/sidebar links from a
// valid series page. The Power Rangers fallback resolver is not changed by this file.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production.js";
let cached = null;

function patchProductionSource(raw) {
  let source = String(raw || "");
  if (!source || !source.includes("function augmentCoreMirrors(source)")) return "";

  const augmentMarker = "function augmentCoreMirrors(source) {";
  const helper = String.raw`
function __wcoInjectSeriesAffinity(coreSource) {
  let src = String(coreSource || "");
  const startMarker = "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant) {";
  const endMarker = "function iframeLink(html, pageUrl)";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) return "";

  const helperCode = [
    'function __wcoSeriesTokens(url) {',
    '  const m = String(url || "").match(/\\/anime\\/([^/?#]+)/i);',
    '  if (!m || !m[1]) return [];',
    '  const stop = new Set(["the","and","of","a","an","anime","cartoon","series","season","watch","online","english","dubbed","subbed","dub","sub"]);',
    '  return String(m[1]).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 2 && !stop.has(x));',
    '}',
    'function __wcoEpisodeBelongsToSeries(href, pageUrl) {',
    '  const tokens = __wcoSeriesTokens(pageUrl);',
    '  if (!tokens.length) return true;',
    '  const path = String(href || "").toLowerCase().replace(/^https?:\\/\\/[^/]+/i, "");',
    '  let hits = 0;',
    '  for (const token of tokens) if (path.includes(token)) hits += 1;',
    '  if (tokens.length === 1) return hits === 1;',
    '  return hits >= Math.max(2, Math.ceil(tokens.length * 0.6));',
    '}',
    ''
  ].join("\\n");

  let block = src.slice(start, end);
  const needle = '    if (!href || !text) continue;';
  if (!block.includes(needle)) return "";
  block = block.replace(needle, needle + '\\n    if (!__wcoEpisodeBelongsToSeries(href, pageUrl)) continue;');

  // Also validate that the candidate page itself still looks like the requested show.
  // This is deliberately conservative: the existing search score remains primary,
  // while a clearly unrelated page is rejected before episode scanning begins.
  const tvStart = src.indexOf("async function tvStreams(info, season, episode) {");
  const tvEnd = src.indexOf("async function movieStreams(info)", tvStart);
  if (tvStart < 0 || tvEnd < 0) return "";
  let tvBlock = src.slice(tvStart, tvEnd);
  const seriesNeedle = '    const series = await candidatePage(candidate);\\n    if (!series) continue;';
  if (!tvBlock.includes(seriesNeedle)) return "";
  const seriesReplacement = seriesNeedle + '\\n    const __identity = pageIdentityText(series.page.text) + " " + String(series.pageUrl || "");\\n    const __identityScore = Math.max(...info.titles.map(t => scoreTitle(__identity, t)));\\n    if (__identityScore < 70) continue;';
  tvBlock = tvBlock.replace(seriesNeedle, seriesReplacement);

  // Apply the episode-link patch first, then splice the validated TV block from the
  // same core source. Re-locate tvStreams after inserting helperCode because offsets move.
  src = src.slice(0, start) + helperCode + block + src.slice(end);
  const newTvStart = src.indexOf("async function tvStreams(info, season, episode) {");
  const newTvEnd = src.indexOf("async function movieStreams(info)", newTvStart);
  if (newTvStart < 0 || newTvEnd < 0) return "";
  src = src.slice(0, newTvStart) + tvBlock + src.slice(newTvEnd);
  return src;
}
`;

  source = source.replace(augmentMarker, helper + "\n" + augmentMarker);

  const oldTail = '  source = source.slice(0, start) + replacement + source.slice(end);\n  return source.replace(\'"use strict";\', \'"use strict";\\n\' + premiumSourceAddon());';
  const newTail = '  source = source.slice(0, start) + replacement + source.slice(end);\n  source = __wcoInjectSeriesAffinity(source);\n  if (!source) return "";\n  return source.replace(\'"use strict";\', \'"use strict";\\n\' + premiumSourceAddon());';
  if (!source.includes(oldTail)) return "";
  return source.replace(oldTail, newTail);
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
