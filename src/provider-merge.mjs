import { normalizeLanguageVersion, normalizeProviderMapping, normalizeSnapshot, validateSnapshot } from './schema.mjs';

const clean = (value) => String(value == null ? '' : value).trim();
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];

export function canonicalProviderTitle(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bwo\b/g, 'o')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function aggregateCensorStatus(current, incoming) {
  const a = clean(current).toLowerCase() || 'unknown';
  const b = clean(incoming).toLowerCase() || 'unknown';
  if (b === 'unknown') return a;
  if (a === 'unknown') return b;
  if (a === b) return a;
  return 'mixed';
}

function stableProviderId(provider, record) {
  let raw = clean(record.seriesId || record.slug || record.providerId || record.id || record.title).toLowerCase();
  for (const prefix of [`${provider}:series:`, `${provider}:`, 'series:']) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length);
      break;
    }
  }
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `sp:${provider}:${slug || 'untitled'}`;
}

function titleCandidates(record) {
  return unique([
    record.title,
    record.providerTitle,
    record.seriesTitle,
    ...list(record.aliases)
  ]);
}

function canonicalCandidates(title) {
  return unique([
    title.title,
    title.titles?.english,
    title.titles?.romaji,
    title.titles?.japanese,
    ...(title.titles?.aliases || []),
    ...(title.providerMappings || []).map((mapping) => mapping.title)
  ]).map(canonicalProviderTitle).filter(Boolean);
}

export function findStrongProviderMatch(titles, record) {
  if (record.canonicalId) {
    const direct = titles.find((title) => title.id === record.canonicalId);
    if (direct) return direct;
  }

  const wanted = new Set(titleCandidates(record).map(canonicalProviderTitle).filter(Boolean));
  if (!wanted.size) return null;

  const matches = titles.filter((title) => canonicalCandidates(title).some((candidate) => wanted.has(candidate)));
  if (matches.length === 1) return matches[0];
  if (matches.length <= 1) return null;

  const year = Number(record.year || 0) || null;
  if (year) {
    const yearMatches = matches.filter((title) => title.year && Math.abs(Number(title.year) - year) <= 1);
    if (yearMatches.length === 1) return yearMatches[0];
  }

  const studio = canonicalProviderTitle(record.studio || record.brand);
  if (studio) {
    const studioMatches = matches.filter((title) => canonicalProviderTitle(title.studio) === studio);
    if (studioMatches.length === 1) return studioMatches[0];
  }

  return null;
}

function mergeEpisode(target, provider, record) {
  const number = Number(record.number || record.episode || 0);
  if (!Number.isInteger(number) || number <= 0) return;

  let episode = target.episodes.find((entry) => entry.number === number);
  if (!episode) {
    episode = {
      number,
      title: clean(record.title) || `Episode ${number}`,
      releaseDate: clean(record.releaseDate) || null,
      runtimeSeconds: Number.isInteger(Number(record.runtimeSeconds)) ? Number(record.runtimeSeconds) : null,
      thumbnail: clean(record.thumbnail) || null,
      overview: clean(record.overview || record.description) || null,
      censorStatus: clean(record.censorStatus) || 'unknown',
      audioLanguages: unique(record.audioLanguages || []),
      subtitleLanguages: unique(record.subtitleLanguages || []),
      providerMappings: []
    };
    target.episodes.push(episode);
  } else {
    episode.releaseDate = episode.releaseDate || clean(record.releaseDate) || null;
    episode.runtimeSeconds = episode.runtimeSeconds || (Number.isInteger(Number(record.runtimeSeconds)) ? Number(record.runtimeSeconds) : null);
    episode.thumbnail = episode.thumbnail || clean(record.thumbnail) || null;
    episode.overview = episode.overview || clean(record.overview || record.description) || null;
  }

  const mapping = normalizeProviderMapping({
    provider,
    providerId: record.providerId,
    seriesId: record.seriesId,
    slug: record.slug,
    url: record.url,
    title: record.title,
    censorStatus: record.censorStatus,
    audioLanguages: record.audioLanguages,
    subtitleLanguages: record.subtitleLanguages,
    tags: record.tags,
    qualities: record.qualities,
    lastVerifiedAt: record.lastVerifiedAt,
    metadata: record.metadata
  });

  if (mapping) {
    const existingIndex = episode.providerMappings.findIndex((item) =>
      item.provider === mapping.provider &&
      (item.slug || item.providerId || '') === (mapping.slug || mapping.providerId || '')
    );
    if (existingIndex >= 0) episode.providerMappings[existingIndex] = mapping;
    else episode.providerMappings.push(mapping);
  }

  episode.censorStatus = aggregateCensorStatus(episode.censorStatus, record.censorStatus);
  episode.audioLanguages = unique([...(episode.audioLanguages || []), ...(record.audioLanguages || [])]);
  episode.subtitleLanguages = unique([...(episode.subtitleLanguages || []), ...(record.subtitleLanguages || [])]);
}

function addProvenance(target, provider, record, payload) {
  const url = clean(record.url) || null;
  const retrievedAt = clean(record.lastVerifiedAt || payload.generatedAt) || new Date().toISOString();
  const source = `${provider} provider catalog`;
  target.provenance = target.provenance || { canonicalSource: target.sourceConfidence || 'unknown', sources: [], lastMergedAt: null };
  target.provenance.sources = Array.isArray(target.provenance.sources) ? target.provenance.sources : [];
  if (!target.provenance.sources.some((entry) => entry.source === source && (entry.url || null) === url)) {
    target.provenance.sources.push({ source, url, retrievedAt });
  }
  target.provenance.lastMergedAt = new Date().toISOString();
}

