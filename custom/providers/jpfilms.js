const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "JPFilms";
const MAIN_URL = "https://jp-films.com";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
};

const absoluteUrl = (value, base = MAIN_URL) => {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  try { return new URL(value, base).toString(); } catch (_) { return value; }
};

const normalize = value => String(value || "")
  .toLowerCase()
  .replace(/full\s*hd/g, "")
  .replace(/\(\d{4}\)/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const scoreTitle = (candidate, wanted, year) => {
  const a = normalize(candidate);
  const b = normalize(wanted);
  if (!a || !b) return 0;
  let score = 0;
  if (a === b) score = 100;
  else if (a.startsWith(b) || b.startsWith(a)) score = 90;
  else if (a.includes(b) || b.includes(a)) score = 80;
  else {
    const aw = a.split(" ");
    const bw = b.split(" ");
    const overlap = bw.filter(w => w.length > 1 && aw.includes(w)).length;
    score = Math.round((overlap / Math.max(1, bw.length)) * 70);
  }
  if (year && String(candidate || "").includes(String(year))) score += 5;
  return score;
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
  const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  const alternatives = type === "movie"
    ? (data.alternative_titles?.titles || []).map(x => x.title)
    : (data.alternative_titles?.results || []).map(x => x.title);
  const titles = [data.title, data.name, data.original_title, data.original_name, ...alternatives].filter(Boolean);
  return {
    title: data.title || data.name || data.original_title || data.original_name || `TMDB ${tmdbId}`,
    titles: [...new Set(titles)],
    year: String(data.release_date || data.first_air_date || "").slice(0, 4)
  };
};

const search = async query => {
  const html = await fetchText(`${MAIN_URL}/search/${encodeURIComponent(query)}`);
  const $ = cheerio.load(html);
  const out = [];
  $("article.thumb.grid-item").each((_, el) => {
    const title = $(el).find(".entry-title").first().text().trim();
    const href = absoluteUrl($(el).find("a").first().attr("href") || "");
    if (title && href) out.push({ title, href });
  });
  return out;
};

const searchAcrossTitles = async info => {
  const out = [];
  const seen = new Set();
  for (const query of info.titles.slice(0, 6)) {
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    try {
      const results = await search(query);
      for (const item of results) {
        if (!out.some(x => x.href === item.href)) out.push(item);
      }
      if (results.some(x => scoreTitle(x.title, query, info.year) >= 80)) break;
    } catch (e) {
      console.error(`[${PROVIDER_NAME}] search failed for ${query}: ${e.message}`);
    }
  }
  return out;
};

const parseEpisodePages = html => {
  const $ = cheerio.load(html);
  let scriptText = "";
  $("script").each((_, el) => {
    const text = $(el).html() || "";
    if (!scriptText && text.includes("var jsonEpisodes")) scriptText = text;
  });
  if (!scriptText) return [];

  const match = scriptText.match(/var\s+jsonEpisodes\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) return [];

  try {
    const groups = JSON.parse(match[1]);
    const out = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const ep of Array.isArray(group) ? group : []) {
        if (Number(ep.serverId) !== 2 || !ep.postUrl) continue;
        const name = String(ep.episodeName || "");
        const num = Number((name.match(/\d+(?:\.\d+)?/) || [])[0] || 0);
        out.push({ url: absoluteUrl(String(ep.postUrl).replace(/\\\//g, "/")), name, episode: num });
      }
    }
    return out;
  } catch (_) {
    return [];
  }
};

const extractStream = async pageUrl => {
  const html = await fetchText(pageUrl, { headers: { Referer: `${MAIN_URL}/` } });
  const $ = cheerio.load(html);
  const nonce = $("body").attr("data-nonce") || "";

  let config = "";
  $("script").each((_, el) => {
    const text = $(el).html() || "";
    if (!config && text.includes("var halim_cfg")) config = text;
  });
  if (!config) return null;

  const postId = (config.match(/"post_id"\s*:\s*(\d+)/) || [])[1];
  const episodeSlug = (config.match(/"episode_slug"\s*:\s*"([^"]+)"/) || [])[1] || "server-1";
  const serverId = (config.match(/"server"\s*:\s*"([^"]+)"/) || [])[1] || "1";
  if (!postId) return null;

  const ajaxUrl = `${MAIN_URL}/wp-content/themes/halimmovies/player.php?episode_slug=${encodeURIComponent(episodeSlug)}&server_id=${encodeURIComponent(serverId)}&subsv_id=&post_id=${encodeURIComponent(postId)}&nonce=${encodeURIComponent(nonce)}&custom_var=`;
  const player = await fetchText(ajaxUrl, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Referer": pageUrl
    }
  });

  const raw = (player.match(/"file"\s*:\s*"([^"]+)"/) || [])[1];
  if (!raw) return null;
  return raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
};

const getStreams = async (tmdbId, mediaType, season, episode) => {
  console.log(`[${PROVIDER_NAME}] tmdb=${tmdbId} type=${mediaType} season=${season || "-"} episode=${episode || "-"}`);
  try {
    const info = await getTmdbInfo(tmdbId, mediaType);
    if (!info) return [];
    const results = await searchAcrossTitles(info);
    if (!results.length) return [];

    const ranked = results
      .map(x => ({ ...x, score: Math.max(...info.titles.map(t => scoreTitle(x.title, t, info.year))) }))
      .filter(x => x.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const output = [];
    for (const item of ranked) {
      const detailHtml = await fetchText(item.href, { headers: { Referer: `${MAIN_URL}/` } });
      const pages = parseEpisodePages(detailHtml);
      let target = item.href;

      if (pages.length) {
        if (mediaType === "movie") {
          target = pages[0].url;
        } else {
          const wanted = Number(episode || 1);
          const ep = pages.find(x => x.episode === wanted) || pages[wanted - 1];
          if (!ep) continue;
          target = ep.url;
        }
      }

      const streamUrl = await extractStream(target);
      if (!streamUrl) continue;
      output.push({
        name: `${PROVIDER_NAME} [Japanese + English Subs] - Auto`,
        title: `${info.title}${mediaType === "movie" ? "" : ` S${String(season || 1).padStart(2, "0")}E${String(episode || 1).padStart(2, "0")}`}`,
        url: streamUrl,
        quality: "Auto",
        language: "Japanese",
        provider: PROVIDER_NAME,
        type: streamUrl.includes("m3u8") ? "m3u8" : "mp4",
        headers: {
          "Referer": `${MAIN_URL}/`,
          "Origin": MAIN_URL
        }
      });
      if (output.length >= 2) break;
    }

    const seen = new Set();
    return output.filter(x => x.url && !seen.has(x.url) && seen.add(x.url));
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] ${e.message}`);
    return [];
  }
};

module.exports = { getStreams };
