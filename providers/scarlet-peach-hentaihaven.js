"use strict";

const PROVIDER = "HentaiHaven";
const CATALOG_BASE = "https://scarlet-peach-catalog.limitlessandre.workers.dev";
const RESOLVER_BASE = "https://scarlet-peach-hentaihaven.limitlessandre.workers.dev";

function clean(v) { return String(v == null ? "" : v).trim(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function diag(stage, detail) {
  const text = `${PROVIDER} • DIAG ${stage} • ${detail}`;
  return [{ name: text, title: text, url: "https://hentaihaven.com/favicon.ico", quality: "DIAG", language: "Unavailable", provider: PROVIDER, type: "m3u8", subtitles: [] }];
}
function baseMediaId(inputId) {
  const raw = clean(inputId);
  if (/^(?:mal|anilist):\d+:\d+$/i.test(raw)) return raw.replace(/:\d+$/i, "");
  if (/^sp:.+:\d+$/i.test(raw)) return raw.replace(/:\d+$/i, "");
  return raw;
}
function episodeFromInput(inputId, episode) {
  const explicit = Number(episode);
  if (explicit > 0) return explicit;
  const raw = clean(inputId), base = baseMediaId(raw);
  if (base !== raw) {
    const n = Number(raw.slice(base.length + 1));
    if (n > 0) return n;
  }
  return 1;
}
async function readJson(response) {
  if (!response) return null;
  try { const text = await response.text(); if (text) return JSON.parse(text); } catch (_) {}
  try { return await response.json(); } catch (_) { return null; }
}
async function getScarletMeta(inputId) {
  const id = baseMediaId(inputId);
  if (!/^(?:mal|anilist|sp):/i.test(id)) return null;
  const response = await fetch(`${CATALOG_BASE}/meta/series/${encodeURIComponent(id)}.json`, { headers: { Accept: "application/json" } });
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
  if (!year && meta.releaseInfo) { const m = String(meta.releaseInfo).match(/\b(19|20)\d{2}\b/); if (m) year = Number(m[0]); }
  return { id, title: String(meta.name), aliases: unique(aliases), year, censorStatus: clean(meta.censorStatus) || "unknown" };
}
function censorLabel(status) {
  const v = clean(status).toLowerCase();
  if (v === "censored") return "Censored";
  if (v === "uncensored") return "Uncensored";
  if (v === "mixed") return "Mixed Censorship";
  return "";
}
function streamHeight(stream) {
  const direct = Number(stream && stream.height || 0);
  if (direct > 0) return direct;
  const m = clean(stream && stream.label).match(/(\d{3,4})p?/i);
  return m ? Number(m[1]) : 0;
}
function numericQuality(stream) { const h = streamHeight(stream); return h ? `${h}p` : "Auto"; }
function qualityTier(stream) {
  const h = streamHeight(stream);
  if (h >= 4320) return `2x4K 8K ${h}p`;
  if (h >= 2160) return `4K ${h}p`;
  if (h >= 1440) return `Enhanced QHD ${h}p`;
  if (h >= 1080) return `FHD ${h}p`;
  if (h >= 720) return `HD ${h}p`;
  if (h >= 540) return `HD-Low ${h}p`;
  if (h >= 480) return `SD ${h}p`;
  if (h >= 360) return `SD-Low ${h}p`;
  if (h >= 240) return `SD-Very Low ${h}p`;
  return "Unknown Auto";
}
async function getStreams(inputId, mediaType, season, episode) {
  try {
    const ep = episodeFromInput(inputId, episode);
    const meta = await getScarletMeta(inputId);
    if (!meta) return diag("ID", `metadata unavailable • input=${clean(inputId)} type=${clean(mediaType)}`);

    let health;
    try { health = await fetch(`${RESOLVER_BASE}/health`, { headers: { Accept: "application/json" } }); }
    catch (e) { return diag("RESOLVER", `worker unavailable • ${e && e.message ? e.message : e}`); }
    if (!health || !health.ok) return diag("RESOLVER", `worker unavailable • HTTP ${health ? health.status : "ERR"}`);

    const response = await fetch(`${RESOLVER_BASE}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title: meta.title, aliases: meta.aliases, year: meta.year, episode: ep })
    });
    const payload = await readJson(response);
    if (!response || !response.ok || !payload) {
      const reason = payload && payload.error ? payload.error : `HTTP ${response ? response.status : "ERR"}`;
      const best = payload && Array.isArray(payload.candidates) && payload.candidates[0] ? ` • best=${payload.candidates[0].title || payload.candidates[0].url} score=${payload.candidates[0].score || 0}` : "";
      return diag("MATCH", `${reason} • title=${meta.title} • ep=${ep}${best}`);
    }
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    if (!streams.length) return diag("PLAYBACK", `no playable streams • title=${meta.title} • ep=${ep}`);
    const censorship = censorLabel(meta.censorStatus);
    return streams.map(stream => {
      const details = [qualityTier(stream), "[SUB]", censorship].filter(Boolean).join(" • ");
      return {
        name: `${PROVIDER} • ${details}`,
        title: `${payload.match && payload.match.name ? payload.match.name : meta.title} • Episode ${ep}`,
        url: stream.url,
        quality: numericQuality(stream),
        language: "Japanese",
        provider: PROVIDER,
        type: "m3u8",
        headers: { Referer: "https://hentaihaven.com/", Origin: "https://hentaihaven.com" },
        subtitles: []
      };
    });
  } catch (error) {
    return diag("ERROR", error && error.message ? error.message : String(error));
  }
}

module.exports = { getStreams };
