import { snapshot } from './snapshot.mjs';
import { fallbackSnapshot } from './fallback-snapshot.mjs';
import { catalogMetas, parseCatalogRequest, toMeta } from './catalog.mjs';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' };
const manifest = { id: 'org.limitlessnexus.scarletpeach.catalog', version: '0.1.0', name: 'Limitless Nexus: Scarlet Peach', resources: ['catalog', 'meta'], types: ['series'], catalogs: [
  { type: 'series', id: 'scarlet-peach-search', name: 'Scarlet Peach Search', extra: [{ name: 'search', isRequired: true }] },
  { type: 'series', id: 'scarlet-peach-latest', name: 'Scarlet Peach Latest' },
  { type: 'series', id: 'scarlet-peach-all', name: 'Scarlet Peach All' }
] };
const required = ['id', 'type', 'adult', 'sourceConfidence', 'title', 'titles', 'genres', 'tags', 'languageVersions', 'censorStatus', 'episodes'];
function isValidSnapshot(candidate) { const ids = new Set(); return Boolean(candidate?.titles?.length) && candidate.titles.every((title) => title.adult === true && /^(mal|anilist|sp):/.test(title.id || '') && required.every((key) => key in title) && !ids.has(title.id) && (ids.add(title.id), true)); }
const catalog = isValidSnapshot(snapshot) ? snapshot : fallbackSnapshot;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

export default { fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/manifest.json') return response(manifest);
  const catalogRequest = parseCatalogRequest(url);
  if (catalogRequest) return response({ metas: catalogMetas(catalog, catalogRequest) });
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'meta' && parts[2]) { const id = decodeURIComponent(parts[2]).replace(/\.json$/, ''); const item = catalog.titles.find((title) => title.id === id); return item ? response({ meta: toMeta(item, true) }) : response({ meta: null }, 404); }
  return response({ error: 'Not found' }, 404);
} };
