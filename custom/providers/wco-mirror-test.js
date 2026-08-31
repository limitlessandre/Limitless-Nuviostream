"use strict";

const PROVIDER_NAME = "WCO Mirror Test";
const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
let cachedCore = null;

function patchCore(source) {
  const startMarker = "async function extractEmbed(embedUrl, variant, displayTitle, info)";
  const endMarker = "async function candidatePage(candidate)";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) return "";

  const replacement = [
    'async function extractEmbed(embedUrl, variant, displayTitle, info) {',
    '  if (!embedUrl || /user\\.wcostream\\.tv\\/check-login/i.test(embedUrl)) return [];',
    '  if (!/embed\\.wcostream/i.test(embedUrl)) return [];',
    '  const lookup = await playerLookup(embedUrl);',
    '  if (!lookup) return [];',
    '  const lookupRes = await req(lookup, { headers: { "Accept": "application/json, text/javascript, */*; q=0.01", "Referer": embedUrl, "Origin": originOf(embedUrl), "X-Requested-With": "XMLHttpRequest" } });',
    '  if (!lookupRes.ok) return [];',
    '  let data;',
    '  try { data = JSON.parse(lookupRes.text); } catch (_) { return []; }',
    '  const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]).slice(0, 2);',
    '  if (!hosts.length) return [];',
    '  const finalVariant = variant || "Original";',
    '  const meta = variantMeta(finalVariant, info.originalLanguage);',
    '  const qualities = [data.fhd ? ["1080p", data.fhd] : null, data.fullhd ? ["1080p", data.fullhd] : null, data.hd ? ["720p", data.hd] : null, data.enc ? ["480p", data.enc] : null].filter(Boolean);',
    '  const out = [];',
    '  for (let mirrorIndex = 0; mirrorIndex < hosts.length; mirrorIndex++) {',
    '    const mirrorHost = hosts[mirrorIndex];',
    '    const usedQuality = new Set();',
    '    for (const item of qualities) {',
    '      const quality = item[0];',
    '      if (usedQuality.has(quality)) continue;',
    '      const mediaRes = await req(mirrorHost + "/getvid?evid=" + encodeURIComponent(String(item[1])) + "&json", { headers: { "Referer": embedUrl, "Origin": originOf(embedUrl) } });',
    '      if (!mediaRes.ok) continue;',
    '      const media = resolvedValue(mediaRes.text, mediaRes.url);',
    '      if (!media) continue;',
    '      usedQuality.add(quality);',
    '      out.push({ name: PROVIDER_NAME + " • " + quality + " • " + meta.label, title: displayTitle, url: media, quality: quality, language: meta.language, provider: PROVIDER_NAME, type: /\\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4", headers: { "Referer": embedUrl, "Origin": originOf(embedUrl), "User-Agent": UA }, _variant: finalVariant, _mirrorIndex: mirrorIndex + 1, _mirrorKey: mirrorHost });',
    '    }',
    '  }',
    '  return out;',
    '}',
    ''
  ].join("\n");

  return source.slice(0, start) + replacement + source.slice(end);
}

async function loadCore() {
  if (cachedCore && typeof cachedCore.getStreams === "function") return cachedCore;
  try {
    const res = await fetch(CORE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const raw = String(await res.text() || "");
    const source = patchCore(raw);
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cachedCore = exported;
    return exported;
  } catch (_) {
    return null;
  }
}

function labelOf(stream) {
  const n = String(stream && stream.name || "").toLowerCase();
  if (n.includes("english dub")) return "English Dub";
  if (n.includes("dual audio")) return "Dual Audio + Subs";
  if (n.includes("japanese + english hard subs")) return "Japanese + English Hard Subs";
  if (n.includes("japanese")) return "Japanese + English Hard Subs";
  return String(stream && stream.language || "Original");
}

function rank(q) {
  const m = String(q || "").match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

function prune(streams) {
  const branches = new Map();
  for (const s of streams || []) {
    if (!s || !s.url) continue;
    const label = labelOf(s);
    const mirror = Number(s._mirrorIndex || 1);
    const key = label + "|" + mirror;
    if (!branches.has(key)) branches.set(key, { label, mirror, items: [] });
    branches.get(key).items.push(s);
  }

  const out = [];
  for (const branch of branches.values()) {
    const sorted = branch.items.slice().sort((a, b) => rank(b.quality) - rank(a.quality));
    const used = new Set();
    let count = 0;
    for (const s of sorted) {
      const q = String(s.quality || "Auto");
      if (used.has(q)) continue;
      used.add(q);
      const clean = { ...s };
      delete clean._mirrorIndex;
      delete clean._mirrorKey;
      clean.provider = PROVIDER_NAME;
      clean.name = PROVIDER_NAME + " • Mirror " + branch.mirror + " • " + q + " • " + branch.label;
      out.push(clean);
      count += 1;
      if (count >= 2) break;
    }
  }
  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie" || Number(season) === 0) return [];
  const core = await loadCore();
  if (!core) return [];
  try {
    return prune(await core.getStreams(inputId, mediaType, season, episode));
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
