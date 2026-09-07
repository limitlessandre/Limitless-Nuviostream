"use strict";

// KissKH Nexus test wrapper v0.1.1
// Keeps the current Sep 2026 KissKH API/kkey implementation from kisskh-nexus.js,
// but adds the currently indexed kisskh.at catalog origin and safer query expansion.
// Candidate acceptance remains strict: punctuation-normalized searches may discover
// a title, but only an exact normalized title identity can be selected.

const PROVIDER_NAME = "KissKH Test";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/kisskh-nexus.js";
let cached = null;

function patchSource(source) {
  let src = String(source || "");

  const oldDomains = `const DOMAINS = [\n  "https://kisskh.is",\n  "https://kisskh.ovh",\n  "https://kisskh.do",\n  "https://kisskh.co",\n  "https://kisskh.id",\n  "https://kisskh.la",\n  "https://kisskh.nl"\n];`;
  const newDomains = `const DOMAINS = [\n  "https://kisskh.at",\n  "https://kisskh.is",\n  "https://kisskh.ovh",\n  "https://kisskh.do",\n  "https://kisskh.co",\n  "https://kisskh.id",\n  "https://kisskh.la",\n  "https://kisskh.nl"\n];`;
  if (src.includes(oldDomains)) src = src.replace(oldDomains, newDomains);

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

  // Search APIs can be punctuation-sensitive even when catalog identity is not.
  // Broaden discovery only; exactCandidateScore still gates final selection.
  const seedTerms = queryTerms.slice();
  for (const term of seedTerms) {
    pushTerm(term.replace(/[-‐‑‒–—]+/g, " ").replace(/\\s+/g, " ").trim());
    pushTerm(term.replace(/[-‐‑‒–—]+/g, "").replace(/\\s+/g, " ").trim());
  }
  if (/kamen\\s+rider\\s+den[-\\s]?o/i.test(meta.title || "")) {
    pushTerm("Kamen Rider Den O");
    pushTerm("Kamen Rider DenO");
    pushTerm("Den-O");
  }

  for (const base of DOMAINS) {
    let reachable = false;
    let best = null;
    let bestScore = -1;
    let candidateCount = 0;
    const samples = [];

    for (const term of queryTerms.slice(0, 10)) {
      const url = base + "/api/DramaList/Search?q=" + encodeURIComponent(term);
      const r = await requestJson(url, base + "/", base);
      if (!r.ok || !Array.isArray(r.data)) {
        failures.push(base.replace(/^https?:\\/\\//, "") + "=" + (r.error || ("HTTP " + (r.status || "ERR"))));
        break;
      }
      reachable = true;
      candidateCount += r.data.length;
      for (const item of r.data) {
        const title = clean(item && item.title);
        if (title && !samples.includes(title) && samples.length < 4) samples.push(title);
        const score = exactCandidateScore(item, meta);
        if (score > bestScore) { bestScore = score; best = item; }
      }
      if (bestScore >= 100) break;
    }

    if (reachable && best && bestScore >= 100) {
      return { base, item: best, score: bestScore, candidateCount, failures };
    }
    if (reachable) {
      const sampleText = samples.length ? (" • samples=" + samples.join(" | ")) : "";
      failures.push(base.replace(/^https?:\\/\\//, "") + "=reachable-no-exact-match" + sampleText);
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
