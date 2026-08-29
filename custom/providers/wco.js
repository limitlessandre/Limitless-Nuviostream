const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "WCoflix";
const MAIN_URL = "https://www.wcoforever.net";
const SEARCH_URL = "https://www.wcoflix.tv/search";
const EMBED_URL = "https://embed.wcostream.com";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
};

const absoluteUrl = (value, base = MAIN_URL) => {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) {
    const origin = (base.match(/^https?:\/\/[^/]+/i) || [base])[0];
    return `${origin}${value}`;
  }
  return `${base.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
};

const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/&amp;/g, "and")
  .replace(/english\s+(dubbed|subbed)/g, "")
  .replace(/\b(dubbed|subbed|dub|sub)\b/g, "")
  .replace(/\bseason\s*\d+\b/g, "")
  .replace(/\bepisode\s*\d+(?:\.\d+)?\b/g, "")
  .replace(/\bmovie\b/g, "")
  .replace(/\(\d{4}\)/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const scoreTitle = (candidate, wanted) => {
  const a = normalize(candidate);
  const b = normalize(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 90;
  if (a.includes(b) || b.includes(a)) return 80;
  const aw = a.split(" ");
  const bw = b.split(" ");
  const overlap = bw.filter(w => w.length > 1 && aw.includes(w)).length;
  return Math.round((overlap / Math.max(1, bw.length)) * 70);
};

const fetchText = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) }
  });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"} for ${url}`);
  return await res.text();
};

