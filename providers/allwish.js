"use strict";

const cheerio = require("cheerio-without-node-native");
const CryptoJS = require("crypto-js");

const NAME = "All-Wish";
const BASE = "https://all-wish.me";
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const MAP = "https://id-mapping-api-malid.hf.space/api/resolve";
const VRF_KEY = "ysJhV6U27FVIjjuk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const H = {
  "User-Agent": UA,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

const AJ = {
  ...H,
  "X-Requested-With": "XMLHttpRequest",
  "Referer": BASE + "/"
};

async function req(url, opt = {}, timeout = 12000) {
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(timeout)
    : undefined;

  const r = await fetch(url, {
    ...opt,
    headers: { ...H, ...(opt.headers || {}) },
    signal,
    skipSizeCheck: true
  });

  if (!r || !r.ok) {
    throw new Error(`HTTP ${r ? r.status : "?"}`);
  }
  return r;
}

async function text(url, opt = {}, timeout) {
  try {
    return await (await req(url, opt, timeout)).text();
  } catch (e) {
    console.log(`[${NAME}] ${e.message}`);
    return null;
  }
}

async function json(url, opt = {}, timeout) {
  try {
    return await (await req(url, opt, timeout)).json();
  } catch (e) {
    console.log(`[${NAME}] ${e.message}`);
    return null;
  }
}

function mediaType(t) {
  return String(t || "tv").toLowerCase() === "movie" ? "movie" : "tv";
}

async function tmdbId(id, type) {
  id = String(id || "").trim();
  if (/^\d+$/.test(id)) return +id;
  if (!/^tt\d+$/i.test(id)) return null;

  const d = await json(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?api_key=${TMDB_KEY}&external_source=imdb_id`
  );
  const a = type === "movie" ? d && d.movie_results : d && d.tv_results;
  return a && a[0] && a[0].id ? +a[0].id : null;
}

async function tmdbInfo(id, type) {
  const d = await json(
    `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&append_to_response=external_ids`
  );
  if (!d) return null;

  return {
    title: type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name),
    original: type === "movie" ? d.original_title : d.original_name,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    genres: Array.isArray(d.genres) ? d.genres.map(x => x.id) : []
  };
}

async function malMap(imdb, s, e) {
  return imdb
    ? json(`${MAP}?id=${encodeURIComponent(imdb)}&s=${encodeURIComponent(s)}&e=${encodeURIComponent(e)}`)
    : null;
}

function clean(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\[\]【】〖〗]/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (!value) continue;
    const str = String(value).trim();
    const key = clean(str);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(str);
  }
  return out;
}

async function aniAliases(mal) {
  if (!mal) return [];
  const query = `
    query($idMal:Int) {
      Media(idMal:$idMal,type:ANIME) {
        title { english romaji native }
        synonyms
      }
    }
  `;
  const d = await json("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { idMal: +mal } })
  });
  const media = d && d.data && d.data.Media;
  if (!media) return [];

  return uniq([
    media.title && media.title.english,
    media.title && media.title.romaji,
    media.title && media.title.native,
    ...(Array.isArray(media.synonyms) ? media.synonyms : [])
  ]);
}

async function malAliases(mal) {
  if (!mal) return [];
  const d = await json(`https://api.jikan.moe/v4/anime/${encodeURIComponent(mal)}`, {}, 15000);
  const anime = d && d.data;
  if (!anime) return [];

  return uniq([
    anime.title,
    anime.title_english,
    anime.title_japanese,
    ...(Array.isArray(anime.title_synonyms) ? anime.title_synonyms : []),
    ...(Array.isArray(anime.titles) ? anime.titles.map(x => x && x.title) : [])
  ]);
}

async function kitsuAliases(mal) {
  if (!mal) return [];

  const url =
    `https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime` +
    `&filter[externalId]=${encodeURIComponent(mal)}&include=item`;

  const d = await json(url, {
    headers: { "Accept": "application/vnd.api+json" }
  }, 15000);

  const included = d && Array.isArray(d.included) ? d.included : [];
  const anime = included.find(x => x && x.type === "anime");
  const a = anime && anime.attributes;
  if (!a) return [];

  return uniq([
    a.canonicalTitle,
    ...(a.titles && typeof a.titles === "object" ? Object.values(a.titles) : []),
    ...(Array.isArray(a.abbreviatedTitles) ? a.abbreviatedTitles : [])
  ]);
}

async function titleAliases(mal, tmdb, mapping) {
  if (!mal) {
    return uniq([tmdb && tmdb.title, tmdb && tmdb.original]);
  }

  const results = await Promise.all([
    malAliases(mal),
    aniAliases(mal),
    kitsuAliases(mal)
  ]);

  return uniq([
    mapping && mapping.anime_title,
    ...results[0],
    ...results[1],
    ...results[2],
    tmdb && tmdb.title,
    tmdb && tmdb.original
  ]).slice(0, 24);
}

async function search(titles) {
  const aliases = uniq(titles);
  const out = [];
  const seen = new Set();

  for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
    const q = aliases[aliasIndex];
    const h = await text(`${BASE}/filter?keyword=${encodeURIComponent(q)}`);
    if (!h) continue;

    const $ = cheerio.load(h);
    let foundExactForQuery = false;

    $("div.item").each((_, el) => {
      const a = $(el).find("div.name > a").first();
      const title = a.text().trim();
      const href = a.attr("href");
      if (!title || !href) return;

      let u = href
        .replace(/\/ep-[\d.]+\/?$/i, "")
        .replace(/\/+$/, "");

      u = /^https?:\/\//i.test(u)
        ? u
        : BASE + (u.startsWith("/") ? u : "/" + u);

      const exact = clean(title) === clean(q);
      if (exact) foundExactForQuery = true;

      if (!seen.has(u)) {
        seen.add(u);
        out.push({
          title,
          url: u,
          exact,
          aliasIndex
        });
      }
    });

    if (foundExactForQuery) break;
  }

  out.sort((a, b) => {
    const exactDiff = Number(b.exact) - Number(a.exact);
    return exactDiff || a.aliasIndex - b.aliasIndex;
  });

  return out;
}


