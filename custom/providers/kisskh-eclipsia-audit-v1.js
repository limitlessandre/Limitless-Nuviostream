"use strict";

// Temporary Nexus audit wrapper for Eclipsia v9.9.0 Fyron/KissKH.
// It does not alter the working provider. It records the upstream request flow,
// re-reads the final episode JSON, and inspects returned HLS masters so we can
// compare the working path with our earlier KissKH implementation.
const PROVIDER_NAME = "KissKH Audit";
const SOURCE_URL = "https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/providers/fyron.js";
const FALLBACK = "https://kisskh.is/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function clean(v) { return String(v == null ? "" : v).trim(); }
function short(v, n) { const s = clean(v).replace(/\s+/g, " "); const m = n || 180; return s.length > m ? s.slice(0, m - 1) + "…" : s; }
function hostOf(v) { try { return new URL(clean(v)).hostname || "?"; } catch (_) { return "?"; } }
function headersObject(value) {
  if (!value) return {};
  if (typeof value.forEach === "function") {
    const out = {}; try { value.forEach((v, k) => { out[k] = v; }); } catch (_) {} return out;
  }
  if (Array.isArray(value)) { const out = {}; for (const p of value) if (Array.isArray(p) && p.length >= 2) out[p[0]] = p[1]; return out; }
  return typeof value === "object" ? { ...value } : {};
}
function diag(label, detail) {
  return {
    name: `${PROVIDER_NAME} • ${label}${detail ? ` • ${short(detail, 210)}` : ""}`,
    title: clean(detail) || label,
    url: FALLBACK,
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function readUpstreamSource() {
  try {
    const r = await fetch(SOURCE_URL, { skipSizeCheck: true });
    if (!r || !r.ok) return { source: "", error: `HTTP ${r && r.status || "ERR"}` };
    return { source: String(await r.text() || ""), error: "" };
  } catch (e) { return { source: "", error: clean(e && e.message || e) || "fetch failed" }; }
}

function staticSummary(source) {
  const s = String(source || "");
  const urls = [];
  const re = /https?:\/\/[^\s"'`\\)]+/g;
  let m; while ((m = re.exec(s)) && urls.length < 16) if (!urls.includes(m[0])) urls.push(m[0]);
  const markers = [];
  if (/script\.google\.com/i.test(s)) markers.push("google-script");
  if (/kkey/i.test(s)) markers.push("kkey");
  if (/DramaList\/Episode/i.test(s)) markers.push("episode-api");
  if (/DramaList\/Search/i.test(s)) markers.push("search-api");
  if (/Video_tmp/i.test(s)) markers.push("Video_tmp");
  if (/ThirdParty/i.test(s)) markers.push("ThirdParty");
  if (/crypto|sha256|md5|aes/i.test(s)) markers.push("crypto-marker");
  return { bytes: s.length, markers, urls };
}

function buildModule(source, calls) {
  const realFetch = fetch;
  const tracedFetch = async function(input, init) {
    const url = clean(typeof input === "string" ? input : input && input.url);
    const opts = init || {};
    let response;
    try {
      response = await realFetch(input, init);
      calls.push({ url, status: Number(response && response.status || 0), ok: !!(response && response.ok), headers: headersObject(opts.headers) });
      return response;
    } catch (e) {
      calls.push({ url, status: 0, ok: false, error: clean(e && e.message || e), headers: headersObject(opts.headers) });
      throw e;
    }
  };

  const mod = { exports: {} };
  const factory = new Function("module", "exports", "require", "fetch", source + "\n;return { moduleExports: module.exports, localGetStreams: (typeof getStreams === 'function' ? getStreams : null) }; ");
  const captured = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }, tracedFetch);
  if (captured && captured.moduleExports && typeof captured.moduleExports.getStreams === "function") return captured.moduleExports;
  if (captured && typeof captured.localGetStreams === "function") return { getStreams: captured.localGetStreams };
  if (mod.exports && typeof mod.exports.getStreams === "function") return mod.exports;
  return null;
}

async function refetchJson(call) {
  if (!call || !call.url) return null;
  try {
    const r = await fetch(call.url, { headers: call.headers || {}, redirect: "follow", skipSizeCheck: true });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

function sourceFields(data) {
  const out = [];
  for (const key of ["Video", "Video_tmp", "ThirdParty", "video", "video_tmp", "thirdParty", "thirdparty"]) {
    const value = clean(data && data[key]);
    if (/^https?:\/\//i.test(value)) out.push({ key, url: value, host: hostOf(value) });
  }
  return out;
}

function parseMaster(text, baseUrl) {
  const body = String(text || "");
  if (!/#EXT-X-STREAM-INF/i.test(body)) return [];
  const lines = body.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (!/#EXT-X-STREAM-INF/i.test(line)) continue;
    const res = line.match(/RESOLUTION=\d+x(\d+)/i);
    const bw = line.match(/BANDWIDTH=(\d+)/i);
    let j = i + 1;
    while (j < lines.length && (!clean(lines[j]) || clean(lines[j]).startsWith("#"))) j++;
    if (j >= lines.length) continue;
    let url = clean(lines[j]);
    try { url = new URL(url, baseUrl).href; } catch (_) {}
    out.push({ height: res ? Number(res[1]) : 0, bandwidth: bw ? Number(bw[1]) : 0, url });
  }
  return out;
}

async function inspectPlaylist(url, headers) {
  try {
    const r = await fetch(url, { headers: headers || { "User-Agent": UA }, redirect: "follow", skipSizeCheck: true });
    if (!r || !r.ok) return { status: Number(r && r.status || 0), master: false, variants: [] };
    const text = String(await r.text() || "");
    const variants = parseMaster(text, url);
    return { status: Number(r.status || 200), master: variants.length > 0, variants, media: /#EXTINF/i.test(text) };
  } catch (_) { return { status: 0, master: false, variants: [] }; }
}

async function getStreams(inputId, mediaType, season, episode) {
  const loaded = await readUpstreamSource();
  if (!loaded.source) return [diag("SOURCE FAILED", loaded.error)];

  const rows = [];
  const stat = staticSummary(loaded.source);
  rows.push(diag("STATIC", `bytes=${stat.bytes} • markers=${stat.markers.join(",") || "none"}`));
  if (stat.urls.length) rows.push(diag("STATIC URLS", stat.urls.slice(0, 6).join(" | ")));

  const calls = [];
  let upstream;
  try { upstream = buildModule(loaded.source, calls); }
  catch (e) { return rows.concat(diag("LOAD FAILED", clean(e && e.message || e))); }
  if (!upstream) return rows.concat(diag("LOAD FAILED", "no getStreams export"));

  let upstreamRows = [];
  try {
    const result = await upstream.getStreams(inputId, mediaType, season, episode);
    upstreamRows = Array.isArray(result) ? result : [];
  } catch (e) {
    rows.push(diag("UPSTREAM ERROR", clean(e && e.message || e)));
  }

  const uniqueCalls = [];
  const seenCall = new Set();
  for (const c of calls) {
    if (!c.url || seenCall.has(c.url)) continue;
    seenCall.add(c.url); uniqueCalls.push(c);
  }
  rows.push(diag("FLOW", `calls=${calls.length} unique=${uniqueCalls.length} • ${uniqueCalls.slice(0, 8).map(c => `${c.status || "ERR"}:${short(c.url, 70)}`).join(" | ")}`));

  if (upstreamRows.length) {
    rows.push(diag("UPSTREAM ROWS", upstreamRows.slice(0, 8).map(r => `${clean(r.quality) || "?"}:${hostOf(r.url)}:${clean(r.name) || "unnamed"}:subs=${Array.isArray(r.subtitles) ? r.subtitles.length : 0}`).join(" | ")));
  } else rows.push(diag("UPSTREAM ROWS", "0"));

  const episodeCall = uniqueCalls.slice().reverse().find(c => /\/api\/DramaList\/Episode\//i.test(c.url) && /\.png(?:\?|$)/i.test(c.url));
  if (!episodeCall) {
    rows.push(diag("EPISODE API", "not observed"));
    return rows;
  }

  const data = await refetchJson(episodeCall);
  if (!data) {
    rows.push(diag("EPISODE JSON", `refetch failed • ${hostOf(episodeCall.url)}`));
    return rows;
  }

  const fields = sourceFields(data);
  const uniqueSources = [];
  const seenUrl = new Set();
  for (const f of fields) if (!seenUrl.has(f.url)) { seenUrl.add(f.url); uniqueSources.push(f); }
  rows.push(diag("SOURCES", `fields=${fields.map(f => `${f.key}=${f.host}`).join(",") || "none"} • unique=${uniqueSources.length}`));

  const rowHeaders = upstreamRows[0] && upstreamRows[0].headers ? upstreamRows[0].headers : episodeCall.headers;
  for (const f of uniqueSources.slice(0, 4)) {
    const info = await inspectPlaylist(f.url, rowHeaders);
    const heights = info.variants.map(v => v.height).filter(Boolean);
    rows.push(diag(`SOURCE ${f.key}`, `${f.host} • status=${info.status || "ERR"} • ${info.master ? `master=${heights.length ? heights.join("/") + "p" : info.variants.length + " variants"}` : (info.media ? "media-playlist" : "not-master")}`));
  }

  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
