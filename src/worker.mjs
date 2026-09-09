import { snapshot } from './snapshot.mjs';
import { fallbackSnapshot } from './fallback-snapshot.mjs';
import { catalogMetas, parseCatalogRequest, toMeta } from './catalog.mjs';
import { normalizeSnapshot, schemaDescriptor, validateSnapshot } from './schema.mjs';

const HENTAIHAVEN_RESOLVER = 'https://scarlet-peach-hentaihaven.limitlessandre.workers.dev';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*'
};
const manifest = {
  id: 'org.limitlessnexus.scarletpeach.catalog',
  version: '0.4.1',
  name: 'Limitless Nexus: Scarlet Peach',
  description: 'Adult-only normalized metadata catalog with schema v2 provider merging, censorship, language, tags, episode metadata, Hanime + HentaiHaven catalog coverage, and HentaiHaven subtitle resources.',
  resources: ['catalog', 'meta', 'subtitles'],
  types: ['series'],
  catalogs: [
    { type: 'series', id: 'scarlet-peach-search', name: 'Scarlet Peach Search', extra: [{ name: 'search', isRequired: true }] },
    { type: 'series', id: 'scarlet-peach-latest', name: 'Scarlet Peach Latest' },
    { type: 'series', id: 'scarlet-peach-all', name: 'Scarlet Peach All' }
  ]
};

const primary = normalizeSnapshot(snapshot);
const fallback = normalizeSnapshot(fallbackSnapshot);
const catalog = validateSnapshot(primary).ok ? primary : fallback;
const response = (body, status = 200, headers = jsonHeaders) => new Response(JSON.stringify(body), { status, headers });

function catalogSummary(data) {
  const providerCounts = {};
  const censorStatusCounts = { censored: 0, uncensored: 0, mixed: 0, unknown: 0 };
  let spTitleCount = 0;
  let mappedTitleCount = 0;

  for (const title of data.titles || []) {
    if (String(title.id || '').startsWith('sp:')) spTitleCount += 1;
    const status = censorStatusCounts[title.censorStatus] === undefined ? 'unknown' : title.censorStatus;
    censorStatusCounts[status] += 1;
    const providers = new Set((title.providerMappings || []).map((mapping) => mapping.provider).filter(Boolean));
    if (providers.size) mappedTitleCount += 1;
    for (const provider of providers) providerCounts[provider] = (providerCounts[provider] || 0) + 1;
  }

  return { providerCounts, censorStatusCounts, spTitleCount, mappedTitleCount };
}

function splitEpisodeId(videoId) {
  const decoded = String(videoId || '').trim();
  const match = decoded.match(/^(.*):(\d+)$/);
  if (!match) return { baseId: decoded, episode: 1 };
  return { baseId: match[1], episode: Math.max(1, Number(match[2]) || 1) };
}

function titleAliases(item) {
  return [...new Set([
    item?.title,
    item?.titles?.english,
    item?.titles?.romaji,
    item?.titles?.japanese,
    ...(item?.titles?.aliases || [])
  ].filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function safeSubtitleSource(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || !/\.vtt(?:$|\?)/i.test(url.toString())) return null;
    const host = url.hostname.toLowerCase();
    const allowed = host === 'octopusmanifest.org' || host.endsWith('.octopusmanifest.org') || host === 'hentaihaven.com' || host === 'hentaihaven.vip';
    return allowed ? url : null;
  } catch (_) {
    return null;
  }
}

async function subtitleProxy(url) {
  const source = safeSubtitleSource(url.searchParams.get('url'));
  if (!source) return new Response('invalid subtitle source', { status: 400, headers: { 'access-control-allow-origin': '*' } });
  try {
    const upstream = await fetch(source.toString(), {
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/vtt,text/plain,*/*',
        referer: 'https://hentaihaven.com/'
      }
    });
    if (!upstream.ok) return new Response(`subtitle upstream HTTP ${upstream.status}`, { status: 502, headers: { 'access-control-allow-origin': '*' } });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*'
      }
    });
  } catch (error) {
    return new Response(`subtitle proxy error: ${error && error.message ? error.message : error}`, { status: 502, headers: { 'access-control-allow-origin': '*' } });
  }
}

async function subtitleResource(requestUrl, encodedVideoId) {
  let videoId;
  try { videoId = decodeURIComponent(String(encodedVideoId || '').replace(/\.json$/, '')); }
  catch (_) { videoId = String(encodedVideoId || '').replace(/\.json$/, ''); }
  const { baseId, episode } = splitEpisodeId(videoId);
  const item = catalog.titles.find((title) => title.id === baseId && title.adult === true);
  if (!item) return response({ subtitles: [] }, 200, { ...jsonHeaders, 'cache-control': 'no-store' });

  const aliases = titleAliases(item);
  try {
    const resolved = await fetch(`${HENTAIHAVEN_RESOLVER}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        title: item.title,
        aliases,
        year: item.year || null,
        episode
      })
    });
    if (!resolved.ok) return response({ subtitles: [] }, 200, { ...jsonHeaders, 'cache-control': 'no-store' });
    const data = await resolved.json();
    const tracks = Array.isArray(data?.metadata?.subtitleTracks) ? data.metadata.subtitleTracks : [];
    const subtitles = [];
    const seen = new Set();
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index] || {};
      const source = safeSubtitleSource(track.url || track.file || track.src);
      if (!source || seen.has(source.toString())) continue;
      seen.add(source.toString());
      const lang = String(track.language || track.lang || 'und').trim().toLowerCase() || 'und';
      const proxyUrl = new URL('/subtitle-proxy.vtt', requestUrl.origin);
      proxyUrl.searchParams.set('url', source.toString());
      subtitles.push({
        id: `scarlet-peach-hentaihaven-${baseId}-${episode}-${lang}-${index}`,
        url: proxyUrl.toString(),
        lang,
        language: lang
      });
    }
    return response({ subtitles }, 200, { ...jsonHeaders, 'cache-control': 'no-store' });
  } catch (_) {
    return response({ subtitles: [] }, 200, { ...jsonHeaders, 'cache-control': 'no-store' });
  }
}

const summary = catalogSummary(catalog);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': '*'
        }
      });
    }
    if (url.pathname === '/manifest.json') return response(manifest);
    if (url.pathname === '/health') return response({
      ok: true,
      service: 'Scarlet Peach Catalog',
      version: manifest.version,
      schemaVersion: catalog.schemaVersion,
      generatedAt: catalog.generatedAt,
      titleCount: catalog.titles.length,
      subtitleResource: true,
      subtitleSource: 'hentaihaven',
      ...summary
    });
    if (url.pathname === '/schema.json') return response(schemaDescriptor());
    if (url.pathname === '/dataset.json' || url.pathname === '/data/current.json') {
      return response(catalog, 200, { ...jsonHeaders, 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' });
    }
    if (url.pathname === '/subtitle-proxy.vtt') return subtitleProxy(url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'subtitles' && parts[1] === 'series' && parts[2]) {
      return subtitleResource(url, parts[2]);
    }
    const catalogRequest = parseCatalogRequest(url);
    if (catalogRequest) return response({ metas: catalogMetas(catalog, catalogRequest) });
    if (parts[0] === 'meta' && parts[2]) {
      const id = decodeURIComponent(parts[2]).replace(/\.json$/, '');
      const item = catalog.titles.find((title) => title.id === id);
      return item ? response({ meta: toMeta(item, true) }) : response({ meta: null }, 404);
    }
    return response({ error: 'Not found' }, 404);
  }
};
