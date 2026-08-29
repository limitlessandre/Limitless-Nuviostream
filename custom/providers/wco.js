"use strict";

const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "WCO";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const EMBED_DELAY_MS = 12000;
const WCO_SITES = [
  { name: "WCOFlix", base: "https://www.wcoflix.tv", oldEmbed: false },
  { name: "WCOStream", base: "https://www.wcostream.tv", oldEmbed: false },
  { name: "WCOForever", base: "https://www.wcoforever.net", oldEmbed: false },
  { name: "WCO", base: "https://www.wco.tv", oldEmbed: true },
  { name: "WCO Anime Sub", base: "https://www.wcoanimesub.tv", oldEmbed: true, variant: "Sub" },
  { name: "WCO Anime Dub", base: "https://www.wcoanimedub.tv", oldEmbed: true, variant: "Dub" }
];

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9"
};

function absoluteUrl(value, base) {
  try { return new URL(String(value || ""), base).toString(); } catch (_) { return ""; }
}

function normalize(value) {
  return String(value || "").toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/english\s+(dubbed|subbed)/g, "")
    .replace(/\b(dubbed|subbed|dub|sub)\b/g, "")
    .replace(/\bseason\s*\d+\b/g, "")
    .replace(/\bepisode\s*\d+(?:\.\d+)?\b/g, "")
    .replace(/\bmovie\b/g, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreTitle(candidate, wanted) {
  const a = normalize(candidate);
  const b = normalize(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 90;
  if (a.includes(b) || b.includes(a)) return 80;
  const words = a.split(" ");
  const wantedWords = b.split(" ").filter(word => word.length > 1);
  const overlap = wantedWords.filter(word => words.includes(word)).length;
  return Math.round((overlap / Math.max(1, wantedWords.length)) * 70);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
    skipSizeCheck: true
  });
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : "?"} for ${url}`);
  return response;
}

async function fetchText(url, options = {}) {
  return String(await (await request(url, options)).text() || "");
}

async function fetchJson(url, options = {}) {
  try { return await (await request(url, options)).json(); } catch (_) { return null; }
}

async function getTmdbInfo(inputId, mediaType) {
  const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
  let tmdbId = String(inputId || "").trim();
  if (/^tt\d+$/i.test(tmdbId)) {
    const found = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(tmdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const results = type === "movie" ? found && found.movie_results : found && found.tv_results;
    tmdbId = results && results[0] && results[0].id ? String(results[0].id) : "";
  }
  if (!/^\d+$/.test(tmdbId)) return null;
  const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
  if (!data) return null;
  const alternatives = type === "movie"
    ? ((data.alternative_titles && data.alternative_titles.titles) || []).map(item => item.title)
    : ((data.alternative_titles && data.alternative_titles.results) || []).map(item => item.title);
  const titles = [data.title, data.name, data.original_title, data.original_name, ...alternatives].filter(Boolean);
  return {
    type,
    title: data.title || data.name || data.original_title || data.original_name || `TMDB ${tmdbId}`,
    titles: [...new Set(titles)],
    year: String(data.release_date || data.first_air_date || "").slice(0, 4)
  };
}

async function searchSite(site, query) {
  const body = `catara=${encodeURIComponent(query)}&konuara=series`;
  const html = await fetchText(`${site.base}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": `${site.base}/`,
      "Origin": site.base
    },
    body
  });
  const $ = cheerio.load(html);
  const results = [];
  $("div#sidebar_right2 li, ul.items li, div#blog div.iccerceve").each((_, element) => {
    const anchor = $(element).find(".recent-release-episodes a, .img a, a").first();
    const title = (anchor.clone().children().remove().end().text() || anchor.text() || anchor.find("img").attr("alt") || "").trim();
    const href = absoluteUrl(anchor.attr("href"), site.base);
    if (title && href) results.push({ title, href, site });
  });
  return results;
}

async function findCandidates(titles) {
  const all = [];
  const seen = new Set();
  for (const site of WCO_SITES) {
    let siteWorked = false;
    for (const title of titles.slice(0, 5)) {
      try {
        const results = await searchSite(site, title);
        for (const result of results) {
          const key = `${result.title}|${result.href}`;
          if (!seen.has(key)) { seen.add(key); all.push(result); }
        }
        if (results.some(result => scoreTitle(result.title, title) >= 80)) { siteWorked = true; break; }
      } catch (_) {}
    }
    // WCO sites mirror one catalogue; after two healthy catalogues, the rest
    // are endpoint fallbacks rather than duplicate sources.
    if (siteWorked && all.filter(item => scoreAgainstTitles(item.title, titles) >= 80).length >= 2) break;
  }
  return all;
}