function fallbackSearchTerms(titles) {
  const stop = new Set([
    "anime", "season", "movie", "special", "episode", "part",
    "the", "and", "with", "from", "this", "that", "girl", "child",
    "favorite", "favourite"
  ]);
  const seen = new Set();
  const out = [];

  for (const title of uniq(titles)) {
    const words = clean(title).split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;

    const meaningful = words.filter(w =>
      w.length >= 4 &&
      !stop.has(w) &&
      !/^\d+$/.test(w)
    );

    for (const word of meaningful.slice().reverse()) {
      if (!seen.has(word)) {
        seen.add(word);
        out.push(word);
      }
    }
  }

  return out.slice(0, 12);
}

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function vrf(id) {
  const e = encodeURIComponent(String(id))
    .replace(/%21/g, "!")
    .replace(/%27/g, "'")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%7E/g, "~")
    .replace(/%2A/g, "*")
    .replace(/%20/g, "+");

  const k = Array.from(VRF_KEY).map(c => c.charCodeAt(0));
  const d = Array.from(e).map(c => c.charCodeAt(0));
  const n = Array.from({ length: 256 }, (_, i) => i);

  let a = 0;
  for (let o = 0; o < 256; o++) {
    a = (a + n[o] + k[o % k.length]) % 256;
    [n[o], n[a]] = [n[a], n[o]];
  }

  const z = [];
  let o = 0;
  a = 0;

  for (const c of d) {
    o = (o + 1) % 256;
    a = (a + n[o]) % 256;
    [n[o], n[a]] = [n[a], n[o]];
    z.push((c ^ n[(n[o] + n[a]) % 256]) & 255);
  }

  const x = b64(z);
  const off = [-3, 3, -4, 2, -2, 5, 4, 5];
  const y = b64(Array.from(x).map((c, i) => (c.charCodeAt(0) + off[i % 8]) & 255));

  return Array.from(y)
    .map(c => {
      if (c >= "A" && c <= "Z") {
        return String.fromCharCode((c.charCodeAt(0) - 52) % 26 + 65);
      }
      if (c >= "a" && c <= "z") {
        return String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97);
      }
      return c;
    })
    .join("");
}

async function episodes(url) {
  const h = await text(url);
  if (!h) return [];

  const $ = cheerio.load(h);
  const id = $("main > div.container").attr("data-id");
  if (!id) return [];

  const d = await json(
    `${BASE}/ajax/episode/list/${encodeURIComponent(id)}?vrf=${encodeURIComponent(vrf(id))}`,
    { headers: AJ },
    30000
  );

  if (!d || d.status !== 200) return [];

  const e = cheerio.load(d.result || "");
  const out = [];

  e("div.range > div > a").each((_, el) => {
    const n = e(el);
    const m = n.attr("data-mal");

    out.push({
      ep: parseFloat(n.attr("data-slug") || "0"),
      ids: n.attr("data-ids") || "",
      mal: m ? parseInt(m, 10) : null,
      sub: n.attr("data-sub") === "1",
      dub: n.attr("data-dub") === "1"
    });
  });

  return out.filter(x => x.ids);
}

function choose(list, mal, ep) {
  const withMal = list.filter(x => x.mal != null);

  if (mal && withMal.length) {
    const same = list.filter(x => x.mal === +mal);
    if (!same.length) return null;
    return same.find(x => x.ep === +ep) || null;
  }

  return list.find(x => x.ep === +ep) || null;
}

