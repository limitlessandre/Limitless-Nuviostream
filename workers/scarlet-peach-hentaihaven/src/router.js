const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

const BACKENDS = [
  { id: 'com', host: 'hentaihaven.com', base: 'https://hentaihaven.com', path: 'video', searchPostType: false },
  { id: 'vip', host: 'hentaihaven.vip', base: 'https://hentaihaven.vip', path: 'watch', searchPostType: true }
];

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
  for (const token of xs) if (ys.has(token)) overlap++;
  return Math.round(100 * overlap / Math.max(xs.size, ys.size));
}
function abs(url, base) { try { return new URL(url, base).toString(); } catch (_) { return ''; } }
function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}
async function getText(url, extra = {}, referer = null) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,*/*',
      referer: referer || new URL(url).origin + '/',
      ...extra
    }
  });
  return { res, text: await res.text() };
}
function dedupeStreams(streams) {
  const out = [];
  for (const stream of streams || []) {
    if (!stream || !stream.url || out.some(item => item.url === stream.url)) continue;
    out.push(stream);
  }
  return out.sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
}

function slugVariants(name) {
  const normalized = normalizeTitle(name);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean);
  const variants = [tokens];
  const oVariant = tokens.map(token => token === 'wo' ? 'o' : token);
  variants.push(oVariant);

  const splitChau = input => {
    const out = [];
    for (const token of input) {
      if (token.length > 5 && token.endsWith('chau')) {
        const stem = token.slice(0, -4);
        if (stem.length >= 2) {
          out.push(stem, 'chau');
          continue;
        }
      }
      out.push(token);
    }
    return out;
  };

  variants.push(splitChau(tokens));
  variants.push(splitChau(oVariant));
  return unique(variants.map(parts => parts.join('-')));
}

function findPlayerEmbed(html, pageUrl) {
  const match = String(html).match(/(?:https?:)?\/\/[^"'\s]+\/wp-content\/plugins\/player-logic\/player\.php[^"'\s<]*/i)
    || String(html).match(/[^"']*\/wp-content\/plugins\/player-logic\/player\.php[^"']*/i);
  return match ? abs(match[0].replace(/&amp;/g, '&'), pageUrl) : '';
}
function findSecureToken(html) {
  const match = String(html).match(/<meta[^>]+(?:name|property)=["']x-secure-token["'][^>]+content=["']([^"']+)/i)
    || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']x-secure-token["']/i);
  return match ? match[1] : '';
}
function rot13(value) {
  return String(value).replace(/[A-Za-z]/g, c => {
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
function normalizeEndpointBase(value, backend) {
  let text = clean(value).replace(/&amp;/g, '&');
  if (!text) return '';
  if (text.startsWith('//')) text = 'https:' + text;
  else if (text.startsWith('/')) text = backend.base + text;
  else if (!/^https?:\/\//i.test(text)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(text)) text = 'https://' + text;
    else text = abs(text, backend.base);
  }
  return text;
}

function titlePage(url, backend) {
  try {
    const parsed = new URL(url, backend.base);
    const marker = `/${backend.path}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return '';
    const rest = parsed.pathname.slice(index + marker.length).split('/').filter(Boolean);
    if (!rest.length) return '';
    parsed.pathname = `${marker}${rest[0]}/`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}
function parseSearchLinks(html, backend) {
  const out = [];
  const marker = backend.path === 'video' ? '\\/video\\/' : '\\/watch\\/';
  const re = new RegExp(`<a\\b[^>]*href=["']([^"']*${marker}[^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
  let match;
  while ((match = re.exec(String(html)))) {
    const page = titlePage(match[1].replace(/&amp;/g, '&'), backend);
    if (!page) continue;
    const slug = page.split(`/${backend.path}/`)[1].replace(/\/$/, '');
    const title = stripTags(match[2]);
    if (!out.some(item => item.url === page)) out.push({ url: page, title, slug });
  }
  return out;
}

async function discoverBackend(backend, title, aliases, episode) {
  const names = unique([title, ...(aliases || [])]);

  for (const name of names) {
    for (const slug of slugVariants(name)) {
      const episodeUrl = `${backend.base}/${backend.path}/${slug}/episode-${episode}`;
      try {
        const { res, text } = await getText(episodeUrl, {}, backend.base + '/');
        if (res.ok && findPlayerEmbed(text, episodeUrl)) {
          return {
            backend: backend.id,
            url: episodeUrl,
            html: text,
            slug,
            mode: slug === slugify(name) ? 'direct' : 'direct-romanization'
          };
        }
      } catch (_) {}
    }
  }

  let best = null;
  const terms = unique(names.flatMap(name => {
    const normalized = normalizeTitle(name);
    const tokens = normalized.split(' ').filter(Boolean);
    return [name, tokens[0], tokens.slice(0, 2).join(' ')];
  })).slice(0, 8);

  for (const term of terms) {
    if (!term) continue;
    const suffix = backend.searchPostType ? '&post_type=wp-manga' : '';
    const searchUrl = `${backend.base}/?s=${encodeURIComponent(term)}${suffix}`;
    try {
      const { res, text } = await getText(searchUrl, {}, backend.base + '/');
      if (!res.ok) continue;
      for (const link of parseSearchLinks(text, backend)) {
        const score = Math.max(...names.map(name => Math.max(scoreTitle(name, link.title), scoreTitle(name, link.slug.replace(/-/g, ' ')))));
        if (!best || score > best.score) best = { ...link, score, term };
      }
      if (best && best.score >= 88) break;
    } catch (_) {}
  }

  if (!best || best.score < 45) return { backend: backend.id, error: `no ${backend.host} match`, candidates: best ? [best] : [] };
  const episodeUrl = `${best.url.replace(/\/+$/, '')}/episode-${episode}`;
  try {
    const { res, text } = await getText(episodeUrl, {}, backend.base + '/');
    if (res.ok && findPlayerEmbed(text, episodeUrl)) {
      return { backend: backend.id, url: episodeUrl, html: text, slug: best.slug, mode: 'search', match: best };
    }
  } catch (_) {}
  return { backend: backend.id, error: `${backend.host} title matched but episode unavailable`, candidates: [best] };
}

async function hlsVariants(source, referer, codec = 'h264') {
  try {
    const res = await fetch(source, {
      headers: { 'user-agent': UA, referer, accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*' }
    });
    const text = await res.text();
    if (!res.ok) return [{ url: source, height: 0, label: 'Auto', codec, type: 'm3u8' }];
    const lines = text.split(/\r?\n/);
    const streams = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const resolution = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      let next = i + 1;
      while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
      if (next >= lines.length) continue;
      const url = abs(lines[next].trim(), source);
      if (url) streams.push({ url, height: resolution ? Number(resolution[1]) : 0, label: resolution ? `${resolution[1]}p` : 'Auto', codec, type: 'm3u8' });
    }
    return streams.length ? streams : [{ url: source, height: 0, label: 'Auto', codec, type: 'm3u8' }];
  } catch (_) {
    return [{ url: source, height: 0, label: 'Auto', codec, type: 'm3u8' }];
  }
}

async function extractBackend(backend, pageUrl, pageHtml) {
  const embedUrl = findPlayerEmbed(pageHtml, pageUrl);
  if (!embedUrl) throw new Error(`${backend.host} player embed not found`);

  const embed = await getText(embedUrl, { referer: pageUrl }, pageUrl);
  if (!embed.res.ok) throw new Error(`${backend.host} player HTTP ${embed.res.status}`);
  const token = findSecureToken(embed.text);
  if (!token) throw new Error(`${backend.host} x-secure-token not found`);

  const interim = decodeSecureToken(token);
  if (!interim || !interim.uri || !interim.en || !interim.iv) throw new Error(`${backend.host} decoded token incomplete`);
  const endpointBase = normalizeEndpointBase(interim.uri, backend);
  const apiUrl = abs('./api.php', endpointBase);
  if (!apiUrl) throw new Error(`${backend.host} player API URL invalid`);

  const form = new FormData();
  form.set('action', 'zarat_get_data_player_ajax');
  form.set('a', String(interim.en));
  form.set('b', String(interim.iv));
  const apiRes = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      referer: embedUrl,
      origin: new URL(apiUrl).origin,
      accept: 'application/json,*/*'
    },
    body: form
  });
  const raw = await apiRes.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_) {}
  if (!apiRes.ok) throw new Error(`${backend.host} player API HTTP ${apiRes.status}`);
  if (!payload || payload.status === false || !payload.data) throw new Error(`${backend.host} player API returned no data`);

  const source = clean(payload.data.sources && payload.data.sources[0] && (payload.data.sources[0].src || payload.data.sources[0].file));
  if (!source) throw new Error(`${backend.host} HLS source missing`);
  const sourceUrl = abs(source, apiUrl);
  if (!sourceUrl) throw new Error(`${backend.host} HLS source URL invalid`);

  let streams = await hlsVariants(sourceUrl, embedUrl, 'h264');
  if (payload.data.isOctopus === true) {
    const vp9Url = abs('./playlist_vp9.m3u8', sourceUrl);
    if (vp9Url) streams = streams.concat(await hlsVariants(vp9Url, embedUrl, 'vp9'));
  }
  streams = dedupeStreams(streams);
  if (!streams.length) throw new Error(`${backend.host} returned no playable streams`);

  return {
    streams,
    headers: { Referer: backend.base + '/', Origin: backend.base },
    debug: { isOctopus: payload.data.isOctopus === true, backendHost: backend.host }
  };
}

async function resolve(body) {
  const title = clean(body && body.title);
  const aliases = Array.isArray(body && body.aliases) ? body.aliases : [];
  const episode = Math.max(1, Number(body && body.episode || 1));
  if (!title) return json({ error: 'title required' }, 400);

  const failures = [];
  for (const backend of BACKENDS) {
    const discovered = await discoverBackend(backend, title, aliases, episode);
    if (discovered.error) {
      failures.push({ backend: backend.id, stage: 'match', error: discovered.error, candidates: discovered.candidates || [] });
      continue;
    }
    try {
      const result = await extractBackend(backend, discovered.url, discovered.html);
      return json({
        provider: 'hentaihaven',
        backend: backend.id,
        match: {
          name: title,
          url: discovered.url,
          mode: discovered.mode,
          backend: backend.id,
          domain: backend.host,
          slug: discovered.slug || null,
          candidate: discovered.match || null
        },
        streams: result.streams,
        headers: result.headers,
        debug: result.debug
      });
    } catch (error) {
      failures.push({ backend: backend.id, stage: 'playback', error: error && error.message ? error.message : String(error) });
    }
  }

  const candidates = failures.flatMap(item => item.candidates || []).slice(0, 5);
  const detail = failures.map(item => `${item.backend}:${item.stage}:${item.error}`).join(' | ');
  return json({ error: `no HentaiHaven backend succeeded • ${detail}`, candidates, failures }, 404);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        name: 'Scarlet Peach HentaiHaven Resolver',
        version: '0.3.0',
        backends: BACKENDS.map(item => item.host),
        disabledBackends: ['hentaihaven.xxx']
      });
    }
    if (url.pathname === '/resolve' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid json' }, 400); }
      return resolve(body);
    }
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', version: '0.3.0', endpoints: ['/health', '/resolve'] });
  }
};