function scoreAgainstTitles(candidate, titles) {
  return Math.max(0, ...titles.map(title => scoreTitle(candidate, title)));
}

async function resolveSeriesPage(candidate) {
  if (/\/anime\//i.test(candidate.href)) return candidate.href;
  try {
    const $ = cheerio.load(await fetchText(candidate.href, { headers: { "Referer": `${candidate.site.base}/` } }));
    const href = $("div.header-tag h2 a").first().attr("href");
    return href ? absoluteUrl(href, candidate.site.base) : candidate.href;
  } catch (_) { return candidate.href; }
}

function detectVariant(text, site) {
  const value = `${text || ""} ${site.variant || ""}`.toLowerCase();
  if (/\bdub(?:bed)?\b/.test(value)) return "Dub";
  if (/\bsub(?:bed)?\b/.test(value)) return "Sub";
  return "Original";
}

async function episodeEntries(seriesUrl, site) {
  const $ = cheerio.load(await fetchText(seriesUrl, { headers: { "Referer": `${site.base}/` } }));
  const entries = [];
  $("div.cat-eps, div#catlist-listview > ul > li, table div.menustyle > ul > li, div#episodeList a.dark-episode-item, nav#sidebarEpisodeList a.sidebar-episode-item, div#sidebar_right3 div.cat-eps a").each((_, element) => {
    const node = $(element);
    const anchor = node.is("a") ? node : node.find("a").first();
    const href = absoluteUrl(anchor.attr("href"), site.base);
    if (!href) return;
    const text = (anchor.find("span").first().text() || anchor.text() || node.text() || "").trim();
    const season = parseInt((String(anchor.attr("data-season") || "").match(/s(\d+)/i) || text.match(/Season\s*(\d+)/i) || [])[1] || "1", 10) || 1;
    const match = text.match(/Episode\s*(\d+(?:\.\d+)?)/i);
    entries.push({ href, text, season, episode: match ? parseFloat(match[1]) : null, variant: detectVariant(`${anchor.attr("data-lang") || ""} ${text}`, site) });
  });
  if (!entries.length) entries.push({ href: seriesUrl, text: $(".video-title, .baslikCell").first().text(), season: 1, episode: 1, variant: detectVariant($("body").text(), site) });
  return entries;
}

function decodeOldIframe($, pageUrl) {
  const script = $("script").toArray().map(node => $(node).html() || "").find(text => text.includes("decodeURIComponent"));
  if (!script) return "";
  try {
    const arrayBody = script.substring(script.indexOf("[") + 1, script.indexOf("]"));
    const chunks = JSON.parse(`[${arrayBody.trim().replace(/,\s*$/, "")}]`);
    const shiftMatch = script.match(/-\s*(\d+)\s*\);?\s*$/m) || script.match(/-\s*(\d+)\s*\)/);
    if (!shiftMatch) return "";
    const decoded = chunks.map(chunk => String.fromCharCode(parseInt(Buffer.from(chunk, "base64").toString().replace(/\D/g, ""), 10) - parseInt(shiftMatch[1], 10))).join("");
    return absoluteUrl(cheerio.load(decoded)("iframe").first().attr("src"), pageUrl);
  } catch (_) { return ""; }
}

async function iframeUrls(pageUrl, site) {
  const $ = cheerio.load(await fetchText(pageUrl, { headers: { "Referer": `${site.base}/` } }));
  const urls = $("iframe").toArray().map(node => absoluteUrl($(node).attr("src"), pageUrl)).filter(Boolean);
  if (!urls.length && site.oldEmbed) {
    const old = decodeOldIframe($, pageUrl);
    if (old) urls.push(old);
  }
  return [...new Set(urls)];
}

function randomNonce() {
  let value = "";
  for (let i = 0; i < 16; i++) value += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return value;
}

