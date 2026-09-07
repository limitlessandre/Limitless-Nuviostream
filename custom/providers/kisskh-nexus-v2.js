"use strict";

// KissKH Nexus test wrapper v0.1.2
// Uses the current Sep 2026 KissKH API/kkey implementation from kisskh-nexus.js.
// Search now mirrors Yuzono's maintained request shape by including type=0,
// while retaining strict exact title acceptance and punctuation-tolerant discovery.
// kisskh.at is intentionally excluded from API probing because it is not part of
// either current maintained streaming implementation and returned non-array data.

const PROVIDER_NAME = "KissKH Test";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/kisskh-nexus.js";
let cached = null;

function patchSource(source) {
  let src = String(source || "");

  const start = src.indexOf("async function findMatch(meta) {");
  const end = src.indexOf("\nasync function getDetail(base, dramaId) {", start);
  if (start < 0 || end < 0) return null;

  const replacement = `async function findMatch(meta) {
  const failures = [];
  const queryTerms = [];
  const pushTerm = value => {
    const q = clean(value);
    if (q && !queryTerms.includes(q)) queryTerms.push(q);
  };

  for (const alias of meta.aliases || []) {
    pushTerm(alias);
    if (queryTerms.length >= 5) break;
  }

  const seedTerms = queryTerms.slice();
  for (const term of seedTerms) {
    pushTerm(term.replace(/[-‐‑‒–—]+/g, " ").replace(/\\s+/g, " ").trim());
    pushTerm(term.replace(/[-‐‑‒–—]+/g, "").replace(/\\s+/g, " ").trim());
  }
  if (/kamen\\s+rider\\s+den[-\\s]?o/i.test(meta.title || "")) {
    pushTerm("Kamen Rider");
    pushTerm("Kamen Rider Den O");
    pushTerm("Kamen Rider DenO");
    pushTerm("Den-O");
  }

  const liveDomains = [
    "https://kisskh.is",
    "https://kisskh.ovh",
    "https://kisskh.do",
    "https://kisskh.co",
    "https://kisskh.id",
    "https://kisskh.la",
    "https://kisskh.nl"
  ];

  for (const base of liveDomains) {
    let reachable = false;
    let best = null;
    let bestScore = -1;
    let candidateCount = 0;
    const samples = [];
    const queryNotes = [];

    for (const term of queryTerms.slice(0, 10)) {
      // Yuzono's maintained Sep 2026 implementation uses &type=0 on search.
      const url = base + "/api/DramaList/Search?q=" + encodeURIComponent(term) + "&type=0";
      const r = await requestJson(url, base + "/", base);
      if (!r.ok || !Array.isArray(r.data)) {
        queryNotes.push(term + "=" + (r.error || ("HTTP " + (r.status || "ERR"))));
        continue;
      }

      reachable = true;
      candidateCount += r.data.length;
      const localSamples = [];
      for (const item of r.data) {
        const title = clean(item && item.title);
        if (title && !samples.includes(title) && samples.length < 6) samples.push(title);
        if (title && localSamples.length < 2) localSamples.push(title);
        const score = exactCandidateScore(item, meta);
        if (score > bestScore) { bestScore = score; best = item; }
      }
      queryNotes.push(term + "→" + r.data.length + (localSamples.length ? "[" + localSamples.join(" | ") + "]" : ""));
      if (bestScore >= 100) break;
    }

    if (reachable && best && bestScore >= 100) {
      return { base, item: best, score: bestScore, candidateCount, failures };
    }

    if (reachable) {
      failures.push(base.replace(/^https?:\\/\\//, "") + "=no-exact • " + queryNotes.slice(0, 4).join(" • ") + (samples.length ? " • samples=" + samples.join(" | ") : ""));
    } else {
      failures.push(base.replace(/^https?:\\/\\//, "") + "=" + (queryNotes.slice(0, 3).join(" • ") || "unreachable"));
    }
  }
  return { base: "", item: null, score: -1, candidateCount: 0, failures };
}
`;

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
  } catch (_) { return null; }
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
