"use strict";

// AnikotoTV Nexus v2.0.5 playback wrapper.
// Keeps the proven v2.0.4 identity + MegaPlay AES path as fallback, but prefers
// AniKoto's current server-list route (VidPlay/VidTube first) for playable desktop HLS.

const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anikototv-nexus-v5.js";
let cached = null;

function patchSource(source) {
  let src = String(source || "");
  const start = src.indexOf("async function resolveMode(identity, episode, mode) {");
  const end = src.indexOf("\n\nfunction row(identity, season, requestedEpisode, mode, resolved) {", start);
  if (start < 0 || end < 0) return null;

  const replacement = `function attrValue(attrs, name) {
  const re = new RegExp("\\\\b" + name + "=[\\\"']([^\\\"']*)[\\\"']", "i");
  const m = String(attrs || "").match(re);
  return m ? m[1] : "";
}

async function anikotoAjax(path, referer) {
  return await requestJson(SITE + path, {
    credentials:"include",
    headers:{
      "Accept":"application/json, text/javascript, */*; q=0.01",
      "X-Requested-With":"XMLHttpRequest",
      "Referer":referer || SITE + "/"
    }
  });
}

async function episodeServerIds(identity, episode) {
  const names = aliases(identity);
  for (const term of names.slice(0, 3)) {
    const html = await requestText(SITE + "/filter?keyword=" + encodeURIComponent(term), {
      credentials:"include",
      headers:{ "Accept":"text/html,application/xhtml+xml", "Referer":SITE + "/" }
    });
    const rows = parseSearch(html).filter(function(row) {
      return names.some(function(name) { return normalize(name) === normalize(row.title); });
    }).slice(0, 4);

    for (const row of rows) {
      // data-tip currently matches the internal AniKoto series id used by episode/list.
      const payload = await anikotoAjax("/ajax/episode/list/" + encodeURIComponent(row.id) + "?vrf=", SITE + "/");
      const result = payload && typeof payload.result === "string" ? payload.result : "";
      if (!result) continue;

      const anchorRe = /<a\\b([^>]*\\bdata-num=[\"']?\\d+[\"']?[^>]*)>/gi;
      let m;
      while ((m = anchorRe.exec(result))) {
        const attrs = m[1];
        if (Number(attrValue(attrs, "data-num")) !== Number(episode)) continue;
        const ids = attrValue(attrs, "data-ids");
        if (ids) return ids;
      }
    }
  }
  return "";
}

function parseAniKotoServers(html, wantedMode) {
  const out = [];
  const text = String(html || "");
  const typeRe = /data-type=[\"'](\\w+)[\"']([\\s\\S]*?)(?=data-type=[\"']|$)/gi;
  let tm;
  while ((tm = typeRe.exec(text))) {
    const rawType = String(tm[1] || "").toLowerCase();
    const type = rawType === "hsub" ? "sub" : rawType;
    if (type !== wantedMode) continue;
    const block = tm[2];
    const liRe = /<li\\b([^>]*\\bdata-link-id=[\"'][^\"']+[\"'][^>]*)>([\\s\\S]*?)<\\/li>/gi;
    let lm;
    while ((lm = liRe.exec(block))) {
      const linkId = attrValue(lm[1], "data-link-id");
      if (!linkId) continue;
      const name = cleanText(lm[2]) || type.toUpperCase();
      out.push({ linkId:linkId, name:name, type:type });
    }
  }

  function score(server) {
    const name = String(server && server.name || "").toLowerCase();
    if (/^vidplay|vidtube/.test(name)) return 0;
    if (/^vidcloud/.test(name)) return 1;
    if (/^vidstream/.test(name)) return 2;
    if (/^hd|megaplay/.test(name)) return 3;
    return 4;
  }
  out.sort(function(a,b) { return score(a) - score(b); });
  return out;
}

async function resolveExternalPlayer(embedValue, mode) {
  const embed = validHttps(embedValue);
  if (!embed) return null;
  const html = await requestText(embed.href, {
    credentials:"include",
    headers:{
      "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer":SITE + "/"
    }
  });
  const sourceId = sourceIdFromHtml(html);
  if (!sourceId) return null;

  const sourceUrl = embed.origin + "/stream/getSources?id=" + encodeURIComponent(sourceId) + "&type=" + encodeURIComponent(mode);
  const payload = await requestJson(sourceUrl, {
    credentials:"include",
    headers:{
      "Accept":"application/json,text/plain,*/*",
      "X-Requested-With":"XMLHttpRequest",
      "Origin":embed.origin,
      "Referer":embed.href
    }
  });
  if (!payload) return null;

  let file = plainSourceFile(payload);
  if (!file && payload.enc) file = await decryptEnc(payload.enc);
  const media = validHttps(file);
  if (!media) return null;

  return {
    url:media.href,
    subtitles:subtitleRows(payload),
    headers:{ "Referer":embed.origin + "/", "Origin":embed.origin, "User-Agent":UA }
  };
}

async function resolveAniKotoServerList(identity, episode, mode) {
  try {
    // Prime same-origin cookies/session before the AJAX chain.
    await requestText(SITE + "/home", { credentials:"include", headers:{ "Referer":SITE + "/" } });
    const ids = await episodeServerIds(identity, episode);
    if (!ids) return null;

    const listPayload = await anikotoAjax("/ajax/server/list?servers=" + encodeURIComponent(ids), SITE + "/");
    const listHtml = listPayload && typeof listPayload.result === "string" ? listPayload.result : "";
    const servers = parseAniKotoServers(listHtml, mode);
    if (!servers.length) return null;

    for (const server of servers.slice(0, 6)) {
      const linkPayload = await anikotoAjax("/ajax/server?get=" + encodeURIComponent(server.linkId), SITE + "/");
      const result = linkPayload && linkPayload.result;
      const embed = result && typeof result === "object" ? result.url : (typeof result === "string" ? result : "");
      if (!embed) continue;
      const resolved = await resolveExternalPlayer(embed, mode);
      if (resolved) return { ...resolved, server:server.name || "AniKoto" };
    }
  } catch (_) {}
  return null;
}

async function resolveMode(identity, episode, mode) {
  // Current AniKoto clients prefer VidPlay because its akirax/norami CDN is
  // substantially more reliable on desktop than MegaPlay's imgnex/snapcdn route.
  const serverList = await resolveAniKotoServerList(identity, episode, mode);
  if (serverList) return serverList;

  // Proven direct MegaPlay path remains the rescue lane for titles with no VidPlay copy.
  for (const embed of directCandidates(identity, episode, mode)) {
    const resolved = await resolveMegaPlay(embed);
    if (resolved) return { ...resolved, server:"MegaPlay Fallback" };
  }
  const fallback = await catalogCandidates(identity, episode, mode);
  for (const embed of fallback) {
    const resolved = await resolveMegaPlay(embed);
    if (resolved) return { ...resolved, server:"Catalog Fallback" };
  }
  return null;
}`;

  return src.slice(0, start) + replacement + src.slice(end);
}

async function loadBase() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const response = await fetch(BASE_URL, { skipSizeCheck:true });
    if (!response || !response.ok) return null;
    const raw = String(await response.text() || "");
    const source = patchSource(raw);
    if (!source) return null;
    const mod = { exports:{} };
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