function lang(label, url) {
  const s = `${label || ""} ${url || ""}`.toLowerCase();

  if (/english|(^|[^a-z])(en|eng)([^a-z]|$)/.test(s)) return ["en", "English"];
  if (/japanese|(^|[^a-z])(ja|jp|jpn)([^a-z]|$)/.test(s)) return ["ja", "Japanese"];
  if (/korean|(^|[^a-z])(ko|kr|kor)([^a-z]|$)/.test(s)) return ["ko", "Korean"];
  if (/chinese|mandarin|(^|[^a-z])(zh|zho|chi)([^a-z]|$)/.test(s)) return ["zh", "Chinese"];

  return null;
}

function subs(tracks, headers, assumeEnglish) {
  const bestByLanguage = new Map();

  for (const t of Array.isArray(tracks) ? tracks : []) {
    if (!t) continue;

    const kind = String(t.kind || "captions").toLowerCase();
    if (t.kind && kind !== "captions" && kind !== "subtitles") continue;

    const u = t.file || t.url || t.src;
    if (!u) continue;

    const rawLabel = String(t.label || t.name || t.language || t.lang || "").trim();
    let l = lang(rawLabel, u);

    if (!l && assumeEnglish && /\.(?:vtt|srt|ass|ssa)(?:$|[?#])/i.test(u)) {
      l = ["en", "English"];
    }
    if (!l) continue;

    const label = rawLabel.toLowerCase();
    let score = 0;

    if (t.default === true || String(t.default).toLowerCase() === "true") score += 100;
    if (kind === "captions" || kind === "subtitles") score += 20;
    if (/\.vtt(?:$|[?#])/i.test(u)) score += 10;
    if (label === l[1].toLowerCase() || label === l[0]) score += 30;
    if (/(?:sdh|hearing|forced|signs?|songs?|commentary)/i.test(label)) score -= 50;

    const current = bestByLanguage.get(l[0]);
    if (!current || score > current.score) {
      bestByLanguage.set(l[0], {
        score,
        subtitle: {
          url: u,
          language: l[0],
          lang: l[0],
          name: `${l[1]} [All-Wish Soft Subtitle]`,
          headers
        }
      });
    }
  }

  return Array.from(bestByLanguage.values()).map(x => x.subtitle);
}

function stream(url, server, section, hard, st, headers, ctx) {
  if (!url) return null;

  const dub = String(section).toLowerCase().includes("dub");
  const mode = dub
    ? "DUB"
    : hard
      ? "HARDSUB"
      : st.length
        ? "SUB + Soft Subs"
        : "SUB";

  return {
    name: `${NAME} | 1080p [${mode}] • ${server}`,
    title: `${ctx.title} • S${ctx.s}E${ctx.e} • ${dub ? "English Dub" : "Japanese"}`,
    url,
    quality: "1080p",
    provider: NAME,
    type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4",
    headers,
    language: dub ? "English" : "Japanese",
    subtitles: st
  };
}

async function mega(url, section, hard, ctx) {
  const h = await text(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Referer": "https://megaplay.buzz/"
    }
  });
  if (!h) return [];

  const m = h.match(/data-id=["'](\d+)["']/i);
  if (!m) return [];

  const d = await json(
    `https://megaplay.buzz/stream/getSources?id=${encodeURIComponent(m[1])}`,
    {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": url,
        "Origin": "https://megaplay.buzz"
      }
    }
  );

  const src = d && d.sources && (d.sources.file || d.sources.url);
  if (!src) return [];

  const ph = {
    "Referer": "https://megaplay.buzz/",
    "Origin": "https://megaplay.buzz",
    "User-Agent": UA
  };

  const st = subs(d.tracks || [], ph, String(section).toLowerCase() === "sub");
  const s = stream(src, "MegaPlay", section, hard, st, ph, ctx);
  return s ? [s] : [];
}

async function zen(url, section, hard, ctx) {
  const h = await text(url, { headers: { "Referer": url } });
  if (!h) return [];

  const v = h.match(/video_b64:\s*["']([^"']+)["']/i);
  const k = h.match(/enc_key_b64:\s*["']([^"']+)["']/i);
  const iv = h.match(/iv_b64:\s*["']([^"']+)["']/i);
  const sm = h.match(/subtitles:\s*["']([^"']*)["']/i);

  if (!v || !k || !iv) return [];

  const dec = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(v[1])
    }),
    CryptoJS.enc.Base64.parse(k[1]),
    {
      iv: CryptoJS.enc.Base64.parse(iv[1]),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    }
  ).toString(CryptoJS.enc.Utf8).trim();

  if (!dec) return [];

  const om = url.match(/^(https?:\/\/[^/]+)/i);
  const ph = {
    "Referer": url,
    "Origin": om ? om[1] : BASE,
    "User-Agent": UA
  };

  let tracks = [];
  if (sm && sm[1]) {
    try {
      const parsed = JSON.parse(
        sm[1]
          .replace(/\\"/g, '"')
          .replace(/\\\//g, "/")
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, x) =>
            String.fromCharCode(parseInt(x, 16))
          )
      );
      if (Array.isArray(parsed)) tracks = parsed;
    } catch (_) {}
  }

  const st = subs(tracks, ph, String(section).toLowerCase() === "sub");
  const s = stream(dec, "Zen", section, hard, st, ph, ctx);
  return s ? [s] : [];
}

async function servers(ids, types, ctx) {
  const d = await json(
    `${BASE}/ajax/server/list?servers=${encodeURIComponent(ids)}`,
    { headers: AJ }
  );

  if (!d || d.status !== 200) return [];

  const $ = cheerio.load(d.result || "");
  const list = [];

  $("div.server-type").each((_, sec) => {
    const n = $(sec);
    const type = String(n.attr("data-type") || "").toLowerCase();
    if (!types.includes(type)) return;

    const hard = /hard\s*sub/i.test(n.text());

    n.find("div.server-list > div.server").each((__, el) => {
      const id = $(el).attr("data-link-id");
      if (id) list.push({ id, type, hard });
    });
  });

  const all = await Promise.all(
    list.map(async x => {
      const r = await json(
        `${BASE}/ajax/server?get=${encodeURIComponent(x.id)}`,
        { headers: AJ }
      );

      const u = r && r.result && r.result.url;
      if (!u) return [];

      if (/megaplay\.buzz|rapid-cloud|vidwish\.live/i.test(u)) {
        return mega(u, x.type, x.hard, ctx);
      }

      if (/player\.sgsgsgsr\.site|zencloudz\.cc/i.test(u)) {
        return zen(u, x.type, x.hard, ctx);
      }

      return [];
    })
  );

  const seen = new Set();
  return all.flat().filter(x => {
    const key = x.url + "|" + x.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getStreams(inputId, type = "tv", season = 1, episode = 1) {
  try {
    type = mediaType(type);

    const s = type === "movie" ? 1 : (parseInt(season, 10) || 1);
    const e = type === "movie" ? 1 : (parseFloat(episode) || 1);

    const tid = await tmdbId(inputId, type);
    if (!tid) return [];

    const tmdb = await tmdbInfo(tid, type);
    if (!tmdb || !tmdb.title) return [];

    if (type === "tv" && tmdb.genres.length && !tmdb.genres.includes(16)) {
      return [];
    }

    const mapping = type === "tv" ? await malMap(tmdb.imdb, s, e) : null;
    const mal = mapping && mapping.mal_id ? +mapping.mal_id : null;
    const target = mapping && mapping.mal_episode != null
      ? parseFloat(mapping.mal_episode)
      : e;

    const aliases = await titleAliases(mal, tmdb, mapping);
    if (!aliases.length) return [];

    console.log(`[${NAME}] Search aliases: ${aliases.join(" | ")}`);

    let candidates = await search(aliases);

    let hit = null;
    let matchedTitle = null;

    for (const candidate of candidates.slice(0, 20)) {
      const ep = choose(await episodes(candidate.url), mal, target);
      if (ep) {
        hit = ep;
        matchedTitle = candidate.title;
        break;
      }
    }

    // If a site-localized title is not present verbatim in MAL/AniList/Kitsu,
    // search distinctive words from the known aliases. The candidate still
    // has to expose the correct MAL ID and mapped episode before it is used.
    if (!hit && mal) {
      const fallbackTerms = fallbackSearchTerms(aliases);
      if (fallbackTerms.length) {
        console.log(`[${NAME}] Fuzzy fallback terms: ${fallbackTerms.join(" | ")}`);
        const fuzzyCandidates = await search(fallbackTerms);

        for (const candidate of fuzzyCandidates.slice(0, 80)) {
          const ep = choose(await episodes(candidate.url), mal, target);
          if (ep) {
            hit = ep;
            matchedTitle = candidate.title;
            break;
          }
        }
      }
    }

    if (!hit) return [];

    const types = [];
    if (hit.sub) types.push("sub");
    if (hit.dub) types.push("dub");
    if (!types.length) return [];

    const ctx = {
      title: matchedTitle || aliases[0] || tmdb.title,
      s,
      e
    };

    const out = await servers(hit.ids, types, ctx);

    out.sort(
      (a, b) =>
        Number(/\[DUB\]/i.test(b.name)) -
        Number(/\[DUB\]/i.test(a.name))
    );

    return out;
  } catch (err) {
    console.log(`[${NAME}] ${err && err.message ? err.message : err}`);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
