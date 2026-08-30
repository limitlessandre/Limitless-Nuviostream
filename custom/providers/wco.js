"use strict";

const PROVIDER_NAME = "WCO";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const ORIGINS = [
  "https://www.wcostream.tv",
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net",
  "https://www.wco.tv",
  "https://www.wcoanimedub.tv",
  "https://www.wcoanimesub.tv"
];
const SEARCH_ORIGINS = ORIGINS.slice(0, 4);
const DUB_ORIGIN = ORIGINS[4];
const SUB_ORIGIN = ORIGINS[5];
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
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/gi, "'");
}

function stripTags(value) {
  return htmlDecode(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function originOf(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}

function pathOf(url) {
  const m = String(url || "").match(/^https?:\/\/[^/]+(\/.*)?$/i);
  return m ? (m[1] || "/") : String(url || "/");
}

function absolute(value, base) {
  const raw = htmlDecode(value).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  const origin = originOf(base) || ORIGINS[0];
  return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function rewriteOrigin(url, origin) {
  const path = pathOf(url);
  return `${String(origin || "").replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function normalize(value) {
  return String(value || "").toLowerCase()
    .replace(/&amp;|&/g, " and ")
    .replace(/english\s+(dubbed|subbed)/g, " ")
    .replace(/\b(dubbed|subbed|dub|sub)\b/g, " ")
    .replace(/\bseason\s*\d+\b/g, " ")
    .replace(/\bepisode\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\b/g, " ")
    .replace(/\bmovie\b/g, " ")
    .replace(/\(\d{4}\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function scoreTitle(candidate, wanted) {
  const a = normalize(candidate), b = normalize(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return 92;
  if (a.includes(b) || b.includes(a)) return 84;
  const aw = a.split(" "), bw = b.split(" ");
  let overlap = 0;
  for (const word of bw) if (word.length > 1 && aw.includes(word)) overlap += 1;
  return Math.round((overlap / Math.max(1, Math.max(aw.length, bw.length))) * 80);
}

function bestScore(candidate, titles) {
  let score = 0;
  for (const title of titles || []) score = Math.max(score, scoreTitle(candidate, title));
  return score;
}

function classifyVariant(value) {
  const text = String(value || "").toLowerCase();
  if (/\bmulti(?:ple)?[\s_-]*audio\b|\bdual[\s_-]*audio\b/.test(text)) return "Multi";
  if (/english[\s_-]*dubbed|\bdubbed\b|\bdub\b/.test(text)) return "Dub";
  if (/english[\s_-]*subbed|\bsubbed\b|\bsub\b/.test(text)) return "Sub";
  return "Original";
}

function languageName(code) {
  const map = { en: "English", ja: "Japanese", ko: "Korean", zh: "Chinese", fr: "French", es: "Spanish" };
  return map[String(code || "").toLowerCase()] || String(code || "").toUpperCase() || "Original";
}

function variantMeta(variant, originalLanguage) {
  if (variant === "Dub") return { label: "English Dub", language: "English" };
  if (variant === "Sub") return { label: "Japanese + English Hard Subs", language: "Japanese" };
  if (variant === "Multi") return { label: "Multi Audio + Subs", language: "Multi" };
  const language = languageName(originalLanguage || "en");
  return { label: `${language} (Original)`, language };
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
  const response = await req(url, options);
  if (!response.ok) return null;
  try { return JSON.parse(response.text); } catch (_) { return null; }
}

function challenged(page) {
  return !!(page && (page.status === 403 || page.status === 429 || page.status === 503) && /cf-chl-|cloudflare|just a moment|challenge-platform|managed challenge/i.test(page.text));
}

function premiumOnly(html) {
  const text = String(html || "");
  const explicit = /This Video\s+Is?\s+For\s+(?:the\s+)?WCO\s+Premium\s+Users?\s+Only/i.test(text) ||
    /This Video\s+Is?\s+for\s+Premium\s+Users/i.test(text) || /Become a Premium User Now/i.test(text) ||
    /Start Your Free Premium Access/i.test(text);
  return explicit && !/embed\.wcostream|<iframe[^>]+(?:src|data-src)=/i.test(text);
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
    titles: uniq([title, original].concat(alt)).slice(0, 10),
    originalLanguage: String(data.original_language || "").toLowerCase(),
    year: String(data.release_date || data.first_air_date || "").slice(0, 4)
  };
}

function parseSearchLinks(html, origin) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']*(?:\/anime\/|\/videos?\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || ""))) && out.length < 80) {
    const href = absolute(match[1], origin);
    const inner = String(match[2] || "");
    const alt = (inner.match(/<img\b[^>]*alt=["']([^"']+)["']/i) || [])[1] || "";
    const titleAttr = (String(match[0]).match(/\btitle=["']([^"']+)["']/i) || [])[1] || "";
    const title = stripTags(titleAttr || alt || inner);
    if (!href || !title) continue;
    if (!out.some(x => x.href === href)) out.push({ href, title, variant: classifyVariant(`${title} ${href}`), synthetic: false });
  }
  return out;
}

async function searchOrigin(origin, query) {
  const page = await req(`${origin}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": origin, "Referer": `${origin}/` },
    body: `catara=${encodeURIComponent(query)}&konuara=series`
  });
  if (!page.ok || challenged(page)) return [];
  return parseSearchLinks(page.text, origin);
}

function syntheticCandidates(info) {
  const out = [];
  for (const title of info.titles.slice(0, 5)) {
    const slug = slugify(title);
    if (!slug) continue;
    for (const origin of SEARCH_ORIGINS.slice(0, 3)) {
      out.push({ title, href: `${origin}/anime/${slug}`, variant: "Original", synthetic: true, score: 100 });
      out.push({ title: `${title} English Dubbed`, href: `${origin}/anime/${slug}-english-dubbed`, variant: "Dub", synthetic: true, score: 96 });
      out.push({ title: `${title} English Subbed`, href: `${origin}/anime/${slug}-english-subbed`, variant: "Sub", synthetic: true, score: 96 });
    }
  }
  return out;
}

async function candidatesFor(info) {
  const found = [];
  for (const title of info.titles.slice(0, 4)) {
    for (const origin of SEARCH_ORIGINS) {
      const items = await searchOrigin(origin, title);
      found.push(...items);
      if (items.some(item => bestScore(item.title, info.titles) >= 92)) break;
    }
    if (found.some(item => bestScore(item.title, info.titles) >= 96)) break;
  }
  const seen = new Set(), ranked = [];
  for (const item of found.concat(syntheticCandidates(info))) {
    const key = item.href;
    if (!item.href || seen.has(key)) continue;
    seen.add(key);
    const score = item.score == null ? bestScore(item.title, info.titles) : item.score;
    if (score >= 45) ranked.push({ ...item, score });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, 18);
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

function parseEpisodeNumbers(text, href) {
  const raw = `${text || ""} ${href || ""}`;
  let season = 1, episode = null;
  let m = raw.match(/Season\s*(\d+)\s*Episode\s*(\d+(?:\.\d+)?)/i);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseFloat(m[2]) };
  m = raw.match(/\bS(\d{1,2})E(\d+(?:\.\d+)?)/i);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseFloat(m[2]) };
  m = raw.match(/Episode[-_\s]*(\d+(?:\.\d+)?)/i);
  if (m) episode = parseFloat(m[1]);
  m = raw.match(/Season[-_\s]*(\d+)/i);
  if (m) season = parseInt(m[1], 10) || 1;
  return { season, episode };
}

