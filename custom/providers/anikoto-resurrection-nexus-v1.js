"use strict";

// AniKoto Resurrection Test v0.2.0
// Nexus-only direct rebuild. No localhost relay and no legacy AniKoto resolver chain.
// Current flow: anime identity -> VRF search -> episode/server APIs -> embed resolver
// -> MegaPlay AES/HMAC or Mewcdn/direct HLS.

const PROVIDER_NAME = "AniKoto Resurrection Test";
const DOMAINS = ["anikototv.to","anikoto.bz","anikoto.cz","anikoto.me","anikoto.net","anikototv.se"];
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
let identityCache = null;
let preferredBase = "";

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function attr(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const m = String(tag || "").match(re);
  return m ? String(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || "") : "";
}

function validHttps(value) {
  try {
    const u = new URL(String(value || "").trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u;
  } catch (_) { return null; }
}

async function boundedFetch(url, options, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  try {
    const work = Promise.resolve().then(function() {
      return fetch(url, Object.assign({}, options || {}, controller ? {signal:controller.signal} : {}, {skipSizeCheck:true, redirect:"follow"}));
    });
    if (typeof setTimeout !== "function") return await work;
    const timeout = new Promise(function(resolve) {
      timer = setTimeout(function() { try { if (controller) controller.abort(); } catch (_) {} resolve(null); }, timeoutMs || 4500);
    });
    return await Promise.race([work, timeout]);
  } catch (_) {
    return null;
  } finally {
    if (timer && typeof clearTimeout === "function") clearTimeout(timer);
  }
}

async function requestText(url, options, timeoutMs) {
  const opts = options || {};
  const response = await boundedFetch(url, Object.assign({}, opts, {
    headers:Object.assign({"User-Agent":UA,"Accept-Language":"en-US,en;q=0.9"}, opts.headers || {})
  }), timeoutMs || 4500);
  if (!response || !response.ok) return "";
  try { return String(await response.text() || ""); } catch (_) { return ""; }
}

async function requestJson(url, options, timeoutMs) {
  const text = await requestText(url, options, timeoutMs);
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

async function loadIdentity() {
  if (identityCache && typeof identityCache.resolveAnimeIdentity === "function") return identityCache;
  const source = await requestText(IDENTITY_URL, {headers:{Accept:"text/plain,*/*"}}, 4500);
  if (!source) return null;
  try {
    const mod = {exports:{}};
    const exported = new Function("module","exports","require", source + "\n;return module.exports;")(
      mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }
    ) || mod.exports;
    if (!exported || typeof exported.resolveAnimeIdentity !== "function") return null;
    identityCache = exported;
    return exported;
  } catch (_) { return null; }
}

function bytesToBase64Url(bytes, keepPadding) {
  try {
    let raw = "";
    for (let i = 0; i < bytes.length; i += 4096) {
      raw += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(bytes.length, i + 4096))));
    }
    if (typeof btoa !== "function") return "";
    const text = btoa(raw).replace(/\+/g,"-").replace(/\//g,"_");
    return keepPadding ? text : text.replace(/=+$/g,"");
  } catch (_) { return ""; }
}

function base64UrlToBytes(value) {
  try {
    const base = String(value || "").replace(/-/g,"+").replace(/_/g,"/");
    const padded = base + "=".repeat((4 - base.length % 4) % 4);
    if (typeof atob !== "function") return null;
    const raw = atob(padded), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch (_) { return null; }
}

function rc4Base64Url(input, key) {
  const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  if (!enc) return "";
  const data = enc.encode(String(input || "")), keyBytes = enc.encode(String(key || ""));
  if (!keyBytes.length) return "";
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBytes[i % keyBytes.length]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0; j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return bytesToBase64Url(out, true);
}

function exchange(input, from, to) {
  return String(input || "").split("").map(function(c) {
    const i = from.indexOf(c);
    return i < 0 ? c : to.charAt(i);
  }).join("");
}

function vrfEncrypt(input) {
  try {
    let value = String(input || "");
    value = exchange(value, "AP6GeR8H0lwUz1", "UAz8Gwl10P6ReH");
    value = rc4Base64Url(value, "ItFKjuWokn4ZpB");
    value = rc4Base64Url(value, "fOyt97QWFB3");
    value = exchange(value, "1majSlPQd2M5", "da1l2jSmP5QM");
    value = exchange(value, "CPYvHj09Au3", "0jHA9CPYu3v");
    value = value.split("").reverse().join("");
    value = rc4Base64Url(value, "736y1uTJpBLUX");
    const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    if (!enc) return "";
    return encodeURIComponent(bytesToBase64Url(enc.encode(value), true));
  } catch (_) { return ""; }
}

async function firstWorkingSite(path, headers) {
  const order = preferredBase ? [preferredBase].concat(DOMAINS.map(function(x){return "https://" + x;}).filter(function(x){return x !== preferredBase;}))
    : DOMAINS.map(function(x){return "https://" + x;});
  return await new Promise(function(resolve) {
    let pending = order.length, settled = false;
    order.forEach(function(base) {
      requestText(base + path, {headers:headers || {}}, 3500).then(function(body) {
        if (!settled && body) {
          settled = true; preferredBase = base; resolve({base:base, body:body});
        }
        pending--;
        if (!settled && pending <= 0) resolve(null);
      }).catch(function() {
        pending--;
        if (!settled && pending <= 0) resolve(null);
      });
    });
  });
}

async function siteText(base, path, headers, timeoutMs) {
  const body = await requestText(base + path, {headers:headers || {}}, timeoutMs || 4500);
  return body;
}

function aliases(identity) {
  const values = [].concat(identity && identity.animeAliases || [])
    .concat(identity && identity.aliases || [])
    .concat(identity && identity.fallbackAliases || [])
    .concat([identity && identity.title, identity && identity.originalTitle]);
  const out = [], seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(text);
  }
  return out.slice(0,12);
}

