const BASE_COM = 'https://hentaihaven.com';
const BASE_XXX = 'https://hentaihaven.xxx';
const API_XXX = `${BASE_XXX}/wp-admin/admin-ajax.php`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
}
function clean(v) { return String(v == null ? '' : v).trim(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function normalizeTitle(v) {
  return clean(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|season|episode|ova)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function slugify(v) { return normalizeTitle(v).replace(/\s+/g, '-'); }
function scoreTitle(a, b) {
  const x = normalizeTitle(a), y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 100;
  if (x.includes(y) || y.includes(x)) return 88;
  const xs = new Set(x.split(' ')), ys = new Set(y.split(' '));
  let overlap = 0;
  for (const t of xs) if (ys.has(t)) overlap++;
  return Math.round(100 * overlap / Math.max(xs.size, ys.size));
}
function abs(url, base) { try { return new URL(url, base).toString(); } catch (_) { return ''; } }
function originOf(url, fallback) { try { return new URL(url).origin; } catch (_) { return fallback; } }
async function getText(url, extra = {}, refererBase = null) {
  const fallbackReferer = refererBase || originOf(url, BASE_COM) + '/';
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', referer: fallbackReferer, ...extra }
  });
  return { res, text: await res.text() };
}
function streamHeightFromLabel(label) {
  const m = clean(label).match(/(\d{3,4})p?/i);
  return m ? Number(m[1]) : 0;
}
function typeFromUrl(url) {
  const s = clean(url).toLowerCase();
  if (s.includes('.mp4')) return 'mp4';
  return 'm3u8';
}
function dedupeStreams(streams) {
  const out = [];
  for (const stream of streams || []) {
    if (!stream || !stream.url || out.some(x => x.url === stream.url)) continue;
    out.push(stream);
  }
  return out.sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
}

// ---- hentaihaven.com backend -------------------------------------------------
function normalizeComEndpointBase(value) {
  let s = clean(value).replace(/&amp;/g, '&');
  if (!s) return '';
  if (s.startsWith('//')) s = 'https:' + s;
  else if (s.startsWith('/')) s = BASE_COM + s;
  else if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(s)) s = 'https://' + s;
    else s = abs(s, BASE_COM);
  }
  return s;
}
function rot13(s) {
  return String(s).replace(/[A-Za-z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
  });
}
function decodeSecureToken(input) {
  let value = clean(input);
  if (value.startsWith('sha512-')) value = value.slice(7);
  for (let i = 0; i < 3; i++) {
    value = rot13(value);
    value = atob(value);
  }
  return JSON.parse(value);
}
function findComEmbed(html, pageUrl) {
  const match = String(html).match(/(?:https?:)?\/\/[^"'\s]+\/wp-content\/plugins\/player-logic\/player\.php[^"'\s<]*/i)
    || String(html).match(/[^"']*\/wp-content\/plugins\/player-logic\/player\.php[^"']*/i);
  return match ? abs(match[0].replace(/&amp;/g, '&'), pageUrl) : '';
}
function findSecureToken(html) {
  const m = String(html).match(/<meta[^>]+(?:name|property)=["']x-secure-token["'][^>]+content=["']([^"']+)/i)
    || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']x-secure-token["']/i);
  return m ? m[1] : '';
}
function parseComSearchLinks(html) {
  const out = [];
  const re = /href=["']([^"']*\/video\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const href = abs(m[1].replace(/&amp;/g, '&'), BASE_COM);
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (href && !out.some(x => x.url === href)) out.push({ url: href, title: text });
  }
  return out;
}
function comEpisodeUrl(url, episode) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '');
  if (/\/episode-\d+$/i.test(path)) return u.toString();
  u.pathname = path + `/episode-${episode}`;
  return u.toString();
}
async function discoverCom(title, aliases, episode) {
  const names = unique([title, ...(aliases || [])]);
  const direct = [];
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    direct.push(`${BASE_COM}/video/${slug}/episode-${episode}`);
    direct.push(`${BASE_COM}/video/${slug}`);
  }
  for (const url of unique(direct)) {
    try {
      const { res, text } = await getText(url, {}, BASE_COM + '/');
      if (res.ok && findComEmbed(text, url)) return { backend: 'com', url, html: text, mode: 'direct' };
    } catch (_) {}
  }

  const query = encodeURIComponent(names[0] || '');
  const searchUrls = [`${BASE_COM}/?s=${query}`, `${BASE_COM}/search/${query}`];
  let best = null;
  for (const searchUrl of searchUrls) {
    try {
      const { res, text } = await getText(searchUrl, {}, BASE_COM + '/');
      if (!res.ok) continue;
      for (const link of parseComSearchLinks(text)) {
        const s = Math.max(...names.map(n => scoreTitle(n, link.title || link.url)));
        if (!best || s > best.score) best = { ...link, score: s };
      }
    } catch (_) {}
  }
  if (!best || best.score < 45) return { backend: 'com', error: 'no hentaihaven.com match', candidates: best ? [best] : [] };
  const episodeUrl = comEpisodeUrl(best.url, episode);
  for (const url of unique([episodeUrl, best.url])) {
    try {
      const { res, text } = await getText(url, {}, BASE_COM + '/');
      if (res.ok && findComEmbed(text, url)) return { backend: 'com', url, html: text, mode: 'search', match: best };
    } catch (_) {}
  }
  return { backend: 'com', error: 'hentaihaven.com title matched but episode unavailable', candidates: [best] };
}
async function hlsVariants(source, referer, id = 'h264') {
  try {
    const res = await fetch(source, { headers: { 'user-agent': UA, referer, accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*' } });
    const text = await res.text();
    if (!res.ok) return [{ url: source, height: 0, label: 'Auto', codec: id, type: 'm3u8' }];
    const lines = text.split(/\r?\n/);
    const streams = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const rm = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      let next = i + 1;
      while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
      if (next >= lines.length) continue;
      const url = abs(lines[next].trim(), source);
      if (url) streams.push({ url, height: rm ? Number(rm[1]) : 0, label: rm ? `${rm[1]}p` : 'Auto', codec: id, type: 'm3u8' });
    }
    return streams.length ? streams : [{ url: source, height: 0, label: 'Auto', codec: id, type: 'm3u8' }];
  } catch (_) {
    return [{ url: source, height: 0, label: 'Auto', codec: id, type: 'm3u8' }];
  }
}
async function extractCom(pageUrl, pageHtml) {
  const embedUrl = findComEmbed(pageHtml, pageUrl);
  if (!embedUrl) throw new Error('hentaihaven.com player embed not found');
  const embed = await getText(embedUrl, { referer: pageUrl }, pageUrl);
  if (!embed.res.ok) throw new Error(`hentaihaven.com player HTTP ${embed.res.status}`);
  const token = findSecureToken(embed.text);
  if (!token) throw new Error('hentaihaven.com x-secure-token not found');
  const interim = decodeSecureToken(token);
  if (!interim || !interim.uri || !interim.en || !interim.iv) throw new Error('hentaihaven.com decoded token incomplete');

  const endpointBase = normalizeComEndpointBase(interim.uri);
  const apiUrl = abs('./api.php', endpointBase);
  if (!apiUrl) throw new Error(`hentaihaven.com player API URL invalid • uri=${clean(interim.uri).slice(0, 100)}`);
  const form = new FormData();
  form.set('action', 'zarat_get_data_player_ajax');
  form.set('a', String(interim.en));
  form.set('b', String(interim.iv));
  const apiRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'user-agent': UA, referer: embedUrl, origin: new URL(apiUrl).origin, accept: 'application/json,*/*' },
    body: form
  });
  const raw = await apiRes.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_) {}
  if (!apiRes.ok) throw new Error(`hentaihaven.com player API HTTP ${apiRes.status}`);
  if (!payload || payload.status === false || !payload.data) throw new Error(`hentaihaven.com player API returned no data • body=${raw.slice(0, 120)}`);
  const source = clean(payload.data.sources && payload.data.sources[0] && (payload.data.sources[0].src || payload.data.sources[0].file));
  if (!source) throw new Error('hentaihaven.com HLS source missing');
  const sourceUrl = abs(source, apiUrl);
  if (!sourceUrl) throw new Error('hentaihaven.com HLS source URL invalid');

  let streams = await hlsVariants(sourceUrl, embedUrl, 'h264');
  if (payload.data.isOctopus === true) {
    const vp9Url = abs('./playlist_vp9.m3u8', sourceUrl);
    if (vp9Url) streams = streams.concat(await hlsVariants(vp9Url, embedUrl, 'vp9'));
  }
  return {
    streams: dedupeStreams(streams),
    headers: { Referer: BASE_COM + '/', Origin: BASE_COM },
    debug: { isOctopus: payload.data.isOctopus === true }
  };
}

