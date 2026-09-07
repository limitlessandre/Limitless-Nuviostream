const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed.json'), 'utf8'));
const required = ['id', 'type', 'adult', 'sourceConfidence', 'title', 'titles', 'genres', 'tags', 'languageVersions', 'censorStatus', 'episodes'];
const ids = new Set();
for (const title of seed.titles) {
  if (title.adult !== true) throw new Error(`Rejected non-adult record: ${title.id}`);
  if (!/^(mal|anilist|sp):/.test(title.id)) throw new Error(`Unsupported stable ID: ${title.id}`);
  if (required.some((key) => !(key in title))) throw new Error(`Missing schema field on ${title.id}`);
  if (ids.has(title.id)) throw new Error(`Duplicate ID: ${title.id}`);
  ids.add(title.id);
}
if (!seed.titles.length) throw new Error('Refusing to publish an empty snapshot');
const candidate = { ...seed, generatedAt: new Date().toISOString() };
const snapshotDir = path.join(root, 'data', 'snapshots');
fs.mkdirSync(snapshotDir, { recursive: true });
const staged = path.join(snapshotDir, 'candidate.json');
const live = path.join(snapshotDir, 'current.json');
fs.writeFileSync(staged, JSON.stringify(candidate, null, 2) + '\n');
fs.renameSync(staged, live); // atomic promotion; existing current is last-known-good until this succeeds
console.log(`Published ${candidate.titles.length} adult-only records to ${live}`);
