const VERSION = '0.1.1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const UA = 'Limitless-Nexus-Scarlet-Peach/0.1 (+https://github.com/limitlessandre/Limitless-Nuviostream)';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', ...extra }
  });
}
function clean(v) { return String(v == null ? '' : v).trim(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function yearFrom(value) {
  const m = clean(value).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}
function normalizeType(value) {
  const v = clean(value).toLowerCase();
  if (v === 'movie' || v === 'film') return 'movie';
  return 'series';
}
function stripEpisodeSuffix(id) {
  const raw = clean(id);
  if (/^tt\d+(?::\d+(?::\d+)?)?$/i.test(raw)) return raw.split(':')[0];
  if (/^(?:tmdb:)?\d+(?::\d+(?::\d+)?)?$/i.test(raw)) {
    const first = raw.split(':');
    if (first[0].toLowerCase() === 'tmdb') return `tmdb:${first[1]}`;
    return first[0];
  }
  return raw;
}
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    ...options,
    headers: { 'user-agent': UA, accept: 'application/json', ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { res, data, text };
}

async function wikidataSearch(property, value) {
  const query = `haswbstatement:${property}=${value}`;
  const url = `https://www.wikidata.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=5&srsearch=${encodeURIComponent(query)}`;
  const { res, data } = await fetchJson(url);
  if (!res.ok || !data || !data.query || !Array.isArray(data.query.search)) return [];
  return data.query.search.map(item => clean(item.title)).filter(id => /^Q\d+$/.test(id));
}

async function wikidataEntity(qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels%7Caliases%7Cclaims&languages=en&ids=${encodeURIComponent(qid)}`;
  const { res, data } = await fetchJson(url);
  if (!res.ok || !data || !data.entities) return null;
  return data.entities[qid] || null;
}

function claimValue(entity, property) {
  const claims = entity && entity.claims && entity.claims[property];
  if (!Array.isArray(claims)) return '';
  for (const claim of claims) {
    const value = claim && claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
    if (typeof value === 'string' || typeof value === 'number') return clean(value);
  }
  return '';
}

function claimTextValues(entity, property) {
  const claims = entity && entity.claims && entity.claims[property];
  if (!Array.isArray(claims)) return [];
  const out = [];
  for (const claim of claims) {
    const value = claim && claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
    if (typeof value === 'string') out.push(value);
    else if (value && typeof value === 'object' && value.text) out.push(value.text);
  }
  return unique(out);
}

function entityFallbackMeta(entity) {
  if (!entity) return null;
  const label = clean(entity.labels && entity.labels.en && entity.labels.en.value);
  const aliases = Array.isArray(entity.aliases && entity.aliases.en)
    ? entity.aliases.en.map(x => clean(x && x.value)).filter(Boolean)
    : [];
  const workTitles = unique([
    ...claimTextValues(entity, 'P1476'),
    ...claimTextValues(entity, 'P1705')
  ]);
  let year = null;
  const dates = entity.claims && entity.claims.P577;
  if (Array.isArray(dates)) {
    for (const claim of dates) {
      const value = claim && claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
      const time = value && value.time;
      year = yearFrom(time);
      if (year) break;
    }
  }
  return label ? { title: label, aliases: unique([...aliases, ...workTitles]), year } : null;
}

async function cinemeta(imdbId, preferredType) {
  const order = preferredType === 'movie' ? ['movie', 'series'] : ['series', 'movie'];
  for (const type of order) {
    try {
      const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`;
      const { res, data } = await fetchJson(url);
      const meta = data && data.meta;
      if (!res.ok || !meta || !meta.name) continue;
      const aliases = unique([
        ...(Array.isArray(meta.aliases) ? meta.aliases : []),
        ...(Array.isArray(meta.alternativeTitles) ? meta.alternativeTitles : []),
        meta.originalTitle,
        meta.name
      ]);
      return {
        type,
        title: clean(meta.name),
        aliases,
        year: Number(meta.year || 0) || yearFrom(meta.releaseInfo)
      };
    } catch (_) {}
  }
  return null;
}

async function resolveIdentity(inputId, mediaType) {
  const raw = stripEpisodeSuffix(inputId);
  const preferredType = normalizeType(mediaType);
  if (!raw) return { error: 'id required', status: 400 };

  let imdbId = '';
  let tmdbId = '';
  let tmdbKind = '';
  let wikidataId = '';
  let entity = null;

  if (/^tt\d+$/i.test(raw)) {
    imdbId = raw.toLowerCase();
  } else {
    const tmdbMatch = raw.match(/^(?:tmdb:)?(\d+)$/i);
    if (!tmdbMatch) return { error: `unsupported external id: ${raw}`, status: 404 };
    tmdbId = tmdbMatch[1];

    const properties = preferredType === 'movie'
      ? [['P4947', 'movie'], ['P4983', 'tv']]
      : [['P4983', 'tv'], ['P4947', 'movie']];

    for (const [property, kind] of properties) {
      let qids = [];
      try { qids = await wikidataSearch(property, tmdbId); } catch (_) {}
      if (!qids.length) continue;
      wikidataId = qids[0];
      tmdbKind = kind;
      try { entity = await wikidataEntity(wikidataId); } catch (_) { entity = null; }
      imdbId = claimValue(entity, 'P345');
      if (imdbId || entity) break;
    }

    if (!wikidataId) return { error: `TMDB ${tmdbId} was not found in Wikidata`, status: 404 };
  }

  let meta = null;
  if (imdbId) {
    try { meta = await cinemeta(imdbId, preferredType); } catch (_) { meta = null; }
  }
  const entityMeta = entityFallbackMeta(entity);
  if (meta && entityMeta) {
    meta = {
      ...meta,
      aliases: unique([...(meta.aliases || []), entityMeta.title, ...(entityMeta.aliases || [])]),
      year: meta.year || entityMeta.year
    };
  } else if (!meta && entityMeta) {
    meta = entityMeta;
  }
  if (!meta || !meta.title) return { error: `metadata unavailable for ${raw}`, status: 404 };

  return {
    status: 200,
    data: {
      inputId: clean(inputId),
      normalizedId: raw,
      source: tmdbId ? `tmdb-${tmdbKind || preferredType}` : 'imdb',
      tmdbId: tmdbId || null,
      imdbId: imdbId || null,
      wikidataId: wikidataId || null,
      type: meta.type || preferredType,
      title: meta.title,
      aliases: unique(meta.aliases || []),
      year: meta.year || null
    }
  };
}

async function cachedResolve(id, type) {
  const cache = caches.default;
  const key = new Request(`https://scarlet-peach.identity/cache/${VERSION}?id=${encodeURIComponent(clean(id))}&type=${encodeURIComponent(clean(type))}`);
  const hit = await cache.match(key);
  if (hit) {
    const data = await hit.json();
    return { status: 200, data: { ...data, cache: 'hit' } };
  }
  const result = await resolveIdentity(id, type);
  if (result.status === 200 && result.data) {
    const response = json(result.data, 200, { 'cache-control': 'public, max-age=604800' });
    await cache.put(key, response.clone());
  }
  return result;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ status: 'ok', name: 'Scarlet Peach Identity Resolver', version: VERSION, sources: ['Wikidata', 'Cinemeta'] });
    }
    if (url.pathname === '/resolve' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid json' }, 400); }
      const result = await cachedResolve(body.id, body.type);
      return result.status === 200 ? json(result.data) : json({ error: result.error }, result.status || 500);
    }
    return json({ name: 'Scarlet Peach Identity Resolver', version: VERSION, endpoints: ['/health', '/resolve'] });
  }
};
