const PROVIDER_NAME = "OneTouchTV";
const API = "https://api3.devcorp.me";
const REDIRECT_HOST = "aapanel.devcorp.me";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

const normalize = value => String(value || "")
  .toLowerCase()
  .replace(/&amp;/g, "and")
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

const getJson = async url => {
  const res = await fetch(url, { headers: HEADERS });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"} for ${url}`);
  return await res.json();
};

const getText = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { ...HEADERS, ...headers } });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"} for ${url}`);
  return await res.text();
};

const getTmdbInfo = async (tmdbId, mediaType) => {
  const type = mediaType === "movie" ? "movie" : "tv";
  const data = await getJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
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
  const data = await getJson(`${API}/vod/search?page=1&keyword=${encodeURIComponent(query)}`);
  return Array.isArray(data?.result) ? data.result : [];
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
        const key = String(item.id || item.title || "");
        if (key && !out.some(x => String(x.id || x.title || "") === key)) out.push(item);
      }
      if (results.some(x => scoreTitle(x.title, query, info.year) >= 80)) break;
    } catch (e) {
      console.error(`[${PROVIDER_NAME}] search failed for ${query}: ${e.message}`);
    }
  }
  return out;
};

const inferLanguage = country => {
  const text = normalize(country);
  if (text.includes("korea")) return "Korean";
  if (text.includes("china") || text.includes("chinese")) return "Chinese";
  if (text.includes("japan")) return "Japanese";
  return "English";
};

const normalizeSubtitleLanguage = value => {
  const text = String(value || "").trim();
  const low = text.toLowerCase();
  if (low.includes("english") || low === "en" || low === "eng") return "English";
  if (low.includes("korean") || low === "ko" || low === "kor") return "Korean";
  if (low.includes("japanese") || low === "ja" || low === "jpn") return "Japanese";
  if (low.includes("chinese") || low.includes("中文") || low === "zh") return "Chinese";
  return text || "Unknown";
};

const followPlaylist = async (url, headers) => {
  if (!url || !url.includes("m3u8")) return url;
  let current = url;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const playlist = await getText(current, headers || {});
      if (!playlist.includes(REDIRECT_HOST)) break;
      const lines = playlist.split("\n").map(x => x.trim()).filter(Boolean);
      const next = [...lines].reverse().find(x => !x.startsWith("#"));
      if (!next) break;
      current = next.startsWith("http") ? next : new URL(next, current).toString();
    } catch (_) {
      break;
    }
  }
  return current;
};

const getStreams = async (tmdbId, mediaType, season, episode) => {
  console.log(`[${PROVIDER_NAME}] tmdb=${tmdbId} type=${mediaType} season=${season || "-"} episode=${episode || "-"}`);
  try {
    const info = await getTmdbInfo(tmdbId, mediaType);
    const results = await searchAcrossTitles(info);
    if (!results.length) return [];

    let best = null;
    let bestScore = -1;
    for (const item of results) {
      const score = Math.max(...info.titles.map(t => scoreTitle(item.title, t, info.year)));
      if (score > bestScore) { best = item; bestScore = score; }
    }
    if (!best || bestScore < 35 || !best.id) return [];

    const detail = await getJson(`${API}/vod/${best.id}/detail`);
    const eps = Array.isArray(detail?.result?.episodes) ? detail.result.episodes : [];
    if (!eps.length) return [];

    const requestedEpisode = Number(episode || 1);
    const ep = eps.find(x => Number(x.episode) === requestedEpisode) || (mediaType === "movie" ? eps[0] : null);
    if (!ep) return [];

    const episodeId = eps[0]?.identifier || detail.result.id || best.id;
    const episodeParam = ep.playId || String(requestedEpisode);
    const playback = await getJson(`${API}/vod/${episodeId}/episode/${episodeParam}`);
    const sources = Array.isArray(playback?.result?.sources) ? playback.result.sources : [];
    const tracks = Array.isArray(playback?.result?.track) ? playback.result.track : [];
    const language = inferLanguage(best.country);

    const subtitles = tracks
      .filter(x => x && x.file)
      .map((x, i) => ({
        url: x.file,
        language: normalizeSubtitleLanguage(x.name || x.label),
        name: x.label || x.name || `${PROVIDER_NAME} Subtitle ${i + 1}`
      }));

    const out = [];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source?.url) continue;
      const sourceHeaders = source.headers && typeof source.headers === "object" ? source.headers : {};
      const finalUrl = await followPlaylist(source.url, sourceHeaders);
      out.push({
        name: `${PROVIDER_NAME} [${language}] - ${source.quality || "Auto"}`,
        title: `${info.title}${mediaType === "movie" ? "" : ` S${String(season || 1).padStart(2, "0")}E${String(requestedEpisode).padStart(2, "0")}`}`,
        url: finalUrl,
        quality: source.quality || "Auto",
        language,
        provider: PROVIDER_NAME,
        type: String(source.type || "").toLowerCase() === "hls" || finalUrl.includes("m3u8") ? "m3u8" : "mp4",
        headers: sourceHeaders,
        subtitles
      });
    }

    const seen = new Set();
    return out.filter(x => x.url && !seen.has(x.url) && seen.add(x.url));
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] ${e.message}`);
    return [];
  }
};

module.exports = { getStreams };
