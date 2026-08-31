"use strict";

const PROVIDER_NAME = "WCO Special Test";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const ORIGINS = [
  "https://www.wcostream.tv",
  "https://www.wco.tv",
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net"
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function uniq(values) {
  const seen = new Set();
  return (values || []).filter(value => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&quot;/g, "\"");
}

function stripTags(value) {
  return htmlDecode(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function originOf(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}

function absolute(value, base) {
  const raw = htmlDecode(value).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  const origin = originOf(base) || ORIGINS[0];
  return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function allowedWco(url) {
  const host = (String(url || "").match(/^https?:\/\/([^/]+)/i) || [])[1] || "";
  return /(^|\.)(wcostream\.tv|wco\.tv|wcoflix\.tv|wcoforever\.net)$/i.test(host);
}

function normalize(value) {
  return String(value || "").toLowerCase()
    .replace(/&amp;|&/g, " and ")
    .replace(/english\s+(dubbed|subbed)/g, " ")
    .replace(/\b(dubbed|subbed|dub|sub|fullhd|hd|movie)\b/g, " ")
    .replace(/\bseason\s*\d+\b/g, " ")
    .replace(/\bepisode\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\b/g, " ")
    .replace(/\(\d{4}\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function scoreTitle(candidate, wanted) {
  const a = normalize(candidate), b = normalize(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return 94;
  if (a.includes(b) || b.includes(a)) return 88;
  const aw = a.split(" "), bw = b.split(" ");
  let overlap = 0;
  for (const word of bw) if (word.length > 1 && aw.includes(word)) overlap += 1;
  return Math.round((overlap / Math.max(1, bw.length)) * 80);
}

function bestScore(value, aliases) {
  let score = 0;
  for (const alias of aliases || []) score = Math.max(score, scoreTitle(value, alias));
  return score;
}

const TITLE_STOP_WORDS = new Set(["a", "an", "and", "at", "in", "is", "it", "of", "on", "the", "to", "yet", "part", "special"]);

function distinctiveWords(value) {
  return normalize(value).split(" ").filter(word => word.length >= 3 && !TITLE_STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function hasDistinctiveMatch(candidate, aliases) {
  const words = new Set(normalize(candidate).split(" "));
  for (const alias of aliases || []) {
    const needed = distinctiveWords(alias);
    if (!needed.length) continue;
    if (needed.every(word => words.has(word))) return true;
  }
  return false;
}

function targetAliases(title, alternatives) {
  const out = [title].concat(alternatives || []);
  for (const value of out.slice()) {
    const raw = String(value || "").trim();
    const colon = raw.split(":");
    if (colon.length > 1) out.push(colon.slice(1).join(":").trim());
    const dash = raw.split(/\s[-–—]\s/);
    if (dash.length > 1) out.push(dash.slice(1).join(" ").trim());
    const inMatch = raw.match(/^(.{1,60}?)\s+in\s+["'“”]?(.+?)["'“”]?$/i);
    if (inMatch) out.push(inMatch[2].trim());
    const quote = raw.match(/["'“”]([^"'“”]{4,})["'“”]/);
    if (quote) out.push(quote[1].trim());
  }
  return uniq(out).filter(x => normalize(x).length >= 3);
}

function franchiseRoots(title, alternatives) {
  const out = [];
  for (const value of [title].concat(alternatives || [])) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const inMatch = raw.match(/^(.{1,60}?)\s+in\s+["'“”]?.+$/i);
    if (inMatch) out.push(inMatch[1].trim());
    const colon = raw.split(":")[0].trim();
    if (colon && colon.split(/\s+/).length <= 8) out.push(colon);
  }
  return uniq(out).filter(x => normalize(x).length >= 3);
}

function classifyVariant(value, forced) {
  if (forced) return forced;
  const text = String(value || "").toLowerCase();
  if (/english[\s_-]*subbed|\bsubbed\b|\bsub\b/.test(text)) return "Sub";
  if (/english[\s_-]*dubbed|\bdubbed\b|\bdub\b/.test(text)) return "Dub";
  return "Original";
}

function variantMeta(variant, originalLanguage) {
  if (variant === "Sub") return { label: "Japanese + English Hard Subs", language: "Japanese" };
  if (variant === "Dub") return { label: "English Dub", language: "English" };
  if (String(originalLanguage || "").toLowerCase() === "ja") return { label: "Japanese (Original)", language: "Japanese" };
  return { label: "English (Original)", language: "English" };
}

async function req(url, options) {
  const opts = options || {};
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {})
      },
      skipSizeCheck: true
    });
    return { ok: !!res.ok, status: res.status || 0, url: res.url || url, text: String(await res.text() || "") };
  } catch (_) {
    return { ok: false, status: 0, url, text: "" };
  }
}

async function jsonReq(url, options) {
  const res = await req(url, options);
  if (!res.ok) return null;
  try { return JSON.parse(res.text); } catch (_) { return null; }
}

async function resolveTmdbId(inputId, type) {
  const raw = String(inputId || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/^tt\d+$/i.test(raw)) return null;
  const found = await jsonReq(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const list = type === "movie" ? found && found.movie_results : found && found.tv_results;
  return Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
}

async function tmdbTarget(inputId, mediaType, season, episode) {
  const type = String(mediaType || "").toLowerCase() === "movie" ? "movie" : "tv";
  const id = await resolveTmdbId(inputId, type);
  if (!id) return null;

  if (type === "movie") {
    const data = await jsonReq(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
    if (!data) return null;
    const alt = ((data.alternative_titles && data.alternative_titles.titles) || []).map(x => x && x.title);
    const title = data.title || data.original_title || `TMDB ${id}`;
    return {
      type: "movie",
      id,
      title,
      targetAliases: targetAliases(title, [data.original_title].concat(alt)),
      strictAliases: targetAliases(title, [data.original_title]),
      seriesAliases: franchiseRoots(title, [data.original_title].concat(alt)),
      originalLanguage: String(data.original_language || "en").toLowerCase(),
      year: String(data.release_date || "").slice(0, 4)
    };
  }

  if (Number(season) !== 0) return null;
  const show = await jsonReq(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
  const special = await jsonReq(`https://api.themoviedb.org/3/tv/${id}/season/0/episode/${Number(episode || 1)}?api_key=${TMDB_API_KEY}`);
  if (!show || !special) return null;
  const alt = ((show.alternative_titles && show.alternative_titles.results) || []).map(x => x && x.title);
  const showTitle = show.name || show.original_name || `TMDB ${id}`;
  const specialTitle = special.name || `Special ${episode}`;
  return {
    type: "special",
    id,
    title: `${showTitle} • ${specialTitle}`,
    targetAliases: targetAliases(specialTitle, []),
    strictAliases: targetAliases(specialTitle, []),
    seriesAliases: uniq([showTitle, show.original_name].concat(alt)).filter(Boolean),
    originalLanguage: String(show.original_language || "").toLowerCase(),
    year: String(special.air_date || show.first_air_date || "").slice(0, 4)
  };
}

function anchorLinks(html, base, forcedVariant) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 1200) {
    const href = absolute(m[1], base);
    const text = stripTags(m[2]);
    if (!href || !text || !allowedWco(href)) continue;
    if (!out.some(x => x.href === href && x.text === text)) {
      out.push({ href, text, variant: classifyVariant(`${text} ${href}`, forcedVariant) });
    }
  }
  return out;
}

async function postSearch(query) {
  const out = [];
  for (const origin of ORIGINS) {
    const page = await req(`${origin}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": origin,
        "Referer": `${origin}/`
      },
      body: `catara=${encodeURIComponent(query)}&konuara=series`
    });
    if (page.ok) out.push(...anchorLinks(page.text, origin));
  }
  return out.filter((item, index, list) => list.findIndex(x => x.href === item.href) === index);
}

function comboQueries(target) {
  const out = [];
  for (const root of target.seriesAliases.slice(0, 3)) {
    for (const title of target.targetAliases.slice(0, 3)) out.push(`${root} ${title}`);
  }
  return uniq(out.concat(target.targetAliases.slice(0, 4), target.seriesAliases.slice(0, 4)));
}

async function findDirectEntries(target) {
  const out = [];
  for (const query of comboQueries(target).slice(0, 8)) {
    for (const item of await postSearch(query)) {
      if (/\/anime\//i.test(item.href)) continue;
      const identity = `${item.text} ${item.href}`;
      const targetScore = bestScore(identity, target.targetAliases);
      const seriesScore = target.seriesAliases.length ? bestScore(identity, target.seriesAliases) : 100;
      if (targetScore < 82 || seriesScore < 55 || !hasDistinctiveMatch(identity, target.strictAliases || target.targetAliases)) continue;
      out.push({ ...item, score: targetScore + Math.min(20, Math.round(seriesScore / 5)) });
    }
    if (out.some(x => x.score >= 112)) break;
  }
  return out.sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex(x => x.href === item.href) === index)
    .slice(0, 8);
}

async function findSeriesCandidates(target) {
  const out = [];
  for (const seed of target.seriesAliases.slice(0, 5)) {
    for (const item of await postSearch(seed)) {
      if (!/\/anime\//i.test(item.href)) continue;
      const score = bestScore(`${item.text} ${item.href}`, target.seriesAliases);
      if (score >= 76) out.push({ ...item, score });
    }
    if (out.some(x => x.score >= 94)) break;
  }
  return out.sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex(x => x.href === item.href) === index)
    .slice(0, 6);
}

async function specialEntriesFromSeries(seriesUrl, target) {
  const base = String(seriesUrl).replace(/[?#].*$/, "").replace(/\/$/, "");
  const pages = [
    { url: `${base}/?season=all`, variant: null },
    { url: `${base}/?season=all&lang=dub`, variant: "Dub" },
    { url: `${base}/?season=all&lang=sub`, variant: "Sub" }
  ];
  const out = [];
  for (const source of pages) {
    const page = await req(source.url, { headers: { "Referer": seriesUrl } });
    if (!page.ok) continue;
    for (const item of anchorLinks(page.text, source.url, source.variant)) {
      if (/\/anime\//i.test(item.href)) continue;
      const identity = `${item.text} ${item.href}`;
      const score = bestScore(identity, target.targetAliases);
      if (score >= 78 && hasDistinctiveMatch(identity, target.strictAliases || target.targetAliases)) out.push({ ...item, score });
    }
  }
  return out.sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex(x => x.href === item.href && x.variant === item.variant) === index)
    .slice(0, 10);
}

function base64Decode(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const clean = String(input || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "", i = 0;
  while (i < clean.length) {
    const e1 = chars.indexOf(clean.charAt(i++));
    const e2 = chars.indexOf(clean.charAt(i++));
    const e3 = chars.indexOf(clean.charAt(i++));
    const e4 = chars.indexOf(clean.charAt(i++));
    if (e1 < 0 || e2 < 0) break;
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== 64 && e3 >= 0) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== 64 && e4 >= 0) out += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return out;
}

function iframeFromMarkup(markup, pageUrl) {
  const m = String(markup || "").match(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return m && m[1] ? absolute(m[1], pageUrl) : "";
}

function legacyIframe(html, pageUrl) {
  const source = String(html || "");
  const uriPatterns = [
    /decodeURIComponent\(\s*["']([^"']+)["']\s*\)/gi,
    /unescape\(\s*["']([^"']+)["']\s*\)/gi
  ];
  for (const re of uriPatterns) {
    let m;
    while ((m = re.exec(source))) {
      try {
        const decoded = decodeURIComponent(m[1]);
        const frame = iframeFromMarkup(decoded, pageUrl);
        if (frame) return frame;
      } catch (_) {}
    }
  }

  try {
    const scriptMatches = source.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const script of scriptMatches) {
      if (!/decodeURIComponent|fromCharCode|document\.write|base64|atob/i.test(script)) continue;
      const list = script.match(/\[((?:\s*["'][A-Za-z0-9+/=]+["']\s*,?\s*){4,})\]/);
      if (!list) continue;
      const shifts = script.match(/-\s*(\d+)\s*\)/g) || [];
      const shiftMatch = shifts.length ? shifts[shifts.length - 1].match(/(\d+)/) : null;
      const shift = shiftMatch ? parseInt(shiftMatch[1], 10) : 0;
      const parts = [];
      const partRe = /["']([A-Za-z0-9+/=]+)["']/g;
      let part;
      while ((part = partRe.exec(list[1]))) parts.push(part[1]);
      const decoded = parts.map(value => {
        const digits = base64Decode(value).replace(/\D/g, "");
        if (!digits) return "";
        return String.fromCharCode(parseInt(digits, 10) - shift);
      }).join("");
      const frame = iframeFromMarkup(decoded, pageUrl);
      if (frame) return frame;
    }
  } catch (_) {}

  const atobRe = /atob\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/gi;
  let atobMatch;
  while ((atobMatch = atobRe.exec(source))) {
    try {
      const decoded = base64Decode(atobMatch[1]);
      const frame = iframeFromMarkup(decoded, pageUrl);
      if (frame) return frame;
    } catch (_) {}
  }
  return "";
}

function iframeLink(html, pageUrl) {
  const direct = iframeFromMarkup(html, pageUrl);
  return direct || legacyIframe(html, pageUrl);
}

function replaceEmbedPath(embedUrl, path) {
  const raw = String(embedUrl || ""), q = raw.indexOf("?");
  return `${originOf(raw)}${path}${q >= 0 ? raw.slice(q) : ""}`;
}

function getJsonPath(html) {
  for (const re of [
    /\$\.getJSON\(\s*["']([^"']+)["']/i,
    /getJSON\(\s*["']([^"']+)["']/i,
    /["'](\/inc\/embed\/getvidlink\.php\?[^"']+)["']/i
  ]) {
    const m = String(html || "").match(re);
    if (m && m[1]) return htmlDecode(m[1].replace(/\\\//g, "/"));
  }
  return "";
}

function legacyLookup(embedUrl) {
  try {
    const params = new URLSearchParams(String(embedUrl || "").split("?").slice(1).join("?"));
    const raw = params.get("file");
    if (!raw) return "";
    const embed = params.get("embed") || "";
    const file = raw.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/");
    const origin = originOf(embedUrl);
    if (params.has("fullhd")) {
      return `${origin}/inc/embed/getvidlink.php?v=${embed}/${file}&embed=${embed}&fullhd=${params.get("fullhd") || "1"}`;
    }
    return `${origin}/inc/embed/getvidlink.php?v=${file}&embed=${embed}&hd=${params.get("hd") || "1"}`;
  } catch (_) {
    return "";
  }
}

async function playerLookup(embedUrl) {
  for (const path of ["/inc/embed/video-js-new.php", "/inc/embed/video-js-old.php", "/inc/embed/video-js.php"]) {
    const url = replaceEmbedPath(embedUrl, path);
    const page = await req(url, {
      headers: {
        "Referer": embedUrl,
        "Origin": originOf(embedUrl),
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin"
      }
    });
    if (!page.ok) continue;
    const found = getJsonPath(page.text);
    if (found) return absolute(found, originOf(embedUrl));
  }
  return legacyLookup(embedUrl);
}

function cleanHost(value) {
  return String(value || "").replace(/\\\//g, "/").replace(/\\/g, "").trim().replace(/\/$/, "");
}

function resolvedValue(text, responseUrl) {
  let raw = String(text || "").trim().replace(/\\\//g, "/");
  try {
    const data = JSON.parse(raw);
    if (typeof data === "string") raw = data;
    else if (data && typeof data.url === "string") raw = data.url;
    else if (data && typeof data.file === "string") raw = data.file;
  } catch (_) {
    raw = raw.replace(/^["']|["']$/g, "");
  }
  raw = String(raw || "").replace(/\\\//g, "/").replace(/\\/g, "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(String(responseUrl || "")) && !/\/getvid\?evid=/i.test(String(responseUrl))) return String(responseUrl);
  return "";
}

function debugStream(message, target) {
  return [{
    name: `${PROVIDER_NAME} • DIAG • ${message}`,
    title: target ? target.title : "WCO Special Diagnostic",
    url: "https://www.wcostream.tv/favicon.ico",
    quality: "Debug",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
}

async function extractEntry(entry, target) {
  const page = await req(entry.href, { headers: { "Referer": `${originOf(entry.href)}/` } });
  if (!page.ok) return { streams: [], reason: `MATCHED ${entry.text} • HTTP ${page.status}` };

  const frame = iframeLink(page.text, entry.href);
  if (!frame) return { streams: [], reason: `MATCHED ${entry.text} • NO IFRAME/LEGACY` };
  if (/user\.wcostream\.tv\/check-login/i.test(frame)) return { streams: [], reason: `MATCHED ${entry.text} • PREMIUM` };
  if (!/embed\.wcostream/i.test(frame)) return { streams: [], reason: `MATCHED ${entry.text} • FRAME ${originOf(frame)}` };

  const lookup = await playerLookup(frame);
  if (!lookup) return { streams: [], reason: `MATCHED ${entry.text} • NO PLAYER` };
  const lookupRes = await req(lookup, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": frame,
      "Origin": originOf(frame),
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!lookupRes.ok) return { streams: [], reason: `MATCHED ${entry.text} • LOOKUP ${lookupRes.status}` };

  let data;
  try { data = JSON.parse(lookupRes.text); }
  catch (_) { return { streams: [], reason: `MATCHED ${entry.text} • BAD JSON` }; }

  const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]);
  const meta = variantMeta(entry.variant, target.originalLanguage);
  const qualities = [
    data.fhd ? ["1080p", data.fhd] : null,
    data.fullhd ? ["1080p", data.fullhd] : null,
    data.hd ? ["720p", data.hd] : null,
    data.enc ? ["480p", data.enc] : null
  ].filter(Boolean);

  const out = [];
  for (const item of qualities) {
    let media = "";
    for (const host of hosts) {
      const mediaRes = await req(`${host}/getvid?evid=${encodeURIComponent(String(item[1]))}&json`, {
        headers: { "Referer": frame, "Origin": originOf(frame) }
      });
      if (!mediaRes.ok) continue;
      media = resolvedValue(mediaRes.text, mediaRes.url);
      if (media) break;
    }
    if (!media) continue;
    out.push({
      name: `${PROVIDER_NAME} • ${item[0]} • ${meta.label} • ${entry.text}`,
      title: `${target.title}${target.year ? ` (${target.year})` : ""}`,
      url: media,
      quality: item[0],
      language: meta.language,
      provider: PROVIDER_NAME,
      type: /\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4",
      headers: {
        "Referer": frame,
        "Origin": originOf(frame),
        "User-Agent": UA
      }
    });
  }
  return { streams: out, reason: out.length ? "" : `MATCHED ${entry.text} • NO MEDIA` };
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "").toLowerCase() === "movie" ? "movie" : "tv";
  if (type === "tv" && Number(season) !== 0) return [];
  try {
    const target = await tmdbTarget(inputId, type, season, episode);
    if (!target) return debugStream("NO TMDB TARGET", null);
    let bestReason = "";

    const direct = await findDirectEntries(target);
    for (const entry of direct) {
      const result = await extractEntry(entry, target);
      if (result.streams.length) return result.streams;
      if (!bestReason) bestReason = result.reason;
    }

    const series = await findSeriesCandidates(target);
    for (const parent of series) {
      const entries = await specialEntriesFromSeries(parent.href, target);
      for (const entry of entries) {
        const result = await extractEntry(entry, target);
        if (result.streams.length) return result.streams;
        if (!bestReason) bestReason = result.reason;
      }
    }

    if (bestReason) return debugStream(bestReason.slice(0, 130), target);
    if (series.length) return debugStream(`SERIES ${series[0].text || series[0].href} • NO SPECIAL MATCH`, target);
    if (direct.length) return debugStream(`DIRECT ${direct[0].text || direct[0].href} • NO PLAYABLE`, target);
    return debugStream(`NO MATCH • ${target.targetAliases[0] || target.title}`, target);
  } catch (_) {
    return debugStream("RUNTIME ERROR", null);
  }
}

module.exports = { getStreams };