"use strict";

// Nexus-only diagnostic passthrough for the validated generic season-title resolver.
// This file does not patch the resolver source. It runs v2 unchanged, then appends
// candidate-level diagnostics only when v2 returns DIAG results. Production WCO is untouched.

const PROVIDER_NAME = "WCO Power Rangers Nexus";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-power-rangers-nexus-v2.js";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
let cached = null;

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diagRow(stage, message, season, episode) {
  const clean = cleanText(message).slice(0, 190);
  return {
    name: `${PROVIDER_NAME} • DIAG ${stage} • ${clean}`,
    title: `Power Rangers S${String(Number(season || 1)).padStart(2, "0")}E${String(Number(episode || 1)).padStart(2, "0")}`,
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  };
}

async function loadProvider() {
  if (cached && typeof cached.getStreams === "function") return cached;
  try {
    const res = await fetch(BASE_URL, { skipSizeCheck: true });
    if (!res || !res.ok) return null;
    const source = String(await res.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) {
      throw new Error("Unsupported nested require: " + name);
    }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    cached = exported;
    return cached;
  } catch (_) {
    return null;
  }
}

function findDiag(rows, needle) {
  return (rows || []).find(row => String(row && row.name || "").includes(needle));
}

function parseHint(rows) {
  const row = findDiag(rows, "DIAG TMDB");
  const text = String(row && row.name || "");
  const m = text.match(/\bhint=(\d+)/i);
  return m ? Number(m[1]) : null;
}

function parseSeriesUrl(rows) {
  const preferred = findDiag(rows, "DIAG SEARCH COMBINED") || findDiag(rows, "DIAG SEARCH SEASON");
  const text = String(preferred && preferred.name || "");
  let m = text.match(/@\s*(https?:\/\/[^\s•]+)/i);
  if (m) return m[1];
  m = text.match(/@\s*((?:www\.)?(?:wcostream\.tv|wcoflix\.tv|wcoforever\.net)\/[^\s•]+)/i);
  if (m) return "https://" + m[1];
  return "";
}

function episodeCandidates(html, pageUrl, wantedEpisode, sourceSeason) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 20) {
    const text = cleanText(m[2]);
    let href = String(m[1] || "").trim();
    if (!href || !text) continue;
    try { href = new URL(href, pageUrl).href; } catch (_) { continue; }
    const combined = text + " " + href;
    const em = combined.match(/Episode\s*(\d+(?:\.\d+)?)/i) || combined.match(/episode[-_ ]?(\d+(?:\.\d+)?)/i);
    if (!em || Number(em[1]) !== Number(wantedEpisode)) continue;
    const sm = combined.match(/Season\s*(\d+)/i) || combined.match(/season[-_ ]?(\d+)/i);
    const foundSeason = sm ? Number(sm[1]) : null;
    if (sourceSeason && foundSeason != null && foundSeason !== sourceSeason) continue;
    const key = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (out.some(x => x.key === key)) continue;
    out.push({ key, href, text, season: foundSeason });
  }
  return out;
}

async function candidateDiagnostics(rows, season, episode) {
  if (!findDiag(rows, "DIAG NUMBER CHECK")) return [];
  const sourceSeason = parseHint(rows);
  const seriesUrl = parseSeriesUrl(rows);
  if (!seriesUrl) return [diagRow("CANDIDATE FETCH", `series URL not found • hint=${sourceSeason || "nil"}`, season, episode)];
  try {
    const pageUrl = seriesUrl.includes("?") ? seriesUrl : seriesUrl.replace(/\/$/, "") + "/?season=all";
    const res = await fetch(pageUrl, { headers: { Referer: pageUrl }, skipSizeCheck: true });
    if (!res || !res.ok) return [diagRow("CANDIDATE FETCH", `HTTP ${res && res.status || "fail"} • ${pageUrl}`, season, episode)];
    const html = String(await res.text() || "");
    const candidates = episodeCandidates(html, pageUrl, episode, sourceSeason);
    if (!candidates.length) return [diagRow("CANDIDATES", `none on ${pageUrl} • hint=${sourceSeason || "nil"}`, season, episode)];
    return candidates.slice(0, 6).map((x, i) => diagRow(
      `CANDIDATE ${i + 1}`,
      `S${x.season == null ? "nil" : x.season} • ${x.text.slice(0, 72)} • ${x.href.replace(/^https?:\/\//, "").slice(0, 88)}`,
      season,
      episode
    ));
  } catch (err) {
    return [diagRow("CANDIDATE FETCH", String(err && err.message || err), season, episode)];
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const provider = await loadProvider();
    if (!provider) return [diagRow("PASSTHROUGH", "v2 provider failed to load", season, episode)];
    const rows = await provider.getStreams(inputId, mediaType, season, episode);
    const list = Array.isArray(rows) ? rows : [];
    if (list.some(row => String(row && row.quality || "").toUpperCase() !== "DIAG")) return list;
    const extra = await candidateDiagnostics(list, season, episode);
    return list.concat(extra).slice(0, 24);
  } catch (err) {
    return [diagRow("PASSTHROUGH", String(err && err.message || err), season, episode)];
  }
}

module.exports = { getStreams };
