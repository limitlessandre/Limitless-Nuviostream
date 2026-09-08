"use strict";

const PROVIDER = "Scarlet Peach - Hanime";
const CATALOG_BASE = "https://scarlet-peach-catalog.limitlessandre.workers.dev";
const RESOLVER_BASE = "https://scarlet-peach-hanime.limitlessandre.workers.dev";

function clean(value) { return String(value == null ? "" : value).trim(); }

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
  if (/^sp:[^:]+:\d+$/i.test(raw)) return raw.replace(/:\d+$/i, "");
  return raw;
}

function episodeFromInput(inputId, episode) {
  const explicit = Number(episode);
  if (explicit > 0) return explicit;
  const m = clean(inputId).match(/:(\d+)$/);
  return m ? Math.max(1, Number(m[1])) : 1;
}

async function readJson(response) {
  if (!response) return null;
  try {
    const text = await response.text();
    if (text) return JSON.parse(text);
  } catch (_) {}
  try { return await response.json(); } catch (_) { return null; }
}

async function getScarletMeta(inputId) {
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
  return {
    id,
    title: String(meta.name),
    aliases: [...new Set(aliases.map(clean).filter(Boolean))],
    year
  };
}

function typeFromUrl(url) {
  const value = clean(url).toLowerCase();
  if (value.includes(".m3u8") || value.includes("/hls/")) return "m3u8";
  if (value.includes(".mp4")) return "mp4";
  return "m3u8";
}

function qualityLabel(stream) {
  const height = Number(stream && stream.height || 0);
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height) return `${height}p`;
  return clean(stream && stream.label) || "HLS";
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const meta = await getScarletMeta(inputId);
    if (!meta) return diag("ID", `metadata unavailable • input=${clean(inputId)} type=${clean(mediaType)}`);

    const ep = episodeFromInput(inputId, episode);
    const health = await fetch(`${RESOLVER_BASE}/health`, { headers: { Accept: "application/json" } });
    if (!health || !health.ok) return diag("RESOLVER", `Hanime worker unavailable • HTTP ${health ? health.status : "ERR"}`);

    const response = await fetch(`${RESOLVER_BASE}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title: meta.title, aliases: meta.aliases, year: meta.year, episode: ep })
    });
    const payload = await readJson(response);
    if (!response || !response.ok || !payload) {
      const reason = payload && payload.error ? payload.error : `HTTP ${response ? response.status : "ERR"}`;
      return diag("MATCH", `${reason} • title=${meta.title} • ep=${ep}`);
    }

    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    if (!streams.length) return diag("PLAYBACK", `no playable streams • title=${meta.title} • ep=${ep}`);

    return streams.map(stream => {
      const label = qualityLabel(stream);
      return {
        name: `${PROVIDER} • ${label}`,
        title: `${payload.match && payload.match.name ? payload.match.name : meta.title} • Episode ${ep}`,
        url: stream.url,
        quality: label,
        language: "Japanese",
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
