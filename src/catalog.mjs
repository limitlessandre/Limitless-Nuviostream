import {
  TAXONOMY_CATALOG_IDS,
  matchesTaxonomyCategory,
  matchesTaxonomyGroup,
  taxonomyCategory,
  taxonomyGroup
} from './taxonomy.mjs';

const CORE_CATALOG_IDS = ['scarlet-peach-search', 'scarlet-peach-latest', 'scarlet-peach-popular', 'scarlet-peach-all'];
const CATALOG_IDS = new Set([...CORE_CATALOG_IDS, ...TAXONOMY_CATALOG_IDS]);
const MINOR_CODED = /(?:^|\b)(?:loli|lolicon|shota|shotacon|school\s*girl|schoolgirl)(?:\b|$)/i;

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
  if (request.id === 'scarlet-peach-latest') {
    return titles
      .filter(isSafeForFeaturedRows)
      .sort((a, b) => dateOf(b) - dateOf(a) || String(a.title || '').localeCompare(String(b.title || '')))
      .map((title) => toMeta(title));
  }
  if (request.id === 'scarlet-peach-popular') {
    return titles
      .filter(isSafeForFeaturedRows)
      .sort(comparePopularity)
      .map((title) => toMeta(title));
  }
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

function isSafeForFeaturedRows(title) {
  const values = [
    title?.title,
    ...(Array.isArray(title?.genres) ? title.genres : []),
    ...(Array.isArray(title?.tags) ? title.tags : []),
    ...(Array.isArray(title?.providerMappings) ? title.providerMappings.flatMap((mapping) => [mapping?.title, ...(mapping?.tags || [])]) : [])
  ];
  return !values.some((value) => MINOR_CODED.test(String(value || '')));
}

function comparePopularity(a, b) {
  const left = popularitySignals(a);
  const right = popularitySignals(b);
  return (
    right.engagement - left.engagement ||
    right.rating - left.rating ||
    right.providers - left.providers ||
    right.episodes - left.episodes ||
    dateOf(b) - dateOf(a) ||
    String(a.title || '').localeCompare(String(b.title || ''))
  );
}

function popularitySignals(title) {
  const metadata = [
    title?.sourceMetadata,
    ...(Array.isArray(title?.providerMappings) ? title.providerMappings.map((mapping) => mapping?.metadata) : []),
    ...(Array.isArray(title?.episodes) ? title.episodes.flatMap((episode) =>
      Array.isArray(episode?.providerMappings) ? episode.providerMappings.map((mapping) => mapping?.metadata) : []
    ) : [])
  ].filter((value) => value && typeof value === 'object');

  let views = 0;
  let likes = 0;
  let favorites = 0;
  let interests = 0;
  let rating = 0;

  for (const object of metadata) {
    for (const [rawKey, rawValue] of Object.entries(object)) {
      const key = String(rawKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const value = numericValue(rawValue);
      if (!Number.isFinite(value) || value < 0) continue;
      if (/^(?:views?|view_count|views_count|watch_count|watchers|plays?|play_count)$/.test(key)) views = Math.max(views, value);
      else if (/^(?:likes?|like_count|likes_count)$/.test(key)) likes = Math.max(likes, value);
      else if (/^(?:favorites?|favourites?|favorite_count|favourite_count)$/.test(key)) favorites = Math.max(favorites, value);
      else if (/^(?:interests?|interest_count|interests_count)$/.test(key)) interests = Math.max(interests, value);
      else if (/^(?:rating|rating_score|score|average_score|avg_score)$/.test(key)) rating = Math.max(rating, normalizeRating(value));
    }
  }

  const engagement =
    Math.log1p(views) * 100 +
    Math.log1p(favorites) * 75 +
    Math.log1p(interests) * 60 +
    Math.log1p(likes) * 50;
  const providers = new Set((title?.providerMappings || []).map((mapping) => mapping?.provider).filter(Boolean)).size;
  const episodes = Array.isArray(title?.episodes) ? title.episodes.length : 0;
  return { engagement, rating, providers, episodes };
}

function numericValue(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return NaN;
  return Number(text);
}

function normalizeRating(value) {
  if (value <= 10) return value;
  if (value <= 100) return value / 10;
  return 0;
}

function dateOf(title) {
  const timestamp = Date.parse(title.updatedAt || title.releaseDate || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function safeDecode(value) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; }
}
