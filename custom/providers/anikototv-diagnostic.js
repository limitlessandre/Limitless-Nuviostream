"use strict";

// Limitless Nexus Anikoto diagnostic provider v0.1.0.
// Surfaces each upstream stage as a visible Nuvio row.

const PROVIDER_NAME = "Anikoto Diagnostic";
const SITE = "https://anikototv.to";
const CATALOG = "https://anikotoapi.site";
const MEGAPLAY = "https://megaplay.buzz";
const IDENTITY_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/anime-identity.js";
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function short(value, max) {
  const text = clean(value);
  const limit = max || 260;
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function diag(label, detail) {
  const text = short(detail || "", 320);
  return {
    name: PROVIDER_NAME + " • " + label + (text ? " • " + text : ""),
    title: text || label,
    url: SITE + "/favicon.ico",
    quality: "DIAG",
    language: "Diagnostic",
    provider: PROVIDER_NAME,
    type: "mp4",
    subtitles: []
  };
}

async function probe(url, options) {
  try {
    const opts = options || {};
    const response = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {})
      },
      redirect: "follow",
      skipSizeCheck: true
    });
    let body = "";
    try { body = String(await response.text() || ""); } catch (_) {}
    return {
      ok: !!(response && response.ok),
      status: response ? Number(response.status || 0) : 0,
      body,
      finalUrl: response && response.url ? String(response.url) : String(url)
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: "",
      finalUrl: String(url),
      error: clean(err && (err.message || err)) || "fetch threw"
    };
  }
}

function jsonParse(text) {
  try { return JSON.parse(String(text || "")); } catch (_) { return null; }
}

