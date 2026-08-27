"use strict";

/*
 * Limitless 123Anime NEXT 2.0.0-alpha.4
 * Runtime wrapper around the immutable alpha.1 aggregator core.
 *
 * alpha.2 fixed the Nuvio HLS handoff for extensionless child playlists.
 * alpha.3 keeps that fix and tightens candidate aggregation so each source can
 * contribute only its highest-ranked card per audio mode (DUB/SUB/MIXED).
 * alpha.4 adds deep HLS health validation for HARDSUB results. A master playlist
 * is not considered playable until at least one media playlist beneath it can be
 * fetched and contains actual media segments. Dead/stale subtitle sources are
 * filtered instead of being returned to Nuvio as an endless-loading stream.
 */

const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/8cd3f91b0b671cf84eaded086d84cea610ecd6f8/providers/123anime-next.js";
const NAME = "123Anime NEXT";
const VERSION = "2.0.0-alpha.4";
let corePromise = null;

function patchCoreSource(code) {
  const detectBefore = '  if (!url || !/\\.m3u8(?:$|[?#])/i.test(String(url))) return fallback;';
  const detectAfter = '  if (!url || !/m3u8/i.test(String(url))) return fallback;';

  const selectBefore = [
    '  variants.sort((a, b) => b.height - a.height);',
    '  return { url: variants[0].url || url, quality: variants[0].height ? `${variants[0].height}p` : fallback.quality };'
  ].join('\n');

  const selectAfter = [
    '  variants.sort((a, b) => b.height - a.height);',
    '  const best = variants[0];',
    '  const child = best.url || url;',
    '  // Nuvio local-plugin streams currently lose their explicit type field.',
    '  // If the selected child is extensionless, keep the original .m3u8 master',
    '  // so the player unmistakably recognizes HLS and performs variant selection.',
    '  const playable = /\\.m3u8(?:$|[?#])/i.test(child) ? child : (/\\.m3u8(?:$|[?#])/i.test(url) ? url : child);',
    '  return { url: playable, quality: best.height ? `${best.height}p` : fallback.quality };'
  ].join('\n');

  const candidateBefore = [
    '  const selected = [];',
    '  const counts = new Map();',
    '  for (const item of ranked) {',
    '    const count = counts.get(item.source.id) || 0;',
    '    if (count >= 2) continue;',
    '    selected.push(item); counts.set(item.source.id, count + 1);',
    '    if (selected.length >= MAX_CANDIDATES) break;',
    '  }',
    '  if (selected.length < MAX_CANDIDATES) {',
    '    for (const item of ranked) {',
    '      if (selected.includes(item)) continue;',
    '      selected.push(item);',
    '      if (selected.length >= MAX_CANDIDATES) break;',
    '    }',
    '  }',
    '  return selected;'
  ].join('\n');

  const candidateAfter = [
    '  const selected = [];',
    '  const sourceModeBuckets = new Set();',
    '  for (const item of ranked) {',
    '    // ranked is already best-first. Keep only the strongest identity card',
    '    // from each source for each audio-mode family. Legacy 123Anime uses',
    '    // separate SUB/DUB cards; Aniwaves uses one MIXED card.',
    '    const mode = item.adapter === "aniwaves" ? "mixed" : String(item.mode || "mixed").toLowerCase();',
    '    const bucket = `${item.source.id}|${mode}`;',
    '    if (sourceModeBuckets.has(bucket)) continue;',
    '    sourceModeBuckets.add(bucket);',
    '    selected.push(item);',
    '    if (selected.length >= MAX_CANDIDATES) break;',
    '  }',
    '  return selected;'
  ].join('\n');

  let patched = code;
  if (!patched.includes(detectBefore)) throw new Error("NEXT core HLS detector patch point not found");
  patched = patched.replace(detectBefore, detectAfter);

  if (!patched.includes(selectBefore)) throw new Error("NEXT core HLS selector patch point not found");
  patched = patched.replace(selectBefore, selectAfter);

  if (!patched.includes(candidateBefore)) throw new Error("NEXT core candidate selector patch point not found");
  patched = patched.replace(candidateBefore, candidateAfter);

  return patched;
}

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

    const rawCode = await response.text();
    if (!rawCode || !rawCode.includes("123Anime NEXT 2.0.0-alpha.1")) {
      throw new Error("Unexpected NEXT core payload");
    }
    const code = patchCoreSource(rawCode);

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

