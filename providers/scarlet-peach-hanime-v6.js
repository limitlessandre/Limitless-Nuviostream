"use strict";

const PROVIDER = "Hanime";
const CATALOG_BASE = "https://scarlet-peach-catalog.limitlessandre.workers.dev";
const RESOLVER_BASE = "https://scarlet-peach-hanime.limitlessandre.workers.dev";

function clean(value) { return String(value == null ? "" : value).trim(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function isTransientStatus(status) { return status === 502 || status === 503 || status === 504; }

function diag(stage, detail) {
  const text = `${PROVIDER} • DIAG ${stage} • ${detail}`;
  return [{
    name: text,
    title: text,
    url: "https://hanime.tv/favicon.ico",
    quality: "DIAG",
    language: "Unavailable",
    provider: PROVIDER,
    type: "m3u8",
    subtitles: []
  }];
}

function baseMediaId(inputId) {
  const raw = clean(inputId);
  if (/^(?:mal|anilist):\d+:\d+$/i.test(raw)) return raw.replace(/:\d+$/i, "");
  if (/^sp:.+:\d+$/i.test(raw)) return raw.replace(/:\d+$/i, "");
  return raw;
}

function directSlugHint(inputId) {
  const raw = clean(inputId);
  const prefixMatch = raw.match(/^(htv|hmm|hse|hs)-/i);
  if (!prefixMatch) return null;
  const sourcePrefix = prefixMatch[1].toLowerCase();
  let slug = raw.slice(prefixMatch[0].length);
  let episode = 1;
  const epMatch = slug.match(/(?:-season)?-episode-(\d+)$/i) || slug.match(/-episode-(\d+)$/i);
  if (epMatch) episode = Math.max(1, Number(epMatch[1]));
  slug = slug
    .replace(/(?:-season)?-episode-\d+$/i, "")
    .replace(/-episode-\d+$/i, "")
    .replace(/-season-\d+$/i, "")
    .replace(/-+/g, " ")
    .trim();
  if (!slug) return null;
  return {
    id: raw,
    title: slug,
    canonicalTitle: slug,
    aliases: [],
    year: null,
    episode,
    providerSlug: null,
    mappingMode: `legacy-${sourcePrefix}`,
    censorStatus: "unknown",
    audioLanguages: [],
    subtitleLanguages: []
  };
}

function episodeFromInput(inputId, episode) {
  const explicit = Number(episode);
  if (explicit > 0) return explicit;
  const raw = clean(inputId);
  const direct = directSlugHint(raw);
  if (direct) return direct.episode;
  const base = baseMediaId(raw);
  if (base !== raw) {
    const suffix = raw.slice(base.length + 1);
    const parsed = Number(suffix);
    if (parsed > 0) return parsed;
  }
  return 1;
}

async function readJson(response) {
  if (!response) return null;
  try {
    const text = await response.text();
    if (text) return JSON.parse(text);
  } catch (_) {}
  try { return await response.json(); } catch (_) { return null; }
}

async function fetchWithTransientRetry(url, options) {
  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetch(url, options);
      const status = response ? Number(response.status || 0) : 0;
      if (!isTransientStatus(status) || attempt === 2) return { response, attempt, error: null };
    } catch (error) {
      lastError = error;
      if (attempt === 2) return { response: null, attempt, error };
    }
  }
  return { response, attempt: 2, error: lastError };
}

function hanimeMapping(mappings) {
  if (!Array.isArray(mappings)) return null;
  return mappings.find(mapping => clean(mapping && mapping.provider).toLowerCase() === "hanime") || null;
}

function languageName(code) {
  const value = clean(code).toLowerCase();
  const names = {
    ja: "Japanese",
    en: "English",
    es: "Spanish",
    pt: "Portuguese",
    fr: "French",
    de: "German",
    it: "Italian",
    ko: "Korean",
    zh: "Chinese"
  };
  return names[value] || clean(code);
}

