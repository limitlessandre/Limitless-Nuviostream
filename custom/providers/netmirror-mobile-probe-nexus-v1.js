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

function visibleDiagnostics(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !String(row.name || "").includes("• DIAG")) {
      out.push(row);
      continue;
    }

    const detail = String(row.title || "").trim();
    if (!detail) {
      out.push(row);
      continue;
    }

    // Nuvio's source picker does not surface the row title for diagnostic cards,
    // so promote the diagnostic payload into the visible stream name. Split long
    // payloads into compact chunks so keys/metadata can be read directly.
    const chunks = [];
    for (let i = 0; i < detail.length; i += 135) chunks.push(detail.slice(i, i + 135));

    chunks.slice(0, 6).forEach((chunk, index) => {
      out.push({
        ...row,
        name: "NetMirror Mobile Probe • " + (index ? "CONT " + (index + 1) + " • " : "") + chunk,
        title: "NetMirror Mobile Probe diagnostic",
        quality: "DIAG"
      });
    });
  }
  return out.slice(0, 24);
}

async function getStreams(inputId, mediaType, season, episode) {
  const base = await loadBase();
  if (!base) return [];
  try {
    return visibleDiagnostics(await base.getStreams(inputId, mediaType, season, episode));
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
