"use strict";

/*
 * Limitless 123Anime NEXT 2.0.0-alpha.2
 * Runtime wrapper around the immutable alpha.1 aggregator core.
 *
 * alpha.2 fixes the Nuvio HLS handoff without changing the new identity,
 * season/cour, mirror, or multi-source aggregation logic.
 *
 * Nuvio's local-plugin bridge currently drops LocalScraperResult.type before
 * playback, so an extensionless child HLS playlist can be treated as a
 * progressive file and appear as a 1-second video. The alpha.1 core is patched
 * in memory so that when a valid .m3u8 master points at an extensionless child,
 * NEXT returns the original master playlist URL and lets ExoPlayer choose the
 * variant itself. This keeps an unmistakable HLS URL all the way to playback.
 */

const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/8cd3f91b0b671cf84eaded086d84cea610ecd6f8/providers/123anime-next.js";
const NAME = "123Anime NEXT";
const VERSION = "2.0.0-alpha.2";
let corePromise = null;

function patchCoreSource(code) {
  const detectBefore = '  if (!url || !/\\.m3u8(?:$|[?#])/i.test(String(url))) return fallback;';
  const detectAfter = '  if (!url || !/m3u8/i.test(String(url))) return fallback;';

  const selectBefore = [
    '  variants.sort((a, b) => b.height - a.height);',
    '  return { url: variants[0].url || url, quality: variants[0].height ? `${variants[0].height}p` : fallback.quality };'
  ].join('\n');

  const selectAfter = [
    '  variants.sort((a, b) => b.height - a.height);',
    '  const best = variants[0];',
    '  const child = best.url || url;',
    '  // Nuvio local-plugin streams currently lose their explicit type field.',
    '  // If the selected child is extensionless, keep the original .m3u8 master',
    '  // so the player unmistakably recognizes HLS and performs variant selection.',
    '  const playable = /\\.m3u8(?:$|[?#])/i.test(child) ? child : (/\\.m3u8(?:$|[?#])/i.test(url) ? url : child);',
    '  return { url: playable, quality: best.height ? `${best.height}p` : fallback.quality };'
  ].join('\n');

  let patched = code;
  if (!patched.includes(detectBefore)) throw new Error("NEXT core HLS detector patch point not found");
  patched = patched.replace(detectBefore, detectAfter);

  if (!patched.includes(selectBefore)) throw new Error("NEXT core HLS selector patch point not found");
  patched = patched.replace(selectBefore, selectAfter);

  return patched;
}

async function loadCore() {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    const response = await fetch(CORE_URL, {
      headers: {
        "User-Agent": "NuvioTV/1.0",
        "Accept": "text/plain,*/*"
      }
    });
    if (!response || !response.ok) {
      throw new Error(`Failed to load NEXT core: HTTP ${response ? response.status : "?"}`);
    }

    const rawCode = await response.text();
    if (!rawCode || !rawCode.includes("123Anime NEXT 2.0.0-alpha.1")) {
      throw new Error("Unexpected NEXT core payload");
    }
    const code = patchCoreSource(rawCode);

    const childModule = { exports: {} };
    const loader = new Function(
      "module",
      "exports",
      "require",
      `${code}\n;return module.exports;`
    );
    const exported = loader(childModule, childModule.exports, require) || childModule.exports;
    if (!exported || typeof exported.getStreams !== "function") {
      throw new Error("NEXT core did not export getStreams");
    }
    return exported;
  })();
  return corePromise;
}

function preserveHlsMetadata(stream) {
  if (!stream || !stream.url) return stream;
  const url = String(stream.url);
  const name = String(stream.name || "");
  const explicitMp4 = /\.mp4(?:$|[?#])/i.test(url);
  const hlsExtractorVariant = /(?:^|\s)(?:JW|Legacy|SBv2)(?:$|\s)/i.test(name);
  if (!explicitMp4 && hlsExtractorVariant) return { ...stream, type: "m3u8" };
  return stream;
}

async function getStreams(inputId, type = "tv", season = 1, episode = 1) {
  try {
    const core = await loadCore();
    const streams = await core.getStreams(inputId, type, season, episode);
    const fixed = Array.isArray(streams) ? streams.map(preserveHlsMetadata) : [];
    console.log(`[${NAME}] v${VERSION} verified HLS handoff for ${fixed.length} stream(s)`);
    return fixed;
  } catch (e) {
    console.log(`[${NAME}] v${VERSION} wrapper error: ${e && e.message ? e.message : e}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
