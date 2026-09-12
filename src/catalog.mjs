import {
  TAXONOMY_CATALOG_IDS,
  matchesTaxonomyCategory,
  matchesTaxonomyGroup,
  taxonomyCategory,
  taxonomyGroup
} from './taxonomy.mjs';

const CORE_CATALOG_IDS = ['scarlet-peach-search', 'scarlet-peach-latest', 'scarlet-peach-all'];
const CATALOG_IDS = new Set([...CORE_CATALOG_IDS, ...TAXONOMY_CATALOG_IDS]);

export function parseCatalogRequest(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'catalog' || parts[1] !== 'series' || !parts[2]) return null;
  const id = parts[2].replace(/\.json$/, '');
  if (!CATALOG_IDS.has(id)) return null;

  const extras = parseExtras(url, parts.slice(3));
  if (id === 'scarlet-peach-search') return { id, search: String(extras.search || '').trim(), genre: null };
  if (TAXONOMY_CATALOG_IDS.includes(id)) return { id, search: null, genre: String(extras.genre || '').trim() || null };
  return { id, search: null, genre: null };
}

export function catalogMetas(snapshot, request) {
  const titles = snapshot.titles.filter((title) => title.adult === true);
  if (request.id === 'scarlet-peach-search') {
    const query = String(request.search || '').toLowerCase().trim();
    return titles.filter((title) => !query || searchable(title).includes(query)).map((title) => toMeta(title));
  }
  if (request.id === 'scarlet-peach-latest') return [...titles].sort((a, b) => dateOf(b) - dateOf(a)).map((title) => toMeta(title));
  if (request.id === 'scarlet-peach-all') return titles.map((title) => toMeta(title));

  const group = taxonomyGroup(request.id);
  if (!group) return [];
  const category = request.genre ? taxonomyCategory(group, request.genre) : null;
  if (request.genre && !category) return [];
  return titles
    .filter((title) => category ? matchesTaxonomyCategory(title, category) : matchesTaxonomyGroup(title, group))
    .sort((a, b) => dateOf(b) - dateOf(a) || String(a.title || '').localeCompare(String(b.title || '')))
    .map((title) => toMeta(title));
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

function parseExtras(url, pathParts) {
  const extras = Object.fromEntries(url.searchParams.entries());
  for (const part of pathParts) {
    const decoded = safeDecode(part.replace(/\.json$/, ''));
    for (const entry of decoded.split('&')) {
      const index = entry.indexOf('=');
      if (index <= 0) continue;
      const key = entry.slice(0, index);
      if (!(key in extras)) extras[key] = entry.slice(index + 1);
    }
  }
  return extras;
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
