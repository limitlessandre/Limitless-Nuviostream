"use strict";

// Production-only WCO safety layer.
// Keeps the existing production provider behavior, but patches the loaded core so
// episode discovery only scans WCO's own episode-list containers. This prevents
// Recent Releases/sidebar links from being treated as requested episodes without
// relying on title/slug similarity, so legitimate aliases such as Monster Farm /
// Monster Rancher remain usable. The Power Rangers fallback resolver is unchanged.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-production.js";
let cached = null;

function patchProductionSource(raw) {
  let source = String(raw || "");
  const augmentMarker = "function augmentCoreMirrors(source) {";
  if (!source || !source.includes(augmentMarker)) return "";

  const helper = `
function __wcoInjectEpisodeScope(coreSource) {
  let src = String(coreSource || "");
  const NL = String.fromCharCode(10);
  const startMarker = "function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason, forcedVariant) {";
  const endMarker = "function iframeLink(html, pageUrl)";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) return "";

  const helperCode = [
    'function __wcoEpisodeScope(html) {',
    '  const text = String(html || "");',
    '  const blocks = [];',
    '  const cat = /<div\\b[^>]*class=["\\x27][^"\\x27]*\\bcat-eps\\b[^"\\x27]*["\\x27][^>]*>[\\s\\S]*?<\\/div>/gi;',
    '  let m;',
    '  while ((m = cat.exec(text)) && blocks.length < 1200) blocks.push(m[0]);',
    '  if (blocks.length) return blocks.join(" ");',
    '  const list = text.match(/<div\\b[^>]*id=["\\x27]episodeList["\\x27][^>]*>([\\s\\S]*?)<\\/div>/i);',
    '  return list && list[1] ? list[1] : "";',
    '}',
    ''
  ].join(NL);

  let episodeBlock = src.slice(start, end);
  const signature = startMarker;
  if (!episodeBlock.startsWith(signature)) return "";
  episodeBlock = episodeBlock.replace(
    signature,
    signature + NL + '  html = __wcoEpisodeScope(html);' + NL + '  if (!html) return [];'
  );
  return src.slice(0, start) + helperCode + episodeBlock + src.slice(end);
}
`;

  source = source.replace(augmentMarker, helper + "\n" + augmentMarker);

  // augmentCoreMirrors is the first occurrence of this splice marker in the production
  // wrapper. Scope episode parsing immediately after its existing embed patch.
  const spliceMarker = "  source = source.slice(0, start) + replacement + source.slice(end);";
  if (!source.includes(spliceMarker)) return "";
  source = source.replace(
    spliceMarker,
    spliceMarker + "\n  source = __wcoInjectEpisodeScope(source);\n  if (!source) return \"\";"
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
