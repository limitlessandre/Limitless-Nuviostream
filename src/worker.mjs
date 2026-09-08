import { snapshot } from './snapshot.mjs';
import { fallbackSnapshot } from './fallback-snapshot.mjs';
import { catalogMetas, parseCatalogRequest, toMeta } from './catalog.mjs';
import { normalizeSnapshot, schemaDescriptor, validateSnapshot } from './schema.mjs';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' };
const manifest = {
  id: 'org.limitlessnexus.scarletpeach.catalog',
  version: '0.2.0',
  name: 'Limitless Nexus: Scarlet Peach',
  description: 'Adult-only normalized metadata catalog with reusable schema v2 provider mappings, censorship, language, tags, and episode metadata.',
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

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/manifest.json') return response(manifest);
    if (url.pathname === '/health') return response({
      ok: true,
      service: 'Scarlet Peach Catalog',
      schemaVersion: catalog.schemaVersion,
      generatedAt: catalog.generatedAt,
      titleCount: catalog.titles.length
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