function episodeStem(text) {
  return normalize(String(text || "")
    .replace(/\s+Season\s+\d+\s+Episode\s+\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?.*$/i, "")
    .replace(/\s+Episode\s+\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?.*$/i, "")
    .replace(/\s+S\d{1,2}E\d+(?:\.\d+)?.*$/i, ""));
}

function parseEpisodeLinks(html, pageUrl) {
  const out = [];
  const re = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || ""))) && out.length < 800) {
    const attrs = `${match[1] || ""} ${match[3] || ""}`;
    const href = absolute(match[2], pageUrl);
    const text = stripTags(match[4]);
    const nums = parseEpisodeNumbers(text, href);
    if (!href || !text || nums.episode == null) continue;
    const dataLang = (attrs.match(/data-lang=["']([^"']+)["']/i) || [])[1] || "";
    out.push({
      href, text, season: nums.season, episode: nums.episode,
      variant: classifyVariant(`${dataLang} ${text} ${href}`), stem: episodeStem(text)
    });
  }
  const seen = new Set();
  return out.filter(item => {
    const key = `${item.href}|${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function affinity(entry, info) {
  let score = 0;
  for (const title of info.titles) {
    const wanted = normalize(title);
    if (!wanted || !entry.stem) continue;
    score = Math.max(score, entry.stem === wanted ? 100 : scoreTitle(entry.stem, wanted));
  }
  return score;
}

function episodeMatches(entries, info, season, episode) {
  const wantedSeason = Number(season || 1), wantedEpisode = Number(episode || 1);
  let matches = (entries || []).filter(item => item.episode === wantedEpisode && item.season === wantedSeason);
  if (!matches.length && wantedSeason === 1) matches = (entries || []).filter(item => item.episode === wantedEpisode);
  matches = matches.map(item => ({ ...item, affinity: affinity(item, info) })).sort((a, b) => b.affinity - a.affinity);
  if (!matches.length) return [];
  const best = matches[0].affinity;
  if (best >= 90) return matches.filter(item => item.affinity >= Math.max(75, best - 12));
  return matches.filter(item => item.affinity >= 45);
}

function iframeLinks(html, pageUrl) {
  const out = [];
  const re = /<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(String(html || ""))) && out.length < 10) {
    const url = absolute(match[1], pageUrl);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
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
        "Referer": embedUrl, "Origin": originOf(embedUrl),
        "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin"
      }
    });
    if (!page.ok || challenged(page)) continue;
    const found = getJsonPath(page.text);
    if (found) return absolute(found, originOf(embedUrl));
  }
  return legacyLookup(embedUrl);
}

function cleanHost(value) {
  return String(value || "").replace(/\\\//g, "/").replace(/\\/g, "").trim().replace(/\/$/, "");
}

async function extractEmbed(embedUrl, variant, title, info) {
  if (/user\.wcostream\.tv\/check-login/i.test(embedUrl)) return { premium: true, streams: [] };
  if (!/embed\.wcostream/i.test(embedUrl)) return { premium: false, streams: [] };
  const lookup = await playerLookup(embedUrl);
  if (!lookup) return { premium: false, streams: [] };
  const data = await jsonReq(lookup, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": embedUrl, "Origin": originOf(embedUrl), "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!data) return { premium: false, streams: [] };
  const host = cleanHost(data.server) || cleanHost(data.cdn);
  if (!host) return { premium: false, streams: [] };

  const detected = classifyVariant(`${variant} ${embedUrl}`);
  const finalVariant = detected === "Original" ? variant : detected;
  const meta = variantMeta(finalVariant, info.originalLanguage);
  const qualities = [
    data.fhd ? ["1080p", data.fhd] : null,
    data.fullhd ? ["1080p", data.fullhd] : null,
    data.hd ? ["720p", data.hd] : null,
    data.enc ? ["480p", data.enc] : null
  ].filter(Boolean);
  const seen = new Set(), streams = [];
  for (const item of qualities) {
    const key = `${item[0]}|${item[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = `${host}/getvid?evid=${encodeURIComponent(String(item[1]))}`;
    streams.push({
      name: `${PROVIDER_NAME} • ${item[0]} • ${meta.label}`,
      title, url, quality: item[0], language: meta.language, provider: PROVIDER_NAME, type: "mp4",
      headers: { "Referer": embedUrl, "Origin": originOf(embedUrl), "User-Agent": UA },
      _variant: finalVariant
    });
  }
  return { premium: false, streams };
}

function mirrorsFor(entry) {
  const preferred = entry.variant === "Dub" ? DUB_ORIGIN : entry.variant === "Sub" ? SUB_ORIGIN : "";
  return uniq([originOf(entry.href), ORIGINS[0], preferred, ORIGINS[1], ORIGINS[2], ORIGINS[3]]);
}

async function streamsForEntry(entry, info, title) {
  let premiumHits = 0;
  for (const origin of mirrorsFor(entry)) {
    const pageUrl = rewriteOrigin(entry.href, origin);
    const page = await req(pageUrl, { headers: { "Referer": `${origin}/`, "Origin": origin } });
    if (!page.ok || challenged(page)) continue;
    if (premiumOnly(page.text)) {
      premiumHits += 1;
      if (premiumHits >= 2) return [];
      continue;
    }
    const frames = iframeLinks(page.text, pageUrl);
    if (!frames.length) continue;
    const out = [];
    for (const frame of frames.slice(0, 3)) {
      const extracted = await extractEmbed(frame, entry.variant, title, info);
      if (extracted.premium) {
        premiumHits += 1;
        if (premiumHits >= 2) return [];
        continue;
      }
      out.push(...extracted.streams);
    }
    if (out.length) return out;
  }
  return [];
}

function finalize(streams, info) {
  const byMedia = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const key = `${stream.quality}|${stream.url}`;
    if (!byMedia.has(key)) byMedia.set(key, { ...stream, _variants: new Set([stream._variant || "Original"]) });
    else byMedia.get(key)._variants.add(stream._variant || "Original");
  }
  const merged = [];
  for (const stream of byMedia.values()) {
    let meta;
    if (stream._variants.has("Dub") && stream._variants.has("Sub")) meta = { label: "Dual Audio + Subs", language: "Multi" };
    else if (stream._variants.has("Multi")) meta = { label: "Multi Audio + Subs", language: "Multi" };
    else if (stream._variants.has("Dub")) meta = variantMeta("Dub", info.originalLanguage);
    else if (stream._variants.has("Sub")) meta = variantMeta("Sub", info.originalLanguage);
    else meta = variantMeta("Original", info.originalLanguage);
    merged.push({ ...stream, _label: meta.label, language: meta.language });
  }
  const groups = new Map();
  for (const stream of merged) {
    const key = `${stream.quality}|${stream._label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stream);
  }
  const out = [];
  for (const list of groups.values()) {
    list.forEach((stream, index) => {
      const clean = { ...stream };
      delete clean._variant; delete clean._variants; delete clean._label;
      clean.name = `${PROVIDER_NAME} • ${clean.quality} • ${stream._label}${list.length > 1 ? ` • Mirror ${index + 1}` : ""}`;
      out.push(clean);
    });
  }
  const quality = value => { const m = String(value || "").match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };
  const rank = name => {
    const text = String(name || "").toLowerCase();
    if (text.includes("english dub")) return 0;
    if (text.includes("dual audio")) return 1;
    if (text.includes("japanese")) return 2;
    return 3;
  };
  return out.sort((a, b) => rank(a.name) - rank(b.name) || quality(b.quality) - quality(a.quality));
}

async function tvStreams(info, season, episode) {
  const candidates = await candidatesFor(info);
  const entryMap = new Map();
  for (const candidate of candidates.slice(0, 12)) {
    let seriesUrl = candidate.href;
    let page = await req(seriesUrl, { headers: { "Referer": `${originOf(seriesUrl) || ORIGINS[0]}/` } });
    if (!page.ok || challenged(page) || premiumOnly(page.text)) continue;
    if (!/\/anime\//i.test(seriesUrl)) {
      const linked = findSeriesLink(page.text, seriesUrl);
      if (linked) {
        seriesUrl = linked;
        page = await req(seriesUrl, { headers: { "Referer": candidate.href } });
        if (!page.ok || challenged(page)) continue;
      }
    }
    const matches = episodeMatches(parseEpisodeLinks(page.text, seriesUrl), info, season, episode);
    for (const match of matches) {
      const key = `${match.href}|${match.variant}`;
      if (!entryMap.has(key)) entryMap.set(key, { ...match, candidateScore: candidate.score });
    }
    const variants = new Set(Array.from(entryMap.values()).map(x => x.variant));
    if ((variants.has("Dub") && variants.has("Sub")) || entryMap.size >= 6) break;
  }
  const entries = Array.from(entryMap.values()).sort((a, b) => (b.affinity || 0) - (a.affinity || 0) || b.candidateScore - a.candidateScore);
  const out = [], wantedSeason = Number(season || 1), wantedEpisode = Number(episode || 1);
  for (const entry of entries.slice(0, 6)) {
    out.push(...await streamsForEntry(entry, info, `${info.title} S${String(wantedSeason).padStart(2, "0")}E${String(wantedEpisode).padStart(2, "0")}`));
  }
  return finalize(out, info);
}

async function movieStreams(info) {
  const candidates = await candidatesFor(info);
  const out = [];
  let premiumCandidates = 0;
  for (const candidate of candidates.slice(0, 10)) {
    const page = await req(candidate.href, { headers: { "Referer": `${originOf(candidate.href) || ORIGINS[0]}/` } });
    if (!page.ok || challenged(page)) continue;
    if (premiumOnly(page.text)) {
      premiumCandidates += 1;
      if (premiumCandidates >= 2) break;
      continue;
    }
    let entries = [];
    const directFrames = iframeLinks(page.text, candidate.href);
    if (directFrames.length) {
      entries = [{ href: candidate.href, text: candidate.title, variant: candidate.variant }];
    } else {
      entries = parseEpisodeLinks(page.text, candidate.href)
        .map(item => ({ ...item, movieScore: bestScore(item.text, info.titles) }))
        .filter(item => item.movieScore >= 45)
        .sort((a, b) => b.movieScore - a.movieScore)
        .slice(0, 3);
    }
    for (const entry of entries) out.push(...await streamsForEntry(entry, info, `${info.title}${info.year ? ` (${info.year})` : ""}`));
    if (out.length) break;
  }
  return finalize(out, info);
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  console.log(`[${PROVIDER_NAME}] id=${inputId} type=${type} season=${season || "-"} episode=${episode || "-"}`);
  try {
    const info = await tmdbInfo(inputId, type);
    if (!info) return [];
    const streams = type === "movie" ? await movieStreams(info) : await tvStreams(info, season, episode);
    console.log(`[${PROVIDER_NAME}] ${streams.length} stream(s) for ${info.title}`);
    return streams;
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] Fatal: ${String(e && e.message || e)}`);
    return [];
  }
}

module.exports = { getStreams };
