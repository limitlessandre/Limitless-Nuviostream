"use strict";

// Anikoto Diagnostic v0.1.1 wrapper.
// Extends v0.1.0 with visible base64/AES-CBC decryption diagnostics.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-diagnostic.js";
let cached = null;

function patchSource(source) {
  let src = String(source || "");
  const helperMarker = "async function loadIdentity(out) {";
  const helperAt = src.indexOf(helperMarker);
  if (helperAt < 0) return null;

  const helpers = `function diagnosticBase64UrlBytes(value) {
  try {
    const input = String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/\\s+/g, "")
      .replace(/=+$/g, "");
    if (!input) return null;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const out = [];
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < input.length; i++) {
      const n = alphabet.indexOf(input.charAt(i));
      if (n < 0) return null;
      acc = (acc << 6) | n;
      bits += 6;
      while (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 255);
        acc = bits ? (acc & ((1 << bits) - 1)) : 0;
      }
    }
    return new Uint8Array(out);
  } catch (_) {
    return null;
  }
}

async function diagnosticDecryptEnc(token) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  const prefix = "i?LMTAx0Q6,:}50U";
  const iv = new Uint8Array([87,48,59,50,55,84,111,97,85,112,108,95,80,37,39,99]);
  const bytes = diagnosticBase64UrlBytes(token);
  const parts = [
    "subtle=" + (subtle ? "yes" : "no"),
    "atob=" + (typeof atob === "function" ? "yes" : "no"),
    "TextDecoder=" + (typeof TextDecoder !== "undefined" ? "yes" : "no"),
    "cipherBytes=" + (bytes ? bytes.length : 0),
    "mod16=" + (bytes ? bytes.length % 16 : "-")
  ];
  if (!subtle) return parts.join(" • ") + " • result=NO-SUBTLE";
  if (!bytes) return parts.join(" • ") + " • result=BASE64-FAIL";
  try {
    const keyBytes = new Uint8Array(32);
    for (let i = 0; i < prefix.length; i++) keyBytes[i] = prefix.charCodeAt(i);
    const key = await subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    const plain = new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv: iv }, key, bytes));
    let text = "";
    if (typeof TextDecoder !== "undefined") text = new TextDecoder().decode(plain);
    else {
      for (let i = 0; i < plain.length; i++) text += String.fromCharCode(plain[i]);
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) {}
    let host = "none";
    if (parsed && parsed.file) {
      try { host = new URL(String(parsed.file)).hostname || "none"; } catch (_) { host = "invalid-url"; }
    }
    return parts.join(" • ") + " • plainBytes=" + plain.length + " • json=" + (parsed ? "yes" : "no") + " • file=" + (parsed && parsed.file ? "yes" : "no") + " • host=" + host;
  } catch (err) {
    return parts.join(" • ") + " • AES-ERROR=" + String(err && (err.name || err.message || err));
  }
}

`;

  src = src.slice(0, helperAt) + helpers + src.slice(helperAt);

  const returnMarker = "  return { sourceId, sourceOk: !!payload, payload };";
  const returnAt = src.indexOf(returnMarker);
  if (returnAt < 0) return null;
  const injection = `  if (payload && payload.enc) {
    const decryptDetail = await diagnosticDecryptEnc(payload.enc);
    out.push(diag("DECRYPT " + candidate.kind + " " + mode.toUpperCase(), decryptDetail));
  }
`;
  src = src.slice(0, returnAt) + injection + src.slice(returnAt);
  return src;
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
