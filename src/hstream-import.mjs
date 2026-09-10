const clean = (value) => String(value == null ? '' : value).trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];

function humanizeSlug(value) {
  return clean(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function comparable(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function positiveEpisodeNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function seriesTitleFromRow(row) {
  const raw = clean(row?.title);
  const slugTitle = humanizeSlug(row?.slug);
  if (!raw) return slugTitle;
  if (!slugTitle) return raw;

  const episodeNumbers = new Set((Array.isArray(row?.episodes) ? row.episodes : [])
    .map((episode) => positiveEpisodeNumber(episode?.episode))
    .filter(Boolean));

  const match = raw.match(/^(.*?)(?:\s*[-–—:]\s*|\s+)(?:episode\s*)?(\d+)\s*$/i);
  if (match) {
    const prefix = clean(match[1]);
    const number = Number(match[2]);
    if (prefix && episodeNumbers.has(number) && comparable(prefix) === comparable(slugTitle)) return prefix;
  }

  return raw;
}

function makeEpisode(seriesSlug, seriesId, row, now, baseUrl) {
  const number = positiveEpisodeNumber(row?.episode);
  const slug = clean(row?.slug);
  if (!number || !slug) return null;
  return {
    number,
    title: `Episode ${number}`,
    releaseDate: null,
    runtimeSeconds: null,
    thumbnail: null,
    overview: null,
    censorStatus: 'unknown',
    audioLanguages: [],
    subtitleLanguages: [],
    providerId: `${seriesSlug}:episode:${number}`,
    seriesId,
    slug,
    url: `${baseUrl}/hentai/${encodeURIComponent(slug)}`,
    tags: [],
    qualities: [],
    lastVerifiedAt: now,
    metadata: {
      sourceHost: 'hstream.moe',
      sourceEndpoint: '/v1/hentai-list'
    }
  };
}

export function buildHStreamProviderImport(input, now = new Date().toISOString(), options = {}) {
  const minRecords = Number.isInteger(options.minRecords) ? options.minRecords : 100;
  const baseUrl = clean(options.baseUrl || input?.baseUrl || 'https://hstream.moe').replace(/\/$/, '');
  const sourceRows = Array.isArray(input) ? input : Array.isArray(input?.records) ? input.records : [];
  if (sourceRows.length < minRecords) throw new Error(`HStream feed is unexpectedly small: ${sourceRows.length}`);

  const records = [];
  let sourceEpisodeCount = 0;
  let skippedEpisodes = 0;

  for (const row of sourceRows) {
    const rawTitle = clean(row?.title);
    const title = seriesTitleFromRow(row);
    const japaneseTitle = clean(row?.title_jpn);
    const slug = clean(row?.slug);
    if (!title || !slug) continue;

    const seriesId = `hstream:series:${slug}`;
    const rawEpisodes = Array.isArray(row?.episodes) ? row.episodes : [];
    const episodes = [];
    for (const episodeRow of rawEpisodes) {
      const episode = makeEpisode(slug, seriesId, episodeRow, now, baseUrl);
      if (episode) episodes.push(episode);
      else skippedEpisodes += 1;
    }
    episodes.sort((a, b) => a.number - b.number);
    sourceEpisodeCount += episodes.length;

    const slugAlias = humanizeSlug(slug);
    const aliases = unique([
      rawTitle && rawTitle.toLowerCase() !== title.toLowerCase() ? rawTitle : null,
      slugAlias && slugAlias.toLowerCase() !== title.toLowerCase() ? slugAlias : null,
      japaneseTitle || null
    ]);
    const firstEpisodeUrl = episodes[0]?.url || `${baseUrl}/search?search=${encodeURIComponent(title)}`;

    records.push({
      providerId: slug,
      seriesId,
      slug,
      title,
      providerTitle: rawTitle || title,
      seriesTitle: title,
      japaneseTitle: japaneseTitle || null,
      aliases,
      description: null,
      poster: null,
      background: null,
      brand: null,
      studio: null,
      year: null,
      releaseDate: null,
      genres: ['Hentai'],
      tags: [],
      censorStatus: 'unknown',
      audioLanguages: [],
      subtitleLanguages: [],
      qualities: [],
      url: firstEpisodeUrl,
      lastVerifiedAt: now,
      metadata: {
        sourceHost: 'hstream.moe',
        sourceEndpoint: '/v1/hentai-list',
        sourceSeriesSlug: slug,
        sourceTitle: rawTitle || null,
        sourceEpisodeCount: episodes.length,
        japaneseTitle: japaneseTitle || null
      },
      episodes
    });
  }

  records.sort((a, b) => a.title.localeCompare(b.title));
  if (records.length < minRecords) throw new Error(`HStream normalization produced suspiciously few records: ${records.length}`);

  return {
    provider: 'hstream',
    schemaVersion: 1,
    generatedAt: now,
    source: `${baseUrl}/v1/hentai-list`,
    sourceRecordCount: sourceRows.length,
    sourceEpisodeCount,
    skippedEpisodes,
    records
  };
}

export const _test = { humanizeSlug, comparable, positiveEpisodeNumber, seriesTitleFromRow, makeEpisode };
