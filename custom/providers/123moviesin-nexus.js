"use strict";

// 123MoviesIN placeholder v0.1.2
// Live Nuvio probing confirmed the TMDB-native title routes are reachable, but the
// apparent player candidates were lazy-loaded image URLs (for example i1.wp.com).
// The current site also presents itself as a streaming guide rather than a direct
// playback source. Keep this provider as a lightweight placeholder while active
// development moves to the separate 123MoviesFree architecture.

const PROVIDER_NAME = "123MoviesIN";
const ORIGIN = "https://123moviesin.com";

function getStreams() {
  return [{
    name: `${PROVIDER_NAME} • INFO • Catalog/Guide Placeholder`,
    title: "TMDB-native catalog routes are reachable, but no distinct embedded playback source was confirmed. Active Nexus development has moved to 123MoviesFree.",
    url: `${ORIGIN}/favicon.ico`,
    quality: "INFO",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  }];
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
