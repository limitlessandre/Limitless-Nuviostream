export function parseCatalogRequest(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'catalog' || parts[1] !== 'series' || !parts[2]) return null;
  const id = parts[2].replace(/\.json$/, '');
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
    const query = String(request.search || '').toLowerCase().trim();
    return titles.filter((title) => !query || searchable(title).includes(query)).map((title) => toMeta(title));
  }
  if (request.id === 'scarlet-peach-latest') return [...titles].sort((a, b) => dateOf(b) - dateOf(a)).map((title) => toMeta(title));
  return titles.map((title) => toMeta(title));
}

export function toMeta(item, detailed = false) {
  const aliases = [item.titles?.english, item.titles?.romaji, ...(item.titles?.aliases || [])].filter(Boolean);
  const meta = {
    id: item.id,
    type: item.type,
    name: item.title,
    poster: item.poster || item.artwork?.poster || undefined,
    background: item.background || item.artwork?.background || undefined,
    description: detailed ? item.description || undefined : undefined,
    year: item.year || undefined,
    releaseInfo: item.year ? String(item.year) : undefined,
    genres: item.genres || [],
    aliases,
    originalTitle: item.titles?.romaji || undefined,
    japaneseTitle: item.titles?.japanese || undefined,
    studio: item.studio || undefined,
    adult: item.adult === true,
    tags: item.tags || [],
    censorStatus: item.censorStatus || 'unknown',
    languageVersions: item.languageVersions || [],
    availability: item.availability || undefined,
    providerMappings: item.providerMappings || [],
    contentRating: item.contentRating || undefined,
    schemaVersion: 2,
    videos: detailed ? (item.episodes || []).map((episode) => ({
      id: `${item.id}:${episode.number}`,
      title: episode.title || `Episode ${episode.number}`,
      season: 1,
      episode: episode.number,
      released: episode.releaseDate || undefined,
      thumbnail: episode.thumbnail || undefined,
      overview: episode.overview || undefined,
      runtimeSeconds: episode.runtimeSeconds ?? undefined,
      censorStatus: episode.censorStatus || 'unknown',
      audioLanguages: episode.audioLanguages || [],
      subtitleLanguages: episode.subtitleLanguages || [],
      providerMappings: episode.providerMappings || []
    })) : undefined
  };
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined));
}

function searchable(title) {
  const providerText = (title.providerMappings || []).flatMap((mapping) => [mapping.title, mapping.slug, ...(mapping.tags || [])]);
  return [
    title.title,
    title.titles?.english,
    title.titles?.romaji,
    title.titles?.japanese,
    ...(title.titles?.aliases || []),
    title.studio,
    ...(title.genres || []),
    ...(title.tags || []),
    ...providerText
  ].filter(Boolean).join(' ').toLowerCase();
}

function dateOf(title) {
  const timestamp = Date.parse(title.updatedAt || title.releaseDate || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function safeDecode(value) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; }
}
