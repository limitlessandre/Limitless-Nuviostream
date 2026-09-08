import { aggregateCensorStatus, canonicalProviderTitle } from './provider-merge.mjs';

const clean = (value) => String(value == null ? '' : value).trim();
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];

function slugify(value) {
  return clean(value).toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function explicitEpisodeSuffix(title) {
  return /(?:\s|[-–—])(?:episode|ep\.?|e)\s*\d+\s*$/i.test(clean(title));
}

function seasonNumber(title) {
  const match = clean(title).match(/\sseason\s+(\d+)\s*$/i);
  return match ? Number(match[1]) : null;
}

function explicitSeasonSuffix(title) {
  return seasonNumber(title) !== null;
}

function trailingBareNumber(title) {
  return /\s\d+\s*$/.test(clean(title)) && !explicitSeasonSuffix(title) && !explicitEpisodeSuffix(title);
}

function isoOrNull(value) {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function earliestDate(records) {
  return records.map((record) => isoOrNull(record.releaseDate)).filter(Boolean).sort()[0] || null;
}

function firstNonEmpty(records, field) {
  for (const record of records) {
    const value = clean(record[field]);
    if (value) return value;
  }
  return null;
}

function mostCommon(records, field) {
  const counts = new Map();
  for (const record of records) {
    const value = clean(record[field]);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

function censorFor(records) {
  return records.reduce((status, record) => aggregateCensorStatus(status, record.censorStatus), 'unknown');
}

function runtimeSeconds(record) {
  const seconds = Number(record?.metadata?.duration_in_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  const milliseconds = Number(record?.metadata?.duration_in_ms);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.round(milliseconds / 1000);
  return null;
}

function candidateStats(records) {
  const map = new Map();
  for (const record of records) {
    const base = clean(record.seriesTitle);
    if (!base || base === clean(record.title)) continue;
    const key = canonicalProviderTitle(base);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { records: [], episodes: new Set(), seasons: new Set() });
    const stat = map.get(key);
    stat.records.push(record);
    const episode = Number(record.episode || 0);
    if (Number.isInteger(episode) && episode > 0) stat.episodes.add(episode);
    const season = seasonNumber(record.title);
    if (Number.isInteger(season) && season > 0) stat.seasons.add(season);
  }
  return map;
}

function chooseBaseTitle(record, stats) {
  const title = clean(record.title);
  const base = clean(record.seriesTitle) || title;
  if (!base || base === title) return { title, grouped: false, includeSeriesAlias: true };

  if (explicitEpisodeSuffix(title)) return { title: base, grouped: true, includeSeriesAlias: true };

  if (explicitSeasonSuffix(title)) {
    const season = seasonNumber(title);
    const stat = stats.get(canonicalProviderTitle(base));
    if (season === 1 && stat && stat.seasons.size === 1) {
      return { title: base, grouped: true, includeSeriesAlias: true };
    }
    return { title, grouped: false, includeSeriesAlias: false };
  }

  if (trailingBareNumber(title)) {
    const stat = stats.get(canonicalProviderTitle(base));
    if (stat && stat.records.length >= 2 && stat.episodes.size >= 2) return { title: base, grouped: true, includeSeriesAlias: true };
    return { title, grouped: false, includeSeriesAlias: false };
  }

  return { title: base, grouped: true, includeSeriesAlias: true };
}

function normalizeEpisode(record, index, grouped) {
  let number = Number(record.episode || 0);
  if (!Number.isInteger(number) || number <= 0) number = index + 1;
  if (!grouped && (trailingBareNumber(record.title) || explicitSeasonSuffix(record.title)) && !explicitEpisodeSuffix(record.title)) number = 1;
  return {
    number,
    title: clean(record.title) || `Episode ${number}`,
    releaseDate: isoOrNull(record.releaseDate),
    runtimeSeconds: runtimeSeconds(record),
    thumbnail: clean(record.poster || record.background) || null,
    overview: clean(record.description) || null,
    censorStatus: clean(record.censorStatus) || 'unknown',
    audioLanguages: unique(record.audioLanguages || []),
    subtitleLanguages: unique(record.subtitleLanguages || []),
    providerId: clean(record.providerId) || clean(record.slug),
    seriesId: null,
    slug: clean(record.slug) || null,
    url: clean(record.url) || null,
    tags: unique(record.tags || []),
    qualities: [],
    lastVerifiedAt: null,
    metadata: {
      ...(record.metadata || {}),
      hanimeProviderTitle: clean(record.providerTitle || record.title) || null
    }
  };
}

export function buildHanimeProviderImport(feed, now = new Date().toISOString(), options = {}) {
  const minRecords = Number.isInteger(options.minRecords) ? options.minRecords : 100;
  if (!feed || feed.provider !== 'hanime') throw new Error('Hanime feed provider must be hanime');
  if (!Array.isArray(feed.records) || feed.records.length < minRecords) throw new Error(`Hanime feed is unexpectedly small: ${feed.records?.length || 0}`);

  const records = feed.records.filter((record) => record && clean(record.title) && clean(record.slug));
  const stats = candidateStats(records);
  const groups = new Map();

  for (const record of records) {
    const chosen = chooseBaseTitle(record, stats);
    const key = canonicalProviderTitle(chosen.title) || `slug:${clean(record.slug)}`;
    if (!groups.has(key)) groups.set(key, { title: chosen.title, grouped: chosen.grouped, includeSeriesAlias: chosen.includeSeriesAlias, records: [] });
    const group = groups.get(key);
    group.grouped = group.grouped || chosen.grouped;
    group.includeSeriesAlias = group.includeSeriesAlias && chosen.includeSeriesAlias;
    group.records.push(record);
  }

  const outputRecords = [];
  for (const group of groups.values()) {
    const groupRecords = group.records.sort((a, b) => {
      const ep = Number(a.episode || 1) - Number(b.episode || 1);
      return ep || clean(a.slug).localeCompare(clean(b.slug));
    });
    const seriesId = `hanime:series:${slugify(group.title)}`;
    const episodes = groupRecords
      .map((record, index) => normalizeEpisode(record, index, group.grouped))
      .map((episode) => ({ ...episode, seriesId, lastVerifiedAt: now }))
      .sort((a, b) => a.number - b.number || clean(a.slug).localeCompare(clean(b.slug)));

    const aliases = unique(groupRecords.flatMap((record) => [
      ...list(record.aliases),
      clean(record.title),
      clean(record.providerTitle),
      ...(group.includeSeriesAlias ? [clean(record.seriesTitle)] : [])
    ])).filter((value) => canonicalProviderTitle(value) !== canonicalProviderTitle(group.title));

    const tags = unique(groupRecords.flatMap((record) => record.tags || []));
    const audioLanguages = unique(groupRecords.flatMap((record) => record.audioLanguages || []));
    const subtitleLanguages = unique(groupRecords.flatMap((record) => record.subtitleLanguages || []));
    const releaseDate = earliestDate(groupRecords);
    const providerSlug = groupRecords.length === 1 ? clean(groupRecords[0].slug) || null : null;
    const providerId = groupRecords.length === 1
      ? clean(groupRecords[0].providerId || groupRecords[0].slug)
      : seriesId;
    const providerUrl = clean(groupRecords[0].url) || null;

    outputRecords.push({
      providerId,
      seriesId,
      slug: providerSlug,
      title: group.title,
      providerTitle: group.title,
      seriesTitle: group.title,
      aliases,
      description: firstNonEmpty(groupRecords, 'description'),
      poster: firstNonEmpty(groupRecords, 'poster'),
      background: firstNonEmpty(groupRecords, 'background'),
      brand: mostCommon(groupRecords, 'brand'),
      studio: mostCommon(groupRecords, 'brand'),
      year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
      releaseDate,
      genres: ['Hentai'],
      tags,
      censorStatus: censorFor(groupRecords),
      audioLanguages,
      subtitleLanguages,
      qualities: [],
      url: providerUrl,
      lastVerifiedAt: now,
      metadata: {
        sourceRecordCount: groupRecords.length,
        episodeCount: episodes.length,
        sourceSlugs: groupRecords.map((record) => clean(record.slug)).filter(Boolean),
        sourceProviderIds: groupRecords.map((record) => clean(record.providerId)).filter(Boolean),
        brands: unique(groupRecords.map((record) => record.brand)),
        feedGeneratedAt: clean(feed.generatedAt) || null
      },
      episodes
    });
  }

  outputRecords.sort((a, b) => a.title.localeCompare(b.title));
  return {
    provider: 'hanime',
    schemaVersion: 1,
    generatedAt: now,
    source: clean(feed.source) || 'Scarlet Peach Hanime catalog feed',
    sourceRecordCount: records.length,
    records: outputRecords
  };
}
