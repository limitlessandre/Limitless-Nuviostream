"use strict";

// 123MoviesFree Nexus placeholder v0.0.1
// Reserved as a separate provider because 123moviesfree.net uses a different
// catalog/season/server architecture from the TMDB-native 123MoviesIN family.

const PROVIDER_NAME = "123MoviesFree";
const ORIGIN = "https://123moviesfree.net";

function getStreams() {
  return [{
    name: `${PROVIDER_NAME} • INFO • Placeholder`,
    title: "Reserved for the separate 123MoviesFree movie/season/server architecture. Active development starts with 123MoviesIN first.",
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