// ---- hentaihaven.xxx backend -------------------------------------------------
function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}
function xxxTitlePage(url) {
  try {
    const u = new URL(url, BASE_XXX);
    const m = u.pathname.match(/^(\/watch\/[^/]+)/i);
    if (!m) return '';
    u.pathname = m[1] + '/';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (_) { return ''; }
}
function parseXxxSearchLinks(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']*\/watch\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const page = xxxTitlePage(m[1].replace(/&amp;/g, '&'));
    if (!page) continue;
    const title = stripTags(m[2]) || page.split('/watch/')[1].replace(/\/$/, '').replace(/-/g, ' ');
    if (!out.some(x => x.url === page)) out.push({ url: page, title });
  }
  return out;
}
function xxxSearchTerms(names) {
  const out = [];
  for (const name of names) {
    const normalized = normalizeTitle(name);
    if (!normalized) continue;
    out.push(name);
    const tokens = normalized.split(' ').filter(Boolean);
    if (tokens[0] && tokens[0].length >= 4) out.push(tokens[0]);
    if (tokens.length >= 2) out.push(tokens.slice(0, 2).join(' '));
  }
  return unique(out).slice(0, 8);
}
function findXxxIframe(html, pageUrl) {
  const matches = [];
  const re = /<iframe\b[^>]*src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const url = abs(m[1].replace(/&amp;/g, '&'), pageUrl);
    if (url) matches.push(url);
  }
  if (!matches.length) return '';
  return matches.find(url => /player|embed|stream|video/i.test(url)) || matches[0];
}
async function discoverXxx(title, aliases, episode) {
  const names = unique([title, ...(aliases || [])]);

  // Cheap direct probes first for titles whose romanization already matches the live slug.
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    const episodeUrl = `${BASE_XXX}/watch/${slug}/episode-${episode}`;
    try {
      const { res, text } = await getText(episodeUrl, {}, BASE_XXX + '/hentai/');
      if (res.ok && findXxxIframe(text, episodeUrl)) return { backend: 'xxx', url: episodeUrl, html: text, mode: 'direct' };
    } catch (_) {}
  }

  let best = null;
  for (const term of xxxSearchTerms(names)) {
    const searchUrl = `${BASE_XXX}/?s=${encodeURIComponent(term)}&post_type=wp-manga`;
    try {
      const { res, text } = await getText(searchUrl, {}, BASE_XXX + '/hentai/');
      if (!res.ok) continue;
      for (const link of parseXxxSearchLinks(text)) {
        const candidateText = `${link.title} ${link.url}`;
        const s = Math.max(...names.map(n => scoreTitle(n, candidateText)));
        if (!best || s > best.score) best = { ...link, score: s, term };
      }
      if (best && best.score >= 88) break;
    } catch (_) {}
  }
  if (!best || best.score < 45) return { backend: 'xxx', error: 'no hentaihaven.xxx match', candidates: best ? [best] : [] };

  const episodeUrl = `${best.url.replace(/\/+$/, '')}/episode-${episode}`;
  try {
    const { res, text } = await getText(episodeUrl, {}, BASE_XXX + '/hentai/');
    if (res.ok && findXxxIframe(text, episodeUrl)) return { backend: 'xxx', url: episodeUrl, html: text, mode: 'search', match: best };
  } catch (_) {}
  return { backend: 'xxx', error: 'hentaihaven.xxx title matched but episode unavailable', candidates: [best] };
}
function parseLooseJson(raw) {
  const text = clean(raw);
  try { return JSON.parse(text); } catch (_) {}
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}
async function extractXxx(pageUrl, pageHtml) {
  const playerSrc = findXxxIframe(pageHtml, pageUrl);
  if (!playerSrc) throw new Error('hentaihaven.xxx player iframe not found');
  const player = await getText(playerSrc, { referer: pageUrl }, BASE_XXX + '/hentai/');
  if (!player.res.ok) throw new Error(`hentaihaven.xxx player HTTP ${player.res.status}`);

  const vals = player.text.match(/action\s*:\s*['"]([^'"]+)['"]\s*,\s*a\s*:\s*['"]([^'"]+)['"]\s*,\s*b\s*:\s*['"]([^'"]+)['"]/i);
  if (!vals) throw new Error('hentaihaven.xxx player AJAX values not found');
  const form = new FormData();
  form.set('action', vals[1]);
  form.set('a', vals[2]);
  form.set('b', vals[3]);
  const apiRes = await fetch(API_XXX, {
    method: 'POST',
    headers: { 'user-agent': UA, referer: playerSrc, origin: BASE_XXX, accept: 'application/json,text/plain,*/*' },
    body: form
  });
  const raw = await apiRes.text();
  if (!apiRes.ok) throw new Error(`hentaihaven.xxx AJAX HTTP ${apiRes.status}`);
  const payload = parseLooseJson(raw);
  if (!payload) throw new Error(`hentaihaven.xxx AJAX JSON unavailable • body=${raw.slice(0, 120)}`);
  const data = payload.data || payload;
  const sources = Array.isArray(data.sources) ? data.sources : Array.isArray(payload.sources) ? payload.sources : [];
  if (!sources.length) throw new Error('hentaihaven.xxx returned no sources');

  let streams = [];
  for (const source of sources) {
    const src = clean(source && (source.src || source.file));
    if (!src) continue;
    const url = abs(src, API_XXX);
    if (!url) continue;
    const label = clean(source.label || source.res || source.quality) || 'Auto';
    const height = streamHeightFromLabel(label);
    const type = typeFromUrl(url);
    if (type === 'm3u8' && !height) streams = streams.concat(await hlsVariants(url, API_XXX, 'h264'));
    else streams.push({ url, height, label, type, codec: clean(source.type || '') });
  }
  streams = dedupeStreams(streams);
  if (!streams.length) throw new Error('hentaihaven.xxx sources were not playable URLs');
  return {
    streams,
    headers: { Referer: API_XXX, Origin: BASE_XXX },
    debug: { sourceCount: sources.length }
  };
}

