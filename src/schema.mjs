export const SCHEMA_VERSION = 2;
export const CENSOR_STATUSES = Object.freeze(['censored', 'uncensored', 'mixed', 'unknown']);

const clean = (value) => String(value == null ? '' : value).trim();
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
const integerOrNull = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

export function normalizeCensorStatus(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === 'censor' || normalized === 'censored') return 'censored';
  if (normalized === 'uncensor' || normalized === 'uncensored') return 'uncensored';
  if (normalized === 'mixed') return 'mixed';
  return 'unknown';
}

export function normalizeLanguageCode(value) {
  const normalized = clean(value).toLowerCase().replace('_', '-');
  const aliases = {
    japanese: 'ja', jp: 'ja', ja: 'ja',
    english: 'en', eng: 'en', en: 'en',
    spanish: 'es', spa: 'es', es: 'es',
    portuguese: 'pt', por: 'pt', pt: 'pt',
    french: 'fr', fra: 'fr', fr: 'fr',
    german: 'de', deu: 'de', de: 'de',
    italian: 'it', ita: 'it', it: 'it',
    korean: 'ko', kor: 'ko', ko: 'ko',
    chinese: 'zh', zho: 'zh', zh: 'zh'
  };
  return aliases[normalized] || normalized || null;
}

export function normalizeLanguageVersion(value) {
  if (typeof value === 'string') {
    const audio = normalizeLanguageCode(value);
    return audio ? { audio, subtitles: [], dub: audio !== 'ja', source: 'legacy', verifiedAt: null } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const audio = normalizeLanguageCode(value.audio || value.audioLanguage || value.language);
  const subtitles = unique(list(value.subtitles || value.subtitleLanguages).map(normalizeLanguageCode).filter(Boolean));
  return {
    audio,
    subtitles,
    dub: typeof value.dub === 'boolean' ? value.dub : Boolean(audio && audio !== 'ja'),
    source: clean(value.source || value.provider) || null,
    verifiedAt: clean(value.verifiedAt || value.lastVerifiedAt) || null
  };
}

export function normalizeProviderMapping(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = clean(value.provider || value.source || value.name).toLowerCase();
  if (!provider) return null;
  const audioLanguages = unique(list(value.audioLanguages || value.languages).map(normalizeLanguageCode).filter(Boolean));
  const subtitleLanguages = unique(list(value.subtitleLanguages || value.subtitles).map(normalizeLanguageCode).filter(Boolean));
  const qualities = [...new Set(list(value.qualities).map(Number).filter((number) => Number.isFinite(number) && number > 0))].sort((a, b) => a - b);
  return {
    provider,
    providerId: clean(value.providerId || value.id) || null,
    seriesId: clean(value.seriesId) || null,
    slug: clean(value.slug) || null,
    url: clean(value.url) || null,
    title: clean(value.title || value.name) || null,
    censorStatus: normalizeCensorStatus(value.censorStatus),
    audioLanguages,
    subtitleLanguages,
    tags: unique(list(value.tags)),
    qualities,
    lastVerifiedAt: clean(value.lastVerifiedAt || value.verifiedAt) || null,
    metadata: value.metadata && typeof value.metadata === 'object' ? value.metadata : {}
  };
}

export function normalizeEpisode(value, index = 0) {
  const episode = value && typeof value === 'object' ? value : {};
  const number = integerOrNull(episode.number) || index + 1;
  return {
    number,
    title: clean(episode.title) || `Episode ${number}`,
    releaseDate: clean(episode.releaseDate || episode.released) || null,
    runtimeSeconds: integerOrNull(episode.runtimeSeconds || episode.durationSeconds),
    thumbnail: clean(episode.thumbnail || episode.poster) || null,
    overview: clean(episode.overview || episode.description) || null,
    censorStatus: normalizeCensorStatus(episode.censorStatus),
    audioLanguages: unique(list(episode.audioLanguages).map(normalizeLanguageCode).filter(Boolean)),
    subtitleLanguages: unique(list(episode.subtitleLanguages).map(normalizeLanguageCode).filter(Boolean)),
    providerMappings: list(episode.providerMappings).map(normalizeProviderMapping).filter(Boolean)
  };
}

function deriveAvailability(providerMappings, languageVersions, censorStatus) {
  const mappings = providerMappings || [];
  const providers = unique(mappings.map((mapping) => mapping.provider));
  const audioLanguages = unique([
    ...mappings.flatMap((mapping) => mapping.audioLanguages || []),
    ...languageVersions.map((version) => version.audio).filter(Boolean)
  ]);
  const subtitleLanguages = unique([
    ...mappings.flatMap((mapping) => mapping.subtitleLanguages || []),
    ...languageVersions.flatMap((version) => version.subtitles || [])
  ]);
  const qualities = [...new Set(mappings.flatMap((mapping) => mapping.qualities || []))].sort((a, b) => a - b);
  const censorStatuses = unique([censorStatus, ...mappings.map((mapping) => mapping.censorStatus)].filter((status) => status && status !== 'unknown'));
  return { providers, audioLanguages, subtitleLanguages, qualities, censorStatuses };
}

export function normalizeTitleRecord(value) {
  const item = value && typeof value === 'object' ? value : {};
  const titles = item.titles && typeof item.titles === 'object' ? item.titles : {};
  const aliases = unique([
    ...list(titles.aliases),
    ...list(item.aliases),
    ...list(item.alternativeTitles)
  ]);
  const providerMappings = Array.isArray(item.providerMappings)
    ? item.providerMappings.map(normalizeProviderMapping).filter(Boolean)
    : Object.entries(item.providerMappings || {}).map(([provider, mapping]) => normalizeProviderMapping({ provider, ...(mapping || {}) })).filter(Boolean);
  const languageVersions = list(item.languageVersions).map(normalizeLanguageVersion).filter(Boolean);
  const censorStatus = normalizeCensorStatus(item.censorStatus);
  const sourceMetadata = item.sourceMetadata && typeof item.sourceMetadata === 'object' ? item.sourceMetadata : {};
  const contentRating = item.contentRating && typeof item.contentRating === 'object' ? item.contentRating : {
    adult: item.adult === true,
    classification: clean(sourceMetadata.rating) || null,
    source: clean(item.sourceConfidence || sourceMetadata.source) || null
  };
  const episodes = list(item.episodes).map(normalizeEpisode);
  const poster = clean(item.poster || item.artwork?.poster) || null;
  const background = clean(item.background || item.artwork?.background) || null;
  const record = {
    id: clean(item.id),
    type: clean(item.type) || 'series',
    adult: item.adult === true,
    sourceConfidence: clean(item.sourceConfidence) || 'unknown',
    sourceMetadata,
    contentRating: {
      adult: contentRating.adult !== false,
      classification: clean(contentRating.classification || contentRating.rating) || null,
      source: clean(contentRating.source) || null
    },
    title: clean(item.title),
    titles: {
      english: clean(titles.english) || null,
      romaji: clean(titles.romaji || item.title) || null,
      japanese: clean(titles.japanese || item.japaneseTitle) || null,
      aliases
    },
    description: clean(item.description) || null,
    poster,
    background,
    artwork: { poster, background },
    year: integerOrNull(item.year),
    releaseDate: clean(item.releaseDate) || null,
    updatedAt: clean(item.updatedAt) || null,
    studio: clean(item.studio || item.brand) || null,
    genres: unique(list(item.genres)),
    tags: unique(list(item.tags)),
    censorStatus,
    languageVersions,
    episodes,
    providerMappings,
    provenance: {
      canonicalSource: clean(item.provenance?.canonicalSource || item.sourceConfidence) || 'unknown',
      sources: Array.isArray(item.provenance?.sources) ? item.provenance.sources : sourceMetadata.source ? [{
        source: clean(sourceMetadata.source),
        url: clean(sourceMetadata.sourceUrl) || null,
        retrievedAt: clean(sourceMetadata.retrievedAt) || null
      }] : [],
      lastMergedAt: clean(item.provenance?.lastMergedAt) || null
    }
  };
  record.availability = deriveAvailability(providerMappings, languageVersions, censorStatus);
  return record;
}

export function normalizeSnapshot(snapshot) {
  const titles = list(snapshot?.titles).map(normalizeTitleRecord);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: clean(snapshot?.generatedAt) || new Date().toISOString(),
    titles
  };
}

