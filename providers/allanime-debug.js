"use strict";

const NAME = "AllAnime DEBUG";
const BASE_PROVIDER_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/Limitless-Nuviotest/providers/allanime.js";

function debugRow(message, index) {
  const text = String(message || "No diagnostic message").slice(0, 500);
  return {
    name: NAME + " " + (index + 1),
    title: text,
    url: "https://example.invalid/allanime-debug/" + (index + 1),
    quality: "DEBUG",
    provider: NAME,
    type: "mp4",
    language: "Debug"
  };
}

async function getStreams(inputId, type, season, episode) {
  const logs = [];
  const originalLog = console.log;
  console.log = function () {
    const parts = Array.prototype.slice.call(arguments).map(function (x) {
      try { return typeof x === "string" ? x : JSON.stringify(x); }
      catch (_) { return String(x); }
    });
    logs.push(parts.join(" "));
    try { originalLog.apply(console, arguments); } catch (_) {}
  };

  try {
    const response = await fetch(BASE_PROVIDER_URL + "?debug=" + Date.now(), { headers: { "Accept": "text/plain,*/*" } });
    if (!response || !response.ok) return [debugRow("DEBUG LOADER: failed to fetch AllAnime base provider HTTP " + (response ? response.status : "?"), 0)];
    const code = await response.text();
    const innerModule = { exports: {} };
    const innerExports = innerModule.exports;
    const factory = new Function("module", "exports", code + "\n;return module.exports;");
    const exported = factory(innerModule, innerExports) || innerModule.exports;
    if (!exported || typeof exported.getStreams !== "function") return [debugRow("DEBUG LOADER: base provider did not export getStreams", 0)];

    const streams = await exported.getStreams(inputId, type, season, episode);
    if (Array.isArray(streams) && streams.length) {
      return [debugRow("SUCCESS: base AllAnime returned " + streams.length + " playable stream(s)", 0)].concat(logs.slice(-6).map(debugRow));
    }

    if (!logs.length) return [debugRow("EMPTY: AllAnime returned zero streams and emitted no stage logs", 0)];
    return logs.slice(-8).map(debugRow);
  } catch (err) {
    logs.push("WRAPPER ERROR: " + (err && err.message ? err.message : err));
    return logs.slice(-8).map(debugRow);
  } finally {
    console.log = originalLog;
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { name: NAME, getStreams: getStreams };
else globalThis.getStreams = getStreams;