function normalizedLanguageCode(code) {
  const value = clean(code).toLowerCase();
  const aliases = {
    japanese: "ja", jp: "ja", ja: "ja",
    english: "en", eng: "en", en: "en",
    spanish: "es", spa: "es", es: "es",
    portuguese: "pt", por: "pt", pt: "pt",
    french: "fr", fra: "fr", fr: "fr",
    german: "de", deu: "de", de: "de",
    italian: "it", ita: "it", it: "it",
    korean: "ko", kor: "ko", ko: "ko",
    chinese: "zh", zho: "zh", zh: "zh"
  };
  return aliases[value] || value;
}

function streamLanguage(meta) {
  const audio = unique(meta && meta.audioLanguages || []);
  if (!audio.length) return "Japanese";
  return audio.map(languageName).filter(Boolean).join(" + ") || "Japanese";
}

function audioVariantTag(meta) {
  const audio = unique(meta && meta.audioLanguages || []).map(normalizedLanguageCode);
  const subtitles = unique(meta && meta.subtitleLanguages || []).map(normalizedLanguageCode);
  const hasSubs = subtitles.length > 0;
  const hasJapanese = audio.includes("ja");
  const hasEnglish = audio.includes("en");
  const multiAudio = new Set(audio).size > 1;

  if (multiAudio && hasSubs) return "[DUAL]";
  if (hasEnglish && !hasJapanese && hasSubs) return "[DUB+SUB]";
  if (hasEnglish && !hasJapanese) return "[DUB]";
  if (hasJapanese && hasSubs) return "[SUB]";
  return "";
}

function censorLabel(status) {
  const value = clean(status).toLowerCase();
  if (value === "censored") return "Censored";
  if (value === "uncensored") return "Uncensored";
  if (value === "mixed") return "Mixed Censorship";
  return "";
}

async function getScarletMeta(inputId, episode) {
  const direct = directSlugHint(inputId);
  if (direct) return direct;

  const id = baseMediaId(inputId);
  if (!/^(?:mal|anilist|sp):/i.test(id)) return null;
  const url = `${CATALOG_BASE}/meta/series/${encodeURIComponent(id)}.json`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response || !response.ok) return null;
  const payload = await readJson(response);
  const meta = payload && payload.meta ? payload.meta : payload;
  if (!meta || !meta.name) return null;

  const aliases = [];
  if (Array.isArray(meta.aliases)) aliases.push(...meta.aliases);
  if (Array.isArray(meta.alternativeTitles)) aliases.push(...meta.alternativeTitles);
  if (meta.originalTitle) aliases.push(meta.originalTitle);
  if (meta.japaneseTitle) aliases.push(meta.japaneseTitle);

  let year = Number(meta.year || 0) || null;
  if (!year && meta.releaseInfo) {
    const m = String(meta.releaseInfo).match(/\b(19|20)\d{2}\b/);
    if (m) year = Number(m[0]);
  }

  const titleMapping = hanimeMapping(meta.providerMappings);
  const video = Array.isArray(meta.videos)
    ? meta.videos.find(item => Number(item && item.episode) === Number(episode))
    : null;
  const episodeMapping = hanimeMapping(video && video.providerMappings);
  const preferredMapping = episodeMapping || titleMapping;
  const providerTitle = clean(episodeMapping && episodeMapping.title) || clean(titleMapping && titleMapping.title);
  if (providerTitle) aliases.unshift(String(meta.name));

  const audioLanguages = unique([
    ...(episodeMapping && episodeMapping.audioLanguages || []),
    ...(titleMapping && titleMapping.audioLanguages || []),
    ...(video && video.audioLanguages || [])
  ]);
  const subtitleLanguages = unique([
    ...(episodeMapping && episodeMapping.subtitleLanguages || []),
    ...(titleMapping && titleMapping.subtitleLanguages || []),
    ...(video && video.subtitleLanguages || [])
  ]);
  const censorStatus = clean(episodeMapping && episodeMapping.censorStatus)
    || clean(video && video.censorStatus)
    || clean(titleMapping && titleMapping.censorStatus)
    || clean(meta.censorStatus)
    || "unknown";

  return {
    id,
    title: providerTitle || String(meta.name),
    canonicalTitle: String(meta.name),
    aliases: unique([...aliases, providerTitle]),
    year,
    providerSlug: clean(preferredMapping && preferredMapping.slug) || null,
    mappingMode: episodeMapping ? "catalog-episode" : titleMapping ? "catalog-title" : "catalog-fuzzy",
    censorStatus,
    audioLanguages,
    subtitleLanguages
  };
}

