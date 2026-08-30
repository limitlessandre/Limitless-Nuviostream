"use strict";

const PROVIDER_NAME = "WCO";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const ORIGINS = [
  "https://www.wcostream.tv",
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
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
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

function normalize(value) {
  return String(value || "").toLowerCase()
    .replace(/&amp;|&/g, " and ")
    .replace(/english\s+(dubbed|subbed)/g, " ")
    .replace(/\b(dubbed|subbed|dub|sub)\b/g, " ")
    .replace(/\bseason\s*\d+\b/g, " ")
    .replace(/\bepisode\s*\d+(?:\.\d+)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function explicitSeason(value) {
  const text = htmlDecode(String(value || ""))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let m = text.match(/\bseason\s*(\d{1,2})\b/i);
  if (m) return parseInt(m[1], 10) || null;
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  if (m) return parseInt(m[1], 10) || null;
  m = text.match(/\bS(\d{1,2})E\d+(?:\.\d+)?\b/i);
  if (m) return parseInt(m[1], 10) || null;
  if (/\bsecond\s+season\b/i.test(text)) return 2;
  if (/\bthird\s+season\b/i.test(text)) return 3;
  if (/\bfourth\s+season\b/i.test(text)) return 4;
  if (/\bfifth\s+season\b/i.test(text)) return 5;
  return null;
}

function pageIdentityText(html) {
  const text = String(html || "");
  const parts = [];
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i, /<h2[^>]*>([\s\S]*?)<\/h2>/i]) {
    const m = text.match(re);
    if (m && m[1]) parts.push(stripTags(m[1]));
  }
  return parts.join(" ");
}

function seasonPreference(value, wantedSeason) {
  const wanted = Number(wantedSeason || 1);
  const found = explicitSeason(value);
  if (found != null && found !== wanted) return -1000;
  if (found === wanted) return 25;
  return wanted === 1 ? 10 : 0;
}

function scoreTitle(candidate, wanted) {
  const a = normalize(candidate), b = normalize(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 90;
  if (a.includes(b) || b.includes(a)) return 80;
  const aw = a.split(" "), bw = b.split(" ");
  let overlap = 0;
  for (const word of bw) if (word.length > 1 && aw.includes(word)) overlap += 1;
  return Math.round((overlap / Math.max(1, bw.length)) * 70);
}

function classifyVariant(value) {
  const text = String(value || "").toLowerCase();
  if (/\bmulti(?:ple)?[\s_-]*audio\b|\bdual[\s_-]*audio\b/.test(text)) return "Multi";
  if (/english[\s_-]*dubbed|\bdubbed\b|\bdub\b/.test(text)) return "Dub";
  if (/english[\s_-]*subbed|\bsubbed\b|\bsub\b/.test(text)) return "Sub";
  return "Original";
}

function languageName(code) {
  const names = { en: "English", ja: "Japanese", ko: "Korean", zh: "Chinese" };
  return names[String(code || "").toLowerCase()] || String(code || "").toUpperCase() || "Original";
}

function variantMeta(variant, originalLanguage) {
  if (variant === "Dub") return { label: "English Dub", language: "English" };
  if (variant === "Sub") return { label: "Japanese + English Hard Subs", language: "Japanese" };
  if (variant === "Multi") return { label: "Multi Audio + Subs", language: "Multi" };
  const lang = languageName(originalLanguage || "en");
  return { label: `${lang} (Original)`, language: lang };
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
    const text = String(await res.text() || "");
    return { ok: !!res.ok, status: res.status || 0, url: res.url || url, text };
  } catch (e) {
    return { ok: false, status: 0, url, text: "", error: String(e && e.message || e) };
  }
}

async function jsonReq(url, options) {
  const res = await req(url, options);
  if (!res.ok) return null;
  try { return JSON.parse(res.text); } catch (_) { return null; }
}

async function tmdbInfo(inputId, mediaType) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  const raw = String(inputId || "").trim();
  let id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (!id && /^tt\d+$/i.test(raw)) {
    const found = await jsonReq(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const list = type === "movie" ? found && found.movie_results : found && found.tv_results;
    id = Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
  }
  if (!id) return null;
  const data = await jsonReq(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
  if (!data) return null;
  const alt = type === "movie"
    ? ((data.alternative_titles && data.alternative_titles.titles) || []).map(x => x && x.title)
    : ((data.alternative_titles && data.alternative_titles.results) || []).map(x => x && x.title);
  const title = type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
  const original = type === "movie" ? data.original_title : data.original_name;
  return {
    id, type, title: title || `TMDB ${id}`,
    titles: uniq([title, original].concat(alt)).slice(0, 6),
    originalLanguage: String(data.original_language || "").toLowerCase(),
    year: String(data.release_date || data.first_air_date || "").slice(0, 4)
  };
}

function searchLinks(html, origin) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']*(?:\/anime\/|\/videos?\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 60) {
    const href = absolute(m[1], origin);
    const inner = String(m[2] || "");
    const alt = (inner.match(/<img\b[^>]*alt=["']([^"']+)["']/i) || [])[1] || "";
    const titleAttr = (String(m[0]).match(/\btitle=["']([^"']+)["']/i) || [])[1] || "";
    const title = stripTags(titleAttr || alt || inner);
    if (!href) continue;
    if (!out.some(x => x.href === href)) out.push({ href, title, variant: classifyVariant(`${title} ${href}`) });
  }
  return out;
}

