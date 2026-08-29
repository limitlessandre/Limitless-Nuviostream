"use strict";

const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "WCO";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const EMBED_ORIGIN = "https://embed.wcostream.com";
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
const HEADERS = { "User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9" };

function uniq(values) {
  const seen = new Set();
  return (values || []).filter(value => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function originOf(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}

function pathOf(url) {
  const m = String(url || "").match(/^https?:\/\/[^/]+(\/.*)?$/i);
  return m ? (m[1] || "/") : String(url || "/");
}

function absoluteUrl(value, base) {
  const raw = String(value || "").trim().replace(/&amp;/g, "&");
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = originOf(base) || ORIGINS[0];
  if (raw.startsWith("/")) return `${origin}${raw}`;
  const root = String(base || origin).replace(/[?#].*$/, "").replace(/\/[^/]*$/, "/");
  return `${root}${raw}`;
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
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
  for (const w of bw) if (w.length > 1 && aw.includes(w)) overlap += 1;
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
  const names = { en: "English", ja: "Japanese", ko: "Korean", zh: "Chinese", fr: "French", es: "Spanish" };
  return names[String(code || "").toLowerCase()] || String(code || "").toUpperCase() || "Original";
}

function variantMeta(variant, originalLanguage) {
  if (variant === "Dub") return { label: "English Dub", language: "English" };
  if (variant === "Sub") return { label: "Japanese + English Hard Subs", language: "Japanese" };
  if (variant === "Multi") return { label: "Multi Audio + Subs", language: "Multi" };
  const lang = languageName(originalLanguage || "en");
  return { label: `${lang} (Original)`, language: lang };
}

async function request(url, options) {
  const opts = options || {};
  return await fetch(url, {
    ...opts,
    headers: { ...HEADERS, ...(opts.headers || {}) },
    skipSizeCheck: true
  });
}

async function fetchJson(url, options) {
  try {
    const res = await request(url, options);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

async function fetchWco(url, options) {
  try {
    const res = await request(url, options);
    const text = String(await res.text() || "");
    const status = res ? res.status : 0;
    return {
      ok: !!(res && res.ok), status, text,
      url: res && res.url ? res.url : url,
      challenged: (status === 403 || status === 429 || status === 503) && /cf-chl-|cloudflare|just a moment|challenge-platform|managed challenge/i.test(text)
    };
  } catch (e) {
    return { ok: false, status: 0, text: "", url, challenged: false, error: String(e && e.message || e) };
  }
}

function premiumOnly(html) {
  const text = String(html || "");
  const explicit = /This Video\s+Is?\s+For\s+(?:the\s+)?WCO\s+Premium\s+Users?\s+Only/i.test(text) ||
    /This Video\s+Is?\s+for\s+Premium\s+Users/i.test(text) ||
    /Become a Premium User Now/i.test(text) || /Start Your Free Premium Access/i.test(text);
  return explicit && !/embed\.wcostream|vhs\.watchanimesub|<iframe[^>]+(?:src|data-src)=/i.test(text);
}

async function tmdbInfo(inputId, mediaType) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  const raw = String(inputId || "").trim();
  let id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (!id && /^tt\d+$/i.test(raw)) {
    const found = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const list = type === "movie" ? found && found.movie_results : found && found.tv_results;
    id = Array.isArray(list) && list[0] && list[0].id ? parseInt(list[0].id, 10) : null;
  }
  if (!id) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,external_ids`);
  if (!data) return null;
  const alt = type === "movie"
    ? ((data.alternative_titles && data.alternative_titles.titles) || []).map(x => x && x.title)
    : ((data.alternative_titles && data.alternative_titles.results) || []).map(x => x && x.title);
  const title = type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
  const original = type === "movie" ? data.original_title : data.original_name;
  return {
    id, type, title: title || `TMDB ${id}`,
    titles: uniq([title, original].concat(alt)).slice(0, 12),
    originalLanguage: String(data.original_language || "").toLowerCase(),
    year: String(data.release_date || data.first_air_date || "").slice(0, 4)
  };
}

function dedupeCandidates(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = `${normalize(item && item.title)}|${String(item && item.href || "")}`;
    if (!item || !item.href || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function parseSearch(html, origin) {
  const $ = cheerio.load(String(html || ""));
  const out = [];
  $("div#blog div.iccerceve, div#sidebar_right2 li, ul.items > li, ul.items li, div#sidebar_right4 li, div.search-entry").each((_, el) => {
    const root = $(el);
    let a = root.find("a[href*='/anime/']").first();
    if (!a.length) a = root.find(".recent-release-episodes a, .img a, a[href]").first();
    if (!a.length) return;
    const href = absoluteUrl(a.attr("href") || "", origin);
    const title = String(a.attr("title") || a.find("img[alt]").attr("alt") || a.text() || root.find("img[alt]").attr("alt") || root.text() || "").trim();
    if (href && title) out.push({ title, href, variant: classifyVariant(`${title} ${href}`), origin, synthetic: false });
  });
  return dedupeCandidates(out);
}

async function searchOrigin(origin, query) {
  const page = await fetchWco(`${origin}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": origin, "Referer": `${origin}/` },
    body: `catara=${encodeURIComponent(query)}&konuara=series`
  });
  return page.ok && !page.challenged ? parseSearch(page.text, origin) : [];
}

function slugFallbacks(info) {
  const out = [];
  for (const title of info.titles.slice(0, 5)) {
    const slug = slugify(title);
    if (!slug) continue;
    out.push({ title, href: `${ORIGINS[0]}/anime/${slug}`, variant: "Original", origin: ORIGINS[0], synthetic: true });
    out.push({ title: `${title} Dub`, href: `${ORIGINS[0]}/anime/${slug}-english-dubbed`, variant: "Dub", origin: ORIGINS[0], synthetic: true });
    out.push({ title: `${title} Sub`, href: `${ORIGINS[0]}/anime/${slug}-english-subbed`, variant: "Sub", origin: ORIGINS[0], synthetic: true });
  }
  return out;
}

async function candidatesFor(info) {
  const found = [];
  for (const title of info.titles.slice(0, 3)) {
    for (const origin of SEARCH_ORIGINS) {
      const items = await searchOrigin(origin, title);
      found.push(...items);
      if (found.some(x => bestScore(x.title, info.titles) >= 92)) break;
    }
    if (found.some(x => bestScore(x.title, info.titles) >= 92)) break;
  }
  let ranked = dedupeCandidates(found).map(x => ({ ...x, score: bestScore(x.title, info.titles) }))
    .filter(x => x.score >= 45).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 80) {
    ranked = ranked.concat(slugFallbacks(info).map(x => ({ ...x, score: bestScore(x.title, info.titles) })));
  }
  return dedupeCandidates(ranked).slice(0, 14);
}

function seriesAnchor(html, pageUrl) {
  const $ = cheerio.load(String(html || ""));
  const href = $("div.header-tag h2 a, div.video-title a, .baslikCell h2 a").first().attr("href") || "";
  return href ? absoluteUrl(href, pageUrl) : "";
}

async function normalizeCandidate(candidate) {
  if (!candidate || !candidate.href || /\/anime\//i.test(candidate.href)) return candidate;
  const page = await fetchWco(candidate.href, { headers: { "Referer": `${originOf(candidate.href) || ORIGINS[0]}/` } });
  if (!page.ok || page.challenged) return candidate;
  const href = seriesAnchor(page.text, candidate.href);
  return href ? { ...candidate, href } : candidate;
}

function parseNumbers(text, seasonAttr) {
  const raw = String(text || "");
  let season = parseInt((String(seasonAttr || "").match(/s?(\d+)/i) || [])[1] || "", 10) || 1;
  let episode = null;
  let m = raw.match(/Season\s*(\d+)\s*Episode\s*(\d+(?:\.\d+)?)/i);
  if (m) { season = parseInt(m[1], 10) || season; episode = parseFloat(m[2]); }
  if (episode == null) {
    m = raw.match(/\bS(\d{1,2})E(\d+(?:\.\d+)?)/i);
    if (m) { season = parseInt(m[1], 10) || season; episode = parseFloat(m[2]); }
  }
  if (episode == null) {
    m = raw.match(/Episode\s*(\d+(?:\.\d+)?)/i);
    if (m) episode = parseFloat(m[1]);
  }
  return { season, episode };
}

function episodeStem(text) {
  return normalize(String(text || "").replace(/[-_]+/g, " ")
    .replace(/\s+Season\s+\d+\s+Episode\s+\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?.*$/i, "")
    .replace(/\s+Episode\s+\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?.*$/i, "")
    .replace(/\s+S\d{1,2}E\d+(?:\.\d+)?.*$/i, ""));
}

function parseEpisodes(html, seriesUrl) {
  const $ = cheerio.load(String(html || ""));
  const selector = [
    "div.cat-eps", "div#episodeList a.dark-episode-item", "nav#sidebarEpisodeList a.sidebar-episode-item",
    "div#catlist-listview > ul > li", "table:has(> tbody > tr > td > h3:contains(Episode List)) div.menustyle > ul > li",
    "div#sidebar_right3 div.cat-eps"
  ].join(", ");
  const out = [];
  $(selector).each((_, el) => {
    const root = $(el), a = root.is("a") ? root : root.find("a[href]").first();
    if (!a.length) return;
    const href = absoluteUrl(a.attr("href") || "", seriesUrl);
    const text = String(a.find("span").first().text() || a.text() || root.text() || "").trim();
    if (!href || !text) return;
    const nums = parseNumbers(text, a.attr("data-season") || root.attr("data-season"));
    out.push({
      href, text, season: nums.season, episode: nums.episode,
      variant: classifyVariant(`${a.attr("data-lang") || root.attr("data-lang") || ""} ${text} ${href}`),
      stem: episodeStem(text)
    });
  });
  const seen = new Set();
  return out.filter(x => { const key = `${x.href}|${x.text}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function affinity(entry, info) {
  let best = 0;
  for (const title of info.titles) {
    const wanted = normalize(title);
    if (!wanted || !entry.stem) continue;
    best = Math.max(best, entry.stem === wanted ? 100 : scoreTitle(entry.stem, wanted));
  }
  return best;
}

function episodeMatches(entries, info, season, episode) {
  const s = Number(season || 1), e = Number(episode || 1);
  let matches = (entries || []).filter(x => x.episode === e && x.season === s);
  if (!matches.length && s === 1) matches = (entries || []).filter(x => x.episode === e);
  matches = matches.map(x => ({ ...x, affinity: affinity(x, info) })).sort((a, b) => b.affinity - a.affinity);
  if (!matches.length) return [];
  const best = matches[0].affinity;
  return best >= 90 ? matches.filter(x => x.affinity >= Math.max(75, best - 12)) : matches.filter(x => x.affinity >= 45);
}

function base64Decode(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const clean = String(input || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "", i = 0;
  while (i < clean.length) {
    const e1 = chars.indexOf(clean.charAt(i++)), e2 = chars.indexOf(clean.charAt(i++));
    const e3 = chars.indexOf(clean.charAt(i++)), e4 = chars.indexOf(clean.charAt(i++));
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== 64 && e3 >= 0) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== 64 && e4 >= 0) out += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return out;
}

function oldIframe(html, pageUrl) {
  const $ = cheerio.load(String(html || ""));
  let script = "";
  $("script").each((_, el) => { const v = String($(el).html() || ""); if (!script && v.includes("decodeURIComponent")) script = v; });
  if (!script) return "";
  try {
    const list = script.match(/\[((?:\s*["'][A-Za-z0-9+/=]+["']\s*,?\s*)+)\]/);
    const shifts = script.match(/-\s*(\d+)\s*\)\s*;?/g) || [];
    if (!list || !shifts.length) return "";
    const sm = shifts[shifts.length - 1].match(/(\d+)/), shift = sm ? parseInt(sm[1], 10) : 0;
    const parts = [], re = /["']([A-Za-z0-9+/=]+)["']/g;
    let m;
    while ((m = re.exec(list[1]))) parts.push(m[1]);
    const decoded = parts.map(p => {
      const digits = base64Decode(p).replace(/\D/g, "");
      return digits ? String.fromCharCode(parseInt(digits, 10) - shift) : "";
    }).join("");
    const inner = cheerio.load(decoded), src = inner("iframe").first().attr("src") || "";
    return absoluteUrl(src, pageUrl);
  } catch (_) { return ""; }
}

function iframeUrls(html, pageUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];
  $("iframe").each((_, el) => {
    const n = $(el), src = n.attr("src") || n.attr("data-src") || "";
    const url = absoluteUrl(src, pageUrl); if (url) urls.push(url);
  });
  const legacy = oldIframe(html, pageUrl); if (legacy) urls.push(legacy);
  return uniq(urls).filter(url => /embed\.wcostream|watchanimesub|\.m3u8(?:[?#]|$)/i.test(url));
}

function replaceEmbedPath(embedUrl, path) {
  const raw = String(embedUrl || ""), q = raw.indexOf("?");
  return `${originOf(raw) || EMBED_ORIGIN}${path}${q >= 0 ? raw.slice(q) : ""}`;
}

function getJsonPath(html) {
  const text = String(html || "");
  const patterns = [/\$\.getJSON\(\s*["']([^"']+)["']/i, /getJSON\(\s*["']([^"']+)["']/i, /["'](\/inc\/embed\/getvidlink\.php\?[^"']+)["']/i];
  for (const re of patterns) {
    const m = text.match(re); if (m && m[1]) return m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }
  return "";
}

async function playerLookup(embedUrl) {
  const players = ["/inc/embed/video-js-new.php", "/inc/embed/video-js-old.php", "/inc/embed/video-js.php"];
  for (const path of players) {
    const url = replaceEmbedPath(embedUrl, path);
    const page = await fetchWco(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": embedUrl, "Origin": originOf(embedUrl) || EMBED_ORIGIN,
        "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin"
      }
    });
    if (!page.ok || page.challenged) continue;
    const pathFound = getJsonPath(page.text);
    if (pathFound) return absoluteUrl(pathFound, url);
  }
  return "";
}

function legacyLookup(embedUrl) {
  try {
    const params = new URLSearchParams(String(embedUrl || "").split("?").slice(1).join("?"));
    const raw = params.get("file"); if (!raw) return "";
    const embed = params.get("embed") || "";
    const file = raw.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/");
    const origin = originOf(embedUrl) || EMBED_ORIGIN;
    if (params.has("fullhd")) return `${origin}/inc/embed/getvidlink.php?v=${embed}/${file}&embed=${embed}&fullhd=${params.get("fullhd") || "1"}`;
    return `${origin}/inc/embed/getvidlink.php?v=${file}&embed=${embed}&hd=${params.get("hd") || "1"}`;
  } catch (_) { return ""; }
}

async function lookupData(url, embedUrl) {
  return await fetchJson(url, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01", "Referer": embedUrl,
      "Origin": originOf(embedUrl) || EMBED_ORIGIN, "X-Requested-With": "XMLHttpRequest"
    }
  });
}

function cleanHost(value) {
  const host = String(value || "").replace(/\\\//g, "/").replace(/\\/g, "").trim();
  return host ? host.replace(/\/$/, "") : "";
}

function resolvedUrl(raw, responseUrl) {
  let text = String(raw || "").trim().replace(/\\\//g, "/");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") text = parsed;
    else if (parsed && typeof parsed.url === "string") text = parsed.url;
    else if (parsed && typeof parsed.file === "string") text = parsed.file;
  } catch (_) { text = text.replace(/^["']|["']$/g, ""); }
  text = String(text || "").replace(/\\\//g, "/").replace(/\\/g, "").trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^https?:\/\//i.test(String(responseUrl || "")) && !/\/getvid\?evid=/i.test(String(responseUrl))) return String(responseUrl);
  return "";
}

async function resolveToken(token, hosts, referer) {
  if (!token) return "";
  for (const hostValue of hosts) {
    const host = cleanHost(hostValue); if (!host) continue;
    try {
      const res = await request(`${host}/getvid?evid=${encodeURIComponent(String(token))}&json`, {
        headers: { "Referer": referer || `${EMBED_ORIGIN}/`, "Origin": EMBED_ORIGIN }
      });
      if (!res || !res.ok) continue;
      const url = resolvedUrl(await res.text(), res.url); if (url) return url;
    } catch (_) {}
  }
  return "";
}

async function fromLookup(data, variant, title, embedUrl, originalLanguage) {
  if (!data) return [];
  const hosts = uniq([cleanHost(data.server), cleanHost(data.cdn)]);
  if (!hosts.length) return [];
  const subtitle = data.sub ? await resolveToken(data.sub, hosts, embedUrl) : "";
  const subtitles = subtitle ? [{ url: subtitle, language: "English", name: `${PROVIDER_NAME} English Soft Subs` }] : [];
  const qualities = [
    data.fhd ? ["1080p", data.fhd] : null,
    data.fullhd ? ["1080p", data.fullhd] : null,
    data.hd ? ["720p", data.hd] : null,
    data.enc ? ["480p", data.enc] : null
  ].filter(Boolean);
  const meta = variantMeta(variant, originalLanguage), seen = new Set(), out = [];
  for (const item of qualities) {
    const key = `${item[0]}|${item[1]}`; if (seen.has(key)) continue; seen.add(key);
    const media = await resolveToken(item[1], hosts, embedUrl); if (!media) continue;
    out.push({
      name: `${PROVIDER_NAME} • ${item[0]} • ${meta.label}`, title, url: media, quality: item[0], language: meta.language,
      provider: PROVIDER_NAME, type: /\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4",
      headers: { "Referer": `${originOf(embedUrl) || EMBED_ORIGIN}/`, "Origin": originOf(embedUrl) || EMBED_ORIGIN, "User-Agent": UA },
      subtitles, _variant: variant
    });
  }
  return out;
}

async function premiumHls(iframeUrl, variant, title, originalLanguage) {
  const page = await fetchWco(iframeUrl, { headers: { "Referer": `${originOf(iframeUrl)}/` } });
  if (!page.ok) return [];
  const matches = String(page.text || "").match(/https?:\\?\/\\?\/[^"'\s]+\.m3u8(?:\?[^"'\s<]+)?/gi) || [];
  const urls = uniq(matches.map(x => x.replace(/\\\//g, "/").replace(/&amp;/g, "&")));
  const meta = variantMeta(variant, originalLanguage);
  return urls.map(url => ({
    name: `${PROVIDER_NAME} • Auto • ${meta.label}`, title, url, quality: "Auto", language: meta.language,
    provider: PROVIDER_NAME, type: "m3u8", headers: { "Referer": iframeUrl, "User-Agent": UA }, subtitles: [], _variant: variant
  }));
}

async function extractIframe(iframeUrl, variant, title, originalLanguage) {
  if (/watchanimesub/i.test(iframeUrl) || /\.m3u8(?:[?#]|$)/i.test(iframeUrl)) return await premiumHls(iframeUrl, variant, title, originalLanguage);
  if (!/embed\.wcostream/i.test(iframeUrl)) return [];
  let url = await playerLookup(iframeUrl);
  if (!url) url = legacyLookup(iframeUrl);
  if (!url) return [];
  const data = await lookupData(url, iframeUrl);
  return data ? await fromLookup(data, variant, title, iframeUrl, originalLanguage) : [];
}

function mirrorsFor(entry) {
  const preferred = entry.variant === "Dub" ? DUB_ORIGIN : entry.variant === "Sub" ? SUB_ORIGIN : "";
  const other = entry.variant === "Dub" ? SUB_ORIGIN : entry.variant === "Sub" ? DUB_ORIGIN : "";
  return uniq([originOf(entry.href), ORIGINS[0], preferred, ORIGINS[1], ORIGINS[2], ORIGINS[3], other]);
}

async function streamsForEntry(entry, info, title) {
  let premium = 0;
  for (const origin of mirrorsFor(entry)) {
    const pageUrl = rewriteOrigin(entry.href, origin);
    const page = await fetchWco(pageUrl, { headers: { "Referer": `${origin}/`, "Origin": origin } });
    if (!page.ok || page.challenged) continue;
    if (premiumOnly(page.text)) { premium += 1; if (premium >= 2) return []; continue; }
    const frames = iframeUrls(page.text, pageUrl);
    if (!frames.length) continue;
    const out = [];
    for (const frame of frames.slice(0, 3)) out.push(...await extractIframe(frame, entry.variant, title, info.originalLanguage));
    if (out.length) return out;
  }
  return [];
}

function mergeSubs(a, b) {
  const seen = new Set(), out = [];
  for (const s of (a || []).concat(b || [])) {
    if (!s || !s.url || seen.has(s.url)) continue; seen.add(s.url); out.push(s);
  }
  return out;
}

function finalize(streams, info) {
  const byMedia = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.url) continue;
    const key = `${stream.quality || "Auto"}|${stream.url}`;
    if (!byMedia.has(key)) byMedia.set(key, { ...stream, _variants: new Set([stream._variant || "Original"]) });
    else {
      const current = byMedia.get(key); current._variants.add(stream._variant || "Original");
      current.subtitles = mergeSubs(current.subtitles, stream.subtitles);
    }
  }
  const merged = [];
  for (const stream of byMedia.values()) {
    const v = stream._variants;
    let meta;
    if (v.has("Dub") && v.has("Sub")) meta = { label: "Dual Audio + Subs", language: "Multi" };
    else if (v.has("Multi")) meta = { label: "Multi Audio + Subs", language: "Multi" };
    else if (v.has("Dub")) meta = variantMeta("Dub", info.originalLanguage);
    else if (v.has("Sub")) meta = variantMeta("Sub", info.originalLanguage);
    else meta = variantMeta("Original", info.originalLanguage);
    merged.push({ ...stream, _label: meta.label, language: meta.language });
  }
  const classes = new Map();
  for (const stream of merged) {
    const key = `${stream.quality || "Auto"}|${stream._label}`;
    if (!classes.has(key)) classes.set(key, []); classes.get(key).push(stream);
  }
  const out = [];
  for (const list of classes.values()) list.forEach((stream, index) => {
    const clean = { ...stream };
    delete clean._variant; delete clean._variants; delete clean._label;
    clean.name = `${PROVIDER_NAME} • ${clean.quality || "Auto"} • ${stream._label}${list.length > 1 ? ` • Mirror ${index + 1}` : ""}`;
    out.push(clean);
  });
  const q = value => { const m = String(value || "").match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };
  const r = name => { const x = String(name || "").toLowerCase(); return x.includes("english dub") ? 0 : x.includes("dual audio") ? 1 : x.includes("japanese") ? 2 : 3; };
  return out.sort((a, b) => r(a.name) - r(b.name) || q(b.quality) - q(a.quality));
}

async function tvStreams(info, season, episode) {
  const candidates = await candidatesFor(info); if (!candidates.length) return [];
  const parsed = [], coverage = new Set();
  for (const raw of candidates.slice(0, 10)) {
    const candidate = await normalizeCandidate(raw);
    const page = await fetchWco(candidate.href, { headers: { "Referer": `${originOf(candidate.href) || ORIGINS[0]}/` } });
    if (!page.ok || page.challenged || premiumOnly(page.text)) continue;
    const matches = episodeMatches(parseEpisodes(page.text, candidate.href), info, season, episode);
    if (!matches.length) continue;
    parsed.push({ candidate, matches });
    for (const match of matches) coverage.add(match.variant);
    if (coverage.has("Dub") && coverage.has("Sub")) break;
    if (parsed.length >= 4) break;
  }
  const entries = [];
  for (const item of parsed) for (const match of item.matches) {
    const key = `${match.href}|${match.variant}|${match.season}|${match.episode}`;
    if (!entries.some(x => x._key === key)) entries.push({ ...match, _key: key, candidateScore: item.candidate.score || 0 });
  }
  entries.sort((a, b) => (b.affinity || 0) - (a.affinity || 0) || b.candidateScore - a.candidateScore);
  const out = [], s = Number(season || 1), e = Number(episode || 1);
  for (const entry of entries.slice(0, 6)) {
    out.push(...await streamsForEntry(entry, info, `${info.title} S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`));
    const kinds = new Set(out.map(x => x._variant));
    if (kinds.has("Dub") && kinds.has("Sub") && out.length >= 6) break;
  }
  return finalize(out, info);
}

async function movieStreams(info) {
  const candidates = (await candidatesFor(info)).map(x => ({ ...x, score: x.score == null ? bestScore(x.title, info.titles) : x.score }))
    .filter(x => x.score >= 45).sort((a, b) => b.score - a.score).slice(0, 8);
  const out = []; let premiumPages = 0;
  for (const candidate of candidates) {
    const page = await fetchWco(candidate.href, { headers: { "Referer": `${originOf(candidate.href) || ORIGINS[0]}/` } });
    if (!page.ok || page.challenged) continue;
    if (premiumOnly(page.text)) { premiumPages += 1; if (premiumPages >= 2) break; continue; }
    let entries = [];
    if (/\/anime\//i.test(candidate.href)) {
      entries = parseEpisodes(page.text, candidate.href).map(x => ({ ...x, movieScore: bestScore(x.text, info.titles) }))
        .filter(x => x.movieScore >= 45).sort((a, b) => b.movieScore - a.movieScore).slice(0, 3);
    }
    if (!entries.length) {
      const $ = cheerio.load(page.text), pageTitle = String($("h1").first().text() || $("title").first().text() || candidate.title).trim();
      entries = [{ href: candidate.href, text: pageTitle, variant: candidate.variant !== "Original" ? candidate.variant : classifyVariant(`${pageTitle} ${candidate.href}`) }];
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
    const info = await tmdbInfo(inputId, type); if (!info) return [];
    const streams = type === "movie" ? await movieStreams(info) : await tvStreams(info, season, episode);
    console.log(`[${PROVIDER_NAME}] ${streams.length} stream(s) for ${info.title}`);
    return streams;
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] Fatal: ${String(e && e.message || e)}`); return [];
  }
}

module.exports = { getStreams };
