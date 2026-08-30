"use strict";

const PROVIDER_NAME = "WCO Movie Test";
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
  if (a.includes(b) || b.includes(a)) return 86;
  const aw = a.split(" "), bw = b.split(" ");
  let overlap = 0;
  for (const word of bw) if (word.length > 1 && aw.includes(word)) overlap += 1;
  return Math.round((overlap / Math.max(1, Math.max(aw.length, bw.length))) * 80);
}

function movieAliases(info) {
  const out = [];
  for (const title of info.titles || []) {
    if (!title) continue;
    out.push(title);
    const colon = String(title).split(":");
    if (colon.length > 1) out.push(colon.slice(1).join(":").trim());
    const dash = String(title).split(/\s[-–—]\s/);
    if (dash.length > 1) out.push(dash.slice(1).join(" ").trim());
  }
  return uniq(out);
}

function bestMovieScore(value, info) {
  let score = 0;
  for (const title of movieAliases(info)) score = Math.max(score, scoreTitle(value, title));
  return score;
}

function classifyVariant(value) {
  const text = String(value || "").toLowerCase();
  if (/english[\s_-]*subbed|\bsubbed\b|\bsub\b/.test(text)) return "Sub";
  if (/english[\s_-]*dubbed|\bdubbed\b|\bdub\b/.test(text)) return "Dub";
  return "Dub";
}

function variantMeta(variant) {
  return variant === "Sub"
    ? { label: "Japanese + English Hard Subs", language: "Japanese" }
    : { label: "English Dub", language: "English" };
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

async function tmdbInfo(inputId) {
  const raw = String(inputId || "").trim();
  let id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (!id && /^tt\d+$/i.test(raw)) {
    const found = await jsonReq(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    id = found && found.movie_results && found.movie_results[0] ? found.movie_results[0].id : null;
  }
  if (!id) return null;
  const data = await jsonReq(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
  if (!data) return null;
  const alt = ((data.alternative_titles && data.alternative_titles.titles) || []).map(x => x && x.title);
  const title = data.title || data.original_title || `TMDB ${id}`;
  return {
    id,
    title,
    titles: uniq([title, data.original_title].concat(alt)).slice(0, 10),
    year: String(data.release_date || "").slice(0, 4)
  };
}

function anchorLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 800) {
    const href = absolute(m[1], base);
    const text = stripTags(m[2]);
    if (!href || !text) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    if (!/wco(?:stream|flix|forever)\./i.test(href)) continue;
    if (!out.some(x => x.href === href)) out.push({ href, text, variant: classifyVariant(`${text} ${href}`) });
  }
  return out;
}

async function searchCandidates(info) {
  const out = [];
  for (const query of movieAliases(info).slice(0, 4)) {
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
      if (!page.ok) continue;
      for (const item of anchorLinks(page.text, origin)) {
        const score = bestMovieScore(`${item.text} ${item.href}`, info);
        if (score < 55) continue;
        if (!out.some(x => x.href === item.href)) out.push({ ...item, score });
      }
      if (out.some(x => x.score >= 94)) break;
    }
    if (out.some(x => x.score >= 94)) break;
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

function iframeLink(html, pageUrl) {
  const m = String(html || "").match(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return m && m[1] ? absolute(m[1], pageUrl) : "";
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

function bestSpecialEntries(html, pageUrl, info) {
  return anchorLinks(html, pageUrl)
    .map(x => ({ ...x, score: bestMovieScore(`${x.text} ${x.href}`, info) }))
    .filter(x => x.score >= 65 && !/\/anime\//i.test(x.href))
    .sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex(x => x.href === item.href) === index)
    .slice(0, 6);
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

async function extractEpisode(entry, info) {
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
  const meta = variantMeta(entry.variant);
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
      title: `${info.title}${info.year ? ` (${info.year})` : ""}`,
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

async function getStreams(inputId, mediaType) {
  if (String(mediaType || "").toLowerCase() !== "movie") return [];
  try {
    const info = await tmdbInfo(inputId);
    if (!info) return [];
    const candidates = await searchCandidates(info);

    for (const candidate of candidates) {
      const first = await req(candidate.href, { headers: { "Referer": `${originOf(candidate.href)}/` } });
      if (!first.ok) continue;

      const directScore = bestMovieScore(`${candidate.text || candidate.title || ""} ${candidate.href}`, info);
      if (!/\/anime\//i.test(candidate.href) && directScore >= 70) {
        const direct = await extractEpisode(candidate, info);
        if (direct.length) return direct;
      }

      let seriesUrl = /\/anime\//i.test(candidate.href) ? candidate.href : findSeriesLink(first.text, candidate.href);
      if (!seriesUrl) continue;
      const series = seriesUrl === candidate.href ? first : await req(seriesUrl, { headers: { "Referer": candidate.href } });
      if (!series.ok) continue;

      for (const entry of bestSpecialEntries(series.text, seriesUrl, info)) {
        const streams = await extractEpisode(entry, info);
        if (streams.length) return streams;
      }
    }
    return [];
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
