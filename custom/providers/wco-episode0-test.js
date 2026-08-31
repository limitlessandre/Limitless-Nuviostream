"use strict";

const PROVIDER_NAME = "WCO Episode 0 Test";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const ORIGINS = [
  "https://www.wcostream.tv",
  "https://www.wco.tv",
  "https://www.wcoflix.tv",
  "https://www.wcoforever.net"
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function uniq(xs) {
  const seen = new Set();
  return (xs || []).filter(x => {
    const k = String(x || "").trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dec(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/gi, "'").replace(/&quot;/g, '"');
}
function text(s) { return dec(String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); }
function origin(u) { const m = String(u || "").match(/^(https?:\/\/[^/]+)/i); return m ? m[1] : ""; }
function abs(v, b) {
  v = dec(v).trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return `https:${v}`;
  const o = origin(b) || ORIGINS[0];
  return `${o}${v.startsWith("/") ? v : `/${v}`}`;
}
function allowed(u) {
  const h = (String(u || "").match(/^https?:\/\/([^/]+)/i) || [])[1] || "";
  return /(^|\.)(wcostream\.tv|wco\.tv|wcoflix\.tv|wcoforever\.net)$/i.test(h);
}
function norm(v) {
  return String(v || "").toLowerCase()
    .replace(/&amp;|&/g, " and ")
    .replace(/english\s+(dubbed|subbed)/g, " ")
    .replace(/\b(dubbed|subbed|dub|sub|fullhd|hd)\b/g, " ")
    .replace(/\bseason\s*\d+\b/g, " ")
    .replace(/\bepisode\s*\d+(?:\.\d+)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function score(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 90;
  const aw = a.split(" "), bw = b.split(" ");
  let n = 0;
  for (const w of bw) if (w.length > 1 && aw.includes(w)) n++;
  return Math.round(n / Math.max(1, bw.length) * 80);
}

async function req(url, opt) {
  try {
    const o = opt || {};
    const r = await fetch(url, {
      ...o,
      headers: {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(o.headers || {})
      },
      skipSizeCheck: true
    });
    return { ok: !!r.ok, status: r.status || 0, url: r.url || url, body: String(await r.text() || "") };
  } catch (_) {
    return { ok: false, status: 0, url, body: "" };
  }
}
async function json(url) {
  const r = await req(url);
  if (!r.ok) return null;
  try { return JSON.parse(r.body); } catch (_) { return null; }
}

async function tmdbId(input) {
  const raw = String(input || "");
  if (/^\d+$/.test(raw)) return +raw;
  if (!/^tt\d+$/i.test(raw)) return null;
  const d = await json(`https://api.themoviedb.org/3/find/${encodeURIComponent(raw)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  const a = d && d.tv_results;
  return a && a[0] && a[0].id ? +a[0].id : null;
}
async function showInfo(input) {
  const id = await tmdbId(input);
  if (!id) return null;
  const d = await json(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`);
  if (!d) return null;
  const alt = ((d.alternative_titles && d.alternative_titles.results) || []).map(x => x && x.title).filter(Boolean);
  return {
    title: d.name || d.original_name || `TMDB ${id}`,
    titles: uniq([d.name, d.original_name].concat(alt)).slice(0, 6),
    lang: String(d.original_language || "").toLowerCase()
  };
}

function anchors(html, base) {
  const out = [], re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 1600) {
    const href = abs(m[1], base), label = text(m[2]);
    if (!href || !label || !allowed(href)) continue;
    out.push({ href, text: label });
  }
  return out;
}

async function findSeries(info) {
  const found = [];
  for (const seed of info.titles.slice(0, 4)) {
    for (const o of ORIGINS) {
      const r = await req(`${o}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": o, "Referer": `${o}/` },
        body: `catara=${encodeURIComponent(seed)}&konuara=series`
      });
      if (!r.ok) continue;
      for (const a of anchors(r.body, o)) {
        if (!/\/anime\//i.test(a.href)) continue;
        const s = Math.max(...info.titles.map(t => score(`${a.text} ${a.href}`, t)));
        if (s >= 70 && !found.some(x => x.href === a.href)) found.push({ ...a, score: s });
      }
    }
    if (found.some(x => x.score >= 90)) break;
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 5);
}

function episodeZeroEntries(html, pageUrl, wantedSeason, forcedVariant) {
  const out = [];
  for (const a of anchors(html, pageUrl)) {
    const id = `${a.text} ${a.href}`;
    const season = (id.match(/\bSeason\s*(\d{1,2})\b/i) || id.match(/\bS(\d{1,2})E0\b/i));
    const ep0 = /\bEpisode\s*0\b/i.test(id) || /episode[-_ ]?0(?:\D|$)/i.test(id) || /\bS\d{1,2}E0\b/i.test(id);
    if (!season || +season[1] !== +wantedSeason || !ep0) continue;
    if (/episode[-_ ]?0\d/i.test(id) || /\bEpisode\s*0\.\d+/i.test(id)) continue;
    const detected = /subbed|\bsub\b/i.test(id) ? "Sub" : (/dubbed|\bdub\b/i.test(id) ? "Dub" : "Original");
    if (forcedVariant && detected !== "Original" && detected !== forcedVariant) continue;
    out.push({ href: a.href, text: a.text, variant: forcedVariant || detected });
  }
  return out.filter((x, i, a) => a.findIndex(y => y.href === x.href && y.variant === x.variant) === i);
}

function iframe(html, page) {
  const m = String(html || "").match(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return m ? abs(m[1], page) : "";
}
function embedPath(u, path) {
  const q = String(u || "").indexOf("?");
  return `${origin(u)}${path}${q >= 0 ? String(u).slice(q) : ""}`;
}
function getJsonPath(s) {
  for (const re of [/\$\.getJSON\(\s*["']([^"']+)["']/i, /getJSON\(\s*["']([^"']+)["']/i, /["'](\/inc\/embed\/getvidlink\.php\?[^"']+)["']/i]) {
    const m = String(s || "").match(re);
    if (m) return dec(m[1].replace(/\\\//g, "/"));
  }
  return "";
}
function legacyLookup(u) {
  try {
    const p = new URLSearchParams(String(u).split("?").slice(1).join("?")), raw = p.get("file");
    if (!raw) return "";
    const em = p.get("embed") || "", file = raw.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/"), o = origin(u);
    return p.has("fullhd")
      ? `${o}/inc/embed/getvidlink.php?v=${em}/${file}&embed=${em}&fullhd=${p.get("fullhd") || "1"}`
      : `${o}/inc/embed/getvidlink.php?v=${file}&embed=${em}&hd=${p.get("hd") || "1"}`;
  } catch (_) { return ""; }
}
async function lookup(frame) {
  for (const p of ["/inc/embed/video-js-new.php", "/inc/embed/video-js-old.php", "/inc/embed/video-js.php"]) {
    const u = embedPath(frame, p), r = await req(u, { headers: { "Referer": frame, "Origin": origin(frame) } });
    if (!r.ok) continue;
    const j = getJsonPath(r.body);
    if (j) return abs(j, origin(frame));
  }
  return legacyLookup(frame);
}
function host(v) { return String(v || "").replace(/\\\//g, "/").replace(/\\/g, "").trim().replace(/\/$/, ""); }
function mediaValue(s, url) {
  let x = String(s || "").trim().replace(/\\\//g, "/");
  try {
    const d = JSON.parse(x);
    x = typeof d === "string" ? d : (d && d.url) || (d && d.file) || x;
  } catch (_) { x = x.replace(/^["']|["']$/g, ""); }
  x = String(x).replace(/\\\//g, "/").replace(/\\/g, "").trim();
  if (/^https?:\/\//i.test(x)) return x;
  if (/^https?:\/\//i.test(String(url || "")) && !/\/getvid\?evid=/i.test(String(url))) return String(url);
  return "";
}

async function extract(entry, info, fallbackSeason) {
  const p = await req(entry.href, { headers: { "Referer": `${origin(entry.href)}/` } });
  if (!p.ok) return [];
  const frame = iframe(p.body, entry.href);
  if (!frame || /check-login/i.test(frame)) return [];
  const l = await lookup(frame);
  if (!l) return [];
  const jr = await req(l, { headers: { "Referer": frame, "Origin": origin(frame), "X-Requested-With": "XMLHttpRequest" } });
  if (!jr.ok) return [];
  let d;
  try { d = JSON.parse(jr.body); } catch (_) { return []; }
  const hs = uniq([host(d.server), host(d.cdn)]);
  const qs = [d.fhd ? ["1080p", d.fhd] : null, d.fullhd ? ["1080p", d.fullhd] : null, d.hd ? ["720p", d.hd] : null, d.enc ? ["480p", d.enc] : null].filter(Boolean);
  const isSub = entry.variant === "Sub";
  const label = isSub ? "Japanese + English Hard Subs" : "English Dub";
  const language = isSub ? "Japanese" : "English";
  const out = [];
  for (const [quality, token] of qs) {
    let media = "";
    for (const h of hs) {
      const mr = await req(`${h}/getvid?evid=${encodeURIComponent(String(token))}&json`, { headers: { "Referer": frame, "Origin": origin(frame) } });
      if (!mr.ok) continue;
      media = mediaValue(mr.body, mr.url);
      if (media) break;
    }
    if (!media) continue;
    out.push({
      name: `${PROVIDER_NAME} • ${quality} • ${label} • S0E${fallbackSeason}→S${fallbackSeason}E0`,
      title: `${info.title} • WCO Season ${fallbackSeason} Episode 0`,
      url: media,
      quality,
      language,
      provider: PROVIDER_NAME,
      type: /\.m3u8(?:[?#]|$)/i.test(media) ? "m3u8" : "mp4",
      headers: { "Referer": frame, "Origin": origin(frame), "User-Agent": UA }
    });
  }
  return out;
}

async function getStreams(inputId, mediaType, season, episode) {
  if (String(mediaType || "").toLowerCase() === "movie" || Number(season) !== 0) return [];
  const fallbackSeason = Number(episode);
  if (!Number.isFinite(fallbackSeason) || fallbackSeason < 1) return [];
  const info = await showInfo(inputId);
  if (!info) return [];
  const series = await findSeries(info);
  for (const s of series) {
    const base = String(s.href).replace(/[?#].*$/, "").replace(/\/$/, "");
    const streams = [];
    for (const cfg of [
      { url: `${base}/?season=all&lang=dub`, variant: "Dub" },
      { url: `${base}/?season=all&lang=sub`, variant: "Sub" },
      { url: `${base}/?season=all`, variant: null }
    ]) {
      const r = await req(cfg.url, { headers: { "Referer": s.href } });
      if (!r.ok) continue;
      const entries = episodeZeroEntries(r.body, cfg.url, fallbackSeason, cfg.variant);
      for (const e of entries.slice(0, 2)) streams.push(...await extract(e, info, fallbackSeason));
    }
    const dedup = streams.filter((x, i, a) => a.findIndex(y => y.url === x.url && y.quality === x.quality && y.language === x.language) === i);
    if (dedup.length) return dedup;
  }
  return [];
}

module.exports = { getStreams };