function videoStreams(data, variant, title, referer) {
  const server = String(data && (data.server || data.cdn) || "").replace(/\\/g, "").replace(/\/$/, "");
  if (!server) return [];
  const subtitles = data.sub ? [{ url: `${server}/getvid?evid=${data.sub}`, language: "English", name: `${PROVIDER_NAME} English` }] : [];
  const label = variant === "Dub" ? "English Dub" : variant === "Sub" ? "Japanese + Subs" : "Original Audio";
  return [
    data.fhd && { quality: "1080p", evid: data.fhd },
    data.fullhd && { quality: "1080p", evid: data.fullhd },
    data.hd && { quality: "720p", evid: data.hd },
    data.enc && { quality: "480p", evid: data.enc }
  ].filter(Boolean).filter((item, index, list) => list.findIndex(other => other.evid === item.evid) === index).map(item => ({
    name: `${PROVIDER_NAME} • ${item.quality} • ${label}`,
    title,
    url: `${server}/getvid?evid=${item.evid}`,
    quality: item.quality,
    language: variant === "Dub" ? "English" : variant === "Sub" ? "Japanese" : "Unknown",
    provider: PROVIDER_NAME,
    type: "mp4",
    headers: { ...BASE_HEADERS, "Referer": referer, "Origin": new URL(referer).origin },
    subtitles
  }));
}

async function extractStandardEmbed(embedUrl, variant, title, episodeReferer) {
  const parsed = new URL(embedUrl);
  const origin = parsed.origin;
  const navHeaders = { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Referer": episodeReferer };
  await request(embedUrl, { headers: navHeaders }).then(response => response.text()).catch(() => "");
  await request(`${origin}/inc/embed/pre-init.js?v2`, { headers: navHeaders }).then(response => response.text()).catch(() => "");
  await request(`${origin}/assets/ads/advertisement.js`, { headers: navHeaders }).then(response => response.text()).catch(() => "");
  const pid = parsed.searchParams.get("pid");
  if (!pid) return extractLegacyEmbed(embedUrl, variant, title);
  const nonce = randomNonce();
  await request(`${origin}/ad-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": origin, "Referer": embedUrl },
    body: JSON.stringify({ nonce, status: "clear", id: pid })
  }).then(response => response.text()).catch(() => "");
  await new Promise(resolve => setTimeout(resolve, EMBED_DELAY_MS));
  const paths = ["/inc/embed/video-js-old.php", "/inc/embed/video-js.php"];
  for (const path of paths) {
    try {
      const playerUrl = `${origin}${path}?n=${encodeURIComponent(nonce)}`;
      const html = await fetchText(playerUrl, { headers: { ...navHeaders, "Referer": embedUrl } });
      const getJson = html.match(/\$\.getJSON\(["']([^"']+)/i);
      if (!getJson) continue;
      const data = await fetchJson(absoluteUrl(getJson[1], origin), { headers: { "X-Requested-With": "XMLHttpRequest", "Referer": playerUrl, "Origin": origin } });
      const streams = videoStreams(data, variant, title, playerUrl);
      if (streams.length) return streams;
    } catch (_) {}
  }
  return extractLegacyEmbed(embedUrl, variant, title);
}

async function extractLegacyEmbed(embedUrl, variant, title) {
  try {
    const parsed = new URL(embedUrl);
    const file = parsed.searchParams.get("file");
    if (!file) return [];
    const embed = parsed.searchParams.get("embed") || "";
    const fullhd = parsed.searchParams.has("fullhd");
    const video = fullhd ? `${embed}/${file.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/")}` : file.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/");
    const qualityParam = fullhd ? `fullhd=${encodeURIComponent(parsed.searchParams.get("fullhd") || "1")}` : `hd=${encodeURIComponent(parsed.searchParams.get("hd") || "1")}`;
    const api = `${parsed.origin}/inc/embed/getvidlink.php?v=${video}&embed=${encodeURIComponent(embed)}&${qualityParam}`;
    const data = await fetchJson(api, { headers: { "X-Requested-With": "XMLHttpRequest", "Referer": embedUrl } });
    return videoStreams(data, variant, title, embedUrl);
  } catch (_) { return []; }
}

async function extractPremium(embedUrl, variant, title) {
  const html = await fetchText(embedUrl, { headers: { "Referer": `${embedUrl}/` } });
  const match = html.match(/getRedirectedUrl\(["'](https:\/\/[^"']+\/index\.m3u8[^"']*)/i);
  if (!match) return [];
  const label = variant === "Dub" ? "English Dub" : variant === "Sub" ? "Japanese + Soft Subs" : "Multi Audio + Soft Subs";
  const masterUrl = match[1];
  const headers = { ...BASE_HEADERS, "Referer": `${embedUrl}/` };
  const language = variant === "Dub" ? "English" : variant === "Sub" ? "Japanese" : "Multi";
  try {
    const playlist = await fetchText(masterUrl, { headers });
    const lines = playlist.split(/\r?\n/);
    const variants = [];
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].startsWith("#EXT-X-STREAM-INF:")) continue;
      const uri = lines.slice(index + 1).find(line => line.trim() && !line.startsWith("#"));
      if (!uri) continue;
      const resolution = (lines[index].match(/RESOLUTION=\d+x(\d+)/i) || [])[1];
      const bandwidth = parseInt((lines[index].match(/BANDWIDTH=(\d+)/i) || [])[1] || "0", 10);
      variants.push({ url: absoluteUrl(uri.trim(), masterUrl), quality: resolution ? `${resolution}p` : "Auto", bandwidth });
    }
    if (variants.length) {
      return variants.sort((a, b) => b.bandwidth - a.bandwidth).map(item => ({
        name: `${PROVIDER_NAME} • Premium • ${item.quality} • ${label}`,
        title,
        url: item.url,
        quality: item.quality,
        language,
        provider: PROVIDER_NAME,
        type: "m3u8",
        headers,
        subtitles: []
      }));
    }
  } catch (_) {}
  return [{ name: `${PROVIDER_NAME} • Premium • Auto • ${label}`, title, url: masterUrl, quality: "Auto", language, provider: PROVIDER_NAME, type: "m3u8", headers, subtitles: [] }];
}

