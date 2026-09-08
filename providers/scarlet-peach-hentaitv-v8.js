"use strict";

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/scarlet-peach-providers/providers/scarlet-peach-hentaitv-v7.js";
let cached = null;

function diag(detail) {
  const text = String(detail || "Scarlet Peach HentaiTV wrapper failure");
  return [{
    name: `Scarlet Peach - HentaiTV • DIAG WRAPPER • ${text}`,
    title: text,
    url: "https://hentai.tv/favicon.ico",
    quality: "DIAG",
    language: "Unavailable",
    provider: "Scarlet Peach - HentaiTV",
    type: "mp4",
    subtitles: []
  }];
}

function patchSource(source) {
  let out = String(source || "");

  out = out.replace(
    'async function getInputMeta(inputId,mediaType){const raw=clean(inputId);if(/^(mal|anilist|sp):/i.test(raw))return getScarletMeta(raw);if(/^(tmdb:)?\\d+$/i.test(raw)||/^tt\\d+$/i.test(raw))return getTmdbMeta(raw,mediaType);return null;}',
    'function baseMediaId(inputId){const raw=clean(inputId);if(/^(?:mal|anilist):\\d+:\\d+$/i.test(raw))return raw.replace(/:\\d+$/i,"");if(/^sp:[^:]+:\\d+$/i.test(raw))return raw.replace(/:\\d+$/i,"");if(/^tmdb:\\d+:\\d+$/i.test(raw))return raw.replace(/:\\d+$/i,"");if(/^tt\\d+:\\d+$/i.test(raw))return raw.replace(/:\\d+$/i,"");if(/^\\d+:\\d+$/i.test(raw))return raw.replace(/:\\d+$/i,"");return raw;}\nfunction episodeFromInputId(inputId){const raw=clean(inputId);const m=raw.match(/:(\\d+)$/);return m?Number(m[1]):null;}\nasync function getInputMeta(inputId,mediaType){const raw=baseMediaId(inputId);if(/^(mal|anilist|sp):/i.test(raw))return getScarletMeta(raw);if(/^(tmdb:)?\\d+$/i.test(raw)||/^tt\\d+$/i.test(raw))return getTmdbMeta(raw,mediaType);return null;}'
  );

  out = out.replace(
    'async function getStreams(inputId,mediaType,season,episode){try{const ep=Number(episode)>0?Number(episode):1;const raw=clean(inputId);',
    'async function getStreams(inputId,mediaType,season,episode){try{const raw=clean(inputId);const ep=Number(episode)>0?Number(episode):(episodeFromInputId(raw)||1);'
  );

  out = out.replace(
    'const iframeMatch=String(mainHtml||"").match(/src=["\'](https:\\/\\/nhplayer\\.com\\/v\\/[^"\']+)["\']/i);if(!iframeMatch)return{urls:[],diag:"nh=absent"};const iframeUrl=decodeHtml(iframeMatch[1]);',
    'const iframeMatch=String(mainHtml||"").match(/src=["\']((?:https?:)?\\/\\/nhplayer\\.com\\/v\\/[^"\']+|\\/v\\/[^"\']+)["\']/i)||String(mainHtml||"").match(/((?:https?:)?\\/\\/nhplayer\\.com\\/v\\/[^"\'<>\\s]+)/i);if(!iframeMatch)return{urls:[],diag:"nh=absent"};let iframeUrl=decodeHtml(iframeMatch[1]);if(/^\\/\\//.test(iframeUrl))iframeUrl="https:"+iframeUrl;else if(/^\\/v\\//.test(iframeUrl))iframeUrl=NH_BASE+iframeUrl;'
  );

  if (!out.includes("function baseMediaId") || !out.includes("episodeFromInputId") || !out.includes("nh=absent")) return null;
  return out;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = patchSource(await response.text());
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return diag("unable to load normalized v7 provider");
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows : diag("provider returned non-array result");
  } catch (error) {
    return diag(error && error.message ? error.message : error);
  }
}

module.exports = { getStreams };