function typeFromUrl(url) {
  const value = clean(url).toLowerCase();
  if (value.includes(".m3u8") || value.includes("/hls/")) return "m3u8";
  if (value.includes(".mp4")) return "mp4";
  return "m3u8";
}

function streamHeight(stream) {
  const direct = Number(stream && stream.height || 0);
  if (direct > 0) return direct;
  const match = clean(stream && stream.label).match(/(\d{3,4})p?/i);
  return match ? Number(match[1]) : 0;
}

function numericQuality(stream) {
  const height = streamHeight(stream);
  return height > 0 ? `${height}p` : "Auto";
}

function qualityTier(stream) {
  const height = streamHeight(stream);
  if (height >= 4320) return `2x4K 8K ${height}p`;
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `Enhanced QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 540) return `HD-Low ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height >= 360) return `SD-Low ${height}p`;
  if (height >= 240) return `SD-Very Low ${height}p`;
  return "Unknown Auto";
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const ep = episodeFromInput(inputId, episode);
    const meta = await getScarletMeta(inputId, ep);
    if (!meta) return diag("ID", `metadata unavailable • input=${clean(inputId)} type=${clean(mediaType)}`);

    const healthResult = await fetchWithTransientRetry(`${RESOLVER_BASE}/health`, { headers: { Accept: "application/json" } });
    const health = healthResult.response;
    if (!health || !health.ok) {
      const status = health ? health.status : "ERR";
      const retry = healthResult.attempt > 1 ? ` • attempts=${healthResult.attempt}` : "";
      return diag("RESOLVER", `Hanime worker unavailable • HTTP ${status}${retry}`);
    }

    const resolvePayload = {
      title: meta.title,
      aliases: meta.aliases,
      year: meta.year,
      episode: ep
    };
    if (meta.providerSlug) resolvePayload.slug = meta.providerSlug;

    const resolveResult = await fetchWithTransientRetry(`${RESOLVER_BASE}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(resolvePayload)
    });
    const response = resolveResult.response;
    const payload = await readJson(response);
    if (!response || !response.ok || !payload) {
      const reason = payload && payload.error ? payload.error : resolveResult.error && resolveResult.error.message
        ? resolveResult.error.message
        : `HTTP ${response ? response.status : "ERR"}`;
      const candidate = payload && Array.isArray(payload.candidates) && payload.candidates[0]
        ? ` • best=${payload.candidates[0].name} score=${payload.candidates[0].score}`
        : "";
      const mapped = meta.providerSlug ? ` • mapped=${meta.providerSlug}` : "";
      const attempts = resolveResult.attempt > 1 ? ` • attempts=${resolveResult.attempt}` : "";
      return diag("MATCH", `${reason} • title=${meta.title} • ep=${ep} • mode=${meta.mappingMode || "unknown"}${mapped}${attempts}${candidate}`);
    }

    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    if (!streams.length) return diag("PLAYBACK", `no playable streams • title=${meta.title} • ep=${ep}`);

    const censorship = censorLabel(meta.censorStatus);
    const audioTag = audioVariantTag(meta);
    const language = streamLanguage(meta);
    return streams.map(stream => {
      const tier = qualityTier(stream);
      const quality = numericQuality(stream);
      const details = [tier, audioTag, censorship].filter(Boolean).join(" • ");
      return {
        name: `${PROVIDER} • ${details}`,
        title: `${payload.match && payload.match.name ? payload.match.name : meta.title} • Episode ${ep}`,
        url: stream.url,
        quality,
        language,
        provider: PROVIDER,
        type: typeFromUrl(stream.url),
        headers: {
          Referer: "https://player.hanime.tv/",
          Origin: "https://player.hanime.tv"
        },
        subtitles: []
      };
    });
  } catch (error) {
    return diag("ERROR", error && error.message ? error.message : String(error));
  }
}

module.exports = { getStreams };