export function mergeProviderPayload(inputSnapshot, payload) {
  const provider = clean(payload?.provider).toLowerCase();
  if (!provider) throw new Error('Provider import is missing provider');
  if (!Array.isArray(payload?.records)) throw new Error('Provider import records must be an array');

  const snapshot = normalizeSnapshot(inputSnapshot);
  let merged = 0;
  let created = 0;
  let skipped = 0;

  for (const record of payload.records) {
    if (!record || !clean(record.title)) {
      skipped += 1;
      continue;
    }

    let target = findStrongProviderMatch(snapshot.titles, record);
    if (!target) {
      target = normalizeSnapshot({ titles: [{
        id: stableProviderId(provider, record),
        type: 'series',
        adult: true,
        sourceConfidence: provider,
        sourceMetadata: {
          source: `${provider} provider catalog`,
          sourceUrl: clean(record.url) || null,
          rating: clean(record.contentRating) || 'adult-provider',
          retrievedAt: clean(record.lastVerifiedAt || payload.generatedAt) || new Date().toISOString()
        },
        contentRating: {
          adult: true,
          classification: clean(record.contentRating) || 'adult-provider',
          source: provider
        },
        title: clean(record.title),
        titles: {
          english: null,
          romaji: clean(record.title),
          japanese: clean(record.japaneseTitle) || null,
          aliases: unique(record.aliases || [])
        },
        description: clean(record.description) || null,
        poster: clean(record.poster) || null,
        background: clean(record.background) || null,
        year: Number(record.year || 0) || null,
        releaseDate: clean(record.releaseDate) || null,
        studio: clean(record.studio || record.brand) || null,
        genres: unique(record.genres || ['Hentai']),
        tags: unique(record.tags || ['hentai']),
        censorStatus: clean(record.censorStatus) || 'unknown',
        languageVersions: [],
        episodes: [],
        providerMappings: []
      }] }).titles[0];
      snapshot.titles.push(target);
      created += 1;
    } else {
      merged += 1;
    }

    target.titles.aliases = unique([
      ...(target.titles.aliases || []),
      ...(record.aliases || []),
      clean(record.providerTitle),
      clean(record.seriesTitle)
    ]);
    target.description = target.description || clean(record.description) || null;
    target.poster = target.poster || clean(record.poster) || null;
    target.background = target.background || clean(record.background) || null;
    target.artwork = { poster: target.poster || null, background: target.background || null };
    target.year = target.year || Number(record.year || 0) || null;
    target.releaseDate = target.releaseDate || clean(record.releaseDate) || null;
    target.studio = target.studio || clean(record.studio || record.brand) || null;
    target.genres = unique([...(target.genres || []), ...(record.genres || [])]);
    target.tags = unique([...(target.tags || []), ...(record.tags || [])]);
    target.censorStatus = aggregateCensorStatus(target.censorStatus, record.censorStatus);

    const mapping = normalizeProviderMapping({
      provider,
      providerId: record.providerId,
      seriesId: record.seriesId,
      slug: record.slug,
      url: record.url,
      title: record.providerTitle || record.title,
      censorStatus: record.censorStatus,
      audioLanguages: record.audioLanguages,
      subtitleLanguages: record.subtitleLanguages,
      tags: record.tags,
      qualities: record.qualities,
      lastVerifiedAt: record.lastVerifiedAt || payload.generatedAt,
      metadata: record.metadata
    });

    if (mapping) {
      const existingIndex = target.providerMappings.findIndex((item) =>
        item.provider === mapping.provider &&
        (item.seriesId || item.slug || item.providerId || '') === (mapping.seriesId || mapping.slug || mapping.providerId || '')
      );
      if (existingIndex >= 0) target.providerMappings[existingIndex] = mapping;
      else target.providerMappings.push(mapping);
    }

    const audioLanguages = unique(record.audioLanguages || []);
    const subtitleLanguages = unique(record.subtitleLanguages || []);
    if (audioLanguages.length || subtitleLanguages.length) {
      const audioValues = audioLanguages.length ? audioLanguages : [null];
      for (const audio of audioValues) {
        const version = normalizeLanguageVersion({
          audio,
          subtitles: subtitleLanguages,
          source: provider,
          verifiedAt: record.lastVerifiedAt || payload.generatedAt
        });
        if (version && !target.languageVersions.some((item) =>
          item.audio === version.audio &&
          item.source === version.source &&
          JSON.stringify(item.subtitles) === JSON.stringify(version.subtitles)
        )) {
          target.languageVersions.push(version);
        }
      }
    }

    for (const episode of record.episodes || []) mergeEpisode(target, provider, episode);
    target.episodes.sort((a, b) => a.number - b.number);
    addProvenance(target, provider, record, payload);
  }

  const output = normalizeSnapshot({ ...snapshot, generatedAt: new Date().toISOString() });
  const validation = validateSnapshot(output);
  if (!validation.ok) throw new Error(`Provider merge validation failed:\n- ${validation.errors.join('\n- ')}`);

  return {
    snapshot: output,
    stats: { provider, merged, created, skipped, total: output.titles.length }
  };
}