async function addSearchResults(all, info, wanted, origin, query) {
  const page = await req(`${origin}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": origin,
      "Referer": `${origin}/`
    },
    body: `catara=${encodeURIComponent(query)}&konuara=series`
  });
  if (!page.ok) return;
  const links = searchLinks(page.text, origin);
  for (const item of links) {
    const baseScore = Math.max(...info.titles.map(t => scoreTitle(item.title, t)));
    const seasonScore = seasonPreference(`${item.title} ${item.href}`, wanted);
    if (seasonScore <= -1000 || baseScore < 45) continue;
    const score = baseScore + seasonScore;
    const existing = all.find(x => x.href === item.href);
    if (!existing) all.push({ ...item, score });
    else if (score > existing.score) existing.score = score;
  }
}

async function searchWco(info, wantedSeason) {
  const all = [];
  const wanted = Number(wantedSeason || 1);
  for (const title of info.titles.slice(0, 3)) {
    const queries = wanted > 1 ? [`${title} Season ${wanted}`, title] : [title];
    for (const query of uniq(queries)) {
      for (const origin of ORIGINS) {
        await addSearchResults(all, info, wanted, origin, query);
        if (all.some(x => x.score >= 115)) break;
      }
      if (all.some(x => x.score >= 115)) break;
    }
    if (all.some(x => x.score >= 120)) break;
  }

  const variants = new Set(all.map(x => x.variant));
  const baseTitle = info.titles[0] || info.title;
  const seasonSuffix = wanted > 1 ? ` Season ${wanted}` : "";

  if (!variants.has("Sub")) {
    const query = `${baseTitle}${seasonSuffix} English Subbed`;
    for (const origin of ORIGINS.slice(0, 2)) {
      await addSearchResults(all, info, wanted, origin, query);
      if (all.some(x => x.variant === "Sub" && x.score >= 90)) break;
    }
  }

  if (!variants.has("Dub")) {
    const query = `${baseTitle}${seasonSuffix} English Dubbed`;
    for (const origin of ORIGINS.slice(0, 2)) {
      await addSearchResults(all, info, wanted, origin, query);
      if (all.some(x => x.variant === "Dub" && x.score >= 90)) break;
    }
  }

  return all.sort((a, b) => b.score - a.score).slice(0, 12);
}

function findSeriesLink(html, pageUrl) {
  const patterns = [
    /<div[^>]+class=["'][^"']*header-tag[^"']*["'][\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i,
    /<div[^>]+class=["'][^"']*video-title[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']*\/anime\/[^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = String(html || "").match(re);
    if (m && m[1]) return absolute(m[1], pageUrl);
  }
  return "";
}

function episodeLinks(html, pageUrl, wantedSeason, wantedEpisode, pageSeason) {
  const exact = [];
  const neutral = [];
  const wantedS = Number(wantedSeason || 1);
  const wantedE = Number(wantedEpisode || 1);
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && (exact.length + neutral.length) < 700) {
    const text = stripTags(m[2]);
    const href = absolute(m[1], pageUrl);
    if (!href || !text) continue;
    const ep = text.match(/Episode\s*(\d+(?:\.\d+)?)/i) || href.match(/episode[-_ ]?(\d+(?:\.\d+)?)/i);
    if (!ep || Number(ep[1]) !== wantedE) continue;

    const season = explicitSeason(`${text} ${href}`);
    if (season != null && season !== wantedS) continue;
    const item = { href, text, variant: classifyVariant(`${text} ${href}`), season };
    if (season === wantedS) exact.push(item);
    else neutral.push(item);
  }

  const dedupe = list => list.filter((item, index) => list.findIndex(x => x.href === item.href) === index);
  if (exact.length) return dedupe(exact);
  if (wantedS === 1) return dedupe(neutral);
  if (Number(pageSeason || 0) === wantedS) return dedupe(neutral);
  return [];
}

function iframeLink(html, pageUrl) {
  const m = String(html || "").match(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return m && m[1] ? absolute(m[1], pageUrl) : "";
}

function replaceEmbedPath(embedUrl, path) {
  const raw = String(embedUrl || ""), q = raw.indexOf("?");
  return `${originOf(raw)}${path}${q >= 0 ? raw.slice(q) : ""}`;
}

function getJsonPath(html) {
  const text = String(html || "");
  const patterns = [
    /\$\.getJSON\(\s*["']([^"']+)["']/i,
    /getJSON\(\s*["']([^"']+)["']/i,
    /["'](\/inc\/embed\/getvidlink\.php\?[^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
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
    if (params.has("fullhd")) return `${origin}/inc/embed/getvidlink.php?v=${embed}/${file}&embed=${embed}&fullhd=${params.get("fullhd") || "1"}`;
    return `${origin}/inc/embed/getvidlink.php?v=${file}&embed=${embed}&hd=${params.get("hd") || "1"}`;
  } catch (_) { return ""; }
}

async function playerLookup(embedUrl) {
  for (const path of ["/inc/embed/video-js-new.php", "/inc/embed/video-js-old.php", "/inc/embed/video-js.php"]) {
    const url = replaceEmbedPath(embedUrl, path);
    const page = await req(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

async function extractEmbed(embedUrl, variant, displayTitle, info) {
  if (!embedUrl || /user\.wcostream\.tv\/check-login/i.test(embedUrl)) return [];
  if (!/embed\.wcostream/i.test(embedUrl)) return [];

  const lookup = await playerLookup(embedUrl);
  if (!lookup) return [];
  const lookupRes = await req(lookup, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": embedUrl,
      "Origin": originOf(embedUrl),
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!lookupRes.ok) return [];

  let data;
  try { data = JSON.parse(lookupRes.text); } catch (_) { return []; }
  const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]);
  if (!hosts.length) return [];

  const detected = classifyVariant(`${variant} ${embedUrl}`);
  const finalVariant = detected === "Original" ? variant : detected;
  const meta = variantMeta(finalVariant, info.originalLanguage);
  const qualities = [
    data.fhd ? ["1080p", data.fhd] : null,
    data.fullhd ? ["1080p", data.fullhd] : null,
    data.hd ? ["720p", data.hd] : null,
    data.enc ? ["480p", data.enc] : null
  ].filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const item of qualities) {
    const key = `${item[0]}|${item[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let media = "";
    for (const host of hosts) {
      const mediaRes = await req(`${host}/getvid?evid=${encodeURIComponent(String(item[1]))}&json`, {
        headers: { "Referer": embedUrl, "Origin": originOf(embedUrl) }
      });
      if (!mediaRes.ok) continue;
      media = resolvedValue(mediaRes.text, mediaRes.url);
      if (media) break;
    }
    if (!media) continue;

    out.push({
      name: `${PROVIDER_NAME} • ${item[0]} • ${meta.label}`,
      title: displayTitle,
      url: media,
      quality: item[0],
      language: meta.language,
      provider: PROVIDER_NAME,
      type: /\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4",
      headers: {
        "Referer": embedUrl,
        "Origin": originOf(embedUrl),
        "User-Agent": UA
      },
      _variant: finalVariant
    });
  }
  return out;
}

async function candidatePage(candidate) {
  let pageUrl = candidate.href;
  let page = await req(pageUrl, { headers: { "Referer": `${originOf(pageUrl) || ORIGINS[0]}/` } });
  if (!page.ok) return null;
  if (!/\/anime\//i.test(pageUrl)) {
    const linked = findSeriesLink(page.text, pageUrl);
    if (linked) {
      pageUrl = linked;
      page = await req(pageUrl, { headers: { "Referer": candidate.href } });
      if (!page.ok) return null;
    }
  }
  const season = explicitSeason(`${candidate.title} ${pageUrl} ${pageIdentityText(page.text)}`);
  return { pageUrl, page, season };
}

async function tvStreams(info, season, episode) {
  const wantedSeason = Number(season || 1);
  const wantedEpisode = Number(episode || 1);
  const candidates = await searchWco(info, wantedSeason);
  const collected = [];
  const gotVariants = new Set();

  const orderedCandidates = candidates.slice(0, 12).sort((a, b) => {
    const ar = a.variant === "Dub" ? 0 : a.variant === "Sub" ? 1 : 2;
    const br = b.variant === "Dub" ? 0 : b.variant === "Sub" ? 1 : 2;
    if (gotVariants.has("Dub") && !gotVariants.has("Sub")) {
      const aa = a.variant === "Sub" ? 0 : 1;
      const bb = b.variant === "Sub" ? 0 : 1;
      if (aa !== bb) return aa - bb;
    }
    return ar - br || b.score - a.score;
  });

  for (const candidate of orderedCandidates) {
    if (candidate.variant !== "Original" && gotVariants.has(candidate.variant)) continue;
    const series = await candidatePage(candidate);
    if (!series) continue;
    if (series.season != null && series.season !== wantedSeason) continue;

    const episodes = episodeLinks(series.page.text, series.pageUrl, wantedSeason, wantedEpisode, series.season);
    if (!episodes.length) continue;

    for (const entry of episodes.slice(0, 4)) {
      const epPage = await req(entry.href, { headers: { "Referer": series.pageUrl } });
      if (!epPage.ok) continue;
      const frame = iframeLink(epPage.text, entry.href);
      if (!frame || /user\.wcostream\.tv\/check-login/i.test(frame)) continue;
      const variant = entry.variant !== "Original" ? entry.variant : candidate.variant;
      const streams = await extractEmbed(
        frame,
        variant,
        `${info.title} S${String(wantedSeason).padStart(2, "0")}E${String(wantedEpisode).padStart(2, "0")}`,
        info
      );
      if (streams.length) {
        collected.push(...streams);
        gotVariants.add(streams[0]._variant || variant || "Original");
        break;
      }
    }

    if (gotVariants.has("Dub") && gotVariants.has("Sub")) break;
  }

  return finalize(collected, info);
}

async function movieStreams(info) {
  const candidates = await searchWco(info, 1);
  for (const candidate of candidates.slice(0, 6)) {
    const page = await candidatePage(candidate);
    if (!page) continue;
    let frame = iframeLink(page.page.text, page.pageUrl);
    if (frame) {
      const streams = await extractEmbed(frame, candidate.variant, `${info.title}${info.year ? ` (${info.year})` : ""}`, info);
      if (streams.length) return finalize(streams, info);
    }
    const entries = episodeLinks(page.page.text, page.pageUrl, 1, 1, page.season);
    for (const entry of entries.slice(0, 2)) {
      const epPage = await req(entry.href, { headers: { "Referer": page.pageUrl } });
      if (!epPage.ok) continue;
      frame = iframeLink(epPage.text, entry.href);
      if (!frame) continue;
      const variant = entry.variant !== "Original" ? entry.variant : candidate.variant;
      const streams = await extractEmbed(frame, variant, `${info.title}${info.year ? ` (${info.year})` : ""}`, info);
      if (streams.length) return finalize(streams, info);
    }
  }
  return [];
}

function finalize(streams, info) {
  const byMedia = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const key = `${stream.quality}|${stream.url}`;
    if (!byMedia.has(key)) {
      byMedia.set(key, { ...stream, _variants: new Set([stream._variant || "Original"]) });
    } else {
      byMedia.get(key)._variants.add(stream._variant || "Original");
    }
  }

  const merged = [];
  for (const stream of byMedia.values()) {
    let meta;
    if (stream._variants.has("Dub") && stream._variants.has("Sub")) meta = { label: "Dual Audio + Subs", language: "Multi" };
    else if (stream._variants.has("Multi")) meta = { label: "Multi Audio + Subs", language: "Multi" };
    else if (stream._variants.has("Dub")) meta = variantMeta("Dub", info.originalLanguage);
    else if (stream._variants.has("Sub")) meta = variantMeta("Sub", info.originalLanguage);
    else meta = variantMeta("Original", info.originalLanguage);

    const clean = { ...stream };
    delete clean._variant;
    delete clean._variants;
    clean.language = meta.language;
    clean.name = `${PROVIDER_NAME} • ${clean.quality} • ${meta.label}`;
    merged.push(clean);
  }

  const quality = value => {
    const m = String(value || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const rank = name => {
    const text = String(name || "").toLowerCase();
    if (text.includes("english dub")) return 0;
    if (text.includes("dual audio")) return 1;
    if (text.includes("japanese")) return 2;
    return 3;
  };
  return merged.sort((a, b) => rank(a.name) - rank(b.name) || quality(b.quality) - quality(a.quality));
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  try {
    const info = await tmdbInfo(inputId, type);
    if (!info) return [];
    return type === "movie"
      ? await movieStreams(info)
      : await tvStreams(info, season, episode);
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] ${String(e && e.message || e)}`);
    return [];
  }
}

module.exports = { getStreams };
