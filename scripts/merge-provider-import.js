const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const clean = (value) => String(value == null ? '' : value).trim();
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
const canonical = (value) => clean(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\bwo\b/g, 'o')
  .replace(/\bseason\s+\d+\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '')
  .trim();

function aggregateCensorStatus(current, incoming) {
  const a = clean(current).toLowerCase() || 'unknown';
  const b = clean(incoming).toLowerCase() || 'unknown';
  if (b === 'unknown') return a;
  if (a === 'unknown') return b;
  if (a === b) return a;
  return 'mixed';
}

function stableProviderId(provider, record) {
  const slug = clean(record.slug || record.providerId || record.id || record.title).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `sp:${provider}:${slug || 'untitled'}`;
}

function titleCandidates(record) {
  return unique([record.title, ...(Array.isArray(record.aliases) ? record.aliases : []), record.providerTitle]);
}

function findStrongMatch(titles, record) {
  if (record.canonicalId) {
    const direct = titles.find((title) => title.id === record.canonicalId);
    if (direct) return direct;
  }
  const wanted = new Set(titleCandidates(record).map(canonical).filter(Boolean));
  if (!wanted.size) return null;
  const year = Number(record.year || 0) || null;
  const matches = titles.filter((title) => {
    const candidates = [title.title, title.titles?.english, title.titles?.romaji, ...(title.titles?.aliases || [])].map(canonical).filter(Boolean);
    if (!candidates.some((candidate) => wanted.has(candidate))) return false;
    if (year && title.year && Number(title.year) !== year) return false;
    return true;
  });
  return matches.length === 1 ? matches[0] : null;
}

function mergeEpisode(target, provider, record, normalizeProviderMapping) {
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
  }
  const mapping = normalizeProviderMapping({
    provider,
    providerId: record.providerId,
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
  if (mapping && !episode.providerMappings.some((item) => item.provider === mapping.provider && (item.slug || item.providerId) === (mapping.slug || mapping.providerId))) {
    episode.providerMappings.push(mapping);
  }
  episode.censorStatus = aggregateCensorStatus(episode.censorStatus, record.censorStatus);
  episode.audioLanguages = unique([...(episode.audioLanguages || []), ...(record.audioLanguages || [])]);
  episode.subtitleLanguages = unique([...(episode.subtitleLanguages || []), ...(record.subtitleLanguages || [])]);
}

async function main() {
  const importPath = process.argv[2];
  if (!importPath) throw new Error('Usage: node scripts/merge-provider-import.js <provider-import.json>');
  const resolvedImport = path.resolve(process.cwd(), importPath);
  const payload = JSON.parse(fs.readFileSync(resolvedImport, 'utf8'));
  const provider = clean(payload.provider).toLowerCase();
  if (!provider) throw new Error('Provider import is missing provider');
  if (!Array.isArray(payload.records)) throw new Error('Provider import records must be an array');

  const { normalizeSnapshot, normalizeProviderMapping, normalizeLanguageVersion, validateSnapshot } = await import(pathToFileURL(path.join(root, 'src', 'schema.mjs')).href);
  const seedPath = path.join(root, 'data', 'seed.json');
  const seed = normalizeSnapshot(JSON.parse(fs.readFileSync(seedPath, 'utf8')));
  let merged = 0;
  let created = 0;

  for (const record of payload.records) {
    if (!record || !clean(record.title)) continue;
    let target = findStrongMatch(seed.titles, record);
    if (!target) {
      target = normalizeSnapshot({ titles: [{
        id: stableProviderId(provider, record),
        type: 'series',
        adult: true,
        sourceConfidence: provider,
        sourceMetadata: {
          source: `${provider} provider import`,
          sourceUrl: clean(record.url) || null,
          rating: clean(record.contentRating) || null,
          retrievedAt: clean(record.lastVerifiedAt || payload.generatedAt) || new Date().toISOString()
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
      seed.titles.push(target);
      created += 1;
    } else {
      merged += 1;
    }

    target.titles.aliases = unique([...(target.titles.aliases || []), ...(record.aliases || []), clean(record.providerTitle)]);
    target.description = target.description || clean(record.description) || null;
    target.poster = target.poster || clean(record.poster) || null;
    target.background = target.background || clean(record.background) || null;
    target.artwork = { poster: target.poster || null, background: target.background || null };
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
      const existingIndex = target.providerMappings.findIndex((item) => item.provider === mapping.provider && (item.slug || item.providerId || '') === (mapping.slug || mapping.providerId || ''));
      if (existingIndex >= 0) target.providerMappings[existingIndex] = mapping;
      else target.providerMappings.push(mapping);
    }

    if ((record.audioLanguages || []).length || (record.subtitleLanguages || []).length) {
      for (const audio of record.audioLanguages || [null]) {
        const version = normalizeLanguageVersion({ audio, subtitles: record.subtitleLanguages || [], source: provider, verifiedAt: record.lastVerifiedAt || payload.generatedAt });
        if (version && !target.languageVersions.some((item) => item.audio === version.audio && item.source === version.source && JSON.stringify(item.subtitles) === JSON.stringify(version.subtitles))) {
          target.languageVersions.push(version);
        }
      }
    }

    for (const episode of record.episodes || []) mergeEpisode(target, provider, episode, normalizeProviderMapping);
    target.episodes.sort((a, b) => a.number - b.number);
    target.provenance.lastMergedAt = new Date().toISOString();
  }

  const output = normalizeSnapshot({ ...seed, generatedAt: new Date().toISOString() });
  const validation = validateSnapshot(output);
  if (!validation.ok) throw new Error(`Provider merge validation failed:\n- ${validation.errors.join('\n- ')}`);
  const staged = path.join(root, 'data', 'seed.provider-merge.candidate.json');
  fs.writeFileSync(staged, JSON.stringify(output, null, 2) + '\n');
  fs.renameSync(staged, seedPath);
  console.log(`Merged provider ${provider}: ${merged} canonical matches, ${created} new sp: records, ${output.titles.length} total titles`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
