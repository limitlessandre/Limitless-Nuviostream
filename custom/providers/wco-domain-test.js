"use strict";

const PROVIDER_NAME = "WCO Domain Test";
const CORE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco.js";
const DOMAINS = [
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net",
  "https://www.wco.tv",
  "https://www.wcoanimedub.tv",
  "https://www.wcoanimesub.tv"
];

let rawCore = null;
const coreCache = new Map();
const coreErrors = new Map();

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].replace(/^www\./i, "") : String(url || "");
}

function qualityRank(value) {
  const m = String(value || "").match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

function audioBranch(stream) {
  const text = String(stream && stream.name || "").toLowerCase();
  if (text.includes("english dub") || text.includes("dual audio")) return "Dub";
  if (text.includes("japanese") || text.includes("hard sub") || text.includes("sub")) return "Sub";
  return "Other";
}

function cleanDetail(value) {
  return String(value || "")
    .replace(/https?:\/\/www\./gi, "")
    .replace(/https?:\/\//gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

async function sourceText() {
  if (rawCore) return rawCore;
  try {
    const res = await fetch(CORE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return "";
    rawCore = String(await res.text() || "");
    return rawCore;
  } catch (_) {
    return "";
  }
}

function diagnosticAddon() {
  return `

async function __wcoDomainDiagnoseVariant(series, variant, wantedSeason, wantedEpisode) {
  const lang = variant === "Sub" ? "sub" : "dub";
  const filteredUrl = audioFilterUrl(series.pageUrl, lang);
  const filtered = await req(filteredUrl, { headers: { "Referer": series.pageUrl } });
  let episodes = filtered.ok
    ? episodeLinks(filtered.text, filteredUrl, wantedSeason, wantedEpisode, series.season, variant)
    : [];

  if (!episodes.length) {
    episodes = episodeLinks(series.page.text, series.pageUrl, wantedSeason, wantedEpisode, series.season, variant);
  }

  if (!episodes.length) {
    return {
      score: 4,
      stage: "EPISODE",
      detail: variant + ": no matching S" + wantedSeason + "E" + wantedEpisode + (filtered.ok ? "" : " (filter HTTP " + (filtered.status || "ERR") + ")")
    };
  }

  let best = { score: 5, stage: "EPISODE PAGE", detail: variant + ": matched episode link, page did not load" };
  for (const entry of episodes.slice(0, 3)) {
    const epPage = await req(entry.href, { headers: { "Referer": filtered.ok ? filteredUrl : series.pageUrl } });
    if (!epPage.ok) {
      best = { score: 5, stage: "EPISODE PAGE", detail: variant + ": HTTP " + (epPage.status || "ERR") };
      continue;
    }

    const frame = iframeLink(epPage.text, entry.href);
    if (!frame) {
      best = { score: 6, stage: "EMBED", detail: variant + ": episode loaded but no iframe was found" };
      continue;
    }
    if (/user\\.wcostream\\.tv\\/check-login/i.test(frame)) {
      best = { score: 6, stage: "EMBED", detail: variant + ": login-gated iframe" };
      continue;
    }
    if (!/embed\\.wcostream/i.test(frame)) {
      best = { score: 6, stage: "EMBED", detail: variant + ": non-WCO iframe " + originOf(frame) };
      continue;
    }

    const lookup = await playerLookup(frame);
    if (!lookup) {
      best = { score: 7, stage: "PLAYER", detail: variant + ": WCO iframe found but player lookup URL was not found" };
      continue;
    }

    const lookupRes = await req(lookup, {
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": frame,
        "Origin": originOf(frame),
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (!lookupRes.ok) {
      best = { score: 8, stage: "PLAYER JSON", detail: variant + ": lookup HTTP " + (lookupRes.status || "ERR") };
      continue;
    }

    let data;
    try { data = JSON.parse(lookupRes.text); }
    catch (_) {
      best = { score: 8, stage: "PLAYER JSON", detail: variant + ": lookup response was not valid JSON" };
      continue;
    }

    const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]);
    if (!hosts.length) {
      best = { score: 9, stage: "MEDIA", detail: variant + ": player JSON had no server/CDN host" };
      continue;
    }

    const qualities = [
      data.fhd ? ["1080p", data.fhd] : null,
      data.fullhd ? ["1080p", data.fullhd] : null,
      data.hd ? ["720p", data.hd] : null,
      data.enc ? ["480p", data.enc] : null
    ].filter(Boolean);
    if (!qualities.length) {
      best = { score: 9, stage: "MEDIA", detail: variant + ": server/CDN found but no quality IDs were returned" };
      continue;
    }

    for (const item of qualities) {
      for (const mediaHost of hosts) {
        const mediaRes = await req(mediaHost + "/getvid?evid=" + encodeURIComponent(String(item[1])) + "&json", {
          headers: { "Referer": frame, "Origin": originOf(frame) }
        });
        if (!mediaRes.ok) {
          best = { score: 9, stage: "MEDIA", detail: variant + ": " + item[0] + " getvid HTTP " + (mediaRes.status || "ERR") + " via " + mediaHost };
          continue;
        }
        const media = resolvedValue(mediaRes.text, mediaRes.url);
        if (media) {
          return { score: 10, stage: "PLAYABLE", detail: variant + ": " + item[0] + " -> " + originOf(media) };
        }
        best = { score: 9, stage: "MEDIA", detail: variant + ": " + item[0] + " getvid response did not resolve via " + mediaHost };
      }
    }
  }
  return best;
}

async function __wcoDomainDiagnose(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  if (type === "movie") return { score: 0, stage: "SKIPPED", detail: "domain test is TV/anime only" };

  const wantedSeason = Number(season || 1);
  const wantedEpisode = Number(episode || 1);
  let info;
  try { info = await tmdbInfo(inputId, type); }
  catch (e) { return { score: 1, stage: "METADATA", detail: "TMDB error: " + String(e && e.message || e) }; }
  if (!info) return { score: 1, stage: "METADATA", detail: "TMDB/IMDb identity could not be resolved" };

  let candidates;
  try { candidates = await searchWco(info, wantedSeason); }
  catch (e) { return { score: 2, stage: "SEARCH", detail: "search error: " + String(e && e.message || e) }; }
  if (!candidates.length) return { score: 2, stage: "SEARCH", detail: "no acceptable title match for " + info.title };

  let best = { score: 3, stage: "SERIES", detail: "search matched " + candidates.length + " candidate(s), but no usable series page" };
  for (const candidate of candidates.slice(0, 6)) {
    let series;
    try { series = await candidatePage(candidate); }
    catch (e) {
      best = { score: 3, stage: "SERIES", detail: "candidate page error: " + String(e && e.message || e) };
      continue;
    }
    if (!series) continue;
    if (series.season != null && series.season !== wantedSeason) {
      best = { score: 3, stage: "SERIES", detail: "candidate resolved to Season " + series.season + ", wanted Season " + wantedSeason };
      continue;
    }

    best = { score: 4, stage: "EPISODE", detail: "series page loaded; checking Dub/Sub episode links" };
    for (const variant of ["Dub", "Sub"]) {
      let result;
      try { result = await __wcoDomainDiagnoseVariant(series, variant, wantedSeason, wantedEpisode); }
      catch (e) { result = { score: 4, stage: "EPISODE", detail: variant + ": diagnostic error " + String(e && e.message || e) }; }
      if (result && Number(result.score || 0) > Number(best.score || 0)) best = result;
      if (result && result.stage === "PLAYABLE") return result;
    }
  }
  return best;
}

module.exports.__diagnose = __wcoDomainDiagnose;
`;
}

function patchForOrigin(source, origin) {
  let patched = String(source || "");
  patched = patched.replace(/const PROVIDER_NAME\s*=\s*"WCO"\s*;/, 'const PROVIDER_NAME = "WCO Domain Test";');
  patched = patched.replace(/const ORIGINS\s*=\s*\[[\s\S]*?\];/, `const ORIGINS = [${JSON.stringify(origin)}];`);
  return patched + diagnosticAddon();
}

async function coreFor(origin) {
  if (coreCache.has(origin)) return coreCache.get(origin);
  const raw = await sourceText();
  if (!raw) {
    coreErrors.set(origin, "WCO core source could not be downloaded");
    return null;
  }
  const patched = patchForOrigin(raw, origin);
  try {
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") {
      coreErrors.set(origin, "patched WCO core did not export getStreams");
      return null;
    }
    coreCache.set(origin, exported);
    return exported;
  } catch (e) {
    coreErrors.set(origin, String(e && e.message || e));
    return null;
  }
}

function pickBest(streams, origin) {
  const best = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const branch = audioBranch(stream);
    if (branch === "Other") continue;
    const prev = best.get(branch);
    if (!prev || qualityRank(stream.quality) > qualityRank(prev.quality)) best.set(branch, stream);
  }

  const out = [];
  for (const [branch, stream] of best.entries()) {
    const clean = { ...stream };
    const frontendHost = hostOf(origin);
    const mediaHost = hostOf(clean.url);
    clean.provider = PROVIDER_NAME;
    clean.name = `${PROVIDER_NAME} • ${frontendHost} → ${mediaHost} • ${clean.quality || "Auto"} • ${branch === "Dub" ? "English Dub" : "Japanese + English Hard Subs"}`;
    out.push(clean);
  }
  return out;
}

function diagnosticStream(origin, stage, detail) {
  const frontendHost = hostOf(origin);
  const safeStage = cleanDetail(stage || "UNKNOWN").toUpperCase();
  const safeDetail = cleanDetail(detail || "no additional detail");
  return {
    name: `${PROVIDER_NAME} • ${frontendHost} • DIAG ${safeStage} • ${safeDetail}`,
    title: `${frontendHost} diagnostic: ${safeStage}`,
    url: `${origin}/`,
    quality: "144p",
    language: "Diagnostic",
    provider: PROVIDER_NAME,
    type: "mp4",
    headers: {
      "Referer": `${origin}/`
    }
  };
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase();
  if (type === "movie" || Number(season) === 0) return [];

  const out = [];
  for (const origin of DOMAINS) {
    const core = await coreFor(origin);
    if (!core) {
      out.push(diagnosticStream(origin, "MODULE LOAD", coreErrors.get(origin) || "isolated WCO core failed to load"));
      continue;
    }

    try {
      const streams = await core.getStreams(inputId, mediaType, season, episode);
      const picked = pickBest(streams, origin);
      if (picked.length) {
        out.push(...picked);
        continue;
      }

      if (typeof core.__diagnose === "function") {
        const diag = await core.__diagnose(inputId, mediaType, season, episode);
        out.push(diagnosticStream(origin, diag && diag.stage, diag && diag.detail));
      } else {
        out.push(diagnosticStream(origin, "NO STREAMS", "core returned no Dub/Sub streams and diagnostics were unavailable"));
      }
    } catch (e) {
      out.push(diagnosticStream(origin, "RUNTIME", String(e && e.message || e)));
    }
  }
  return out;
}

module.exports = { getStreams };
