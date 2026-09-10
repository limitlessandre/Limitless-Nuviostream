"use strict";

// Temporary Nexus audit wrapper for Eclipsia v9.9.0 Fyron/KissKH.
// It does not alter the working provider. It records the upstream request flow,
// token/episode query shape, returned headers/subtitles, source fields, HLS form,
// and probes ThirdParty fallback behavior for Den-O / Ex-Aid analysis.
const PROVIDER_NAME = "KissKH Audit";
const SOURCE_URL = "https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/providers/fyron.js";
const FALLBACK = "https://kisskh.is/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function clean(v) { return String(v == null ? "" : v).trim(); }
function short(v, n) { const s = clean(v).replace(/\s+/g, " "); const m = n || 190; return s.length > m ? s.slice(0, m - 1) + "…" : s; }
function hostOf(v) { try { return new URL(clean(v)).hostname || "?"; } catch (_) { return "?"; } }
function headersObject(value) {
  if (!value) return {};
  if (typeof value.forEach === "function") { const out = {}; try { value.forEach((v, k) => { out[k] = v; }); } catch (_) {} return out; }
  if (Array.isArray(value)) { const out = {}; for (const p of value) if (Array.isArray(p) && p.length >= 2) out[p[0]] = p[1]; return out; }
  return typeof value === "object" ? { ...value } : {};
}
function header(headers, name) {
  const h = headersObject(headers); const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase()); return key ? clean(h[key]) : "";
}
function diag(label, detail) {
  return { name: `${PROVIDER_NAME} • ${label}${detail ? ` • ${short(detail, 220)}` : ""}`, title: clean(detail) || label, url: FALLBACK, quality: "DIAG", language: "Unavailable", provider: PROVIDER_NAME, type: "mp4", subtitles: [] };
}

async function readUpstreamSource() {
  try { const r = await fetch(SOURCE_URL, { skipSizeCheck: true }); if (!r || !r.ok) return { source: "", error: `HTTP ${r && r.status || "ERR"}` }; return { source: String(await r.text() || ""), error: "" }; }
  catch (e) { return { source: "", error: clean(e && e.message || e) || "fetch failed" }; }
}

