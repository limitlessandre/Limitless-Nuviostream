"use strict";

// AnikotoTV Nexus v2.0.3 runtime-compatibility wrapper.
// Patches the v2.0.2 resolver so encrypted MegaPlay payloads do not depend on global atob.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-nexus-v3.js";
let cached = null;

function patchSource(source) {
  let src = String(source || "");
  const start = src.indexOf("function base64UrlBytes(value) {");
  const end = src.indexOf("\n\nasync function decryptEnc(token) {", start);
  if (start < 0 || end < 0) return null;

  const replacement = `function base64UrlBytes(value) {
  try {
    const input = String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/\\s+/g, "")
      .replace(/=+$/g, "");
    if (!input) return null;

    // Decode base64 directly instead of relying on browser atob, which is not
    // guaranteed to exist in Android / React-Native provider runtimes.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < input.length; i++) {
      const n = alphabet.indexOf(input.charAt(i));
      if (n < 0) return null;
      acc = (acc << 6) | n;
      bits += 6;
      while (bits >= 8) {
        bits -= 8;
        bytes.push((acc >> bits) & 255);
        acc = bits ? (acc & ((1 << bits) - 1)) : 0;
      }
    }
    return new Uint8Array(bytes);
  } catch (_) {
    return null;
  }
}`;

  return src.slice(0, start) + replacement + src.slice(end);
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const raw = String(await response.text() || "");
    const source = patchSource(raw);
    if (!source) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
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
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
