const BASE = 'https://hentaihaven.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
}
function clean(v) { return String(v == null ? '' : v).trim(); }
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
function abs(url, base = BASE) { try { return new URL(url, base).toString(); } catch (_) { return ''; } }
function normalizeEndpointBase(value) {
  let s = clean(value).replace(/&amp;/g, '&');
  if (!s) return '';
  if (s.startsWith('//')) s = 'https:' + s;
  else if (s.startsWith('/')) s = BASE + s;
  else if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(s)) s = 'https://' + s;
    else s = abs(s, BASE);
  }
  return s;
}
async function getText(url, extra = {}) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', referer: BASE + '/', ...extra } });
  return { res, text: await res.text() };
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
function findEmbed(html, pageUrl) {
  const match = String(html).match(/(?:https?:)?\/\/[^"'\s]+\/wp-content\/plugins\/player-logic\/player\.php[^"'\s<]*/i)
    || String(html).match(/[^"']*\/wp-content\/plugins\/player-logic\/player\.php[^"']*/i);
  return match ? abs(match[0].replace(/&amp;/g, '&'), pageUrl) : '';
}
function findSecureToken(html) {
  const m = String(html).match(/<meta[^>]+(?:name|property)=["']x-secure-token["'][^>]+content=["']([^"']+)/i)
    || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']x-secure-token["']/i);
  return m ? m[1] : '';
}
function parseSearchLinks(html) {
  const out = [];
  const re = /href=["']([^"']*\/video\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const href = abs(m[1].replace(/&amp;/g, '&'));
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (href && !out.some(x => x.url === href)) out.push({ url: href, title: text });
  }
  return out;
}
function episodeUrlFromCandidate(url, episode) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '');
  if (/\/episode-\d+$/i.test(path)) return u.toString();
  u.pathname = path + `/episode-${episode}`;
  return u.toString();
}
async function discoverPage(title, aliases, episode) {
  const names = [title, ...(aliases || [])].map(clean).filter(Boolean);
  const direct = [];
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    direct.push(`${BASE}/video/${slug}/episode-${episode}`);
    direct.push(`${BASE}/video/${slug}`);
  }
  for (const url of [...new Set(direct)]) {
    try {
      const { res, text } = await getText(url);
      if (res.ok && findEmbed(text, url)) return { url, html: text, mode: 'direct' };
    } catch (_) {}
  }

  const query = encodeURIComponent(names[0] || '');
  const searchUrls = [`${BASE}/?s=${query}`, `${BASE}/search/${query}`];
  let best = null;
  for (const searchUrl of searchUrls) {
    try {
      const { res, text } = await getText(searchUrl);
      if (!res.ok) continue;
      const links = parseSearchLinks(text);
      for (const link of links) {
        const s = Math.max(...names.map(n => scoreTitle(n, link.title || link.url)));
        if (!best || s > best.score) best = { ...link, score: s };
      }
    } catch (_) {}
  }
  if (!best || best.score < 45) return { error: 'no HentaiHaven match', candidates: best ? [best] : [] };
  const episodeUrl = episodeUrlFromCandidate(best.url, episode);
  for (const url of [...new Set([episodeUrl, best.url])]) {
    try {
      const { res, text } = await getText(url);
      if (res.ok && findEmbed(text, url)) return { url, html: text, mode: 'search', match: best };
    } catch (_) {}
  }
  return { error: 'matched title but episode page unavailable', candidates: [best] };
}
async function extractPlayer(pageUrl, pageHtml) {
  const embedUrl = findEmbed(pageHtml, pageUrl);
  if (!embedUrl) throw new Error('player embed not found');
  const embed = await getText(embedUrl, { referer: pageUrl });
  if (!embed.res.ok) throw new Error(`player HTTP ${embed.res.status}`);
  const token = findSecureToken(embed.text);
  if (!token) throw new Error('x-secure-token not found');
  const interim = decodeSecureToken(token);
  if (!interim || !interim.uri || !interim.en || !interim.iv) throw new Error('decoded player token incomplete');

  const endpointBase = normalizeEndpointBase(interim.uri);
  const apiUrl = abs('./api.php', endpointBase);
  if (!apiUrl) throw new Error(`player API URL invalid • uri=${clean(interim.uri).slice(0, 100)}`);
  const form = new FormData();
  form.set('action', 'zarat_get_data_player_ajax');
  form.set('a', String(interim.en));
  form.set('b', String(interim.iv));
  const apiRes = await fetch(apiUrl, { method: 'POST', headers: { 'user-agent': UA, referer: embedUrl, origin: new URL(apiUrl).origin, accept: 'application/json,*/*' }, body: form });
  const raw = await apiRes.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_) {}
  if (!apiRes.ok) throw new Error(`player API HTTP ${apiRes.status}`);
  if (!payload || payload.status === false || !payload.data) throw new Error(`player API returned no data • body=${raw.slice(0, 120)}`);
  const source = clean(payload.data.sources && payload.data.sources[0] && (payload.data.sources[0].src || payload.data.sources[0].file));
  if (!source) throw new Error('HLS source missing');
  const sourceUrl = abs(source, apiUrl);
  if (!sourceUrl) throw new Error(`HLS source URL invalid • source=${source.slice(0, 100)}`);
  return { source: sourceUrl, embedUrl, apiUrl, isOctopus: payload.data.isOctopus === true };
}
async function hlsVariants(source, referer) {
  try {
    const res = await fetch(source, { headers: { 'user-agent': UA, referer, accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*' } });
    const text = await res.text();
    if (!res.ok) return [{ url: source, height: 0, label: 'Auto' }];
    const lines = text.split(/\r?\n/);
    const streams = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const rm = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      let next = i + 1;
      while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
      if (next >= lines.length) continue;
      const url = abs(lines[next].trim(), source);
      if (url) streams.push({ url, height: rm ? Number(rm[1]) : 0, label: rm ? `${rm[1]}p` : 'Auto' });
    }
    if (!streams.length) return [{ url: source, height: 0, label: 'Auto' }];
    return streams.filter((x, i, a) => a.findIndex(y => y.url === x.url) === i).sort((a,b) => b.height - a.height);
  } catch (_) { return [{ url: source, height: 0, label: 'Auto' }]; }
}

async function resolve(body) {
  const title = clean(body && body.title);
  const aliases = Array.isArray(body && body.aliases) ? body.aliases : [];
  const episode = Math.max(1, Number(body && body.episode || 1));
  if (!title) return json({ error: 'title required' }, 400);
  const discovered = await discoverPage(title, aliases, episode);
  if (discovered.error) return json({ error: discovered.error, candidates: discovered.candidates || [] }, 404);
  try {
    const player = await extractPlayer(discovered.url, discovered.html);
    const streams = await hlsVariants(player.source, player.embedUrl);
    return json({ provider: 'hentaihaven', match: { name: title, url: discovered.url, mode: discovered.mode }, streams, debug: { isOctopus: player.isOctopus } });
  } catch (error) {
    return json({ error: error && error.message ? error.message : String(error), match: { url: discovered.url, mode: discovered.mode } }, 502);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ status: 'ok', name: 'Scarlet Peach HentaiHaven Resolver', version: '0.1.1' });
    if (url.pathname === '/resolve' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid json' }, 400); }
      return resolve(body);
    }
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', endpoints: ['/health', '/resolve'] });
  }
};
