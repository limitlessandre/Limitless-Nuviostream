"use strict";
// v5 identity/title/episode/AES logic is retained; replace only source extraction.
const ROOT = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/";
let cached;
async function boundedText(url) {
  let timer;
  try {
    const work = Promise.resolve().then(async () => {
      const r = await fetch(url, {skipSizeCheck: true}); return r && r.ok ? String(await r.text()) : "";
    });
    return typeof setTimeout === "function" ? await Promise.race([work, new Promise(resolve => {timer = setTimeout(() => resolve(""), 10000);})]) : await work;
  } finally { if (timer !== undefined && typeof clearTimeout === "function") clearTimeout(timer); }
}
function patchSource(source, extractor) {
  source = source.replace(/\r\n/g, "\n");
  source = source.replace("async function requestText(url, options) {", "async function rawRequestText(url, options) {");
  source += `
async function requestText(url, options) {
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") return rawRequestText(url, options);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  try {
    const deadline = new Promise(resolve => { timer = setTimeout(() => { resolve(""); if (controller) controller.abort(); }, 8000); });
    return await Promise.race([deadline, Promise.resolve().then(() => rawRequestText(url, {...options, ...(controller ? {signal:controller.signal} : {})}))]);
  } finally {clearTimeout(timer);}
}
`;
  const start = source.indexOf("async function resolveMode(identity, episode, mode) {");
  const end = source.indexOf("\n\nfunction row(identity, season, requestedEpisode, mode, resolved) {", start);
  if (start < 0 || end < 0 || !extractor.includes("function createAniKotoSources")) throw new Error("AniKoto base changed");
  let result = source.slice(0, start) + extractor + '\nconst aniSources = createAniKotoSources({requestText, requestJson, aliases, parseSearch, normalize, directCandidates, catalogCandidates, decryptEnc, ua: UA});\nasync function resolveMode(identity, episode, mode) { return aniSources.resolveMode(identity, episode, mode); }\n' + source.slice(end);
  result = result.replace('if (dub) out.push(row(identity, season, requestedEpisode, "dub", dub));', 'for (const item of dub || []) out.push(row(identity, season, requestedEpisode, "dub", item));')
    .replace('if (sub) out.push(row(identity, season, requestedEpisode, "sub", sub));', 'for (const item of sub || []) out.push(row(identity, season, requestedEpisode, "sub", item));')
    .replace('quality:"Auto",', 'quality:resolved.quality || "Auto",\n    anikotoSource:{embed:resolved.embed, mode},')
    .replace('" • Auto • " + audio', '" • " + (resolved.quality || "Auto") + " • " + audio');
  return result;
}
async function loadBase() {
  if (!cached) cached = (async () => {
    const [base, extractor] = await Promise.all([boundedText(ROOT + "anikototv-nexus-v5.js"), boundedText(ROOT + "anikoto-sources.js?rev=208")]);
    const mod = {exports: {}};
    return new Function("module", "exports", "require", patchSource(base, extractor) + "\nreturn module.exports;")(mod, mod.exports, () => {throw new Error("Unsupported require");});
  })().catch(error => {cached = null; console.log("[AniKoto] " + error.message); return null;});
  return cached;
}
async function getStreams(...args) { const base = await loadBase(); return base ? base.getStreams(...args) : []; }
if (typeof module !== "undefined" && module.exports) module.exports = {getStreams, patchSource};
else globalThis.getStreams = getStreams;
