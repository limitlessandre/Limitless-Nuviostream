"use strict";

/*
 * Limitless 123Anime NEXT 2.0.0-alpha.2
 * Runtime wrapper around the immutable alpha.1 aggregator core.
 *
 * alpha.2 fixes the Nuvio HLS handoff for extensionless child playlists.
 * Some 123Anime/EchoVideo master playlists point at a variant URL that does
 * not end in .m3u8. The alpha.1 core correctly resolved the HLS child but then
 * inferred type=mp4 from the extensionless URL. Nuvio consequently opened the
 * playlist as a file and reported a 1-second duration.
 *
 * The identity, season/cour, multi-source, mirror, and extraction logic remains
 * byte-for-byte alpha.1 and is loaded from its immutable Git commit below.
 */

const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/8cd3f91b0b671cf84eaded086d84cea610ecd6f8/providers/123anime-next.js";
const NAME = "123Anime NEXT";
const VERSION = "2.0.0-alpha.2";
let corePromise = null;

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

    const code = await response.text();
    if (!code || !code.includes("123Anime NEXT 2.0.0-alpha.1")) {
      throw new Error("Unexpected NEXT core payload");
    }

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

function fixNuvioHlsType(stream) {
  if (!stream || !stream.url) return stream;

  const url = String(stream.url);
  const name = String(stream.name || "");
  const explicitMp4 = /\.mp4(?:$|[?#])/i.test(url);
  const hlsExtractorVariant = /(?:^|\s)(?:JW|Legacy|SBv2)(?:$|\s)/i.test(name);

  // The alpha.1 resolver can choose an extensionless child URI from an HLS
  // master playlist. Those JW/Legacy/SBv2 outputs are still HLS even when the
  // selected URI has no filename extension. Preserve real .mp4 links.
  if (!explicitMp4 && hlsExtractorVariant) {
    return { ...stream, type: "m3u8" };
  }

  return stream;
}

async function getStreams(inputId, type = "tv", season = 1, episode = 1) {
  try {
    const core = await loadCore();
    const streams = await core.getStreams(inputId, type, season, episode);
    const fixed = Array.isArray(streams) ? streams.map(fixNuvioHlsType) : [];
    console.log(`[${NAME}] v${VERSION} HLS handoff fixed ${fixed.length} stream(s)`);
    return fixed;
  } catch (e) {
    console.log(`[${NAME}] v${VERSION} wrapper error: ${e && e.message ? e.message : e}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