function sourceIdFromHtml(html) {
  const text = String(html || "");
  return (text.match(/\bdata-id=["'](\d+)["']/i) || text.match(/<title>\s*File\s+(\d+)\s*-/i) || [])[1] || "";
}

function titleFromHtml(html) {
  return clean((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return "not-json-object";
  const keys = Object.keys(payload).slice(0, 12);
  let sourceShape = "none";
  const s = payload.sources;
  if (typeof s === "string") sourceShape = "string";
  else if (Array.isArray(s)) sourceShape = "array(" + s.length + ")";
  else if (s && typeof s === "object") sourceShape = "object(" + Object.keys(s).slice(0, 8).join(",") + ")";
  const tracks = Array.isArray(payload.tracks) ? payload.tracks.length : 0;
  return "keys=" + (keys.join(",") || "none") + " • sources=" + sourceShape + " • enc=" + (payload.enc ? "yes(" + String(payload.enc).length + ")" : "no") + " • tracks=" + tracks;
}

async function loadIdentity(out) {
  const raw = await probe(IDENTITY_URL, { headers: { "Accept": "text/plain,*/*" } });
  out.push(diag("IDENTITY FILE", "HTTP " + raw.status + " • body=" + raw.body.length + (raw.error ? " • " + raw.error : "")));
  if (!raw.ok || !raw.body) return null;
  try {
    const mod = { exports: {} };
    const factory = new Function("module", "exports", "require", raw.body + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    const valid = exported && typeof exported.resolveAnimeIdentity === "function";
    out.push(diag("IDENTITY EVAL", valid ? "resolveAnimeIdentity available" : "export missing"));
    return valid ? exported : null;
  } catch (err) {
    out.push(diag("IDENTITY EVAL", "FAILED • " + clean(err && (err.message || err))));
    return null;
  }
}

function embedCandidates(identity, episode, mode) {
  const out = [];
  if (identity && identity.anilistId) out.push({ kind: "ANI", url: MEGAPLAY + "/stream/ani/" + encodeURIComponent(identity.anilistId) + "/" + encodeURIComponent(episode) + "/" + mode });
  if (identity && identity.malId) out.push({ kind: "MAL", url: MEGAPLAY + "/stream/mal/" + encodeURIComponent(identity.malId) + "/" + encodeURIComponent(episode) + "/" + mode });
  return out;
}

async function probeEmbed(candidate, mode, out) {
  const profiles = [
    { name: "MP", headers: { "Accept": "text/html,application/json,text/plain,*/*", "Referer": MEGAPLAY + "/" } },
    { name: "SITE", headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Referer": SITE + "/" } },
    { name: "IFRAME", headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": SITE + "/",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "iframe",
      "Upgrade-Insecure-Requests": "1"
    } }
  ];

  let sourceId = "";
  let winningProfile = "";
  for (const profile of profiles) {
    const r = await probe(candidate.url, { headers: profile.headers });
    const id = sourceIdFromHtml(r.body);
    const title = titleFromHtml(r.body);
    out.push(diag("EMBED " + candidate.kind + " " + mode.toUpperCase() + " " + profile.name,
      "HTTP " + r.status + " • body=" + r.body.length + " • id=" + (id || "none") + " • title=" + (title || "none") + " • final=" + short(r.finalUrl, 100) + (r.error ? " • " + r.error : "")));
    if (id) {
      sourceId = id;
      winningProfile = profile.name;
      break;
    }
  }

  if (!sourceId) return { sourceId: "", sourceOk: false };

  const sourceUrl = MEGAPLAY + "/stream/getSources?id=" + encodeURIComponent(sourceId);
  const s = await probe(sourceUrl, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": MEGAPLAY,
      "Referer": candidate.url,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty"
    }
  });
  const payload = jsonParse(s.body);
  out.push(diag("SOURCES " + candidate.kind + " " + mode.toUpperCase(),
    "profile=" + winningProfile + " • HTTP " + s.status + " • body=" + s.body.length + " • " + summarizePayload(payload) + (s.error ? " • " + s.error : "")));

  return { sourceId, sourceOk: !!payload, payload };
}

function searchCandidates(html) {
  const text = String(html || "");
  const out = [];
  const seen = new Set();
  const re = /data-tip=["'](\d+)["']/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 12) {
    const id = Number(m[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const chunk = text.slice(m.index, Math.min(text.length, m.index + 5000));
    const name = clean((chunk.match(/<[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ id, title: name });
  }
  return out;
}

async function probeCatalog(identity, mappedEpisode, out) {
  const term = clean(identity && (identity.title || (identity.aliases && identity.aliases[0]) || (identity.animeAliases && identity.animeAliases[0])));
  if (!term) {
    out.push(diag("CATALOG SEARCH", "no usable title"));
    return;
  }

  const searchUrl = SITE + "/filter?keyword=" + encodeURIComponent(term);
  const search = await probe(searchUrl, { headers: { "Accept": "text/html,application/xhtml+xml", "Referer": SITE + "/" } });
  const candidates = searchCandidates(search.body);
  out.push(diag("CATALOG SEARCH", "HTTP " + search.status + " • body=" + search.body.length + " • candidates=" + candidates.length + " • first=" + (candidates[0] ? candidates[0].id + ":" + candidates[0].title : "none")));
  if (!candidates.length) return;

  const candidate = candidates[0];
  const series = await probe(CATALOG + "/series/" + encodeURIComponent(candidate.id), { headers: { "Accept": "application/json", "Referer": CATALOG + "/" } });
  const payload = jsonParse(series.body);
  const data = payload && payload.data;
  const episodes = data && Array.isArray(data.episodes) ? data.episodes : [];
  const ep = episodes.find(function(row) { return Number(row && row.number) === Number(mappedEpisode); });
  out.push(diag("CATALOG SERIES", "id=" + candidate.id + " • HTTP " + series.status + " • body=" + series.body.length + " • ok=" + String(!!(payload && payload.ok)) + " • episodes=" + episodes.length + " • wanted=" + mappedEpisode + " • match=" + (ep ? "yes" : "no")));
  if (ep) {
    out.push(diag("CATALOG EPISODE", "embedId=" + (ep.episode_embed_id || "none") + " • sub=" + ((ep.embed_url && ep.embed_url.sub) ? "yes" : "no") + " • dub=" + ((ep.embed_url && ep.embed_url.dub) ? "yes" : "no")));
  }
}

async function getStreams(inputId, mediaType, season, episode) {
  const out = [];
  try {
    const type = String(mediaType || "tv").toLowerCase();
    const requestedEpisode = type === "movie" ? 1 : Number(episode || 1);
    out.push(diag("START", "id=" + String(inputId) + " • type=" + type + " • S" + String(season || 1) + "E" + requestedEpisode + " • crypto=" + (globalThis.crypto && globalThis.crypto.subtle ? "yes" : "no") + " • URL=" + (typeof URL === "function" ? "yes" : "no") + " • Function=" + (typeof Function === "function" ? "yes" : "no")));

    const helper = await loadIdentity(out);
    if (!helper) return out;

    let identity = null;
    try {
      identity = await helper.resolveAnimeIdentity(inputId, mediaType, season, episode, TMDB_API_KEY);
    } catch (err) {
      out.push(diag("IDENTITY CALL", "THREW • " + clean(err && (err.message || err))));
      return out;
    }

    if (!identity) {
      out.push(diag("IDENTITY RESULT", "null"));
      return out;
    }

    const mappedEpisode = type === "movie" ? 1 : Number(identity.mappedEpisode || requestedEpisode || 1);
    out.push(diag("IDENTITY RESULT",
      "anime=" + String(!!identity.isAnime) + " • title=" + (identity.title || "none") + " • MAL=" + (identity.malId || "none") + " • AniList=" + (identity.anilistId || "none") + " • mappedEp=" + mappedEpisode + " • source=" + (identity.identitySource || "none")));
    if (!identity.isAnime) return out;

    let gotSource = false;
    for (const mode of ["dub", "sub"]) {
      const candidates = embedCandidates(identity, mappedEpisode, mode);
      out.push(diag("DIRECT " + mode.toUpperCase(), "candidates=" + (candidates.map(function(x) { return x.kind; }).join(",") || "none")));
      for (const candidate of candidates.slice(0, 2)) {
        const result = await probeEmbed(candidate, mode, out);
        if (result.sourceOk) {
          gotSource = true;
          break;
        }
      }
    }

    if (!gotSource) await probeCatalog(identity, mappedEpisode, out);
    out.push(diag("END", gotSource ? "direct source payload reached" : "no direct source payload; catalog probe complete"));
    return out;
  } catch (err) {
    out.push(diag("FATAL", clean(err && (err.stack || err.message || err))));
    return out;
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
