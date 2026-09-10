"use strict";

// AniKoto-only extraction. Identity/episode mapping stays in the proven v5 base.
// Shared by provider and relay re-resolution; no third-party player code is evaluated.
function createAniKotoSources(h) {
  const site = "https://anikototv.to", ua = h.ua || "Mozilla/5.0 Chrome/140 Safari/537.36";
  const discoveries = new Map();
  const https = value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch (_) { return ""; } };
  const attr = (text, name) => ((String(text).match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i")) || []).slice(1).find(x => x !== undefined) || "");
  const clean = text => String(text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const modeOf = type => /^(dub|a-dub)$/i.test(type) ? "dub" : /^(sub|hsub|h-sub|softsub)$/i.test(type) ? "sub" : "";
  async function parallel(items, work, concurrency = 3) {
    const out = new Array(items.length); let next = 0;
    await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
      while (next < items.length) { const i = next++; try { out[i] = await work(items[i]); } catch (_) { out[i] = null; } }
    }));
    return out.filter(Boolean);
  }
  function parseServers(html) {
    const out = [], groups = /data-type\s*=\s*["']([^"']+)["']([\s\S]*?)(?=data-type\s*=|$)/gi;
    let g;
    while ((g = groups.exec(String(html || "")))) {
      const mode = modeOf(g[1]); if (!mode) continue;
      const re = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi; let m;
      while ((m = re.exec(g[2]))) {
        if (/download-icon/i.test(attr(m[1], "class"))) continue;
        const linkId = attr(m[1], "data-link-id") || attr(m[1], "data-id");
        if (linkId) out.push({linkId, name: clean(m[2]) || "AniKoto", mode, sourceType: g[1]});
      }
    }
    return out;
  }
  function parseMapper(data) {
    const out = [];
    for (const [key, item] of Object.entries(data || {})) {
      if (!item || typeof item !== "object" || key.toLowerCase() === "status") continue;
      const name = ({gogoanime: "Vidstream", anivibe: "Vibe-Stream", animepahe: "Kiwi-Stream"})[key.toLowerCase()] || key;
      for (const mode of ["sub", "dub"]) {
        const url = item[mode] && item[mode].url;
        if (typeof url === "string" && url) out.push({linkId: url, name, mode, sourceType: mode === "sub" ? "hsub" : "dub"});
      }
    }
    return out;
  }
  const ajax = path => h.requestJson(site + path, {credentials: "include", headers: {Referer: site + "/", "X-Requested-With": "XMLHttpRequest"}});
  async function discover(identity, episode) {
    const key = [identity.anilistId, identity.malId, identity.title, episode].join(":");
    const previous = discoveries.get(key);
    if (previous && previous.expires > Date.now()) return previous.promise;
    const promise = (async () => {
      await h.requestText(site + "/home", {credentials: "include", headers: {Referer: site + "/"}});
      const names = h.aliases(identity);
      for (const term of names.slice(0, 3)) {
        const html = await h.requestText(site + "/filter?keyword=" + encodeURIComponent(term), {credentials: "include", headers: {Referer: site + "/"}});
        const titles = h.parseSearch(html).filter(row => names.some(name => h.normalize(name) === h.normalize(row.title))).slice(0, 4);
        for (const title of titles) {
          const data = await ajax("/ajax/episode/list/" + encodeURIComponent(title.id) + "?vrf=");
          const anchors = String(data && data.result || "").match(/<a\b[^>]*>/gi) || [];
          const anchor = anchors.find(x => Number(attr(x, "data-num")) === Number(episode));
          if (!anchor) continue;
          const ids = attr(anchor, "data-ids"), mal = attr(anchor, "data-mal"), slug = attr(anchor, "data-slug"), timestamp = attr(anchor, "data-timestamp");
          const [list, mapper] = await Promise.all([
            ids ? ajax("/ajax/server/list?servers=" + encodeURIComponent(ids)) : null,
            mal && slug && timestamp ? h.requestJson("https://mapper.nekostream.site/api/mal/" + [mal, slug, timestamp].map(encodeURIComponent).join("/"), {headers: {Referer: site + "/", Origin: site}}) : null
          ]);
          const seen = new Set();
          return parseServers(list && list.result).concat(parseMapper(mapper)).filter(x => {
            const k = x.mode + ":" + x.linkId; if (seen.has(k)) return false; seen.add(k); return true;
          }).slice(0, 32);
        }
      }
      return [];
    })();
    if (discoveries.size >= 16) discoveries.delete(discoveries.keys().next().value);
    discoveries.set(key, {promise, expires: Date.now() + 120000});
    return promise;
  }
  function subtitles(payload, base) {
    const seen = new Set();
    return (Array.isArray(payload && payload.tracks) ? payload.tracks : []).filter(t => !t.kind || /^(captions|subtitles)$/i.test(t.kind)).map(t => {
      let url; try { url = https(new URL(t.file || t.url, base).href); } catch (_) { return null; }
      if (!url || seen.has(url)) return null; seen.add(url);
      const name = clean(t.label || t.name || t.language || "Subtitle");
      const language = /english|^eng?$|^en-/i.test(name) ? "eng" : /japanese|jpn/i.test(name) ? "jpn" : /spanish|spa/i.test(name) ? "spa" : /portuguese|por/i.test(name) ? "por" : /french|fra/i.test(name) ? "fra" : /german|deu/i.test(name) ? "deu" : "und";
      return {id: name, name, language, url};
    }).filter(Boolean);
  }
  async function decrypt(token) {
    if (h.decryptEnc) return h.decryptEnc(token);
    try {
      const raw = atob(String(token).replace(/-/g, "+").replace(/_/g, "/"));
      const cipher = Uint8Array.from(raw, c => c.charCodeAt(0)), keyBytes = new Uint8Array(32);
      keyBytes.set(new TextEncoder().encode("i?LMTAx0Q6,:}50U"));
      const key = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-CBC"}, false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({name: "AES-CBC", iv: new Uint8Array([87,48,59,50,55,84,111,97,85,112,108,95,80,37,39,99])}, key, cipher);
      return JSON.parse(new TextDecoder().decode(plain)).file || "";
    } catch (_) { return ""; }
  }
  async function sourceRows(payload, embed) {
    if (!payload) return [];
    let list = payload.sources;
    if (!Array.isArray(list)) list = list ? [list] : [];
    if (!list.length && payload.enc) list = [await decrypt(payload.enc)];
    return list.map(x => ({url: https(typeof x === "string" ? x : x && (x.file || x.url || x.src)), quality: clean(x && typeof x === "object" && (x.label || x.quality)), subtitles: subtitles(payload, embed)})).filter(x => x.url);
  }
  async function external(value, mode, depth = 0, visited = new Set()) {
    const embed = https(value); if (!embed || depth > 3 || visited.has(embed)) return [];
    visited.add(embed); const u = new URL(embed);
    const headers = {Referer: u.origin + "/", Origin: u.origin, "User-Agent": ua};
    const wrap = rows => rows.map(x => ({...x, headers: x.headers || headers, embed, mode}));
    if (/\.m3u8(?:[?#]|$)/i.test(embed)) return wrap([{url: embed, subtitles: []}]);
    const html = await h.requestText(embed, {credentials: "include", headers: {Referer: site + "/"}});
    if (/^\s*#EXTM3U/.test(html)) return wrap([{url: embed, subtitles: []}]);
    if (/mewcdn\./i.test(u.hostname) && u.hash) {
      try {
        let media = atob(u.hash.slice(1).split("#")[0]);
        const map = (html.match(/(?:var|let|const)\s+HOST_MAP\s*=\s*\{([^}]+)\}/) || [])[1] || "";
        for (const entry of map.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) media = media.replace(entry[1], entry[2]);
        if (https(media)) return wrap([{url: media, subtitles: []}]);
      } catch (_) {}
    }
    const id = attr(html, "data-id") || ((html.match(/<title>\s*File\s+(\d+)\s*-/i) || [])[1]);
    if (id) {
      const type = /\/(sub|dub|hsub)(?:[?#]|$)/i.exec(embed);
      const streamType = type ? type[1] : mode;
      for (const endpoint of ["getSources", "getSourcesNew"]) {
        const payload = await h.requestJson(u.origin + "/stream/" + endpoint + "?id=" + encodeURIComponent(id) + "&type=" + encodeURIComponent(streamType), {headers: {...headers, Referer: embed, "X-Requested-With": "XMLHttpRequest"}});
        const rows = await sourceRows(payload, embed);
        if (rows.length) return wrap(rows);
      }
    }
    const iframe = (html.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i) || [])[1];
    if (iframe) { try { return await external(new URL(iframe.replace(/&amp;/g, "&"), embed).href, mode, depth + 1, visited); } catch (_) {} }
    const media = (html.match(/(?:file|src|source|url)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i) || [])[1];
    if (media) { try { const url = https(new URL(media.replace(/\\\//g, "/"), embed).href); if (url) return wrap([{url, subtitles: []}]); } catch (_) {} }
    return [];
  }
  async function resolveMode(identity, episode, mode) {
    const servers = (await discover(identity, episode)).filter(s => s.mode === mode);
    const embeds = new Map();
    const results = await parallel(servers, async server => {
      const link = https(server.linkId) ? server.linkId : await ajax("/ajax/server?get=" + encodeURIComponent(server.linkId)).then(x => x && (typeof x.result === "string" ? x.result : x.result && x.result.url));
      const key = (server.sourceType || mode) + ":" + link;
      if (!embeds.has(key)) embeds.set(key, external(link, server.sourceType || mode));
      return (await embeds.get(key)).map(x => ({...x, mode, server: server.name}));
    });
    let rows = results.flat();
    // Keep both proven identity and catalog rescue paths, without duplicate MAL/AniList rows.
    if (!rows.length) {
      for (const embed of h.directCandidates(identity, episode, mode)) rows.push(...(await external(embed, mode)).map(x => ({...x, server: "MegaPlay Fallback"})));
      if (!rows.length) for (const embed of await h.catalogCandidates(identity, episode, mode)) rows.push(...(await external(embed, mode)).map(x => ({...x, server: "Catalog Fallback"})));
    }
    const unique = new Map();
    for (const row of rows) {
      const key = mode + ":" + row.url, previous = unique.get(key);
      if (!previous) unique.set(key, {...row, mirrors: [row.server]});
      else if (!previous.mirrors.includes(row.server)) previous.mirrors.push(row.server);
    }
    return [...unique.values()].map(row => ({...row, server: row.mirrors.join(" / ")}));
  }
  return {parseServers, parseMapper, discover, external, resolveMode, subtitles, sourceRows, parallel};
}
if (typeof module !== "undefined" && module.exports) module.exports = {createAniKotoSources};