function staticSummary(source) {
  const s = String(source || "");
  const markers = [];
  for (const pair of [
    [/enc-dec\.app\/api\/enc-kisskh/i, "enc-kisskh"], [/enc-dec\.app\/api\/dec-kisskh/i, "dec-kisskh"],
    [/script\.google\.com/i, "google-script"], [/kkey/i, "kkey"], [/DramaList\/Episode/i, "episode-api"],
    [/DramaList\/Search/i, "search-api"], [/\/api\/Sub\//i, "sub-api"], [/Video_tmp/i, "Video_tmp"], [/ThirdParty/i, "ThirdParty"]
  ]) if (pair[0].test(s)) markers.push(pair[1]);
  return { bytes: s.length, markers };
}
function snippet(source, token) {
  const s = String(source || ""); const i = s.toLowerCase().indexOf(String(token).toLowerCase()); if (i < 0) return "not present";
  return short(s.slice(Math.max(0, i - 110), Math.min(s.length, i + 260)), 330);
}

function buildModule(source, calls) {
  const realFetch = fetch;
  const tracedFetch = async function(input, init) {
    const url = clean(typeof input === "string" ? input : input && input.url); const opts = init || {}; let response;
    try { response = await realFetch(input, init); calls.push({ url, status: Number(response && response.status || 0), ok: !!(response && response.ok), headers: headersObject(opts.headers) }); return response; }
    catch (e) { calls.push({ url, status: 0, ok: false, error: clean(e && e.message || e), headers: headersObject(opts.headers) }); throw e; }
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
  try { const r = await fetch(call.url, { headers: call.headers || {}, redirect: "follow", skipSizeCheck: true }); if (!r || !r.ok) return null; return await r.json(); } catch (_) { return null; }
}
function sourceFields(data) {
  const out = [];
  for (const key of ["Video", "Video_tmp", "ThirdParty", "video", "video_tmp", "thirdParty", "thirdparty"]) { const value = clean(data && data[key]); if (/^https?:\/\//i.test(value)) out.push({ key, url: value, host: hostOf(value) }); }
  return out;
}
function queryShape(url) {
  try {
    const u = new URL(url); const get = k => u.searchParams.has(k) ? (u.searchParams.get(k) === "" ? "<empty>" : (k === "kkey" ? `<present:${clean(u.searchParams.get(k)).length}>` : short(u.searchParams.get(k), 45))) : "<absent>";
    return `${u.hostname}${u.pathname} • ts=${get("ts")} • time=${get("time")} • kkey=${get("kkey")}`;
  } catch (_) { return short(url, 180); }
}
function callKind(url) {
  const s = clean(url);
  if (/enc-dec\.app\/api\/enc-kisskh/i.test(s)) return "TOKEN";
  if (/\/api\/DramaList\/Episode\//i.test(s)) return "EPISODE";
  if (/\/api\/DramaList\/Search/i.test(s)) return "SEARCH";
  if (/\/api\/DramaList\/Drama\//i.test(s)) return "DETAIL";
  if (/\/api\/Sub\//i.test(s)) return "SUB";
  if (/dec-kisskh/i.test(s)) return "SUBDEC";
  if (/themoviedb\.org/i.test(s)) return "TMDB";
  return "OTHER";
}
function parseMaster(text, baseUrl) {
  const body = String(text || ""); if (!/#EXT-X-STREAM-INF/i.test(body)) return [];
  const lines = body.split(/\r?\n/), out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]); if (!/#EXT-X-STREAM-INF/i.test(line)) continue;
    const res = line.match(/RESOLUTION=\d+x(\d+)/i), bw = line.match(/BANDWIDTH=(\d+)/i); let j = i + 1;
    while (j < lines.length && (!clean(lines[j]) || clean(lines[j]).startsWith("#"))) j++; if (j >= lines.length) continue;
    let child = clean(lines[j]); try { child = new URL(child, baseUrl).href; } catch (_) {}
    out.push({ height: res ? Number(res[1]) : 0, bandwidth: bw ? Number(bw[1]) : 0, url: child });
  }
  return out;
}
async function fetchText(url, headers) {
  try { const r = await fetch(url, { headers: headers || {}, redirect: "follow", skipSizeCheck: true }); if (!r) return { status: 0, text: "" }; return { status: Number(r.status || 0), text: r.ok ? String(await r.text() || "") : "" }; }
  catch (_) { return { status: 0, text: "" }; }
}
async function inspectPlaylist(url, headers) {
  const r = await fetchText(url, headers); if (!r.text) return { status: r.status, master: false, variants: [], media: false, segHost: "", hints: "" };
  const variants = parseMaster(r.text, url); const lines = r.text.split(/\r?\n/).map(clean).filter(Boolean);
  const seg = lines.find(x => x[0] !== "#") || ""; let segUrl = seg; try { segUrl = seg ? new URL(seg, url).href : ""; } catch (_) {}
  const hints = lines.filter(x => /^#EXT-X-(?:MAP|KEY|BYTERANGE|TARGETDURATION|MEDIA-SEQUENCE)/i.test(x)).slice(0, 4).join(" ");
  return { status: r.status, master: variants.length > 0, variants, media: /#EXTINF/i.test(r.text), segHost: hostOf(segUrl), hints: short(hints, 120) };
}
function embeddedCandidates(text, base) {
  const out = [], seen = new Set(); const s = String(text || "");
  const re = /(?:https?:\\?\/\\?\/[^\s"'<>]+|(?:src|file)\s*[:=]\s*["']([^"']+)["'])/ig; let m;
  while ((m = re.exec(s)) && out.length < 10) { let v = clean(m[1] || m[0]); v = v.replace(/^.*?[:=]\s*["']?/, "").replace(/["']$/, "").replace(/\\\//g, "/"); try { v = new URL(v, base).href; } catch (_) {} if (/^https?:\/\//i.test(v) && !seen.has(v)) { seen.add(v); out.push(v); } }
  return out;
}
async function probeThirdParty(url, episodeReferer, root) {
  const common = { "User-Agent": UA };
  const attempts = [
    ["none", common], ["episode", { ...common, Referer: episodeReferer || root, Origin: root }], ["root", { ...common, Referer: root + "/", Origin: root }]
  ];
  const results = [];
  for (const a of attempts) { const r = await fetchText(url, a[1]); results.push(`${a[0]}=${r.status || "ERR"}`); if (r.text) { const c = embeddedCandidates(r.text, url).filter(x => /\.m3u8|\.mp4|\/embed|\/e\//i.test(x)); if (c.length) return { results, candidates: c }; } }
  return { results, candidates: [] };
}

async function getStreams(inputId, mediaType, season, episode) {
  const loaded = await readUpstreamSource(); if (!loaded.source) return [diag("SOURCE FAILED", loaded.error)];
  const rows = [], stat = staticSummary(loaded.source);
  rows.push(diag("STATIC", `bytes=${stat.bytes} • markers=${stat.markers.join(",") || "none"}`));
  rows.push(diag("KEY CODE", snippet(loaded.source, "enc-kisskh")));
  rows.push(diag("SOURCE CODE", snippet(loaded.source, "ThirdParty")));
  const calls = []; let upstream;
  try { upstream = buildModule(loaded.source, calls); } catch (e) { return rows.concat(diag("LOAD FAILED", clean(e && e.message || e))); }
  if (!upstream) return rows.concat(diag("LOAD FAILED", "no getStreams export"));
  let upstreamRows = [];
  try { const result = await upstream.getStreams(inputId, mediaType, season, episode); upstreamRows = Array.isArray(result) ? result : []; }
  catch (e) { rows.push(diag("UPSTREAM ERROR", clean(e && e.message || e))); }

  const uniqueCalls = [], seenCall = new Set();
  for (const c of calls) if (c.url && !seenCall.has(c.url)) { seenCall.add(c.url); uniqueCalls.push(c); }
  rows.push(diag("FLOW", uniqueCalls.map(c => `${callKind(c.url)}=${c.status || "ERR"}`).join(" → ")));
  const tokenCall = uniqueCalls.find(c => callKind(c.url) === "TOKEN");
  if (tokenCall) rows.push(diag("TOKEN CALL", short(tokenCall.url.replace(/([?&](?:text|id|kkey)=)[^&]+/ig, "$1<value>"), 210)));
  const episodeCall = uniqueCalls.slice().reverse().find(c => callKind(c.url) === "EPISODE");
  if (episodeCall) rows.push(diag("EPISODE CALL", queryShape(episodeCall.url)));
  const subCalls = uniqueCalls.filter(c => callKind(c.url) === "SUB" || callKind(c.url) === "SUBDEC");
  rows.push(diag("SUB FLOW", `runtimeCalls=${subCalls.length} • upstreamTracks=${upstreamRows.reduce((n,r)=>n+(Array.isArray(r.subtitles)?r.subtitles.length:0),0)} • static=${stat.markers.includes("sub-api") || stat.markers.includes("dec-kisskh") ? "present" : "absent"}`));

  if (upstreamRows.length) {
    rows.push(diag("UPSTREAM ROWS", upstreamRows.slice(0, 6).map(r => `${clean(r.quality) || "?"}:${hostOf(r.url)}:${clean(r.name) || "unnamed"}:subs=${Array.isArray(r.subtitles) ? r.subtitles.length : 0}`).join(" | ")));
    rows.push(diag("PLAYBACK HEADERS", upstreamRows.slice(0, 3).map(r => `ref=${hostOf(header(r.headers,"referer"))} origin=${hostOf(header(r.headers,"origin"))} type=${clean(r.type)||"?"}`).join(" | ")));
  } else rows.push(diag("UPSTREAM ROWS", "0"));
  if (!episodeCall) return rows.concat(diag("EPISODE API", "not observed"));

  const data = await refetchJson(episodeCall); if (!data) return rows.concat(diag("EPISODE JSON", `refetch failed • ${hostOf(episodeCall.url)}`));
  const fields = sourceFields(data), uniqueSources = [], seenUrl = new Set();
  for (const f of fields) if (!seenUrl.has(f.url)) { seenUrl.add(f.url); uniqueSources.push(f); }
  rows.push(diag("SOURCES", `fields=${fields.map(f => `${f.key}=${f.host}`).join(",") || "none"} • unique=${uniqueSources.length}`));

  const rowHeaders = upstreamRows[0] && upstreamRows[0].headers ? upstreamRows[0].headers : episodeCall.headers;
  let root = "https://kisskh.ovh"; try { const u = new URL(episodeCall.url); root = u.origin; } catch (_) {}
  const epRef = header(episodeCall.headers, "referer") || root + "/";
  for (const f of uniqueSources.slice(0, 4)) {
    if (/ThirdParty/i.test(f.key)) {
      const p = await probeThirdParty(f.url, epRef, root);
      rows.push(diag(`FALLBACK ${f.key}`, `${f.host} • ${p.results.join(" • ")} • nested=${p.candidates.length}${p.candidates.length ? `:${p.candidates.slice(0,3).map(hostOf).join(",")}` : ""}`));
    } else {
      const info = await inspectPlaylist(f.url, rowHeaders); const heights = info.variants.map(v => v.height).filter(Boolean);
      rows.push(diag(`SOURCE ${f.key}`, `${f.host} • status=${info.status || "ERR"} • ${info.master ? `master=${heights.length ? heights.join("/") + "p" : info.variants.length + " variants"}` : (info.media ? "media-playlist" : "not-master")} • seg=${info.segHost || "?"}${info.hints ? ` • ${info.hints}` : ""}`));
    }
  }
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
