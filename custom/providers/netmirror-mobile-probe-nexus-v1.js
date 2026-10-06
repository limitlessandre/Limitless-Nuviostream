"use strict";

// Nexus test wrapper for the NetMirror Mobile Probe.
// The diagnostic implementation remains isolated in Provider Lab while this
// wrapper exposes it through the active Nexus manifest for testing.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-Provider-Lab/providers/netmirror-mobile-probe.js";
let cached = null;

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    const module = { exports: {} };
    const factory = new Function(
      "module",
      "exports",
      "require",
      source + "\n;return { moduleExports: module.exports, localGetStreams: (typeof getStreams === 'function' ? getStreams : null) };"
    );
    const captured = factory(module, module.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    });
    const exported = captured && captured.moduleExports && typeof captured.moduleExports.getStreams === "function"
      ? captured.moduleExports
      : (captured && typeof captured.localGetStreams === "function"
        ? { getStreams: captured.localGetStreams }
        : module.exports);
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
  try {
    return await base.getStreams(inputId, mediaType, season, episode);
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
