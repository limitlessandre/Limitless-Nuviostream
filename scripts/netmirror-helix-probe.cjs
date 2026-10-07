#!/usr/bin/env node
"use strict";

/*
 * NetMirror Helix: read-only cold-path topology probe.
 * Production NetMirror is intentionally not imported or modified.
 *
 * Goal: determine whether the fast Net27 episode endpoint exposes enough
 * episode-specific media information to recover rich audio/subtitle topology
 * without a pre-existing mobile t_hash_t session.
 */
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://net27.cc";
const REFERER = "https://videodownloader.site/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const TITLES = [
  { name: "Teach You a Lesson", tmdb: 281151, season: 1, episode: 1 },
  { name: "Centaurworld", tmdb: 93233, season: 1, episode: 1 },
  { name: "Squid Game", tmdb: 93405, season: 1, episode: 1 }
];

function redact(value) {
  return String(value || "")
    .replace(/([?&](?:sign|token|in|h|hash|t)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/(t_hash_t=)[^;\s]+/gi, "$1<redacted>");
}
function walk(value, trail = [], out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, trail.concat(i), out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    const next = trail.concat(key);
    if (typeof item === "string") {
      const lower = key.toLowerCase();
      if (/^https?:\/\//i.test(item) || /url|file|src|stream|audio|caption|subtitle|master|playlist/i.test(lower)) {
        out.push({ path: next.join("."), key, value: redact(item) });
      }
    }
    walk(item, next, out);
  }
  return out;
}
function classifyUrl(url) {
  const text = String(url || "");
  if (/220884/.test(text)) return "wrong-220884";
  if (/tran-audio/i.test(text)) return "audio-resource";
  if (/\.m3u8(?:[?#]|$)/i.test(text)) return "hls";
  if (/\.mp4(?:[?#]|$)/i.test(text)) return "mp4";
  if (/\.(?:vtt|srt)(?:[?#]|$)/i.test(text)) return "subtitle";
  return "other";
}
function episodeIds(value) {
  return [...new Set(walk(value).flatMap(x => (String(x.value).match(/\/files\/(\d+)\//g) || []).map(s => s.match(/\d+/)[0])))];
}
async function getJson(url) {
  const started = Date.now();
  const r = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*", Referer: BASE + "/", "User-Agent": UA },
    signal: AbortSignal.timeout(8000)
  });
  const text = await r.text();
  return { ms: Date.now() - started, status: r.status, finalUrl: r.url, json: JSON.parse(text) };
}
async function headish(url) {
  const started = Date.now();
  try {
    const r = await fetch(url, {
      headers: { Referer: REFERER, "User-Agent": UA, Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(8000)
    });
    return { status: r.status, ms: Date.now() - started, contentType: r.headers.get("content-type") || "", finalUrl: redact(r.url) };
  } catch (e) { return { error: e.message, ms: Date.now() - started }; }
}
async function runOne(title) {
  const started = Date.now();
  const url = BASE + "/api/embed-tmdb/" + title.tmdb + "?type=tv&se=" + title.season + "&ep=" + title.episode;
  const response = await getJson(url);
  const refs = walk(response.json);
  const urls = [...new Map(refs.filter(x => /^https?:\/\//i.test(x.value)).map(x => [x.value, x])).values()];
  const inventory = urls.map(x => ({ ...x, kind: classifyUrl(x.value) }));
  const probes = [];
  for (const item of inventory.filter(x => ["hls","mp4","audio-resource"].includes(x.kind)).slice(0, 20)) {
    probes.push({ path: item.path, kind: item.kind, url: item.value, probe: await headish(item.value) });
  }
  return {
    title: title.name, tmdb: title.tmdb, season: title.season, episode: title.episode,
    elapsedMs: Date.now() - started, apiMs: response.ms, status: response.status,
    identity: {
      ok: response.json && response.json.ok,
      tmdbId: response.json && response.json.tmdbId,
      currentSeason: response.json && response.json.currentSeason,
      currentEpisode: response.json && response.json.currentEpisode,
      subjectId: response.json && response.json.subjectId,
      title: response.json && response.json.title
    },
    topLevelKeys: Object.keys(response.json || {}).sort(),
    episodeAssetIds: episodeIds(response.json),
    inventory, probes,
    counts: inventory.reduce((a, x) => (a[x.kind] = (a[x.kind] || 0) + 1, a), {})
  };
}
(async () => {
  const output = { generatedAt: new Date().toISOString(), experiment: "NetMirror Helix", coldCookie: true, titles: [] };
  for (const title of TITLES) {
    console.log("Helix:", title.name);
    try { output.titles.push(await runOne(title)); }
    catch (e) { output.titles.push({ title: title.name, error: e.message }); }
  }
  const dest = process.argv[2] || path.resolve(process.cwd(), "netmirror-helix-evidence.json");
  fs.writeFileSync(dest, JSON.stringify(output, null, 2));
  console.log("Wrote", dest);
  for (const x of output.titles) console.log(x.title, x.error || (x.elapsedMs + "ms " + JSON.stringify(x.counts) + " assets=" + x.episodeAssetIds.join(",")));
})().catch(e => { console.error(e); process.exitCode = 1; });
