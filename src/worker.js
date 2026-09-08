import { snapshot } from './snapshot.js';
import { fallbackSnapshot } from './fallback-snapshot.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' };
const manifest = {
  id: 'org.limitlessnexus.scarletpeach.catalog',
  version: '0.1.0',
  name: 'Limitless Nexus: Scarlet Peach',
  resources: ['catalog', 'meta'],
  types: ['series'],
  catalogs: [
    { type: 'series', id: 'scarlet-peach-search', name: 'Scarlet Peach Search', extra: [{ name: 'search', isRequired: true }] },
    { type: 'series', id: 'scarlet-peach-latest', name: 'Scarlet Peach Latest' },
    { type: 'series', id: 'scarlet-peach-all', name: 'Scarlet Peach All' }
  ]
};

const required = ['id', 'type', 'adult', 'sourceConfidence', 'title', 'titles', 'genres', 'tags', 'languageVersions', 'censorStatus', 'episodes'];
function isValidSnapshot(candidate) {
  if (!candidate || !Array.isArray(candidate.titles) || candidate.titles.length === 0) return false;
  const ids = new Set();
  return candidate.titles.every((title) => title.adult === true && /^(mal|anilist|sp):/.test(title.id || '') && required.every((key) => key in title) && !ids.has(title.id) && (ids.add(title.id), true));
}
const catalog = isValidSnapshot(snapshot) ? snapshot : fallbackSnapshot;

function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function toMeta(item, detailed = false) {
  return {
    id: item.id, type: item.type, name: item.title, poster: item.poster || undefined,
    description: detailed ? item.description : undefined, year: item.year || undefined, genres: item.genres,
    videos: detailed ? item.episodes.map((episode) => ({ id: `${item.id}:${episode.number}`, title: episode.title || `Episode ${episode.number}`, episode: episode.number })) : undefined
  };
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/manifest.json') return response(manifest);
    if (parts[0] === 'catalog') {
      const query = (url.searchParams.get('search') || '').trim().toLowerCase();
      const metas = catalog.titles.filter((item) => !query || [item.title, ...item.titles.aliases].join(' ').toLowerCase().includes(query)).map((item) => toMeta(item));
      return response({ metas });
    }
    if (parts[0] === 'meta' && parts[2]) {
      const id = decodeURIComponent(parts[2]).replace(/\.json$/, '');
      const item = catalog.titles.find((title) => title.id === id);
      return item ? response({ meta: toMeta(item, true) }) : response({ meta: null }, 404);
    }
    return response({ error: 'Not found' }, 404);
  }
};
