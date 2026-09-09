import { snapshot } from './snapshot.mjs';
import { fallbackSnapshot } from './fallback-snapshot.mjs';
import { catalogMetas, parseCatalogRequest, toMeta } from './catalog.mjs';
import { normalizeSnapshot, schemaDescriptor, validateSnapshot } from './schema.mjs';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' };
const manifest = {
  id: 'org.limitlessnexus.scarletpeach.catalog',
  version: '0.4.0',
  name: 'Limitless Nexus: Scarlet Peach',
  description: 'Adult-only normalized metadata catalog with schema v2 provider merging, censorship, language, tags, episode metadata, and Hanime + HentaiHaven catalog coverage.',
  resources: ['catalog', 'meta'],
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

const summary = catalogSummary(catalog);

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/manifest.json') return response(manifest);
    if (url.pathname === '/health') return response({
      ok: true,
      service: 'Scarlet Peach Catalog',
      version: manifest.version,
      schemaVersion: catalog.schemaVersion,
      generatedAt: catalog.generatedAt,
      titleCount: catalog.titles.length,
      ...summary
    });
    if (url.pathname === '/schema.json') return response(schemaDescriptor());
    if (url.pathname === '/dataset.json' || url.pathname === '/data/current.json') {
      return response(catalog, 200, { ...jsonHeaders, 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' });
    }
    const catalogRequest = parseCatalogRequest(url);
    if (catalogRequest) return response({ metas: catalogMetas(catalog, catalogRequest) });
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'meta' && parts[2]) {
      const id = decodeURIComponent(parts[2]).replace(/\.json$/, '');
      const item = catalog.titles.find((title) => title.id === id);
      return item ? response({ meta: toMeta(item, true) }) : response({ meta: null }, 404);
    }
    return response({ error: 'Not found' }, 404);
  }
};
