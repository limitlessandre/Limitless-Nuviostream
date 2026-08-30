"use strict";

const PROVIDER_NAME = "WCO Special Test";
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
    .replace(/\b(dubbed|subbed|dub|sub|fullhd|hd)\b/g, " ")
    .replace(/\bseason\s*\d+\b/g, " ")
    .replace(/\bepisode\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\b/g, " ")
    .replace(/\bmovie\b/g, " ")
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
  const coverage = overlap / Math.max(1, bw.length);
  return Math.round(coverage * 80);
}

function bestScore(value, aliases) {
  let score = 0;
  for (const alias of aliases || []) score = Math.max(score, scoreTitle(value, alias));
  return score;
}

function targetAliases(title, alternatives) {
  const out = [title].concat(alternatives || []);
  for (const value of out.slice()) {
    const raw = String(value || "").trim();
    const colon = raw.split(":");
    if (colon.length > 1) out.push(colon.slice(1).join(":").trim());
    const dash = raw.split(/\s[-–—]\s/);
    if (dash.length > 1) out.push(dash.slice(1).join(" ").trim());
    const inMatch = raw.match(/^(.{1,40}?)\s+in\s+["'“”]?(.+?)["'“”]?$/i);
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
    const colon = raw.split(":")[0].trim();
    if (colon && colon.split(/\s+/).length <= 7) out.push(colon);
    const inMatch = raw.match(/^(.{1,40}?)\s+in\s+["'“”]?.+$/i);
    if (inMatch && inMatch[1].trim().split(/\s+/).length <= 7) out.push(inMatch[1].trim());
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
    const text = String(await res.text() || "");
    return { ok: !!res.ok, status: res.status || 0, url: res.url || url, text };
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
      type: "movie", id, title,
      targetAliases: targetAliases(title, [data.original_title].concat(alt)),
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
    type: "special", id,
    title: `${showTitle} • ${specialTitle}`,
    targetAliases: targetAliases(specialTitle, []),
    seriesAliases: uniq([showTitle, show.original_name].concat(alt)).filter(Boolean),
    originalLanguage: String(show.original_language || "").toLowerCase(),
    year: String(special.air_date || show.first_air_date || "").slice(0, 4)
  };
}

function anchorLinks(html, base, forcedVariant) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 1000) {
    const href = absolute(m[1], base);
    const text = stripTags(m[2]);
    if (!href || !text || !/^https?:\/\//i.test(href)) continue;
    if (!/wco(?:stream|flix|forever)\./i.test(href)) continue;
    if (!out.some(x => x.href === href)) out.push({ href, text, variant: classifyVariant(`${text} ${href}`, forcedVariant) });
  }
  return out;
}

async function postSearch(query) {
  const out = [];
  for (const origin of ORIGINS) {
    const page = await req(`${origin}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": origin, "Referer": `${origin}/` },
      body: `catara=${encodeURIComponent(query)}&konuara=series`
    });
    if (!page.ok) continue;
    out.push(...anchorLinks(page.text, origin));
  }
  return out.filter((item, index, list) => list.findIndex(x => x.href === item.href) === index);
}

async function findDirectEntries(target) {
  const out = [];
  for (const query of target.targetAliases.slice(0, 4)) {
    const links = await postSearch(query);
    for (const item of links) {
      if (/\/anime\//i.test(item.href)) continue;
      const score = bestScore(`${item.text} ${item.href}`, target.targetAliases);
      if (score >= 82) out.push({ ...item, score });
    }
    if (out.some(x => x.score >= 94)) break;
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

async function findSeriesCandidates(target) {
  const out = [];
  for (const seed of target.seriesAliases.slice(0, 5)) {
    const links = await postSearch(seed);
    for (const item of links) {
      if (!/\/anime\//i.test(item.href)) continue;
      const score = bestScore(`${item.text} ${item.href}`, target.seriesAliases);
      if (score < 72) continue;
      out.push({ ...item, score });
    }
    if (out.some(x => x.score >= 94)) break;
  }
  return out.sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex(x => x.href === item.href) === index)
    .slice(0, 6);
}

async function specialEntriesFromSeries(seriesUrl, target) {
  const pages = [
    { url: `${String(seriesUrl).replace(/[?#].*$/, "").replace(/\/$/, "")}/?season=all`, variant: null },
    { url: `${String(seriesUrl).replace(/[?#].*$/, "").replace(/\/$/, "")}/?season=all&lang=dub`, variant: "Dub" },
    { url: `${String(seriesUrl).replace(/[?#].*$/, "").replace(/\/$/, "")}/?season=all&lang=sub`, variant: "Sub" }
  ];
  const out = [];
  for (const source of pages) {
    const page = await req(source.url, { headers: { "Referer": seriesUrl } });
    if (!page.ok) continue;
    for (const item of anchorLinks(page.text, source.url, source.variant)) {
      if (/\/anime\//i.test(item.href)) continue;
      const score = bestScore(`${item.text} ${item.href}`, target.targetAliases);
      if (score < 78) continue;
      out.push({ ...item, score });
    }
  }
  return out.sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex(x => x.href === item.href && x.variant === item.variant) === index)
    .slice(0, 8);
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
  for (const re of [
    /\$\.getJSON\(\s*["']([^"']+)["']/i,
    /getJSON\(\s*["']([^"']+)["']/i,
    /["'](\/inc\/embed\/getvidlink\.php\?[^"']+)["']/i
  ]) {
    const m = text.match(re);
    if (m && m[1]) return htmlDecode(m[1].replace(/\\\//g, "/"));
  }
  return "";
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
  return "";
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

async function extractEntry(entry, target) {
  const page = await req(entry.href, { headers: { "Referer": `${originOf(entry.href)}/` } });
  if (!page.ok) return [];
  const frame = iframeLink(page.text, entry.href);
  if (!frame || /user\.wcostream\.tv\/check-login/i.test(frame) || !/embed\.wcostream/i.test(frame)) return [];
  const lookup = await playerLookup(frame);
  if (!lookup) return [];
  const lookupRes = await req(lookup, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": frame,
      "Origin": originOf(frame),
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!lookupRes.ok) return [];
  let data;
  try { data = JSON.parse(lookupRes.text); } catch (_) { return []; }
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
      headers: { "Referer": frame, "Origin": originOf(frame), "User-Agent": UA }
    });
  }
  return out;
}

function dedupeStreams(streams) {
  const seen = new Set();
  return (streams || []).filter(stream => {
    const key = `${stream.quality}|${stream.url}`;
    if (!stream.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "").toLowerCase() === "movie" ? "movie" : "tv";
  if (type === "tv" && Number(season) !== 0) return [];
  try {
    const target = await tmdbTarget(inputId, type, season, episode);
    if (!target) return [];

    for (const entry of await findDirectEntries(target)) {
      const streams = await extractEntry(entry, target);
      if (streams.length) return dedupeStreams(streams);
    }

    for (const series of await findSeriesCandidates(target)) {
      for (const entry of await specialEntriesFromSeries(series.href, target)) {
        const streams = await extractEntry(entry, target);
        if (streams.length) return dedupeStreams(streams);
      }
    }
    return [];
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