const getTmdbInfo = async (tmdbId, mediaType) => {
  const type = mediaType === "movie" ? "movie" : "tv";
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const alt = type === "movie"
      ? (data.alternative_titles?.titles || []).map(x => x.title)
      : (data.alternative_titles?.results || []).map(x => x.title);
    const titles = [
      data.title,
      data.name,
      data.original_title,
      data.original_name,
      ...alt
    ].filter(Boolean);
    return {
      title: data.title || data.name || data.original_title || data.original_name || `TMDB ${tmdbId}`,
      titles: [...new Set(titles)],
      year: String(data.release_date || data.first_air_date || "").slice(0, 4)
    };
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] TMDB error: ${e.message}`);
    return null;
  }
};

const searchWco = async (query) => {
  const body = `catara=${encodeURIComponent(query)}&konuara=series`;
  const html = await fetchText(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": `${SEARCH_URL}`,
      "Origin": "https://www.wcoflix.tv"
    },
    body
  });
  const $ = cheerio.load(html);
  const results = [];
  $("ul.items li").each((_, el) => {
    const anchor = $(el).find("div.recent-release-episodes a").first();
    if (!anchor || !anchor.length) return;
    const title = anchor.text().trim();
    const href = absoluteUrl(anchor.attr("href") || "", MAIN_URL);
    if (title && href) results.push({ title, href });
  });
  return results;
};

const searchAcrossTitles = async (titles) => {
  const seen = new Set();
  const out = [];
  for (const title of titles.slice(0, 6)) {
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    try {
      const results = await searchWco(title);
      for (const r of results) {
        const key = `${r.title}|${r.href}`;
        if (!out.some(x => `${x.title}|${x.href}` === key)) out.push(r);
      }
      if (out.some(r => scoreTitle(r.title, title) >= 80)) break;
    } catch (e) {
      console.error(`[${PROVIDER_NAME}] Search failed for ${title}: ${e.message}`);
    }
  }
  return out;
};

const findSeriesPage = async (url) => {
  if (url.includes("/anime/")) return url;
  try {
    const html = await fetchText(url, { headers: { Referer: `${MAIN_URL}/` } });
    const $ = cheerio.load(html);
    const href = $("div.header-tag h2 a").first().attr("href") || "";
    return href ? absoluteUrl(href, MAIN_URL) : url;
  } catch (_) {
    return url;
  }
};

const parseEpisodeEntries = async (seriesUrl) => {
  const html = await fetchText(seriesUrl, { headers: { Referer: `${MAIN_URL}/` } });
  const $ = cheerio.load(html);
  const entries = [];
  $("div#episodeList a.dark-episode-item, div#sidebar_right3 div.cat-eps a").each((_, el) => {
    const node = $(el);
    const href = absoluteUrl(node.attr("href") || "", MAIN_URL);
    if (!href) return;
    const text = (node.find("span").first().text() || node.text() || "").trim();
    const seasonRaw = node.attr("data-season") || "";
    const season = parseInt((seasonRaw.match(/s(\d+)/i) || text.match(/Season\s*(\d+)/i) || [])[1] || "1", 10) || 1;
    const episodeMatch = text.match(/Episode\s*(\d+(?:\.\d+)?)/i);
    const episode = episodeMatch ? parseFloat(episodeMatch[1]) : null;
    const langRaw = (node.attr("data-lang") || text || "").toLowerCase();
    const variant = /dub/.test(langRaw) ? "Dub" : /sub/.test(langRaw) ? "Sub" : "Original";
    entries.push({ href, text, season, episode, variant });
  });
  return entries;
};

const getIframe = async (pageUrl) => {
  const html = await fetchText(pageUrl, { headers: { Referer: `${MAIN_URL}/` } });
  const $ = cheerio.load(html);
  const src = $("iframe").first().attr("src") || "";
  return absoluteUrl(src, pageUrl);
};

const extractWcoStream = async (embedUrl, variant, displayTitle) => {
  if (!embedUrl) return [];
  try {
    const query = embedUrl.includes("?") ? embedUrl.split("?").slice(1).join("?") : "";
    const params = new URLSearchParams(query);
    const fileRaw = params.get("file");
    if (!fileRaw) return [];
    const embed = params.get("embed") || "";
    let apiPath;
    if (params.has("fullhd")) {
      const fullhdVal = params.get("fullhd") || "1";
      const v = `${embed}/${fileRaw.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/")}`;
      apiPath = `${EMBED_URL}/inc/embed/getvidlink.php?v=${v}&embed=${embed}&fullhd=${fullhdVal}`;
    } else {
      const hdVal = params.get("hd") || "1";
      const v = fileRaw.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/");
      apiPath = `${EMBED_URL}/inc/embed/getvidlink.php?v=${v}&embed=${embed}&hd=${hdVal}`;
    }

    const apiRes = await fetch(apiPath, {
      headers: {
        ...HEADERS,
        "Referer": embedUrl,
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (!apiRes.ok) return [];
    const rawData = await apiRes.text();
    let data;
    try { data = JSON.parse(rawData); } catch (_) { return []; }
    const hostRaw = String(data.server || data.cdn || "").replace(/\\/g, "").trim();
    if (!hostRaw) return [];
    const host = hostRaw.endsWith("/") ? hostRaw : `${hostRaw}/`;

    const subtitles = [];
    if (data.sub) {
      subtitles.push({
        url: `${host}getvid?evid=${data.sub}`,
        language: "English",
        name: `${PROVIDER_NAME} English`
      });
    }

    const qualities = [
      data.fullhd ? { evid: data.fullhd, quality: "1080p" } : null,
      data.hd ? { evid: data.hd, quality: "720p" } : null,
      data.enc ? { evid: data.enc, quality: "480p" } : null
    ].filter(Boolean);

    const streams = [];
    for (const item of qualities) {
      try {
        const vidPath = `${host}getvid?evid=${item.evid}&json`;
        const resp = await fetch(vidPath, {
          headers: {
            ...HEADERS,
            "Referer": `${EMBED_URL}/`,
            "Origin": EMBED_URL
          }
        });
        if (!resp.ok) continue;
        let videoUrl = (await resp.text()).trim().replace(/^"|"$/g, "").replace(/\\/g, "");
        if (!/^https?:\/\//i.test(videoUrl)) continue;

        if (videoUrl.includes("/getvid?evid=")) {
          try {
            const resolved = await fetch(videoUrl, {
              headers: {
                ...HEADERS,
                "Referer": host,
                "Origin": host.replace(/\/$/, "")
              }
            });
            if (resolved && resolved.url && /^https?:\/\//i.test(resolved.url) && !resolved.url.includes("/getvid?evid=")) {
              videoUrl = resolved.url;
            }
          } catch (_) {}
        }

        const language = variant === "Dub" ? "English" : variant === "Sub" ? "Japanese" : "English";
        const variantLabel = variant === "Dub" ? "English DUB" : variant === "Sub" ? "Japanese SUB + English Subs" : "English";
        streams.push({
          name: `${PROVIDER_NAME} [${variantLabel}] - ${item.quality}`,
          title: displayTitle,
          url: videoUrl,
          quality: item.quality,
          language,
          provider: PROVIDER_NAME,
          type: videoUrl.includes(".m3u8") ? "m3u8" : "mp4",
          headers: {
            "Referer": `${EMBED_URL}/`,
            "Origin": EMBED_URL
          },
          subtitles
        });
      } catch (e) {
        console.error(`[${PROVIDER_NAME}] Stream ${item.quality} failed: ${e.message}`);
      }
    }
    return streams;
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] Extractor error: ${e.message}`);
    return [];
  }
};

const getTvStreams = async (info, season, episode) => {
  const candidates = await searchAcrossTitles(info.titles);
  if (!candidates.length) return [];
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const score = Math.max(...info.titles.map(t => scoreTitle(c.title, t)));
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (!best) return [];

  const seriesUrl = await findSeriesPage(best.href);
  const entries = await parseEpisodeEntries(seriesUrl);
  const s = Number(season || 1);
  const e = Number(episode || 1);
  let matches = entries.filter(x => x.episode === e && x.season === s);
  if (!matches.length && s === 1) matches = entries.filter(x => x.episode === e);
  if (!matches.length) return [];

  const output = [];
  for (const entry of matches.slice(0, 4)) {
    const iframe = await getIframe(entry.href);
    const displayTitle = `${info.title} S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")} (${entry.variant})`;
    output.push(...await extractWcoStream(iframe, entry.variant, displayTitle));
  }
  return output;
};

const getMovieStreams = async (info) => {
  const candidates = await searchAcrossTitles(info.titles);
  if (!candidates.length) return [];
  const ranked = candidates
    .map(c => ({ ...c, score: Math.max(...info.titles.map(t => scoreTitle(c.title, t))) }))
    .filter(c => c.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const output = [];
  for (const candidate of ranked) {
    const lower = candidate.title.toLowerCase();
    const variant = /dub/.test(lower) ? "Dub" : /sub/.test(lower) ? "Sub" : "Original";
    let target = candidate.href;
    try {
      if (target.includes("/anime/")) {
        const entries = await parseEpisodeEntries(target);
        if (entries.length) target = entries[entries.length - 1].href;
      }
    } catch (_) {}
    const iframe = await getIframe(target);
    output.push(...await extractWcoStream(iframe, variant, `${info.title}${info.year ? ` (${info.year})` : ""} (${variant})`));
  }
  return output;
};

const dedupeStreams = (streams) => {
  const seen = new Set();
  return streams.filter(stream => {
    const key = `${stream.url}|${stream.name}`;
    if (!stream.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getStreams = async (tmdbId, mediaType, season, episode) => {
  console.log(`[${PROVIDER_NAME}] tmdb=${tmdbId} type=${mediaType} season=${season || "-"} episode=${episode || "-"}`);
  try {
    const info = await getTmdbInfo(tmdbId, mediaType);
    if (!info) return [];
    const streams = mediaType === "movie"
      ? await getMovieStreams(info)
      : await getTvStreams(info, season, episode);
    console.log(`[${PROVIDER_NAME}] ${streams.length} stream(s)`);
    return dedupeStreams(streams);
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] Fatal: ${e.message}`);
    return [];
  }
};

module.exports = { getStreams };

