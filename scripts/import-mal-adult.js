const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data', 'imports', 'mal-adult-verified.json'), 'utf8'));
if (!Array.isArray(source.titles) || source.titles.length === 0) throw new Error('MAL import is empty');
const ids = new Set();
const titles = source.titles.map((record) => {
  if (record.rating !== 'Rx - Hentai') throw new Error(`Rejected non-adult MAL record ${record.malId}`);
  if (!Number.isInteger(record.malId) || ids.has(record.malId)) throw new Error(`Invalid or duplicate MAL ID ${record.malId}`);
  ids.add(record.malId);
  return { id: `mal:${record.malId}`, type: 'series', adult: true, sourceConfidence: 'MAL', sourceMetadata: { source: source.source, sourceUrl: record.sourceUrl, rating: record.rating, retrievedAt: source.retrievedAt }, title: record.title, titles: { english: null, romaji: record.romaji, japanese: record.japanese, aliases: record.aliases }, description: record.description, poster: record.poster, year: record.year, releaseDate: record.releaseDate, updatedAt: null, studio: record.studio, genres: record.genres, tags: ['hentai'], languageVersions: [], censorStatus: 'unknown', episodes: Array.from({ length: record.episodes }, (_, index) => ({ number: index + 1, title: `Episode ${index + 1}`, releaseDate: null })), providerMappings: [] };
});
const candidate = { schemaVersion: 1, generatedAt: new Date().toISOString(), titles };
const staged = path.join(root, 'data', 'seed.candidate.json');
const target = path.join(root, 'data', 'seed.json');
fs.writeFileSync(staged, JSON.stringify(candidate, null, 2) + '\n');
fs.renameSync(staged, target);
console.log(`Imported ${titles.length} MAL adult-only records`);
