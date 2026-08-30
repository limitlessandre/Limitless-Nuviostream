"use strict";

const PROVIDER_NAME = "WCO Diagnostic";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DIAG_URL = "https://www.wcostream.tv/favicon.ico";
const ORIGINS = ["https://www.wcostream.tv", "https://www.wcoflix.tv", "https://www.wcoforever.net"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function diag(stage, message) {
  const label = `${stage} • ${message}`;
  return [{
    name: `${PROVIDER_NAME} • ${label}`,
    title: label,
    url: DIAG_URL,
    quality: "DIAG",
    language: "Debug",
    provider: PROVIDER_NAME,
    type: "mp4"
  }];
}

async function req(url, options) {
  const opts = options || {};
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {})
      },
      skipSizeCheck: true
    });
    const text = String(await res.text() || "");
    return { ok: !!res.ok, status: res.status || 0, url: res.url || url, text, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, url, text: "", error: String(e && e.message || e) };
  }
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"");
}

function stripTags(value) {
  return htmlDecode(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function originOf(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}

function absolute(value, origin) {
  const raw = htmlDecode(value).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function searchLinks(html, origin) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']*(?:\/anime\/|\/videos?\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 30) {
    const href = absolute(m[1], origin);
    const title = stripTags(m[2]);
    if (!href) continue;
    if (!out.some(x => x.href === href)) out.push({ href, title });
  }
  return out;
}

function findSeriesLink(html, pageUrl) {
  const origin = originOf(pageUrl) || ORIGINS[0];
  const patterns = [
    /<div[^>]+class=["'][^"']*header-tag[^"']*["'][\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i,
    /<div[^>]+class=["'][^"']*video-title[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']*\/anime\/[^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = String(html || "").match(re);
    if (m && m[1]) return absolute(m[1], origin);
  }
  return "";
}

function episodeLinks(html, pageUrl, wantedEpisode) {
  const origin = originOf(pageUrl) || ORIGINS[0];
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 500) {
    const text = stripTags(m[2]);
    const href = absolute(m[1], origin);
    if (!href || !text) continue;
    const ep = text.match(/Episode\s*(\d+(?:\.\d+)?)/i) || href.match(/episode[-_ ]?(\d+(?:\.\d+)?)/i);
    if (!ep) continue;
    if (Number(ep[1]) === Number(wantedEpisode || 1)) out.push({ href, text });
  }
  return out;
}

function iframeLink(html, pageUrl) {
  const origin = originOf(pageUrl) || ORIGINS[0];
  const m = String(html || "").match(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return m && m[1] ? absolute(m[1], origin) : "";
}

function replaceEmbedPath(embedUrl, path) {
  const raw = String(embedUrl || "");
  const q = raw.indexOf("?");
  return `${originOf(raw)}${path}${q >= 0 ? raw.slice(q) : ""}`;
}

function getJsonPath(html) {
  const text = String(html || "");
  const patterns = [
    /\$\.getJSON\(\s*["']([^"']+)["']/i,
    /getJSON\(\s*["']([^"']+)["']/i,
    /["'](\/inc\/embed\/getvidlink\.php\?[^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return htmlDecode(m[1].replace(/\\\//g, "/"));
  }
  return "";
}

function legacyLookup(embedUrl) {
  try {
    const params = new URLSearchParams(String(embedUrl || "").split("?").slice(1).join("?"));
    const raw = params.get("file");
    if (!raw) return "";
    const embed = params.get("embed") || "";
    const file = raw.replace(/\.flv/gi, ".mp4").replace(/%2F/gi, "/");
    const origin = originOf(embedUrl);
    if (params.has("fullhd")) return `${origin}/inc/embed/getvidlink.php?v=${embed}/${file}&embed=${embed}&fullhd=${params.get("fullhd") || "1"}`;
    return `${origin}/inc/embed/getvidlink.php?v=${file}&embed=${embed}&hd=${params.get("hd") || "1"}`;
  } catch (_) { return ""; }
}

function parseLookup(text) {
  try { return JSON.parse(String(text || "")); } catch (_) { return null; }
}

function cleanHost(value) {
  return String(value || "").replace(/\\\//g, "/").replace(/\\/g, "").trim().replace(/\/$/, "");
}

function resolvedValue(text, responseUrl) {
  let raw = String(text || "").trim().replace(/\\\//g, "/");
  try {
    const data = JSON.parse(raw);
    if (typeof data === "string") raw = data;
    else if (data && typeof data.url === "string") raw = data.url;
    else if (data && typeof data.file === "string") raw = data.file;
  } catch (_) { raw = raw.replace(/^["']|["']$/g, ""); }
  raw = String(raw || "").replace(/\\\//g, "/").replace(/\\/g, "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(String(responseUrl || "")) && !/\/getvid\?evid=/i.test(String(responseUrl))) return String(responseUrl);
  return "";
}

async function continueFromIframe(frame) {
  if (/user\.wcostream\.tv\/check-login/i.test(frame)) {
    return diag("10", "LOGIN / PREMIUM IFRAME");
  }
  if (!/embed\.wcostream/i.test(frame)) {
    return diag("10", `NONSTANDARD IFRAME • ${frame.replace(/^https?:\/\//, "").slice(0, 70)}`);
  }

  const playerPaths = ["/inc/embed/video-js-new.php", "/inc/embed/video-js-old.php", "/inc/embed/video-js.php"];
  let lookup = "";
  const statusBits = [];
  for (const path of playerPaths) {
    const playerUrl = replaceEmbedPath(frame, path);
    const page = await req(playerUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": frame,
        "Origin": originOf(frame),
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin"
      }
    });
    statusBits.push(`${path.includes("new") ? "new" : path.includes("old") ? "old" : "std"}:${page.status}:${page.text.length}`);
    if (!page.ok) continue;
    const found = getJsonPath(page.text);
    if (found) {
      lookup = absolute(found, originOf(frame));
      break;
    }
  }

  if (!lookup) {
    lookup = legacyLookup(frame);
    if (!lookup) return diag("10", `PLAYER NO GETJSON • ${statusBits.join(" ")}`);
  }

  const lookupRes = await req(lookup, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": frame,
      "Origin": originOf(frame),
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!lookupRes.ok) return diag("11", `GETVIDLINK HTTP ${lookupRes.status} • ${statusBits.join(" ")}`);

  const data = parseLookup(lookupRes.text);
  if (!data) return diag("11", `GETVIDLINK JSON FAILED • HTTP ${lookupRes.status} • bytes ${lookupRes.text.length}`);

  const hosts = [cleanHost(data.server), cleanHost(data.cdn)].filter(Boolean);
  const token = data.fhd || data.fullhd || data.hd || data.enc || "";
  const keys = [data.fhd || data.fullhd ? "1080" : "", data.hd ? "720" : "", data.enc ? "480" : "", data.sub ? "sub" : ""].filter(Boolean).join(",");
  if (!hosts.length) return diag("12", `LOOKUP OK • NO SERVER/CDN • keys ${keys || "none"}`);
  if (!token) return diag("12", `LOOKUP OK • host ${hosts[0].replace(/^https?:\/\//, "")} • NO VIDEO TOKEN • keys ${keys || "none"}`);

  let lastStatus = 0;
  for (const host of hosts) {
    const mediaRes = await req(`${host}/getvid?evid=${encodeURIComponent(String(token))}&json`, {
      headers: { "Referer": frame, "Origin": originOf(frame) }
    });
    lastStatus = mediaRes.status;
    if (!mediaRes.ok) continue;
    const media = resolvedValue(mediaRes.text, mediaRes.url);
    if (media) {
      const safe = media.replace(/^https?:\/\//, "").split("?")[0].slice(0, 75);
      return diag("13", `MEDIA RESOLVED • ${keys || "video"} • ${safe}`);
    }
  }

  return diag("13", `MEDIA TOKEN FAILED • last HTTP ${lastStatus} • host ${hosts[0].replace(/^https?:\/\//, "").slice(0, 45)} • keys ${keys || "video"}`);
}

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
    const rawId = String(inputId || "").trim();
    if (!/^\d+$/.test(rawId)) return diag("1", `INPUT ID UNSUPPORTED (${rawId || "empty"})`);

    const metaRes = await req(`https://api.themoviedb.org/3/${type}/${rawId}?api_key=${TMDB_API_KEY}`);
    if (!metaRes.ok) return diag("2", `TMDB FAILED HTTP ${metaRes.status}`);

    let meta;
    try { meta = JSON.parse(metaRes.text); } catch (_) { return diag("2", "TMDB JSON FAILED"); }
    const title = type === "movie" ? (meta.title || meta.original_title) : (meta.name || meta.original_name);
    if (!title) return diag("2", "TMDB TITLE EMPTY");

    let searchHtml = "";
    let searchOrigin = "";
    let searchStatus = 0;
    for (const origin of ORIGINS) {
      const search = await req(`${origin}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": origin,
          "Referer": `${origin}/`
        },
        body: `catara=${encodeURIComponent(title)}&konuara=series`
      });
      searchStatus = search.status;
      const links = searchLinks(search.text, origin);
      if (search.ok && links.length) {
        searchHtml = search.text;
        searchOrigin = origin;
        break;
      }
    }
    if (!searchHtml) return diag("3", `SEARCH FAILED / NO LINKS (last HTTP ${searchStatus})`);

    const links = searchLinks(searchHtml, searchOrigin);
    if (!links.length) return diag("4", "SEARCH PARSE RETURNED 0");

    const wanted = String(title).toLowerCase();
    const candidate = links.find(x => String(x.title || "").toLowerCase().includes(wanted)) || links[0];
    if (!candidate || !candidate.href) return diag("4", "NO CANDIDATE URL");

    let seriesUrl = candidate.href;
    let series = await req(seriesUrl, { headers: { "Referer": `${searchOrigin}/` } });
    if (!series.ok) return diag("5", `CANDIDATE FAILED HTTP ${series.status}`);

    if (!/\/anime\//i.test(seriesUrl)) {
      const linked = findSeriesLink(series.text, seriesUrl);
      if (linked) {
        seriesUrl = linked;
        series = await req(seriesUrl, { headers: { "Referer": candidate.href } });
      }
    }
    if (!series.ok) return diag("5", `SERIES FAILED HTTP ${series.status}`);

    if (type === "movie") {
      const frame = iframeLink(series.text, seriesUrl);
      if (!frame) return diag("6", `MOVIE PAGE OK • NO IFRAME • ${seriesUrl.replace(/^https?:\/\//, "")}`);
      return await continueFromIframe(frame);
    }

    const eps = episodeLinks(series.text, seriesUrl, episode || 1);
    if (!eps.length) return diag("6", `SERIES OK • EP${episode || 1} NOT FOUND • ${seriesUrl.replace(/^https?:\/\//, "")}`);

    const ep = eps[0];
    const epPage = await req(ep.href, { headers: { "Referer": seriesUrl } });
    if (!epPage.ok) return diag("7", `EP PAGE FAILED HTTP ${epPage.status}`);

    const frame = iframeLink(epPage.text, ep.href);
    if (!frame) return diag("8", `EP PAGE OK • NO IFRAME • ${ep.text.slice(0, 55)}`);

    return await continueFromIframe(frame);
  } catch (e) {
    return diag("X", `RUNTIME ERROR • ${String(e && e.message || e).slice(0, 80)}`);
  }
}

module.exports = { getStreams };
