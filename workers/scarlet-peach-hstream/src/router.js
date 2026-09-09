const VERSION = "0.1.0";
const BASE = "https://hstream.moe";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 ScarletPeach/0.1";

function clean(value) { return String(value == null ? "" : value).trim(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function decodeEntities(value) {
  return clean(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
function normalize(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function baseTitle(value) {
  return clean(value)
    .replace(/\s*(?:-|–|—)\s*(?:episode\s*)?\d+\s*$/i, "")
    .replace(/\s+episode\s+\d+\s*$/i, "")
    .trim();
}
function slugify(value) {
  return normalize(baseTitle(value)).replace(/\s+/g, "-");
}
function humanizeSlug(value) {
  return clean(value).replace(/-\d+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
function episodeFromSlug(slug) {
  const match = clean(slug).match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}
function titleScore(candidate, targets) {
  const c = normalize(baseTitle(candidate));
  if (!c) return 0;
  let best = 0;
  for (const target of targets) {
    const t = normalize(baseTitle(target));
    if (!t) continue;
    if (c === t) best = Math.max(best, 100);
    else if (c.replace(/^a\s+/, "") === t.replace(/^a\s+/, "")) best = Math.max(best, 96);
    else if (c.includes(t) || t.includes(c)) best = Math.max(best, 82);
    const ca = c.split(" "), ta = t.split(" ");
    const overlap = ta.filter(x => ca.includes(x)).length;
    if (ta.length) best = Math.max(best, Math.round((overlap / Math.max(ca.length, ta.length)) * 78));
  }
  return best;
}
function romanizationSlugVariants(slug) {
  const out = [slug];
  const replacements = [
    [/-wo-/g, "-o-"],
    [/-ou-/g, "-o-"],
    [/-oo-/g, "-o-"],
    [/-wa-/g, "-ha-"]
  ];
  for (const [pattern, replacement] of replacements) {
    for (const current of [...out]) out.push(current.replace(pattern, replacement));
  }
  return unique(out);
}
function directSlugs(title, aliases, episode) {
  const bases = unique([title, ...(aliases || [])]).slice(0, 8);
  const out = [];
  for (const name of bases) {
    const slug = slugify(name);
    if (!slug) continue;
    for (const variant of romanizationSlugVariants(`-${slug}-`).map(v => v.replace(/^-|-$/g, ""))) {
      out.push(`${variant}-${episode}`);
    }
  }
  return unique(out).slice(0, 18);
}
function pageTitle(html) {
  const h1 = String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripHtml(h1[1]);
  const title = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripHtml(title[1]).replace(/\s*[-|]\s*English Subbed[\s\S]*$/i, "") : "";
}
function cookieMap(headers) {
  let values = [];
  try {
    if (headers && typeof headers.getSetCookie === "function") values = headers.getSetCookie() || [];
  } catch (_) {}
  if (!values.length) {
    const raw = headers && headers.get ? headers.get("set-cookie") : "";
    if (raw) values = [raw];
  }
  const map = {};
  for (const value of values) {
    const text = String(value || "");
    const re = /(?:^|,\s*)(XSRF-TOKEN|hstream_session)=([^;,]+)/gi;
    let match;
    while ((match = re.exec(text))) map[match[1]] = match[2];
    const first = text.match(/^\s*([^=;,]+)=([^;,]+)/);
    if (first && !map[first[1]]) map[first[1]] = first[2];
  }
  return map;
}
function cookieHeader(cookies) {
  return Object.entries(cookies || {}).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function fetchPage(url) {
  const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow" });
  if (!response.ok) return { ok: false, status: response.status, url: response.url || url, html: "", cookies: {} };
  const html = await response.text();
  return { ok: true, status: response.status, url: response.url || url, html, cookies: cookieMap(response.headers) };
}
function parseSearchCandidates(html, episode) {
  const out = [];
  const source = String(html || "");
  const re = /<a\b([^>]*?)href=["'](?:https?:\/\/hstream\.moe)?\/hentai\/([^"'?#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(source))) {
    const slug = clean(match[2]);
    if (!slug || episodeFromSlug(slug) !== episode) continue;
    const attrs = `${match[1]} ${match[3]}`;
    const attrTitle = attrs.match(/(?:title|aria-label)=["']([^"']+)["']/i)?.[1] || "";
    const alt = match[4].match(/alt=["']([^"']+)["']/i)?.[1] || "";
    const text = stripHtml(match[4]);
    const title = decodeEntities(attrTitle || alt || text || humanizeSlug(slug));
    const url = `${BASE}/hentai/${encodeURIComponent(slug)}`;
    if (!out.some(item => item.slug === slug)) out.push({ slug, title, url });
  }
  return out;
}
async function searchCandidates(names, episode) {
  const all = [];
  for (const query of unique(names).slice(0, 4)) {
    const url = `${BASE}/search?search=${encodeURIComponent(baseTitle(query))}`;
    const result = await fetchPage(url);
    if (!result.ok) continue;
    for (const candidate of parseSearchCandidates(result.html, episode)) {
      if (!all.some(x => x.slug === candidate.slug)) all.push(candidate);
    }
    if (all.length >= 20) break;
  }
  return all;
}
async function resolveEpisodePage(title, aliases, episode) {
  const targets = unique([title, ...(aliases || [])]);
  const direct = directSlugs(title, aliases, episode);
  for (const slug of direct.slice(0, 10)) {
    const url = `${BASE}/hentai/${encodeURIComponent(slug)}`;
    const page = await fetchPage(url);
    if (!page.ok) continue;
    const foundTitle = pageTitle(page.html) || humanizeSlug(slug);
    const score = titleScore(foundTitle, targets);
    if (score >= 82) return { ...page, slug, title: foundTitle, score, discovery: "direct" };
  }

  const candidates = await searchCandidates(targets, episode);
  const ranked = candidates
    .map(item => ({ ...item, score: titleScore(item.title || humanizeSlug(item.slug), targets) }))
    .sort((a, b) => b.score - a.score);
  for (const candidate of ranked.slice(0, 8)) {
    if (candidate.score < 50) break;
    const page = await fetchPage(candidate.url);
    if (!page.ok) continue;
    const foundTitle = pageTitle(page.html) || candidate.title;
    const score = Math.max(candidate.score, titleScore(foundTitle, targets));
    if (score >= 58) return { ...page, slug: candidate.slug, title: foundTitle, score, discovery: "search", candidates: ranked.slice(0, 5) };
  }
  return { ok: false, status: 404, error: "No matching HStream episode", candidates: ranked.slice(0, 5) };
}
function extractEpisodeId(html) {
  const source = String(html || "");
  return source.match(/e_id["']?\s+type=["']hidden["']\s+value=["']([^"']+)/i)?.[1]
    || source.match(/name=["']e_id["'][^>]*value=["']([^"']+)/i)?.[1]
    || null;
}
function pageCensorship(html) {
  const source = String(html || "");
  const marker = source.search(/>\s*Genres\s*</i);
  const slice = marker >= 0 ? source.slice(marker, marker + 12000) : "";
  if (/\buncensored\b/i.test(stripHtml(slice))) return "uncensored";
  if (/\bcensored\b/i.test(stripHtml(slice))) return "censored";
  return "unknown";
}
function pageStudio(html) {
  const source = String(html || "");
  const match = source.match(/href=["'][^"']*(?:studio|studios)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  return match ? stripHtml(match[1]) : null;
}
async function playerApi(page) {
  const episodeId = extractEpisodeId(page.html);
  if (!episodeId) throw new Error("HStream episode id missing");
  const cookies = page.cookies || {};
  const xsrfRaw = clean(cookies["XSRF-TOKEN"] || cookies["xsrf-token"]);
  if (!xsrfRaw) throw new Error("HStream XSRF cookie missing");
  let xsrf = xsrfRaw;
  try { xsrf = decodeURIComponent(xsrfRaw); } catch (_) {}
  const response = await fetch(`${BASE}/player/api`, {
    method: "POST",
    headers: {
      "user-agent": UA,
      accept: "application/json",
      "content-type": "application/json",
      referer: page.url,
      origin: BASE,
      "x-requested-with": "XMLHttpRequest",
      "x-xsrf-token": xsrf,
      cookie: cookieHeader(cookies)
    },
    body: JSON.stringify({ episode_id: episodeId })
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!response.ok || !data) throw new Error(`HStream player API HTTP ${response.status}`);
  return { episodeId, data };
}
function joinUrl(base, path) {
  return new URL(clean(path).replace(/\\/g, "/").replace(/^\/+/, ""), clean(base).replace(/\/?$/, "/")).toString();
}
function parseFrameRate(value) {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction && Number(fraction[2])) return Number(fraction[1]) / Number(fraction[2]);
  return null;
}
function manifestMetadata(xml) {
  const source = String(xml || "");
  const fpsValues = [...source.matchAll(/frameRate=["']([^"']+)["']/gi)].map(m => parseFrameRate(m[1])).filter(Boolean);
  const audioLang = source.match(/<AdaptationSet\b[^>]*(?:contentType=["']audio["']|mimeType=["']audio\/)[^>]*\blang=["']([^"']+)["']/i)?.[1]
    || source.match(/<AdaptationSet\b[^>]*\blang=["']([^"']+)["'][^>]*(?:contentType=["']audio["']|mimeType=["']audio\/)/i)?.[1]
    || null;
  const codecs = unique([...source.matchAll(/codecs=["']([^"']+)["']/gi)].map(m => m[1]));
  return { frameRate: fpsValues.length ? Math.max(...fpsValues) : null, audioLanguage: audioLang, codecs };
}
async function probeManifest(url, pageUrl) {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, referer: pageUrl, accept: "application/dash+xml,application/xml,text/xml,*/*" } });
    if (!response.ok) return null;
    const text = await response.text();
    if (!/<MPD\b/i.test(text)) return null;
    return { url, ...manifestMetadata(text) };
  } catch (_) { return null; }
}
async function extractStreams(apiData, pageUrl) {
  const domains = unique(apiData.stream_domains || []);
  const streamPath = clean(apiData.stream_url).replace(/\\/g, "/");
  if (!domains.length || !streamPath) throw new Error("HStream player returned no stream location");
  const heights = [2160, 1080, 720];
  const streams = [];
  for (const height of heights) {
    let found = null;
    for (const domain of domains) {
      const cdnBase = joinUrl(domain, streamPath);
      const manifest = joinUrl(cdnBase, `${height}/manifest.mpd`);
      const probe = await probeManifest(manifest, pageUrl);
      if (probe) {
        found = { type: "mpd", height, label: `${height}p`, url: probe.url, frameRate: probe.frameRate, codecs: probe.codecs, audioLanguage: probe.audioLanguage, domain };
        break;
      }
    }
    if (found) streams.push(found);
  }
  return streams;
}
function subtitleMetadata(apiData, streams) {
  const first = streams[0];
  if (!first) return { languages: [], tracks: [] };
  const base = new URL(first.url);
  base.pathname = base.pathname.replace(/\/\d+\/manifest\.mpd$/, "/");
  const tracks = [{ language: "en", label: "English", url: new URL("eng.ass", base).toString(), format: "ass", machineTranslated: false }];
  const extra = apiData.extra_subtitles && typeof apiData.extra_subtitles === "object" ? apiData.extra_subtitles : {};
  const codes = Array.isArray(extra) ? extra : Object.keys(extra);
  for (const codeRaw of codes) {
    const code = clean(codeRaw).toLowerCase();
    if (!code || code === "en") continue;
    tracks.push({ language: code, label: code.toUpperCase(), url: new URL(`autotrans/${encodeURIComponent(code)}.ass`, base).toString(), format: "ass", machineTranslated: true });
  }
  return { languages: unique(tracks.map(t => t.language)), tracks };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" }
  });
}

async function resolve(request) {
  let body = null;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const title = clean(body && body.title);
  const aliases = unique(body && body.aliases);
  const episode = Math.max(1, Number(body && body.episode) || 1);
  if (!title) return json({ error: "title is required" }, 400);

  const page = await resolveEpisodePage(title, aliases, episode);
  if (!page.ok) return json({ error: page.error || "No matching HStream episode", candidates: page.candidates || [] }, 404);

  try {
    const player = await playerApi(page);
    const streams = await extractStreams(player.data, page.url);
    if (!streams.length) return json({ error: "No playable HStream DASH manifests", match: { name: page.title, slug: page.slug, url: page.url } }, 502);
    const subs = subtitleMetadata(player.data, streams);
    const audioLanguages = unique(streams.map(s => s.audioLanguage).filter(Boolean));
    if (!audioLanguages.length) audioLanguages.push("ja");
    const metadata = {
      censorStatus: pageCensorship(page.html),
      audioLanguages,
      subtitleLanguages: subs.languages,
      subtitles: subs.tracks,
      audioVariant: subs.languages.length ? "sub" : "",
      studio: pageStudio(page.html),
      interpolated: Boolean(player.data.interpolated),
      interpolatedUhd: Boolean(player.data.interpolated_uhd)
    };
    return json({
      ok: true,
      provider: "HStream",
      version: VERSION,
      match: { name: page.title, slug: page.slug, url: page.url, episode, score: page.score, discovery: page.discovery, episodeId: player.episodeId },
      streams,
      metadata,
      headers: { Referer: page.url, Origin: BASE }
    });
  } catch (error) {
    return json({ error: error && error.message ? error.message : String(error), match: { name: page.title, slug: page.slug, url: page.url } }, 502);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
    if (url.pathname === "/health") return json({ ok: true, name: "Scarlet Peach HStream Resolver", version: VERSION, source: BASE, formats: ["dash/mpd"], qualities: [720, 1080, 2160] });
    if (url.pathname === "/resolve" && request.method === "POST") return resolve(request);
    return json({ ok: true, name: "Scarlet Peach HStream Resolver", version: VERSION, endpoints: ["/health", "/resolve"] });
  }
};