async function extractIframe(embedUrl, variant, title, episodeReferer) {
  if (/embed\.wcostream/i.test(embedUrl)) return extractStandardEmbed(embedUrl, variant, title, episodeReferer);
  if (/vhs\.watchanimesub/i.test(embedUrl)) return extractPremium(embedUrl, variant, title);
  return [];
}

async function streamsForEntry(entry, site, title) {
  const output = [];
  for (const iframe of await iframeUrls(entry.href, site)) {
    output.push(...await extractIframe(iframe, entry.variant, title, entry.href).catch(() => []));
  }
  return output;
}

function dedupe(streams) {
  const seen = new Set();
  return streams.filter(stream => {
    const key = `${stream.url}|${stream.language}|${stream.quality}`;
    if (!stream.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getTvStreams(info, season, episode) {
  const candidates = (await findCandidates(info.titles))
    .map(candidate => ({ ...candidate, score: scoreAgainstTitles(candidate.title, info.titles) }))
    .filter(candidate => candidate.score >= 45)
    .sort((a, b) => b.score - a.score).slice(0, 4);
  const wantedSeason = Number(season || 1);
  const wantedEpisode = Number(episode || 1);
  const output = [];
  for (const candidate of candidates) {
    const entries = await episodeEntries(await resolveSeriesPage(candidate), candidate.site).catch(() => []);
    let matches = entries.filter(item => item.season === wantedSeason && item.episode === wantedEpisode);
    if (!matches.length && wantedSeason === 1) matches = entries.filter(item => item.episode === wantedEpisode);
    for (const entry of matches.slice(0, 4)) {
      const title = `${info.title} S${String(wantedSeason).padStart(2, "0")}E${String(wantedEpisode).padStart(2, "0")} • ${entry.variant}`;
      output.push(...await streamsForEntry(entry, candidate.site, title));
    }
    if (output.some(stream => stream.language === "English") && output.some(stream => stream.language === "Japanese" || stream.language === "Multi")) break;
  }
  return output;
}

async function getMovieStreams(info) {
  const candidates = (await findCandidates(info.titles))
    .map(candidate => ({ ...candidate, score: scoreAgainstTitles(candidate.title, info.titles) }))
    .filter(candidate => candidate.score >= 45)
    .sort((a, b) => b.score - a.score).slice(0, 5);
  const output = [];
  for (const candidate of candidates) {
    let entries = [{ href: candidate.href, variant: detectVariant(candidate.title, candidate.site) }];
    if (/\/anime\//i.test(candidate.href)) {
      const parsed = await episodeEntries(candidate.href, candidate.site).catch(() => []);
      if (parsed.length) entries = [parsed[parsed.length - 1]];
    }
    for (const entry of entries) output.push(...await streamsForEntry(entry, candidate.site, `${info.title}${info.year ? ` (${info.year})` : ""} • ${entry.variant}`));
  }
  return output;
}

async function getStreams(inputId, mediaType = "tv", season = 1, episode = 1) {
  try {
    const info = await getTmdbInfo(inputId, mediaType);
    if (!info) return [];
    return dedupe(info.type === "movie" ? await getMovieStreams(info) : await getTvStreams(info, season, episode));
  } catch (error) {
    console.log(`[${PROVIDER_NAME}] ${error && error.message ? error.message : error}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;