function preserveHlsMetadata(stream) {
  if (!stream || !stream.url) return stream;
  const url = String(stream.url);
  const name = String(stream.name || "");
  const explicitMp4 = /\.mp4(?:$|[?#])/i.test(url);
  const hlsExtractorVariant = /(?:^|\s)(?:JW|Legacy|SBv2)(?:$|\s)/i.test(name);
  if (!explicitMp4 && hlsExtractorVariant) return { ...stream, type: "m3u8" };
  return stream;
}

function isHardSubStream(stream) {
  return !!stream && /\[HARDSUB(?:\+SUBS)?\]/i.test(String(stream.name || ""));
}

function playlistLines(body) {
  return String(body || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function hasMediaSegments(lines) {
  let hasExtinf = false;
  let hasUri = false;
  for (const line of lines || []) {
    if (line.startsWith("#EXTINF:")) hasExtinf = true;
    else if (line && !line.startsWith("#")) hasUri = true;
  }
  return hasExtinf && hasUri;
}

function variantUrls(lines, baseUrl) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < (lines || []).length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith("#")) continue;
      let resolved = null;
      try { resolved = new URL(lines[j], baseUrl).toString(); } catch (_) {}
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        out.push(resolved);
      }
      break;
    }
  }
  return out;
}

async function fetchPlaylist(url, headers, timeout = 8000) {
  try {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(timeout)
      : undefined;
    const response = await fetch(url, {
      headers: { ...(headers || {}) },
      redirect: "follow",
      signal,
      skipSizeCheck: true
    });
    if (!response || !response.ok) return null;
    const body = await response.text();
    if (!body || !body.trimStart().startsWith("#EXTM3U")) return null;
    return {
      url: response.url || url,
      lines: playlistLines(body)
    };
  } catch (_) {
    return null;
  }
}

async function validateHlsUrl(url, headers, depth = 0) {
  if (!url || depth > 2) return false;
  const playlist = await fetchPlaylist(url, headers);
  if (!playlist) return false;
  if (hasMediaSegments(playlist.lines)) return true;

  const variants = variantUrls(playlist.lines, playlist.url || url).slice(0, 4);
  if (!variants.length) return false;

  for (const child of variants) {
    if (await validateHlsUrl(child, headers, depth + 1)) return true;
  }
  return false;
}

async function filterDeadHardSubs(streams) {
  const health = new Map();
  const checks = (streams || []).map(async stream => {
    if (!isHardSubStream(stream) || !stream.url) return stream;
    const key = `${stream.url}|${JSON.stringify(stream.headers || {})}`;
    let promise = health.get(key);
    if (!promise) {
      promise = validateHlsUrl(stream.url, stream.headers || {});
      health.set(key, promise);
    }
    const ok = await promise;
    if (!ok) {
      console.log(`[${NAME}] dropping dead HARDSUB source: ${stream.name || stream.url}`);
      return null;
    }
    return stream;
  });
  const settled = await Promise.allSettled(checks);
  return settled.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
}

async function getStreams(inputId, type = "tv", season = 1, episode = 1) {
  try {
    const core = await loadCore();
    const streams = await core.getStreams(inputId, type, season, episode);
    const fixed = Array.isArray(streams) ? streams.map(preserveHlsMetadata) : [];
    const healthy = await filterDeadHardSubs(fixed);
    console.log(`[${NAME}] v${VERSION} candidate-dedup + HLS health verified ${healthy.length}/${fixed.length} stream(s)`);
    return healthy;
  } catch (e) {
    console.log(`[${NAME}] v${VERSION} wrapper error: ${e && e.message ? e.message : e}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
