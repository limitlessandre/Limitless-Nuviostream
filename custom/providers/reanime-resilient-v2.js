"use strict";

// Nexus Season 0 safety wrapper for Re:ANIME resilient production.
// Some Re:ANIME special records expose can_watch=false even though /api/flix
// already has playable servers. For specials, real server availability is the
// authority. The catalog flag becomes a fallback hint only when no servers exist.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/reanime-resilient.js";
let cached = null;

function patchSource(source) {
  let out = String(source || "");

  const oldTarget = `    if (explicitFalse(match.candidate && match.candidate.can_watch) || explicitFalse(detail.can_watch)) {
      return { info:specialInfoRow(special.label, detail, match.candidate) };
    }
    const anilistId = Number(detail.anilist_id || detail.anilistId || match.candidate.anilist_id || 0) || 0;
    if (!anilistId) continue;
    const display = titleValues(detail.title || match.candidate.title || match.candidate.name)[0] || special.label;
    return { target:{ anilistId, title:display, source:"season-0-special" }, resolvedEpisode:1 };`;

  const newTarget = `    const unavailableHint = explicitFalse(match.candidate && match.candidate.can_watch) || explicitFalse(detail.can_watch);
    const anilistId = Number(detail.anilist_id || detail.anilistId || match.candidate.anilist_id || 0) || 0;
    if (!anilistId) {
      if (unavailableHint) return { info:specialInfoRow(special.label, detail, match.candidate) };
      continue;
    }
    const display = titleValues(detail.title || match.candidate.title || match.candidate.name)[0] || special.label;
    return {
      target:{ anilistId, title:display, source:"season-0-special" },
      resolvedEpisode:1,
      unavailableInfo: unavailableHint ? specialInfoRow(special.label, detail, match.candidate) : null
    };`;

  const oldRun = `      if (special.info) return [special.info];
      const servers = selectServers(await fetchServers(special.target.anilistId, special.resolvedEpisode));
      if (!servers.length) return [];
      const assets = await Promise.all(servers.map(server => resolveDirectAsset(server).catch(() => null)));
      return buildStreams(assets, special.target.title, special.resolvedEpisode);`;

  const newRun = `      if (special.info) return [special.info];
      const servers = selectServers(await fetchServers(special.target.anilistId, special.resolvedEpisode));
      if (!servers.length) return special.unavailableInfo ? [special.unavailableInfo] : [];
      const assets = await Promise.all(servers.map(server => resolveDirectAsset(server).catch(() => null)));
      const streams = buildStreams(assets, special.target.title, special.resolvedEpisode);
      if (streams.length) return streams;
      return special.unavailableInfo ? [special.unavailableInfo] : [];`;

  if (!out.includes(oldTarget) || !out.includes(oldRun)) return "";
  out = out.replace(oldTarget, newTarget).replace(oldRun, newRun);
  return out;
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck:true });
    if (!response || !response.ok) return null;
    const patched = patchSource(String(await response.text() || ""));
    if (!patched || !patched.includes("module.exports")) return null;
    const mod = { exports:{} };
    const factory = new Function("module", "exports", "require", patched + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name){ throw new Error("Unsupported nested require: " + name); }) || mod.exports;
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
  try { return await base.getStreams(inputId, mediaType, season, episode); }
  catch (_) { return []; }
}

module.exports = { getStreams };