export function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || snapshot.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(snapshot?.titles) || snapshot.titles.length === 0) errors.push('titles must be a non-empty array');
  const ids = new Set();
  for (const title of snapshot?.titles || []) {
    const prefixOk = /^(mal|anilist|sp):/.test(title.id || '');
    if (!prefixOk) errors.push(`unsupported stable ID: ${title.id || '<missing>'}`);
    if (ids.has(title.id)) errors.push(`duplicate ID: ${title.id}`);
    ids.add(title.id);
    if (title.adult !== true) errors.push(`non-adult record: ${title.id}`);
    if (!title.title) errors.push(`missing title: ${title.id}`);
    if (!title.titles || !Array.isArray(title.titles.aliases)) errors.push(`invalid titles object: ${title.id}`);
    if (!Array.isArray(title.genres) || !Array.isArray(title.tags)) errors.push(`invalid classification arrays: ${title.id}`);
    if (!CENSOR_STATUSES.includes(title.censorStatus)) errors.push(`invalid censorStatus on ${title.id}`);
    if (!Array.isArray(title.languageVersions)) errors.push(`invalid languageVersions on ${title.id}`);
    if (!Array.isArray(title.episodes)) errors.push(`invalid episodes on ${title.id}`);
    if (!Array.isArray(title.providerMappings)) errors.push(`invalid providerMappings on ${title.id}`);
    for (const mapping of title.providerMappings || []) {
      if (!mapping.provider) errors.push(`provider mapping without provider on ${title.id}`);
      if (!CENSOR_STATUSES.includes(mapping.censorStatus)) errors.push(`invalid provider censorStatus on ${title.id}/${mapping.provider}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function schemaDescriptor() {
  return {
    schemaVersion: SCHEMA_VERSION,
    idPrefixes: ['mal:', 'anilist:', 'sp:'],
    censorStatuses: CENSOR_STATUSES,
    titleFields: [
      'identity', 'titles/aliases', 'description/artwork', 'year/releaseDate', 'studio',
      'genres/tags', 'contentRating', 'censorStatus', 'languageVersions', 'episodes',
      'providerMappings', 'availability', 'provenance'
    ],
    providerMappingFields: [
      'provider', 'providerId', 'seriesId', 'slug', 'url', 'title', 'censorStatus',
      'audioLanguages', 'subtitleLanguages', 'tags', 'qualities', 'lastVerifiedAt', 'metadata'
    ],
    episodeFields: [
      'number', 'title', 'releaseDate', 'runtimeSeconds', 'thumbnail', 'overview',
      'censorStatus', 'audioLanguages', 'subtitleLanguages', 'providerMappings'
    ]
  };
}
