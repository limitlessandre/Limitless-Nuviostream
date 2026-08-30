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
    return { ok: !!res.ok, status: res.status || 0, url: res.url || url, text };
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
  const origin = (String(pageUrl).match(/^https?:\/\/[^/]+/) || [ORIGINS[0]])[0];
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
  const origin = (String(pageUrl).match(/^https?:\/\/[^/]+/) || [ORIGINS[0]])[0];
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
  const origin = (String(pageUrl).match(/^https?:\/\/[^/]+/) || [ORIGINS[0]])[0];
  const m = String(html || "").match(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return m && m[1] ? absolute(m[1], origin) : "";
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
    let candidate = links.find(x => String(x.title || "").toLowerCase().includes(wanted)) || links[0];
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
      return diag("8", `MOVIE IFRAME FOUND • ${frame.replace(/^https?:\/\//, "").slice(0, 70)}`);
    }

    const eps = episodeLinks(series.text, seriesUrl, episode || 1);
    if (!eps.length) return diag("6", `SERIES OK • EP${episode || 1} NOT FOUND • ${seriesUrl.replace(/^https?:\/\//, "")}`);

    const ep = eps[0];
    const epPage = await req(ep.href, { headers: { "Referer": seriesUrl } });
    if (!epPage.ok) return diag("7", `EP PAGE FAILED HTTP ${epPage.status}`);

    const frame = iframeLink(epPage.text, ep.href);
    if (!frame) return diag("8", `EP PAGE OK • NO IFRAME • ${ep.text.slice(0, 55)}`);

    return diag("9", `IFRAME FOUND • ${frame.replace(/^https?:\/\//, "").slice(0, 75)}`);
  } catch (e) {
    return diag("X", `RUNTIME ERROR • ${String(e && e.message || e).slice(0, 80)}`);
  }
}

module.exports = { getStreams };
