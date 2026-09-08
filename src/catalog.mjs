export function parseCatalogRequest(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'catalog' || parts[1] !== 'series' || !parts[2]) return null;
  const id = parts[2];
  if (!['scarlet-peach-search', 'scarlet-peach-latest', 'scarlet-peach-all'].includes(id)) return null;
  if (id !== 'scarlet-peach-search') return { id, search: null };
  const querySearch = url.searchParams.get('search');
  if (querySearch !== null) return { id, search: querySearch.trim() };
  const pathSearch = parts.slice(3).map((part) => safeDecode(part.replace(/\.json$/, ''))).flatMap((part) => part.split('&')).find((part) => part.startsWith('search='));
  return { id, search: pathSearch ? pathSearch.slice('search='.length).trim() : '' };
}

export function catalogMetas(snapshot, request) {
  const titles = snapshot.titles.filter((title) => title.adult === true);
  if (request.id === 'scarlet-peach-search') {
    const query = request.search.toLowerCase();
    return titles.filter((title) => searchable(title).includes(query)).map((title) => toMeta(title));
  }
  if (request.id === 'scarlet-peach-latest') return [...titles].sort((a, b) => dateOf(b) - dateOf(a)).map((title) => toMeta(title));
  return titles.map((title) => toMeta(title));
}

export function toMeta(item, detailed = false) {
  return {
    id: item.id, type: item.type, name: item.title, poster: item.poster || undefined,
    description: detailed ? item.description : undefined, year: item.year || undefined, genres: item.genres,
    videos: detailed ? item.episodes.map((episode) => ({ id: `${item.id}:${episode.number}`, title: episode.title || `Episode ${episode.number}`, episode: episode.number, released: episode.releaseDate || undefined })) : undefined
  };
}

function searchable(title) { return [title.title, title.titles.english, title.titles.romaji, title.titles.japanese, ...title.titles.aliases].filter(Boolean).join(' ').toLowerCase(); }
function dateOf(title) { const timestamp = Date.parse(title.updatedAt || title.releaseDate || ''); return Number.isNaN(timestamp) ? 0 : timestamp; }
function safeDecode(value) { try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; } }