async function resolve(body) {
  const title = clean(body && body.title);
  const aliases = Array.isArray(body && body.aliases) ? body.aliases : [];
  const episode = Math.max(1, Number(body && body.episode || 1));
  if (!title) return json({ error: 'title required' }, 400);

  const failures = [];

  const com = await discoverCom(title, aliases, episode);
  if (!com.error) {
    try {
      const result = await extractCom(com.url, com.html);
      return json({
        provider: 'hentaihaven', backend: 'com',
        match: { name: title, url: com.url, mode: com.mode, backend: 'com' },
        streams: result.streams, headers: result.headers, debug: result.debug
      });
    } catch (error) {
      failures.push({ backend: 'com', stage: 'playback', error: error && error.message ? error.message : String(error) });
    }
  } else {
    failures.push({ backend: 'com', stage: 'match', error: com.error, candidates: com.candidates || [] });
  }

  const xxx = await discoverXxx(title, aliases, episode);
  if (!xxx.error) {
    try {
      const result = await extractXxx(xxx.url, xxx.html);
      return json({
        provider: 'hentaihaven', backend: 'xxx',
        match: { name: title, url: xxx.url, mode: xxx.mode, backend: 'xxx', candidate: xxx.match || null },
        streams: result.streams, headers: result.headers, debug: result.debug
      });
    } catch (error) {
      failures.push({ backend: 'xxx', stage: 'playback', error: error && error.message ? error.message : String(error) });
    }
  } else {
    failures.push({ backend: 'xxx', stage: 'match', error: xxx.error, candidates: xxx.candidates || [] });
  }

  const candidates = failures.flatMap(x => x.candidates || []).slice(0, 5);
  const detail = failures.map(x => `${x.backend}:${x.stage}:${x.error}`).join(' | ');
  return json({ error: `no HentaiHaven backend succeeded • ${detail}`, candidates, failures }, 404);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ status: 'ok', name: 'Scarlet Peach HentaiHaven Resolver', version: '0.2.0', backends: ['hentaihaven.com', 'hentaihaven.xxx'] });
    if (url.pathname === '/resolve' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid json' }, 400); }
      return resolve(body);
    }
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', version: '0.2.0', endpoints: ['/health', '/resolve'] });
  }
};