function searchRows(html) {
  const out = [], re = /<a\b([^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 80) {
    const attrs = m[1], href = attr(attrs,"href");
    if (!/\/watch\//i.test(href)) continue;
    const text = cleanText(m[2]), en = attr(attrs,"data-en"), jp = attr(attrs,"data-jp");
    out.push({href:href, title:en || text, english:en, japanese:jp, text:text});
  }
  return out;
}

function sourcePath(href) {
  const m = String(href || "").match(/(?:https?:\/\/[^/]+)?(\/watch\/[^?#]+)/i);
  return m ? m[1].replace(/\/$/,"").replace(/\/ep-\d+(?:\.\d+)?$/,"") : "";
}

function parseAnimeId(html) {
  const tag = (String(html || "").match(/<[^>]*\bid=["']watch-main["'][^>]*>/i) || [])[0] || "";
  return attr(tag,"data-id") || attr(tag,"data-tip") || "";
}

function parseEpisode(html, wanted) {
  const anchors = String(html || "").match(/<a\b[^>]*>/gi) || [];
  for (const tag of anchors) {
    if (Number(attr(tag,"data-num")) !== Number(wanted)) continue;
    return {
      ids:attr(tag,"data-ids"),
      mal:attr(tag,"data-mal"),
      slug:attr(tag,"data-slug"),
      timestamp:attr(tag,"data-timestamp")
    };
  }
  return null;
}

function parseServers(html) {
  const out = [], text = String(html || "");
  const groupRe = /data-type\s*=\s*["']([^"']+)["']([\s\S]*?)(?=data-type\s*=|$)/gi;
  let group;
  while ((group = groupRe.exec(text))) {
    const type = String(group[1] || "").toLowerCase();
    const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
    let li;
    while ((li = liRe.exec(group[2]))) {
      if (/download-icon/i.test(attr(li[1],"class"))) continue;
      const id = attr(li[1],"data-link-id") || attr(li[1],"data-id");
      if (!id) continue;
      out.push({id:id, name:cleanText(li[2]) || "Server", type:type});
    }
  }
  return out.slice(0,8);
}

function isTcdn(value) {
  try { return String(new URL(String(value || "")).searchParams.get("s") || "").toLowerCase() === "tcdn"; }
  catch (_) { return /[?&]s=tcdn(?:[&#]|$)/i.test(String(value || "")); }
}

function isDirect(value) {
  return /^https:\/\//i.test(String(value || "")) && /\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(value || "")) && !/\/stream\//i.test(String(value || ""));
}

async function decryptEnc(token) {
  try {
    if (!globalThis.crypto || !crypto.subtle) return "";
    const cipher = base64UrlToBytes(token);
    if (!cipher || !cipher.length || cipher.length % 16) return "";
    const keyBytes = new Uint8Array(32), enc = new TextEncoder();
    keyBytes.set(enc.encode("i?LMTAx0Q6,:}50U").subarray(0,32));
    const iv = enc.encode("W0;27ToaUpl_P%'c");
    const key = await crypto.subtle.importKey("raw", keyBytes, {name:"AES-CBC"}, false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({name:"AES-CBC",iv:iv}, key, cipher));
    const text = new TextDecoder().decode(plain);
    const obj = JSON.parse(text);
    return String(obj && obj.file || "");
  } catch (_) { return ""; }
}

async function signMedia(value) {
  try {
    const u = new URL(String(value || ""));
    if (u.searchParams.get("token")) return u.href;
    const m = u.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if (!m) return u.href;
    if (!globalThis.crypto || !crypto.subtle) return "";
    const payload = String(Math.floor(Date.now()/1000) + 90) + "|" + m[1].toLowerCase() + "/" + m[2].toLowerCase();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s"), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
    const token = bytesToBase64Url(enc.encode(payload), false) + "." + bytesToBase64Url(sig, false);
    if (!token || token === ".") return "";
    u.searchParams.set("token", token);
    return u.href;
  } catch (_) { return ""; }
}

function subtitleLanguage(label) {
  const text = String(label || "").toLowerCase();
  if (/english|^eng?$/.test(text)) return "en";
  if (/japanese|jpn/.test(text)) return "ja";
  if (/spanish|spa/.test(text)) return "es";
  if (/portuguese|por/.test(text)) return "pt";
  if (/french|fra/.test(text)) return "fr";
  return "und";
}

function subtitleRows(payload) {
  const out = [], seen = new Set();
  for (const track of Array.isArray(payload && payload.tracks) ? payload.tracks : []) {
    if (track && track.kind && !/^(captions|subtitles)$/i.test(String(track.kind))) continue;
    const u = validHttps(track && (track.file || track.url));
    if (!u || seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({id:String(track.label || "Subtitle"), name:String(track.label || "Subtitle"), language:subtitleLanguage(track.label), url:u.href});
  }
  return out;
}

async function resolveMegaPlay(embedUrl, siteBase) {
  if (isTcdn(embedUrl)) return null;
  const embed = validHttps(embedUrl);
  if (!embed) return null;
  const page = await requestText(embed.href, {headers:{Referer:siteBase + "/","X-Requested-With":"XMLHttpRequest",Accept:"text/html,application/xhtml+xml,*/*;q=0.8"}}, 4500);
  if (!page) return null;
  const mediaId = (page.match(/data-id=["']([^"']+)["']/i) || page.match(/File\s+(\d+)/i) || [])[1];
  if (!mediaId) return null;
  const origin = embed.origin, api = new URL(origin + "/stream/getSources");
  api.searchParams.set("id", mediaId);
  const server = embed.searchParams.get("s");
  if (server) api.searchParams.set("s", server);
  const payload = await requestJson(api.href, {headers:{Referer:embed.href,"X-Requested-With":"XMLHttpRequest",Accept:"application/json,*/*"}}, 4500);
  if (!payload) return null;
  let media = "";
  let decrypted = false;
  if (typeof payload.enc === "string" && payload.enc) {
    media = await decryptEnc(payload.enc);
    decrypted = !!media;
  }
  if (!media) {
    const sources = payload.sources;
    if (typeof sources === "string") media = sources;
    else if (Array.isArray(sources) && sources[0]) media = String(sources[0].file || sources[0].url || sources[0]);
    else if (sources && typeof sources === "object") media = String(sources.file || sources.url || "");
  }
  if (!validHttps(media) || isTcdn(media)) return null;
  if (decrypted && !/[?&]token=/i.test(media)) media = await signMedia(media);
  const mediaUrl = validHttps(media);
  if (!mediaUrl) return null;
  return {url:mediaUrl.href, headers:{Referer:origin + "/",Origin:origin,"User-Agent":UA}, subtitles:subtitleRows(payload)};
}

async function resolveMewcdn(embedUrl, siteBase) {
  const embed = validHttps(embedUrl);
  if (!embed) return null;
  const fragment = String(embed.hash || "").replace(/^#/,"").split("#")[0];
  if (!fragment) return null;
  let media = "";
  try {
    const bytes = base64UrlToBytes(fragment);
    if (!bytes) return null;
    media = new TextDecoder().decode(bytes).trim();
  } catch (_) { return null; }
  if (!validHttps(media)) return null;
  const page = await requestText(embed.href, {headers:{Referer:siteBase + "/"}}, 4000);
  const hostMap = (String(page || "").match(/var\s+HOST_MAP\s*=\s*\{([^}]+)\}/) || [])[1] || "";
  for (const m of hostMap.matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)) {
    if (media.includes(m[1])) { media = media.replace(m[1],m[2]); break; }
  }
  const final = validHttps(media);
  return final ? {url:final.href, headers:{Referer:"https://mewcdn.online/",Origin:"https://mewcdn.online","User-Agent":UA}, subtitles:[]} : null;
}

async function resolveEmbed(embedUrl, siteBase, referer) {
  const url = String(embedUrl || "").trim();
  if (!url || isTcdn(url)) return null;
  if (isDirect(url)) return {url:url,headers:{Referer:referer || siteBase + "/",Origin:siteBase,"User-Agent":UA},subtitles:[]};
  if (/mewcdn\.online\/player\/plyr\.php/i.test(url)) return await resolveMewcdn(url, siteBase);
  const mega = await resolveMegaPlay(url, siteBase);
  if (mega) return mega;
  const u = validHttps(url);
  if (!u) return null;
  const page = await requestText(u.href,{headers:{Referer:siteBase + "/"}},3500);
  const direct = (String(page || "").match(/https:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i) || [])[0];
  return direct ? {url:direct.replace(/\\\//g,"/"),headers:{Referer:u.origin + "/",Origin:u.origin,"User-Agent":UA},subtitles:[]} : null;
}

function rowFor(identity, season, requestedEpisode, server, resolved) {
  const subs = Array.isArray(resolved.subtitles) ? resolved.subtitles : [];
  let tag = "[UNK]";
  if (/dub/i.test(server.type)) tag = subs.length ? "[DUB+SUB]" : "[DUB]";
  else if (subs.length) tag = "[SUB]";
  else if (/h-?sub/i.test(server.type)) tag = "[HSUB]";
  const show = String(identity.title || (identity.animeAliases && identity.animeAliases[0]) || "Anime");
  const ep = "S" + String(Number(season || 1)).padStart(2,"0") + "E" + String(Number(requestedEpisode || 1)).padStart(2,"0");
  return {
    name:PROVIDER_NAME + " • Unknown Auto • " + tag + " • " + server.name,
    title:show + " • " + ep,
    url:resolved.url,
    quality:"Auto",
    language:/dub/i.test(server.type) ? "English" : "Japanese",
    provider:PROVIDER_NAME,
    type:/\.mp4(?:$|[?#])/i.test(resolved.url) ? "mp4" : "m3u8",
    headers:resolved.headers,
    subtitles:subs
  };
}

async function findSeries(identity) {
  const names = aliases(identity);
  for (const term of names.slice(0,3)) {
    const path = "/filter?keyword=" + encodeURIComponent(term) + "&vrf=" + vrfEncrypt(term);
    const first = preferredBase
      ? {base:preferredBase,body:await siteText(preferredBase,path,{Referer:preferredBase + "/"},4000)}
      : await firstWorkingSite(path,{Referer:"https://anikototv.to/"});
    if (!first || !first.body) continue;
    const rows = searchRows(first.body);
    const match = rows.find(function(row) {
      const candidates = [row.title,row.english,row.japanese,row.text].map(normalize).filter(Boolean);
      return names.some(function(name){ return candidates.includes(normalize(name)); });
    });
    if (match) return {base:first.base,path:sourcePath(match.href)};
  }
  return null;
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const helper = await loadIdentity();
    if (!helper) return [];
    const identity = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    if (!identity || !identity.isAnime) return [];
    const requestedEpisode = String(mediaType || "tv").toLowerCase() === "movie" ? 1 : Number(episode || 1);
    const mappedEpisode = String(mediaType || "tv").toLowerCase() === "movie" ? 1 : Number(identity.mappedEpisode || requestedEpisode || 1);
    const found = await findSeries(identity);
    if (!found || !found.path) return [];
    const watch = await siteText(found.base, found.path + "/ep-" + mappedEpisode, {Referer:found.base + "/"}, 4500);
    if (!watch) return [];
    const animeId = parseAnimeId(watch);
    if (!animeId) return [];
    const list = await requestJson(found.base + "/ajax/episode/list/" + encodeURIComponent(animeId) + "?vrf=" + vrfEncrypt(animeId), {
      headers:{Accept:"application/json, text/javascript, */*; q=0.01",Referer:found.base + found.path,"X-Requested-With":"XMLHttpRequest"}
    },4500);
    const ep = parseEpisode(list && list.result, mappedEpisode);
    if (!ep || !ep.ids) return [];
    const serverPayload = await requestJson(found.base + "/ajax/server/list?servers=" + encodeURIComponent(ep.ids), {
      headers:{Accept:"application/json, text/javascript, */*; q=0.01",Referer:found.base + found.path + "/ep-" + mappedEpisode,"X-Requested-With":"XMLHttpRequest"}
    },4500);
    const servers = parseServers(serverPayload && (serverPayload.result || serverPayload.html));
    if (!servers.length) return [];

    const work = servers.slice(0,6).map(async function(server) {
      try {
        const target = await requestJson(found.base + "/ajax/server?get=" + encodeURIComponent(server.id), {
          headers:{Accept:"application/json, text/javascript, */*; q=0.01",Referer:found.base + found.path + "/ep-" + mappedEpisode,"X-Requested-With":"XMLHttpRequest"}
        },4000);
        const embed = target && target.result && (typeof target.result === "string" ? target.result : target.result.url);
        if (!embed) return null;
        const resolved = await resolveEmbed(embed, found.base, found.base + found.path + "/ep-" + mappedEpisode);
        return resolved ? rowFor(identity, season, requestedEpisode, server, resolved) : null;
      } catch (_) { return null; }
    });
    const rows = (await Promise.all(work)).filter(Boolean);
    const seen = new Set();
    return rows.filter(function(r){ if (seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0,6);
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = {getStreams};
else globalThis.getStreams = getStreams;
